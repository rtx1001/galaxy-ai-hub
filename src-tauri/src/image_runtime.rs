use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::app_paths;
use crate::config_store::load_app_settings;

#[derive(Debug, Clone)]
pub struct ImageGenerationOutput {
    pub image_base64: String,
    pub mime_type: String,
    pub file_path: String,
}

#[derive(Debug, Clone)]
struct ImageModelProfile {
    key: String,
    backend: ImageBackend,
    diffusion: PathBuf,
    vae: PathBuf,
    llm: PathBuf,
    vision: Option<PathBuf>,
    steps: u32,
    sampler: &'static str,
    width_cap: u32,
    height_cap: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ImageBackend {
    ZImage,
    QwenEdit,
}

struct ImageServerProcess {
    key: String,
    port: u16,
    child: Child,
}

static IMAGE_SERVER: OnceLock<Mutex<Option<ImageServerProcess>>> = OnceLock::new();

const QWEN_IMAGE_MODELS: &[&str] = &[
    "Qwen-Rapid-NSFW-v23_Q8_0.gguf",
    "Qwen-Rapid-NSFW-v23_Q6_K.gguf",
    "Qwen-Rapid-NSFW-v23_Q5_K.gguf",
    "Qwen-Rapid-NSFW-v23_Q4_K.gguf",
    "Qwen-Rapid-NSFW-v23_Q3_K.gguf",
    "Qwen-Rapid-NSFW-v23_Q2_K.gguf",
];
const QWEN_IMAGE_LLMS: &[&str] = &[
    "Qwen2.5-VL-7B-Instruct.Q8_0.gguf",
    "Qwen2.5-VL-7B-Instruct.Q6_K.gguf",
    "Qwen2.5-VL-7B-Instruct.Q5_K_M.gguf",
    "Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf",
    "Qwen2.5-VL-7B-Instruct.Q3_K_M.gguf",
    "Qwen2.5-VL-7B-Instruct.Q2_K.gguf",
];
const QWEN_IMAGE_VISION: &str = "Qwen2.5-VL-7B-Instruct.mmproj-Q8_0.gguf";
const QWEN_IMAGE_VAE: &str = "qwen_image_vae.safetensors";

fn app_root_dir() -> PathBuf {
    app_paths::app_root_dir()
}

fn assistant_runtime_dir() -> PathBuf {
    app_root_dir().join("assistant-runtime")
}

fn sdcpp_dir() -> PathBuf {
    assistant_runtime_dir().join("sdcpp")
}

fn sdcpp_output_dir() -> PathBuf {
    sdcpp_dir().join("output")
}

fn sdcpp_input_dir() -> PathBuf {
    sdcpp_dir().join("input")
}

fn sd_server_path() -> PathBuf {
    app_root_dir()
        .join("bin")
        .join("stable-diffusion")
        .join(if cfg!(windows) {
            "sd-server.exe"
        } else {
            "sd-server"
        })
}

fn qwen_edit_dir() -> PathBuf {
    sdcpp_dir().join("models").join("qwen-edit")
}

fn z_image_dir() -> PathBuf {
    sdcpp_dir().join("models").join("z-image-turbo")
}

fn append_image_log(message: &str) {
    crate::assistant_runtime::append_runtime_log("image-trace", message);
}

fn selected_tier_hint() -> String {
    let settings = load_app_settings().unwrap_or_default();
    let selected = settings.selected_model_path.to_lowercase();
    if selected.contains("e2b") || selected.contains("light") {
        "light".to_string()
    } else if selected.contains("q8") || selected.contains("high") {
        "high".to_string()
    } else {
        "balanced".to_string()
    }
}

fn existing_first(root: &Path, names: &[&str]) -> Option<PathBuf> {
    names
        .iter()
        .map(|name| root.join(name))
        .find(|path| path.exists())
}

fn z_image_profile_for_tier(tier: &str) -> Option<ImageModelProfile> {
    let root = z_image_dir();
    let diffusion_name = if tier == "light" {
        "z_image_turbo-Q4_K.gguf"
    } else {
        "z_image_turbo-Q6_K.gguf"
    };
    let diffusion = root.join(diffusion_name);
    let vae = root.join("ae.safetensors");
    let llm = root.join("qwen3-4b-abl-q4_0.gguf");
    if sd_server_path().exists() && diffusion.exists() && vae.exists() && llm.exists() {
        Some(ImageModelProfile {
            key: format!("z-image-{}-{}", tier, diffusion_name),
            backend: ImageBackend::ZImage,
            diffusion,
            vae,
            llm,
            vision: None,
            steps: 8,
            sampler: "euler",
            width_cap: if tier == "light" { 512 } else { 1024 },
            height_cap: if tier == "light" { 512 } else { 1024 },
        })
    } else {
        None
    }
}

fn qwen_profile() -> Option<ImageModelProfile> {
    let root = qwen_edit_dir();
    let diffusion = existing_first(&root, QWEN_IMAGE_MODELS)?;
    let vae = root.join("vae").join(QWEN_IMAGE_VAE);
    let llm = existing_first(&root.join("text_encoders"), QWEN_IMAGE_LLMS)?;
    let vision = root.join("text_encoders").join(QWEN_IMAGE_VISION);
    if sd_server_path().exists()
        && diffusion.exists()
        && vae.exists()
        && llm.exists()
        && vision.exists()
    {
        Some(ImageModelProfile {
            key: format!(
                "qwen-edit-{}",
                diffusion
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("model")
            ),
            backend: ImageBackend::QwenEdit,
            diffusion,
            vae,
            llm,
            vision: Some(vision),
            steps: 4,
            sampler: "euler_a",
            width_cap: 1536,
            height_cap: 1536,
        })
    } else {
        None
    }
}

fn resolve_image_profile() -> Result<ImageModelProfile, String> {
    let tier = selected_tier_hint();
    let preferred = if tier == "high" {
        qwen_profile()
    } else {
        z_image_profile_for_tier(&tier)
    };
    preferred
        .or_else(|| z_image_profile_for_tier("balanced"))
        .or_else(|| z_image_profile_for_tier("light"))
        .or_else(qwen_profile)
        .ok_or_else(|| {
            "Image Studio is not fully installed. Install or repair the selected setup tier first."
                .to_string()
        })
}

fn reserve_local_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Could not reserve an Image Studio port: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Could not read the Image Studio port: {}", e))?
        .port();
    drop(listener);
    Ok(port)
}

fn stop_server_locked(server: &mut Option<ImageServerProcess>) {
    if let Some(mut running) = server.take() {
        let _ = running.child.kill();
        let _ = running.child.wait();
        append_image_log(&format!("sd-server stopped key={}", running.key));
    }
}

pub fn shutdown_image_server() {
    if let Ok(mut guard) = IMAGE_SERVER.get_or_init(|| Mutex::new(None)).lock() {
        stop_server_locked(&mut guard);
    }
}

fn spawn_server(profile: &ImageModelProfile, port: u16) -> Result<Child, String> {
    let mut command = Command::new(sd_server_path());
    command
        .arg("--listen-ip")
        .arg("127.0.0.1")
        .arg("--listen-port")
        .arg(port.to_string())
        .arg("--diffusion-model")
        .arg(&profile.diffusion)
        .arg("--vae")
        .arg(&profile.vae)
        .arg("--llm")
        .arg(&profile.llm)
        .arg("--cfg-scale")
        .arg("1")
        .arg("--sampling-method")
        .arg(profile.sampler)
        .arg("--steps")
        .arg(profile.steps.to_string())
        .arg("--offload-to-cpu")
        .arg("--diffusion-fa");
    if let Some(vision) = &profile.vision {
        command.arg("--llm_vision").arg(vision);
    }
    if profile.backend == ImageBackend::QwenEdit {
        command
            .arg("--flow-shift")
            .arg("3")
            .arg("--qwen-image-zero-cond-t");
    }
    command.stdout(Stdio::null()).stderr(Stdio::null());
    crate::process_util::hide_window(&mut command);
    command
        .spawn()
        .map_err(|e| format!("Could not start Image Studio server: {}", e))
}

async fn wait_for_server_ready(
    client: &Client,
    port: u16,
    child: &mut Child,
) -> Result<(), String> {
    let base = format!("http://127.0.0.1:{}", port);
    let started = Instant::now();
    loop {
        match client
            .get(format!("{}/sdcpp/v1/capabilities", base))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => return Ok(()),
            _ => {}
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "Image Studio server exited before it became ready: {}",
                status
            ));
        }
        if started.elapsed() > Duration::from_secs(90) {
            return Err("Image Studio started, but it did not become ready in time.".to_string());
        }
        tokio::time::sleep(Duration::from_millis(350)).await;
    }
}

async fn ensure_server(profile: &ImageModelProfile, client: &Client) -> Result<u16, String> {
    let mut existing: Option<(u16, bool)> = None;
    {
        let mut guard = IMAGE_SERVER
            .get_or_init(|| Mutex::new(None))
            .lock()
            .map_err(|_| "Image Studio server lock failed.".to_string())?;
        if let Some(server) = guard.as_mut() {
            let exited = server
                .child
                .try_wait()
                .map_err(|e| format!("Could not check Image Studio server: {}", e))?
                .is_some();
            if exited || server.key != profile.key {
                stop_server_locked(&mut guard);
            } else {
                existing = Some((server.port, true));
            }
        }
    }
    if let Some((port, _)) = existing {
        return Ok(port);
    }

    let port = reserve_local_port()?;
    let mut child = spawn_server(profile, port)?;
    append_image_log(&format!(
        "sd-server starting key={} port={} diffusion=\"{}\"",
        profile.key,
        port,
        profile.diffusion.display()
    ));
    wait_for_server_ready(client, port, &mut child).await?;
    append_image_log(&format!(
        "sd-server ready key={} port={}",
        profile.key, port
    ));
    let mut guard = IMAGE_SERVER
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Image Studio server lock failed.".to_string())?;
    stop_server_locked(&mut guard);
    *guard = Some(ImageServerProcess {
        key: profile.key.clone(),
        port,
        child,
    });
    Ok(port)
}

fn clamp_dimension(value: Option<u32>, cap: u32) -> u32 {
    value.unwrap_or(cap).clamp(256, cap)
}

fn extension_from_data_url(data_url: &str) -> &'static str {
    if data_url.starts_with("data:image/jpeg") || data_url.starts_with("data:image/jpg") {
        "jpg"
    } else if data_url.starts_with("data:image/webp") {
        "webp"
    } else {
        "png"
    }
}

fn save_reference_image(data_url_or_path: &str) -> Result<String, String> {
    let value = data_url_or_path.trim();
    if value.is_empty() {
        return Err("No input image was provided.".to_string());
    }
    if value.starts_with("data:image/") {
        let (_, encoded) = value
            .split_once(',')
            .ok_or_else(|| "Attached image data is not a valid data URL.".to_string())?;
        let bytes = BASE64
            .decode(encoded)
            .map_err(|e| format!("Could not decode the attached image: {}", e))?;
        let input_dir = sdcpp_input_dir();
        std::fs::create_dir_all(&input_dir)
            .map_err(|e| format!("Could not prepare the image input folder: {}", e))?;
        let extension = extension_from_data_url(value);
        let hash = crate::assistant_runtime::stable_bytes_hash(&bytes);
        let path = input_dir.join(format!("galaxy-input-{}.{}", hash, extension));
        if !path.exists() {
            std::fs::write(&path, &bytes)
                .map_err(|e| format!("Could not save the attached image: {}", e))?;
        }
        return Ok(value.to_string());
    }

    let path = PathBuf::from(value);
    if !path.exists() {
        return Err(format!("The input image file was not found: {}", value));
    }
    let bytes =
        std::fs::read(&path).map_err(|e| format!("Could not read the input image file: {}", e))?;
    let mime = match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    };
    Ok(format!("data:{};base64,{}", mime, BASE64.encode(bytes)))
}

fn generation_payload(
    profile: &ImageModelProfile,
    prompt: String,
    init_images: Vec<String>,
    mask_prompt: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
) -> Value {
    let width = clamp_dimension(width, profile.width_cap);
    let height = clamp_dimension(height, profile.height_cap);
    let mut payload = json!({
        "prompt": prompt,
        "negative_prompt": "",
        "clip_skip": -1,
        "width": width,
        "height": height,
        "strength": 0.55,
        "seed": -1,
        "batch_count": 1,
        "auto_resize_ref_image": true,
        "increase_ref_index": false,
        "control_strength": 0.9,
        "output_format": "jpeg",
        "output_compression": 90,
        "sample_params": {
            "sample_steps": profile.steps,
            "sample_method": profile.sampler,
            "scheduler": "default",
            "shifted_timestep": 0,
            "custom_sigmas": [],
            "guidance": {
                "txt_cfg": 1.0,
                "distilled_guidance": 3.5,
                "slg": {
                    "layers": [7, 8, 9],
                    "layer_start": 0.01,
                    "layer_end": 0.2,
                    "scale": 0.0
                }
            }
        },
        "vae_tiling_params": {
            "enabled": false,
            "tile_size_x": 0,
            "tile_size_y": 0,
            "target_overlap": 0.5,
            "rel_size_x": 0.0,
            "rel_size_y": 0.0
        },
        "scm_mask": "",
        "scm_policy_dynamic": true
    });
    if profile.backend == ImageBackend::QwenEdit {
        payload["sample_params"]["flow_shift"] = json!(3.0);
    }
    if !init_images.is_empty() {
        payload["init_image"] = json!(init_images[0]);
        payload["ref_images"] = json!(init_images);
        if profile.backend == ImageBackend::ZImage {
            payload["strength"] = json!(0.35);
        }
    }
    if let Some(mask) = mask_prompt
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        payload["scm_mask"] = json!(mask);
    }
    payload
}

#[derive(Debug, Deserialize)]
struct JobSubmitResponse {
    id: String,
}

async fn submit_generation(client: &Client, port: u16, payload: &Value) -> Result<String, String> {
    let response = client
        .post(format!("http://127.0.0.1:{}/sdcpp/v1/img_gen", port))
        .json(payload)
        .send()
        .await
        .map_err(|e| format!("Could not reach Image Studio server: {}", e))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_else(|_| String::new());
    if !status.is_success() {
        return Err(format!("Image Studio returned {}. {}", status, text));
    }
    serde_json::from_str::<JobSubmitResponse>(&text)
        .map(|job| job.id)
        .or_else(|_| {
            serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|value| value.get("id").and_then(Value::as_str).map(str::to_string))
                .ok_or_else(|| {
                    format!("Image Studio returned an unreadable job response: {}", text)
                })
        })
}

async fn poll_job(client: &Client, port: u16, job_id: &str) -> Result<Value, String> {
    let started = Instant::now();
    loop {
        let response = client
            .get(format!(
                "http://127.0.0.1:{}/sdcpp/v1/jobs/{}",
                port, job_id
            ))
            .send()
            .await
            .map_err(|e| format!("Could not read Image Studio job status: {}", e))?;
        let status = response.status();
        let text = response.text().await.unwrap_or_else(|_| String::new());
        if !status.is_success() {
            return Err(format!(
                "Image Studio job poll returned {}. {}",
                status, text
            ));
        }
        let value: Value = serde_json::from_str(&text)
            .map_err(|e| format!("Image Studio returned invalid job JSON: {}", e))?;
        match value
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "completed" => return Ok(value),
            "failed" | "cancelled" => {
                return Err(format!(
                    "Image Studio job failed: {}",
                    value.get("error").cloned().unwrap_or(Value::Null)
                ))
            }
            _ => {}
        }
        if started.elapsed() > Duration::from_secs(240) {
            return Err("Image Studio did not finish in time.".to_string());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

fn image_b64_from_job(job: &Value) -> Result<(String, String), String> {
    let result = job
        .get("result")
        .ok_or_else(|| "Image Studio job has no result.".to_string())?;
    let output_format = result
        .get("output_format")
        .and_then(Value::as_str)
        .unwrap_or("jpeg")
        .to_string();
    let image_b64 = result
        .get("images")
        .and_then(Value::as_array)
        .and_then(|images| images.first())
        .and_then(|image| image.get("b64_json"))
        .and_then(Value::as_str)
        .ok_or_else(|| "Image Studio job did not return an image.".to_string())?
        .to_string();
    let mime = if output_format == "png" {
        "image/png"
    } else {
        "image/jpeg"
    };
    Ok((image_b64, mime.to_string()))
}

pub async fn generate_image(
    prompt: String,
    init_image_data_url: Option<String>,
    init_image_data_urls: Option<Vec<String>>,
    mask_prompt: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<ImageGenerationOutput, String> {
    let profile = resolve_image_profile()?;
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Could not create Image Studio client: {}", e))?;
    let mut init_images = Vec::new();
    if let Some(values) = init_image_data_urls {
        for value in values {
            let value = value.trim();
            if !value.is_empty() {
                init_images.push(save_reference_image(value)?);
            }
        }
    }
    if init_images.is_empty() {
        if let Some(value) = init_image_data_url
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            init_images.push(save_reference_image(&value)?);
        }
    }
    let payload = generation_payload(
        &profile,
        prompt.clone(),
        init_images,
        mask_prompt,
        width,
        height,
    );
    let port = ensure_server(&profile, &client).await?;
    append_image_log(&format!(
        "sd-server generate key={} port={} prompt=\"{}\"",
        profile.key,
        port,
        crate::assistant_runtime::compact_trace_text(&prompt, 600)
    ));
    let job_id = submit_generation(&client, port, &payload).await?;
    let job = poll_job(&client, port, &job_id).await?;
    let (image_base64, mime_type) = image_b64_from_job(&job)?;
    let bytes = BASE64
        .decode(&image_base64)
        .map_err(|e| format!("Could not decode generated image: {}", e))?;
    let output_dir = sdcpp_output_dir();
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Could not prepare the image output folder: {}", e))?;
    let output_path = output_dir.join(format!(
        "galaxy-image-{}.jpg",
        crate::assistant_runtime::now_millis()
    ));
    std::fs::write(&output_path, bytes)
        .map_err(|e| format!("Could not save generated image: {}", e))?;
    append_image_log(&format!(
        "sd-server completed key={} job={} file=\"{}\"",
        profile.key,
        job_id,
        output_path.display()
    ));
    let saved_bytes = std::fs::read(&output_path)
        .map_err(|e| format!("Could not read generated image: {}", e))?;
    Ok(ImageGenerationOutput {
        image_base64: BASE64.encode(saved_bytes),
        mime_type,
        file_path: output_path.to_string_lossy().to_string(),
    })
}
