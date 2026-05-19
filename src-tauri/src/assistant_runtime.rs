use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::{
    collections::HashMap,
    io::{Cursor, Write},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::agent_react::{
    self, ActionProposal, ImageProposal, ReactChatMessage, ReactChatResult, ToolResultCard,
    ToolResultItem,
};
use crate::agent_store::{
    self, list_local_memory, load_personality_chat_session, remember_local_memory,
    save_personality_chat_session,
};
use crate::character_store;
use crate::config_store::{load_app_settings, AppSettings, PersonalityPreset};
use crate::file_tools::{self, normalize_text};
use crate::google_calendar;
use crate::llama_manager::{self, LlamaState};
use crate::omnivoice_runtime::{self, OmniVoiceRuntimeState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceSetupStatus {
    pub state: String,
    pub message: String,
    pub progress: u8,
    pub ready: bool,
}

#[derive(Clone)]
pub struct VoiceRuntimeState {
    pub status: Arc<Mutex<VoiceSetupStatus>>,
    pub installing: Arc<AtomicBool>,
    pub detected_languages: Arc<Mutex<HashMap<String, DetectedVoiceLanguage>>>,
}

impl Default for VoiceRuntimeState {
    fn default() -> Self {
        Self {
            status: Arc::new(Mutex::new(VoiceSetupStatus {
                state: "idle".to_string(),
                message: "Voice helper is waiting.".to_string(),
                progress: 0,
                ready: false,
            })),
            installing: Arc::new(AtomicBool::new(false)),
            detected_languages: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct GraphicsPowerStatus {
    pub available: bool,
    pub used_mb: u32,
    pub total_mb: u32,
    pub percent: u8,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub language: String,
    pub language_probability: f32,
}

#[derive(Debug, Serialize)]
pub struct AudioSynthesisResult {
    pub audio_base64: String,
    pub mime_type: String,
}

#[derive(Debug, Serialize)]
pub struct VoiceSample {
    pub name: String,
    pub label: String,
    pub path: String,
    pub language: Option<String>,
    pub language_probability: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectedVoiceLanguage {
    pub language: String,
    pub language_probability: f32,
}

#[derive(Debug, Serialize)]
pub struct ImageGenerationResult {
    pub image_base64: String,
    pub mime_type: String,
    pub file_path: String,
}

#[derive(Debug, Serialize)]
pub struct TelegramBotStatus {
    pub success: bool,
    pub message: String,
    pub username: Option<String>,
}

#[derive(Clone)]
pub struct TelegramRuntimeState {
    worker: Arc<Mutex<Option<TelegramWorker>>>,
    session: Arc<Mutex<TelegramSessionState>>,
}

impl Default for TelegramRuntimeState {
    fn default() -> Self {
        Self {
            worker: Arc::new(Mutex::new(None)),
            session: Arc::new(Mutex::new(TelegramSessionState::default())),
        }
    }
}

struct TelegramWorker {
    stop: Arc<AtomicBool>,
    username: Option<String>,
    token: String,
    owner_id: Option<i64>,
}

#[derive(Debug, Default)]
struct TelegramSessionState {
    last_chat_id: Option<i64>,
    last_personality_id: Option<String>,
    auto_voice: bool,
    last_image_by_chat: HashMap<i64, String>,
    pending_approvals: HashMap<String, TelegramPendingApproval>,
}

#[derive(Debug, Clone)]
struct TelegramPendingApproval {
    chat_id: i64,
    personality_id: String,
    prefers_vietnamese: bool,
    reference_image_path: Option<String>,
    payload: TelegramPendingApprovalPayload,
}

#[derive(Debug, Clone)]
enum TelegramPendingApprovalPayload {
    Image(ImageProposal),
    Action(ActionProposal),
}

#[derive(Debug, Deserialize)]
struct WhisperStdout {
    text: String,
    language: String,
    language_probability: f32,
}

const VOICE_RUNTIME_SCRIPT: &str = include_str!("../python/voice_runtime.py");
const PREPARED_VOICE_SAMPLE_VERSION: &str = "v4-mono22050-normfade-8s";
const PREPARED_VOICE_SAMPLE_RATE: u32 = 22_050;
const DEFAULT_QWEN_IMAGE_MODELS: &[&str] = &[
    "Qwen-Rapid-NSFW-v23_Q4_K.gguf",
    "Qwen-Rapid-NSFW-v23_Q3_K.gguf",
    "Qwen-Rapid-NSFW-v23_Q2_K.gguf",
];
const DEFAULT_QWEN_IMAGE_LLMS: &[&str] = &[
    "Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf",
    "Qwen2.5-VL-7B-Instruct.Q3_K_M.gguf",
    "Qwen2.5-VL-7B-Instruct.Q2_K.gguf",
];
const DEFAULT_QWEN_IMAGE_VISION: &str = "Qwen2.5-VL-7B-Instruct.mmproj-Q8_0.gguf";
const DEFAULT_QWEN_IMAGE_VAE: &str = "qwen_image_vae.safetensors";

fn app_root_dir() -> PathBuf {
    crate::app_paths::app_root_dir()
}

fn assistant_runtime_dir() -> PathBuf {
    app_root_dir().join("assistant-runtime")
}

fn voices_dir(folder: Option<&str>) -> PathBuf {
    folder
        .filter(|value| !value.trim().is_empty())
        .map(|value| PathBuf::from(value.trim()))
        .unwrap_or_else(|| app_root_dir().join("voices"))
}

fn voice_runtime_dir() -> PathBuf {
    assistant_runtime_dir().join("voice")
}

fn voice_cache_dir() -> PathBuf {
    voice_runtime_dir().join("cache")
}

fn voice_temp_dir() -> PathBuf {
    voice_runtime_dir().join("temp")
}

fn prepared_voice_samples_dir() -> PathBuf {
    voice_runtime_dir().join("prepared-samples")
}

fn voice_venv_dir() -> PathBuf {
    voice_runtime_dir().join(".venv")
}

fn voice_python_path() -> PathBuf {
    voice_venv_dir().join("Scripts").join("python.exe")
}

fn voice_worker_script_path() -> PathBuf {
    voice_runtime_dir().join("voice_runtime.py")
}

fn pip_cache_dir() -> PathBuf {
    assistant_runtime_dir().join("pip-cache")
}

fn cleanup_voice_temp_dir() {
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(60 * 60 * 24))
        .unwrap_or(SystemTime::now());
    let Ok(entries) = std::fs::read_dir(voice_temp_dir()) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let stale = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .map(|modified| modified <= cutoff)
            .unwrap_or(false);
        if stale {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn cleanup_stale_prepared_samples() {
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(60 * 60 * 24 * 30))
        .unwrap_or(SystemTime::now());
    let Ok(entries) = std::fs::read_dir(prepared_voice_samples_dir()) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_staging = path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.ends_with(".tmp.wav"))
            .unwrap_or(false);
        if !is_staging {
            continue;
        }
        let stale = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .map(|modified| modified <= cutoff)
            .unwrap_or(true);
        if stale {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn update_voice_status(state: &VoiceRuntimeState, status: VoiceSetupStatus) {
    if let Ok(mut guard) = state.status.lock() {
        *guard = status;
    }
}

fn current_voice_status(state: &VoiceRuntimeState) -> VoiceSetupStatus {
    state
        .status
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or(VoiceSetupStatus {
            state: "error".to_string(),
            message: "Voice helper status is unavailable.".to_string(),
            progress: 100,
            ready: false,
        })
}

fn ensure_voice_dirs() -> Result<(), String> {
    std::fs::create_dir_all(voice_runtime_dir()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(voice_cache_dir()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(voice_temp_dir()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(prepared_voice_samples_dir()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(pip_cache_dir()).map_err(|e| e.to_string())?;
    cleanup_voice_temp_dir();
    cleanup_stale_prepared_samples();
    Ok(())
}

fn ensure_voice_worker_script() -> Result<PathBuf, String> {
    ensure_voice_dirs()?;
    let path = voice_worker_script_path();
    let needs_write = match std::fs::read_to_string(&path) {
        Ok(existing) => existing != VOICE_RUNTIME_SCRIPT,
        Err(_) => true,
    };

    if needs_write {
        std::fs::write(&path, VOICE_RUNTIME_SCRIPT).map_err(|e| e.to_string())?;
    }

    Ok(path)
}

fn command_exists(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn create_venv() -> Result<(), String> {
    if voice_python_path().exists() {
        return Ok(());
    }

    let venv_dir = voice_venv_dir();
    let status = if command_exists("py", &["-3", "--version"]) {
        Command::new("py")
            .args(["-3", "-m", "venv"])
            .arg(&venv_dir)
            .status()
    } else {
        Command::new("python")
            .args(["-m", "venv"])
            .arg(&venv_dir)
            .status()
    }
    .map_err(|e| format!("Unable to start Python for voice helper: {}", e))?;

    if !status.success() {
        return Err(
            "A compatible Python 3.10+ runtime was not found, so voice listening could not be prepared."
                .to_string(),
        );
    }

    Ok(())
}

fn run_voice_python(args: &[&str]) -> Result<std::process::Output, String> {
    let script_path = ensure_voice_worker_script()?;
    let mut command = Command::new(voice_python_path());
    command
        .arg(script_path)
        .args(args)
        .env("HF_HOME", voice_cache_dir())
        .env("HUGGINGFACE_HUB_CACHE", voice_cache_dir())
        .env("TRANSFORMERS_CACHE", voice_cache_dir())
        .env("XDG_CACHE_HOME", voice_cache_dir())
        .env("PIP_CACHE_DIR", pip_cache_dir())
        .current_dir(voice_runtime_dir());

    command
        .output()
        .map_err(|e| format!("Voice helper failed to start: {}", e))
}

fn install_voice_runtime_blocking(state: VoiceRuntimeState) {
    let result = (|| -> Result<(), String> {
        update_voice_status(
            &state,
            VoiceSetupStatus {
                state: "installing".to_string(),
                message: "Preparing voice helper...".to_string(),
                progress: 10,
                ready: false,
            },
        );

        ensure_voice_dirs()?;
        create_venv()?;

        update_voice_status(
            &state,
            VoiceSetupStatus {
                state: "installing".to_string(),
                message: "Installing listening tools...".to_string(),
                progress: 45,
                ready: false,
            },
        );

        let pip_upgrade = Command::new(voice_python_path())
            .args(["-m", "pip", "install", "--upgrade", "pip"])
            .env("PIP_CACHE_DIR", pip_cache_dir())
            .current_dir(voice_runtime_dir())
            .status()
            .map_err(|e| format!("Could not prepare pip: {}", e))?;

        if !pip_upgrade.success() {
            return Err("Could not prepare the voice installer.".to_string());
        }

        let install = Command::new(voice_python_path())
            .args(["-m", "pip", "install", "faster-whisper"])
            .env("PIP_CACHE_DIR", pip_cache_dir())
            .current_dir(voice_runtime_dir())
            .status()
            .map_err(|e| format!("Could not install faster-whisper: {}", e))?;

        if !install.success() {
            return Err("Could not install the listening helper.".to_string());
        }

        update_voice_status(
            &state,
            VoiceSetupStatus {
                state: "installing".to_string(),
                message: "Downloading the tiny listening model...".to_string(),
                progress: 80,
                ready: false,
            },
        );

        let warmup = run_voice_python(&[
            "warmup",
            "--cache-dir",
            voice_cache_dir().to_string_lossy().as_ref(),
        ])?;

        if !warmup.status.success() {
            let stderr = String::from_utf8_lossy(&warmup.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "The voice helper could not finish setting up.".to_string()
            } else {
                stderr
            });
        }

        update_voice_status(
            &state,
            VoiceSetupStatus {
                state: "ready".to_string(),
                message: "Voice helper is ready.".to_string(),
                progress: 100,
                ready: true,
            },
        );

        Ok(())
    })();

    if let Err(error) = result {
        update_voice_status(
            &state,
            VoiceSetupStatus {
                state: "error".to_string(),
                message: error,
                progress: 100,
                ready: false,
            },
        );
    }

    state.installing.store(false, Ordering::SeqCst);
}

fn audio_extension_from_data_url(data_url: &str) -> &'static str {
    if data_url.starts_with("data:audio/webm") {
        "webm"
    } else if data_url.starts_with("data:audio/mpeg") || data_url.starts_with("data:audio/mp3") {
        "mp3"
    } else if data_url.starts_with("data:audio/ogg") {
        "ogg"
    } else if data_url.starts_with("data:audio/wav") {
        "wav"
    } else if data_url.starts_with("data:audio/mp4") {
        "m4a"
    } else if data_url.starts_with("data:audio/flac") {
        "flac"
    } else if data_url.starts_with("data:audio/aac") {
        "aac"
    } else {
        "bin"
    }
}

fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let encoded = data_url
        .split_once(',')
        .map(|(_, data)| data)
        .unwrap_or(data_url);

    BASE64
        .decode(encoded)
        .map_err(|e| format!("Could not decode the recorded audio: {}", e))
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn append_runtime_log(area: &str, message: &str) {
    let log_dir = app_root_dir().join("logs");
    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let line = format!("[{}] [{}] {}\n", timestamp, area, message);

    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("galaxy-app.log"))
    {
        let _ = file.write_all(line.as_bytes());
    }
}

fn compact_trace_text(text: &str, limit: usize) -> String {
    let collapsed = text
        .replace('\r', " ")
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    collapsed.chars().take(limit).collect()
}

#[tauri::command]
pub fn append_app_log(message: String) -> Result<(), String> {
    append_runtime_log("app", &message);
    Ok(())
}

fn image_extension_from_mime(mime: &str) -> &'static str {
    match mime.to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    }
}

fn image_reference_data_url(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("data:image/") {
        return Some(trimmed.to_string());
    }
    file_tools::read_local_image_data_url(trimmed.to_string())
        .ok()
        .map(|image| image.data_url)
}

fn stable_bytes_hash(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}

fn find_existing_sdcpp_input_image(
    input_dir: &Path,
    extension: &str,
    bytes: &[u8],
) -> Option<PathBuf> {
    let expected_extension = extension.trim_start_matches('.').to_ascii_lowercase();
    let entries = std::fs::read_dir(input_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        if !file_name.starts_with("galaxy-input-") {
            continue;
        }
        let actual_extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if actual_extension != expected_extension {
            continue;
        }
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        if metadata.len() != bytes.len() as u64 {
            continue;
        }
        if std::fs::read(&path).ok().as_deref() == Some(bytes) {
            return Some(path);
        }
    }
    None
}

fn png_pixels_to_jpeg_rgb(
    pixels: &[u8],
    color_type: png::ColorType,
    width: usize,
    height: usize,
) -> Result<Vec<u8>, String> {
    let pixel_count = width
        .checked_mul(height)
        .ok_or_else(|| "Generated image is too large to convert.".to_string())?;
    let mut rgb = Vec::with_capacity(pixel_count * 3);

    match color_type {
        png::ColorType::Rgb => {
            if pixels.len() < pixel_count * 3 {
                return Err("Generated RGB image data is incomplete.".to_string());
            }
            rgb.extend_from_slice(&pixels[..pixel_count * 3]);
        }
        png::ColorType::Rgba => {
            if pixels.len() < pixel_count * 4 {
                return Err("Generated RGBA image data is incomplete.".to_string());
            }
            for chunk in pixels[..pixel_count * 4].chunks_exact(4) {
                let alpha = chunk[3] as u16;
                for channel in &chunk[..3] {
                    let blended = ((*channel as u16 * alpha) + (255 * (255 - alpha))) / 255;
                    rgb.push(blended as u8);
                }
            }
        }
        png::ColorType::Grayscale => {
            if pixels.len() < pixel_count {
                return Err("Generated grayscale image data is incomplete.".to_string());
            }
            for value in &pixels[..pixel_count] {
                rgb.extend_from_slice(&[*value, *value, *value]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            if pixels.len() < pixel_count * 2 {
                return Err("Generated grayscale-alpha image data is incomplete.".to_string());
            }
            for chunk in pixels[..pixel_count * 2].chunks_exact(2) {
                let alpha = chunk[1] as u16;
                let blended = ((chunk[0] as u16 * alpha) + (255 * (255 - alpha))) / 255;
                let value = blended as u8;
                rgb.extend_from_slice(&[value, value, value]);
            }
        }
        png::ColorType::Indexed => {
            return Err(
                "Generated indexed PNG was not expanded before JPEG conversion.".to_string(),
            );
        }
    }

    Ok(rgb)
}

fn convert_png_to_jpeg(source_path: &Path, target_path: &Path, quality: u8) -> Result<(), String> {
    let original = std::fs::read(source_path)
        .map_err(|e| format!("Could not read generated PNG for JPEG conversion: {}", e))?;
    let mut decoder = png::Decoder::new(Cursor::new(&original));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|e| format!("Could not parse generated PNG for JPEG conversion: {}", e))?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let info = reader
        .next_frame(&mut buffer)
        .map_err(|e| format!("Could not decode generated PNG for JPEG conversion: {}", e))?;
    let pixels = &buffer[..info.buffer_size()];
    let rgb = png_pixels_to_jpeg_rgb(
        pixels,
        info.color_type,
        info.width as usize,
        info.height as usize,
    )?;
    let mut jpeg = Vec::new();
    let encoder = jpeg_encoder::Encoder::new(&mut jpeg, quality);
    encoder
        .encode(
            &rgb,
            info.width as u16,
            info.height as u16,
            jpeg_encoder::ColorType::Rgb,
        )
        .map_err(|e| format!("Could not encode generated JPEG: {}", e))?;
    std::fs::write(target_path, jpeg)
        .map_err(|e| format!("Could not save generated JPEG: {}", e))?;
    Ok(())
}

fn sdcpp_dir() -> PathBuf {
    assistant_runtime_dir().join("sdcpp")
}

fn sdcpp_qwen_edit_dir() -> PathBuf {
    sdcpp_dir().join("models").join("qwen-edit")
}

fn sdcpp_output_dir() -> PathBuf {
    sdcpp_dir().join("output")
}

fn sdcpp_input_dir() -> PathBuf {
    sdcpp_dir().join("input")
}

fn sdcpp_cli_path() -> PathBuf {
    app_root_dir()
        .join("bin")
        .join("stable-diffusion")
        .join(if cfg!(windows) {
            "sd-cli.exe"
        } else {
            "sd-cli"
        })
}

fn qwen_image_paths() -> Option<(PathBuf, PathBuf, PathBuf, PathBuf)> {
    let root = sdcpp_qwen_edit_dir();
    let diffusion = DEFAULT_QWEN_IMAGE_MODELS
        .iter()
        .map(|name| root.join(name))
        .find(|path| path.exists())?;
    let vae = root.join("vae").join(DEFAULT_QWEN_IMAGE_VAE);
    let llm = DEFAULT_QWEN_IMAGE_LLMS
        .iter()
        .map(|name| root.join("text_encoders").join(name))
        .find(|path| path.exists())?;
    let vision = root.join("text_encoders").join(DEFAULT_QWEN_IMAGE_VISION);
    if sdcpp_cli_path().exists()
        && diffusion.exists()
        && vae.exists()
        && llm.exists()
        && vision.exists()
    {
        Some((diffusion, vae, llm, vision))
    } else {
        None
    }
}

fn save_sdcpp_input_image(data_url_or_path: &str) -> Result<PathBuf, String> {
    let value = data_url_or_path.trim();
    if value.is_empty() {
        return Err("No input image was provided.".to_string());
    }
    if !value.starts_with("data:image/") {
        let path = PathBuf::from(value);
        if path.exists() {
            return Ok(path);
        }
        return Err(format!("The input image file was not found: {}", value));
    }

    let (mime, encoded) = value
        .split_once(',')
        .ok_or_else(|| "Attached image data is not a valid data URL.".to_string())?;
    let mime_type = mime
        .strip_prefix("data:")
        .and_then(|value| value.split(';').next())
        .unwrap_or("image/png");
    let bytes = BASE64
        .decode(encoded)
        .map_err(|e| format!("Could not decode the attached image: {}", e))?;
    let input_dir = sdcpp_input_dir();
    std::fs::create_dir_all(&input_dir)
        .map_err(|e| format!("Could not prepare the image input folder: {}", e))?;
    let extension = image_extension_from_mime(mime_type);
    if let Some(existing) = find_existing_sdcpp_input_image(&input_dir, extension, &bytes) {
        return Ok(existing);
    }
    let path = input_dir.join(format!(
        "galaxy-input-{}.{}",
        stable_bytes_hash(&bytes),
        extension
    ));
    if path.exists() {
        return Ok(path);
    }
    std::fs::write(&path, bytes)
        .map_err(|e| format!("Could not save the attached image: {}", e))?;
    Ok(path)
}

async fn generate_image_with_sdcpp_qwen(
    prompt: String,
    init_image_data_url: Option<String>,
    init_image_data_urls: Option<Vec<String>>,
    mask_prompt: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<ImageGenerationResult, String> {
    let (diffusion, vae, llm, vision) = qwen_image_paths()
        .ok_or_else(|| "Qwen Image Edit files are not fully installed.".to_string())?;
    let cli = sdcpp_cli_path();
    let mut input_images = Vec::new();
    if let Some(values) = init_image_data_urls {
        for value in values {
            let value = value.trim();
            if !value.is_empty() {
                input_images.push(save_sdcpp_input_image(value)?);
            }
        }
    }
    if input_images.is_empty() {
        if let Some(path) = init_image_data_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(save_sdcpp_input_image)
            .transpose()?
        {
            input_images.push(path);
        }
    }
    let output_dir = sdcpp_output_dir();
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Could not prepare the image output folder: {}", e))?;
    let output_stem = format!("galaxy-qwen-{}", now_millis());
    let raw_output_path = output_dir.join(format!("{}.png", output_stem));
    let output_path = output_dir.join(format!("{}.jpg", output_stem));
    let seed = (now_millis() % (u32::MAX as u128)) as u32;
    let mode = if input_images.is_empty() {
        "txt2img"
    } else {
        "img2img"
    };
    let width = width.unwrap_or(1024).clamp(256, 2048);
    let height = height.unwrap_or(1024).clamp(256, 2048);

    append_runtime_log(
        "image-trace",
        &format!(
            "sdcpp-qwen mode={} refs={} size={}x{} steps=4 cfg=1 sampler=euler_a prompt=\"{}\" mask=\"{}\" output=\"{}\"",
            mode,
            input_images.len(),
            width,
            height,
            compact_trace_text(&prompt, 600),
            compact_trace_text(mask_prompt.as_deref().unwrap_or_default(), 100),
            raw_output_path.display(),
        ),
    );

    let output_for_task = raw_output_path.clone();
    let output = tokio::task::spawn_blocking(move || {
        let mut command = Command::new(cli);
        command
            .arg("--diffusion-model")
            .arg(diffusion)
            .arg("--vae")
            .arg(vae)
            .arg("--llm")
            .arg(llm)
            .arg("--llm_vision")
            .arg(vision)
            .arg("-W")
            .arg(width.to_string())
            .arg("-H")
            .arg(height.to_string())
            .arg("--cfg-scale")
            .arg("1")
            .arg("--sampling-method")
            .arg("euler_a")
            .arg("--steps")
            .arg("4")
            .arg("--flow-shift")
            .arg("3")
            .arg("--offload-to-cpu")
            .arg("--diffusion-fa")
            .arg("--qwen-image-zero-cond-t")
            .arg("-p")
            .arg(prompt)
            .arg("--seed")
            .arg(seed.to_string())
            .arg("-o")
            .arg(&output_for_task);
        for path in input_images {
            command.arg("-r").arg(path);
        }

        let output = command
            .output()
            .map_err(|e| format!("Could not start the local image engine: {}", e))?;
        if !output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "The local image engine failed. {}{}",
                compact_trace_text(&stdout, 700),
                compact_trace_text(&stderr, 1200)
            ));
        }
        Ok(output)
    })
    .await
    .map_err(|e| format!("The local image task failed: {}", e))??;

    append_runtime_log(
        "image-trace",
        &format!(
            "sdcpp-qwen completed stdout=\"{}\" stderr=\"{}\"",
            compact_trace_text(&String::from_utf8_lossy(&output.stdout), 800),
            compact_trace_text(&String::from_utf8_lossy(&output.stderr), 800),
        ),
    );

    convert_png_to_jpeg(&raw_output_path, &output_path, 90)?;
    let raw_size = std::fs::metadata(&raw_output_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let jpg_size = std::fs::metadata(&output_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let _ = std::fs::remove_file(&raw_output_path);
    append_runtime_log(
        "image-trace",
        &format!("jpeg saved quality=90 {} -> {} bytes", raw_size, jpg_size),
    );

    let bytes = std::fs::read(&output_path)
        .map_err(|e| format!("The local image engine did not save an output image: {}", e))?;
    Ok(ImageGenerationResult {
        image_base64: BASE64.encode(bytes),
        mime_type: "image/jpeg".to_string(),
        file_path: output_path.to_string_lossy().to_string(),
    })
}

fn is_supported_voice_file(path: &PathBuf) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "wav" | "mp3" | "ogg" | "flac" | "m4a"
            )
        })
        .unwrap_or(false)
}

fn collect_voice_samples(
    dir: &Path,
    seen_names: &mut std::collections::HashSet<String>,
    samples: &mut Vec<VoiceSample>,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_voice_samples(&path, seen_names, samples);
            continue;
        }
        if !path.is_file() || !is_supported_voice_file(&path) {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        if !seen_names.insert(name.to_ascii_lowercase()) {
            continue;
        }
        let label = path
            .file_stem()
            .and_then(|value| value.to_str())
            .map(prettify_voice_name)
            .unwrap_or_else(|| name.clone());
        samples.push(VoiceSample {
            name,
            label,
            path: path.to_string_lossy().to_string(),
            language: None,
            language_probability: None,
        });
    }
}

fn prettify_voice_name(name: &str) -> String {
    name.replace('_', " ")
        .replace('-', " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_telegram_token(input: &str) -> String {
    let mut token = input.trim().to_string();
    if let Some((_, rest)) = token.rsplit_once("/bot") {
        token = rest.to_string();
    }
    if token.len() >= 3 && token[..3].eq_ignore_ascii_case("bot") {
        token = token[3..].to_string();
    }

    token = token
        .split_whitespace()
        .find(|part| part.contains(':'))
        .unwrap_or(token.as_str())
        .to_string();

    token
        .split('/')
        .next()
        .unwrap_or_default()
        .trim()
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '`' | ',' | ';'))
        .trim_end_matches('/')
        .to_string()
}

fn parse_telegram_owner_id(input: &str) -> Result<Option<i64>, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    trimmed
        .parse::<i64>()
        .map(Some)
        .map_err(|_| "Telegram owner ID must be a number.".to_string())
}

async fn telegram_get_me(
    client: &reqwest::Client,
    token: &str,
) -> Result<TelegramBotStatus, String> {
    let response = client
        .get(format!("https://api.telegram.org/bot{}/getMe", token))
        .send()
        .await
        .map_err(|e| format!("Could not reach Telegram: {}", e))?;

    let status = response.status();
    let body_text = response
        .text()
        .await
        .map_err(|e| format!("Could not read Telegram response: {}", e))?;
    let body: Value = serde_json::from_str(&body_text)
        .map_err(|_| format!("Telegram returned an unreadable response: {}", body_text))?;

    if !status.is_success() || !body.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        let description = body
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("Telegram did not accept this bot token.");
        return Ok(TelegramBotStatus {
            success: false,
            message: description.to_string(),
            username: None,
        });
    }

    let username = body
        .get("result")
        .and_then(|result| result.get("username"))
        .and_then(Value::as_str)
        .map(|value| value.to_string());

    Ok(TelegramBotStatus {
        success: true,
        message: username
            .as_ref()
            .map(|name| format!("Connected to @{}.", name))
            .unwrap_or_else(|| "Connected to Telegram bot.".to_string()),
        username,
    })
}

async fn send_telegram_message(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    text: &str,
) -> Result<(), String> {
    // Try with Markdown first, fall back to plain text if Markdown parse fails
    let response = client
        .post(format!("https://api.telegram.org/bot{}/sendMessage", token))
        .json(&json!({
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown",
            "disable_web_page_preview": true
        }))
        .send()
        .await
        .map_err(|e| format!("Could not send Telegram message: {}", e))?;

    if response.status().is_success() {
        return Ok(());
    }

    // Fallback: send as plain text (avoids Markdown parse errors on raw text)
    let fallback = client
        .post(format!("https://api.telegram.org/bot{}/sendMessage", token))
        .json(&json!({
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": true
        }))
        .send()
        .await
        .map_err(|e| format!("Could not send Telegram message: {}", e))?;

    if fallback.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "Telegram sendMessage failed with {}.",
            fallback.status()
        ))
    }
}

fn telegram_message_chunks(text: &str) -> Vec<String> {
    const LIMIT: usize = 3500;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    for paragraph in trimmed.split_inclusive('\n') {
        let paragraph_chars = paragraph.chars().count();
        if !current.is_empty() && current.chars().count() + paragraph_chars > LIMIT {
            chunks.push(current.trim().to_string());
            current.clear();
        }

        if paragraph_chars <= LIMIT {
            current.push_str(paragraph);
            continue;
        }

        if !current.trim().is_empty() {
            chunks.push(current.trim().to_string());
            current.clear();
        }
        chunks.extend(split_telegram_long_segment(paragraph, LIMIT));
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }
    chunks
}

fn split_telegram_long_segment(segment: &str, limit: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut last_break: Option<usize> = None;

    for ch in segment.chars() {
        current.push(ch);
        if matches!(
            ch,
            '.' | '!' | '?' | '\u{3002}' | '\u{ff01}' | '\u{ff1f}' | '\n'
        ) {
            last_break = Some(current.len());
        } else if ch.is_whitespace() && last_break.is_none() {
            last_break = Some(current.len());
        }

        if current.chars().count() >= limit {
            let split_at = last_break
                .filter(|index| *index > 0 && *index < current.len())
                .unwrap_or(current.len());
            let head = current[..split_at].trim().to_string();
            let tail = current[split_at..].trim_start().to_string();
            if !head.is_empty() {
                chunks.push(head);
            }
            current = tail;
            last_break = None;
        }
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }
    chunks
}

async fn send_telegram_message_chunked(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    text: &str,
) {
    let chunks = telegram_message_chunks(text);
    for (index, chunk) in chunks.iter().enumerate() {
        let _ = send_telegram_message(client, token, chat_id, chunk).await;
        if index + 1 < chunks.len() {
            tokio::time::sleep(Duration::from_millis(120)).await;
        }
    }
}

async fn send_telegram_message_with_keyboard(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    text: &str,
    reply_markup: Value,
) -> Result<(), String> {
    let response = client
        .post(format!("https://api.telegram.org/bot{}/sendMessage", token))
        .json(&json!({
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": true,
            "reply_markup": reply_markup
        }))
        .send()
        .await
        .map_err(|e| format!("Could not send Telegram message: {}", e))?;

    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(format!(
            "Telegram sendMessage failed with {}: {}",
            status, body
        ))
    }
}

async fn clear_telegram_message_keyboard(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    message_id: i64,
) {
    let _ = client
        .post(format!(
            "https://api.telegram.org/bot{}/editMessageReplyMarkup",
            token
        ))
        .json(&json!({
            "chat_id": chat_id,
            "message_id": message_id,
            "reply_markup": { "inline_keyboard": [] }
        }))
        .send()
        .await;
}

async fn answer_telegram_callback(
    client: &reqwest::Client,
    token: &str,
    callback_id: &str,
    text: &str,
) {
    let _ = client
        .post(format!(
            "https://api.telegram.org/bot{}/answerCallbackQuery",
            token
        ))
        .json(&json!({ "callback_query_id": callback_id, "text": text }))
        .send()
        .await;
}

async fn send_telegram_document(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    path: &str,
    caption: Option<&str>,
) -> Result<(), String> {
    let file_bytes =
        std::fs::read(path).map_err(|e| format!("Could not read file for Telegram: {}", e))?;
    let filename = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(filename)
        .mime_str("application/octet-stream")
        .map_err(|e| format!("Could not prepare file for Telegram: {}", e))?;

    let mut form = reqwest::multipart::Form::new()
        .text("chat_id", chat_id.to_string())
        .part("document", part);

    if let Some(cap) = caption {
        form = form.text("caption", cap.to_string());
    }

    let response = client
        .post(format!(
            "https://api.telegram.org/bot{}/sendDocument",
            token
        ))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Could not send document to Telegram: {}", e))?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "Telegram sendDocument failed with {}.",
            response.status()
        ))
    }
}

async fn send_telegram_photo(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    path: &str,
    caption: Option<&str>,
) -> Result<(), String> {
    let file_bytes =
        std::fs::read(path).map_err(|e| format!("Could not read image for Telegram: {}", e))?;
    let filename = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image.png")
        .to_string();

    let mime = if filename.to_lowercase().ends_with(".jpg")
        || filename.to_lowercase().ends_with(".jpeg")
    {
        "image/jpeg"
    } else if filename.to_lowercase().ends_with(".webp") {
        "image/webp"
    } else {
        "image/png"
    };

    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(filename)
        .mime_str(mime)
        .map_err(|e| format!("Could not prepare image for Telegram: {}", e))?;

    let mut form = reqwest::multipart::Form::new()
        .text("chat_id", chat_id.to_string())
        .part("photo", part);

    if let Some(cap) = caption {
        form = form.text("caption", cap.to_string());
    }

    let response = client
        .post(format!("https://api.telegram.org/bot{}/sendPhoto", token))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Could not send photo to Telegram: {}", e))?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "Telegram sendPhoto failed with {}.",
            response.status()
        ))
    }
}

async fn send_telegram_voice(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    audio_bytes: Vec<u8>,
    caption: Option<&str>,
) -> Result<(), String> {
    let voice_part = reqwest::multipart::Part::bytes(audio_bytes.clone())
        .file_name("reply.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("Could not prepare voice for Telegram: {}", e))?;

    let mut form = reqwest::multipart::Form::new()
        .text("chat_id", chat_id.to_string())
        .part("voice", voice_part);

    if let Some(cap) = caption.filter(|value| !value.trim().is_empty()) {
        form = form.text("caption", cap.to_string());
    }

    let response = client
        .post(format!("https://api.telegram.org/bot{}/sendVoice", token))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Could not send voice to Telegram: {}", e))?;

    if response.status().is_success() {
        Ok(())
    } else {
        let voice_status = response.status();
        let audio_part = reqwest::multipart::Part::bytes(audio_bytes)
            .file_name("reply.wav")
            .mime_str("audio/wav")
            .map_err(|e| format!("Could not prepare audio for Telegram: {}", e))?;
        let mut audio_form = reqwest::multipart::Form::new()
            .text("chat_id", chat_id.to_string())
            .part("audio", audio_part);
        if let Some(cap) = caption.filter(|value| !value.trim().is_empty()) {
            audio_form = audio_form.text("caption", cap.to_string());
        }
        let audio_response = client
            .post(format!("https://api.telegram.org/bot{}/sendAudio", token))
            .multipart(audio_form)
            .send()
            .await
            .map_err(|e| format!("Could not send audio to Telegram: {}", e))?;
        if audio_response.status().is_success() {
            Ok(())
        } else {
            Err(format!(
                "Telegram sendVoice failed with {}; sendAudio failed with {}.",
                voice_status,
                audio_response.status()
            ))
        }
    }
}

async fn synthesize_and_send_telegram_voice(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    omnivoice_state: OmniVoiceRuntimeState,
    llama_state: Arc<LlamaState>,
    text: &str,
    voice_sample_path: Option<String>,
    caption: Option<&str>,
) {
    let speech_text = sanitize_telegram_speech_text(text);
    if speech_text.trim().is_empty() {
        return;
    }
    let speech_text_for_log = speech_text.clone();
    let started_at = Instant::now();
    let voice_sample_label = voice_sample_path
        .as_deref()
        .and_then(|path| Path::new(path).file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("default")
        .to_string();
    let record_telegram_voice = |success: bool, output_text: String| {
        let _ = agent_store::record_agent_tool_run(agent_store::AgentToolRun {
            tool_name: "voice_speech".to_string(),
            input_json: json!({
                "interface": "telegram",
                "chat_id": chat_id,
                "voice_sample": voice_sample_label,
                "text": speech_text_for_log.chars().take(220).collect::<String>(),
            })
            .to_string(),
            output_text,
            success,
            duration_ms: started_at.elapsed().as_millis().min(i64::MAX as u128) as i64,
        });
    };
    let voice_status_loop =
        start_telegram_action_loop(client.clone(), token.to_string(), chat_id, "record_voice");
    let had_llm_session = llama_state
        .session
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false);

    if had_llm_session {
        let vram = crate::resource_monitor::get_vram_memory_status();
        append_runtime_log(
            "telegram",
            &format!(
                "voice vram check free={}MB used={}MB total={}MB need=3072MB",
                vram.free_mb, vram.used_mb, vram.total_mb
            ),
        );
        if !vram.available || vram.free_mb < 3072 {
            let state_for_stop = llama_state.clone();
            let _ = tokio::task::spawn_blocking(move || {
                llama_manager::stop_model_state(&state_for_stop)
            })
            .await;
        }
    }

    let synth_result = omnivoice_runtime::synthesize_speech_with_state(
        omnivoice_state,
        speech_text,
        voice_sample_path.clone(),
        false,
    )
    .await;

    match synth_result {
        Ok(audio) => match BASE64.decode(audio.audio_base64.as_bytes()) {
            Ok(bytes) => {
                if let Err(error) =
                    send_telegram_voice(client, token, chat_id, bytes, caption).await
                {
                    record_telegram_voice(false, format!("Voice send failed: {}", error));
                    append_runtime_log("telegram", &format!("voice send failed: {}", error));
                } else {
                    record_telegram_voice(true, "Sent Telegram voice message.".to_string());
                }
            }
            Err(error) => {
                record_telegram_voice(false, format!("Voice decode failed: {}", error));
                append_runtime_log("telegram", &format!("voice decode failed: {}", error));
            }
        },
        Err(error) => {
            record_telegram_voice(false, format!("Voice synthesis failed: {}", error));
            append_runtime_log("telegram", &format!("voice synthesis failed: {}", error));
        }
    }
    voice_status_loop.store(false, Ordering::Relaxed);
}

fn sanitize_telegram_speech_text(text: &str) -> String {
    let mut output = String::new();
    let mut in_code_block = false;
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("```") {
            in_code_block = !in_code_block;
            output.push(' ');
            continue;
        }
        if in_code_block || line.starts_with("<tool_call") || line.starts_with("<|tool_call") {
            output.push(' ');
            continue;
        }
        let mut chars = line.chars().peekable();
        while let Some(ch) = chars.next() {
            if ch == '`' {
                continue;
            }
            if ch == '[' {
                let mut label = String::new();
                while let Some(next) = chars.next() {
                    if next == ']' {
                        break;
                    }
                    label.push(next);
                }
                if chars.peek() == Some(&'(') {
                    while let Some(next) = chars.next() {
                        if next == ')' {
                            break;
                        }
                    }
                }
                output.push_str(&label);
                output.push(' ');
                continue;
            }
            if ch == 'h' {
                let mut url = String::from(ch);
                while let Some(next) = chars.peek().copied() {
                    if next.is_whitespace() {
                        break;
                    }
                    url.push(next);
                    chars.next();
                }
                if url.starts_with("http://") || url.starts_with("https://") {
                    output.push(' ');
                } else {
                    output.push_str(&url);
                }
                continue;
            }
            if is_speech_symbol_or_emoji(ch) {
                output.push(' ');
            } else if matches!(
                ch,
                '-' | '\u{2013}' | '\u{2014}' | '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>'
            ) {
                output.push_str(", ");
            } else {
                output.push(ch);
            }
        }
        output.push_str(". ");
    }
    let normalized = normalize_telegram_speech_reading(&output);
    normalized.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_speech_symbol_or_emoji(ch: char) -> bool {
    matches!(
        ch,
        '#' | '*'
            | '>'
            | '<'
            | '_'
            | '~'
            | '|'
            | '@'
            | '^'
            | '&'
            | '='
            | '+'
            | '"'
            | '\''
            | '\u{201c}'
            | '\u{201d}'
            | '\u{2018}'
            | '\u{2019}'
            | '\u{2022}'
            | '\u{00b7}'
    ) || ('\u{1F000}'..='\u{1FAFF}').contains(&ch)
        || ('\u{2600}'..='\u{27BF}').contains(&ch)
}

fn telegram_speech_looks_vietnamese(text: &str) -> bool {
    text.chars()
        .any(|ch| ('\u{00C0}'..='\u{1EF9}').contains(&ch) || ch == '\u{0111}' || ch == '\u{0110}')
}

fn normalize_telegram_speech_reading(text: &str) -> String {
    let vi = telegram_speech_looks_vietnamese(text);
    text.split_whitespace()
        .map(|token| normalize_telegram_speech_token(token, vi))
        .collect::<Vec<_>>()
        .join(" ")
        .replace('/', ", ")
        .replace('\\', ", ")
}

fn normalize_telegram_speech_token(token: &str, vi: bool) -> String {
    let without_trailing =
        token.trim_end_matches(|ch: char| matches!(ch, ',' | ';' | ':' | '.' | '!' | '?'));
    let trailing = &token[without_trailing.len()..];
    let core = without_trailing
        .trim_start_matches(|ch: char| matches!(ch, ',' | ';' | ':' | '.' | '!' | '?'));
    let lower = core.to_lowercase();

    if let Some((day, month, year)) = parse_slash_date(core) {
        let spoken = if vi {
            format!(
                "{} th\u{00e1}ng {} n\u{0103}m {}",
                strip_numeric_leading_zero(day),
                strip_numeric_leading_zero(month),
                year
            )
        } else {
            format!(
                "{} {} {}",
                strip_numeric_leading_zero(month),
                strip_numeric_leading_zero(day),
                year
            )
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some((day, month)) = parse_slash_day_month(core) {
        let spoken = if vi {
            format!(
                "{} th\u{00e1}ng {}",
                strip_numeric_leading_zero(day),
                strip_numeric_leading_zero(month)
            )
        } else {
            format!(
                "{} {}",
                strip_numeric_leading_zero(month),
                strip_numeric_leading_zero(day)
            )
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = core
        .strip_suffix("\u{00b0}C")
        .or_else(|| core.strip_suffix("\u{00b0}c"))
    {
        let spoken = if vi {
            format!("{} \u{0111}\u{1ed9} C\u{00ea}", value)
        } else {
            format!("{} degrees Celsius", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = core
        .strip_suffix("\u{00b0}F")
        .or_else(|| core.strip_suffix("\u{00b0}f"))
    {
        let spoken = if vi {
            format!("{} \u{0111}\u{1ed9} F", value)
        } else {
            format!("{} degrees Fahrenheit", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = lower.strip_suffix("km/h") {
        let spoken = if vi {
            format!("{} ki l\u{00f4} m\u{00e9}t tr\u{00ea}n gi\u{1edd}", value)
        } else {
            format!("{} kilometers per hour", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = lower.strip_suffix("km") {
        let spoken = if vi {
            format!("{} ki l\u{00f4} m\u{00e9}t", value)
        } else {
            format!("{} kilometers", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = lower.strip_suffix("mm") {
        let spoken = if vi {
            format!("{} mi li m\u{00e9}t", value)
        } else {
            format!("{} millimeters", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = lower.strip_suffix("cm") {
        let spoken = if vi {
            format!("{} xen ti m\u{00e9}t", value)
        } else {
            format!("{} centimeters", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = core.strip_suffix('%') {
        let spoken = if vi {
            format!("{} ph\u{1ea7}n tr\u{0103}m", value)
        } else {
            format!("{} percent", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = core.strip_prefix('$') {
        let spoken = if vi {
            format!("{} \u{0111}\u{00f4} la", value)
        } else {
            format!("{} dollars", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if lower.ends_with("usd") && core.len() > 3 {
        let value = &core[..core.len() - 3];
        let spoken = if vi {
            format!("{} \u{0111}\u{00f4} la", value)
        } else {
            format!("{} dollars", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if (lower.ends_with("vnd") || lower.ends_with("vn\u{0111}")) && core.len() > 3 {
        let value = &core[..core.len() - 3];
        let spoken = if vi {
            format!("{} \u{0111}\u{1ed3}ng", value)
        } else {
            format!("{} Vietnamese dong", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = core.strip_suffix('\u{20ab}') {
        let spoken = if vi {
            format!("{} \u{0111}\u{1ed3}ng", value)
        } else {
            format!("{} Vietnamese dong", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = core.strip_prefix('\u{20ac}') {
        let spoken = if vi {
            format!("{} euro", value)
        } else {
            format!("{} euros", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = core.strip_prefix('\u{00a3}') {
        let spoken = if vi {
            format!("{} b\u{1ea3}ng Anh", value)
        } else {
            format!("{} pounds", value)
        };
        return format!("{}{}", spoken, trailing);
    }

    format!("{}{}", core, trailing)
}

fn parse_slash_date(value: &str) -> Option<(&str, &str, &str)> {
    let parts = value.split('/').collect::<Vec<_>>();
    if parts.len() != 3
        || !parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
    {
        return None;
    }
    if !(1..=2).contains(&parts[0].len())
        || !(1..=2).contains(&parts[1].len())
        || !(2..=4).contains(&parts[2].len())
    {
        return None;
    }
    Some((parts[0], parts[1], parts[2]))
}

fn parse_slash_day_month(value: &str) -> Option<(&str, &str)> {
    let parts = value.split('/').collect::<Vec<_>>();
    if parts.len() != 2
        || !parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
    {
        return None;
    }
    if !(1..=2).contains(&parts[0].len()) || !(1..=2).contains(&parts[1].len()) {
        return None;
    }
    Some((parts[0], parts[1]))
}

fn strip_numeric_leading_zero(value: &str) -> String {
    value
        .parse::<u32>()
        .map(|number| number.to_string())
        .unwrap_or_else(|_| value.to_string())
}

async fn send_telegram_chat_action(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    action: &str,
) {
    let _ = client
        .post(format!(
            "https://api.telegram.org/bot{}/sendChatAction",
            token
        ))
        .json(&json!({ "chat_id": chat_id, "action": action }))
        .send()
        .await;
}

fn start_telegram_action_loop(
    client: reqwest::Client,
    token: String,
    chat_id: i64,
    action: &'static str,
) -> Arc<AtomicBool> {
    let running = Arc::new(AtomicBool::new(true));
    let running_for_task = running.clone();
    tokio::spawn(async move {
        while running_for_task.load(Ordering::Relaxed) {
            send_telegram_chat_action(&client, &token, chat_id, action).await;
            tokio::time::sleep(Duration::from_secs(4)).await;
        }
    });
    running
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredChatSessionMessage {
    id: String,
    role: String,
    content: String,
    #[serde(default)]
    thinking: Option<String>,
}

#[derive(Debug, Clone)]
struct TelegramAssistantProfile {
    personality_id: String,
    personality_name: String,
    user_name: String,
    system_prompt: String,
    greeting: String,
    avatar_path: Option<String>,
    voice_sample_path: Option<String>,
    folders: Vec<String>,
    google_client_id: String,
    google_client_secret: String,
    personality_memory: String,
    thinking_enabled: bool,
    sampling: agent_react::SamplingConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TelegramGreetingLanguage {
    Vietnamese,
    Thai,
    English,
}

fn infer_telegram_greeting_language(history: &[ReactChatMessage]) -> TelegramGreetingLanguage {
    for message in history.iter().rev() {
        let text = extract_message_text(&message.content);
        if text.trim().is_empty() {
            continue;
        }
        if text
            .chars()
            .any(|ch| ('\u{0E00}'..='\u{0E7F}').contains(&ch))
        {
            return TelegramGreetingLanguage::Thai;
        }
        if telegram_speech_looks_vietnamese(&text) {
            return TelegramGreetingLanguage::Vietnamese;
        }
        if message.role == "assistant" {
            return TelegramGreetingLanguage::English;
        }
    }
    TelegramGreetingLanguage::English
}

fn greeting_style_hint(prompt: &str) -> &'static str {
    let lower = prompt.to_ascii_lowercase();
    if lower.contains("cute") || lower.contains("cheerful") || lower.contains("lively") {
        "bright"
    } else if lower.contains("calm") || lower.contains("gentle") || lower.contains("soft") {
        "soft"
    } else if lower.contains("professional") || lower.contains("assistant") {
        "ready"
    } else {
        "natural"
    }
}

fn build_personality_greeting(name: &str, prompt: &str, history: &[ReactChatMessage]) -> String {
    let speaker = if name.trim().is_empty() {
        "Assistant"
    } else {
        name.trim()
    };
    match (
        infer_telegram_greeting_language(history),
        greeting_style_hint(prompt),
    ) {
        (TelegramGreetingLanguage::Vietnamese, "bright") => {
            format!(
                "D\u{1ea1}, {} \u{0111}\u{00e2}y \u{1ea1}. Em v\u{1eeba} \u{0111}\u{1ed5}i qua r\u{1ed3}i n\u{00e8}, m\u{00ec}nh n\u{00f3}i ti\u{1ebf}p nha.",
                speaker
            )
        }
        (TelegramGreetingLanguage::Vietnamese, "soft") => {
            format!(
                "D\u{1ea1}, {} \u{0111}\u{00e2}y. Em \u{1edf} \u{0111}\u{00e2}y r\u{1ed3}i, anh c\u{1ee9} n\u{00f3}i ti\u{1ebf}p v\u{1edb}i em nha.",
                speaker
            )
        }
        (TelegramGreetingLanguage::Vietnamese, _) => {
            format!(
                "D\u{1ea1}, {} \u{0111}\u{00e3} v\u{00e0}o cu\u{1ed9}c tr\u{00f2} chuy\u{1ec7}n r\u{1ed3}i \u{1ea1}. M\u{00ec}nh ti\u{1ebf}p t\u{1ee5}c nh\u{00e9}.",
                speaker
            )
        }
        (TelegramGreetingLanguage::Thai, "bright") => {
            format!("{} is here now. We can keep going.", speaker)
        }
        (TelegramGreetingLanguage::Thai, _) => {
            format!("{} is ready. Send the next message anytime.", speaker)
        }
        (TelegramGreetingLanguage::English, "bright") => {
            format!("{} is here now. I'm ready, let's keep going.", speaker)
        }
        (TelegramGreetingLanguage::English, "soft") => {
            format!("{} is here. I'm with you, we can continue.", speaker)
        }
        (TelegramGreetingLanguage::English, _) => {
            format!("{} is active now. Send me what you need next.", speaker)
        }
    }
}

fn greeting_mentions_speaker(text: &str, speaker: &str) -> bool {
    if speaker.trim().is_empty() {
        return true;
    }
    let normalized_text = normalize_text(text);
    let normalized_speaker = normalize_text(speaker);
    !normalized_speaker.is_empty() && normalized_text.contains(&normalized_speaker)
}

fn ensure_greeting_mentions_speaker(
    text: String,
    speaker: &str,
    language: TelegramGreetingLanguage,
) -> String {
    if greeting_mentions_speaker(&text, speaker) {
        return text.trim().to_string();
    }

    let speaker = speaker.trim();
    if speaker.is_empty() {
        return text.trim().to_string();
    }

    let prefix = match language {
        TelegramGreetingLanguage::Vietnamese => {
            format!("D\u{1ea1}, {} \u{0111}\u{00e2}y. ", speaker)
        }
        TelegramGreetingLanguage::Thai => format!("{} here. ", speaker),
        TelegramGreetingLanguage::English => format!("{} here. ", speaker),
    };
    format!("{}{}", prefix, text.trim())
}

async fn build_telegram_switch_greeting(profile: &TelegramAssistantProfile) -> String {
    let history = load_personality_chat_history(&profile.personality_id);
    let language = infer_telegram_greeting_language(&history);
    let language_hint = match language {
        TelegramGreetingLanguage::Vietnamese => {
            "Reply in Vietnamese with full accents. Start by naturally identifying yourself by name."
        }
        TelegramGreetingLanguage::Thai => "Reply in Thai. Start by naturally identifying yourself by name.",
        TelegramGreetingLanguage::English => "Reply in English. Start by naturally identifying yourself by name.",
    };
    let recent_context = history
        .iter()
        .rev()
        .take(8)
        .rev()
        .map(|message| {
            format!(
                "{}: {}",
                message.role,
                extract_message_text(&message.content)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        "Write one short, natural greeting as {name} for Telegram right after this character is switched on. Match the character personality, sound human, be a little creative, and do not mention system status or profile fields. Keep it to one short message.\n\n{language_hint}\n\nRecent conversation context:\n{recent_context}",
        name = profile.personality_name,
        language_hint = language_hint,
        recent_context = if recent_context.trim().is_empty() {
            "(no prior conversation)".to_string()
        } else {
            recent_context
        }
    );

    let messages = vec![
        json!({
            "role": "system",
            "content": profile.system_prompt.clone(),
        }),
        json!({
            "role": "user",
            "content": prompt,
        }),
    ];

    match agent_react::generate_plain_text_reply(messages, profile.sampling, 64).await {
        Ok(text) if !text.trim().is_empty() => {
            ensure_greeting_mentions_speaker(text, &profile.personality_name, language)
        }
        _ => profile.greeting.clone(),
    }
}

fn personality_memory_kind(personality_id: &str) -> String {
    format!("personality:{}", personality_id)
}

fn compact_personality_memory(memory: &str, feedback: &str) -> String {
    let clean_feedback = feedback.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean_feedback.is_empty() {
        return memory.trim().to_string();
    }
    let bullet = format!("- {}", clean_feedback);
    let mut existing = memory
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| *line != bullet)
        .map(str::to_string)
        .collect::<Vec<_>>();
    existing.push(bullet);
    let next = existing
        .into_iter()
        .rev()
        .take(14)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    if next.len() > 2_200 {
        next[next.len().saturating_sub(2_200)..]
            .trim_start_matches(|ch| ch != '\n')
            .trim_start_matches('\n')
            .to_string()
    } else {
        next
    }
}

fn is_personality_training_feedback(text: &str) -> bool {
    let lower = normalize_text(text);
    [
        "remember",
        "learn",
        "from now on",
        "answer like",
        "dont answer",
        "do not answer",
        "bad answer",
        "good answer",
        "format like",
        "style like",
        "sai",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase))
}

fn extract_message_text(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    content
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| {
                    let is_text = part.get("type").and_then(Value::as_str) == Some("text");
                    if !is_text {
                        return None;
                    }
                    part.get("text").and_then(Value::as_str).map(str::to_string)
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_else(|| content.to_string())
        .trim()
        .to_string()
}

fn load_personality_memory(personality_id: &str) -> String {
    list_local_memory(Some(personality_memory_kind(personality_id)), Some(20))
        .ok()
        .and_then(|items| {
            items
                .into_iter()
                .find(|item| item.key == "compact_style_memory")
                .map(|item| item.value)
        })
        .unwrap_or_default()
}

fn update_personality_memory_after_turn(
    personality_id: &str,
    current_memory: &str,
    user_text: &str,
    answer_text: &str,
) -> String {
    if !is_personality_training_feedback(user_text) {
        return current_memory.to_string();
    }
    let feedback = format!(
        "User feedback: {}{}",
        user_text.trim(),
        if answer_text.trim().is_empty() {
            String::new()
        } else {
            format!(
                " | Last answer summary: {}",
                answer_text.trim().chars().take(220).collect::<String>()
            )
        }
    );
    let next_memory = compact_personality_memory(current_memory, &feedback);
    let _ = remember_local_memory(
        personality_memory_kind(personality_id),
        "compact_style_memory".to_string(),
        next_memory.clone(),
        Some("personality_training".to_string()),
        Some(0.9),
    );
    next_memory
}

fn build_personality_runtime_prompt(
    settings: &AppSettings,
    preset: &PersonalityPreset,
    personality_memory: &str,
    fallback_system_prompt: &str,
) -> String {
    let personality_prompt = if preset.prompt.trim().is_empty() {
        settings.personality.trim()
    } else {
        preset.prompt.trim()
    };
    let character_files = character_store::load_character_files(
        preset.id.clone(),
        preset.name.clone(),
        personality_prompt.to_string(),
        preset.avatar.clone(),
        preset.voice_path.clone(),
    )
    .ok();
    let character_soul = character_files
        .as_ref()
        .map(|files| files.soul.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    let mut sections = vec![format!(
        "Assistant profile:\nName: {}\nInstructions:\n{}",
        if preset.name.trim().is_empty() {
            "Assistant"
        } else {
            preset.name.trim()
        },
        personality_prompt
    )];
    if !character_soul.trim().is_empty() {
        sections.push(format!(
            "\nAdditional character context:\n{}",
            character_soul.trim()
        ));
    }

    if !personality_memory.trim().is_empty() {
        sections.push(format!(
            "\nConversation memory:\n{}",
            personality_memory.trim()
        ));
    }

    let active_user = settings
        .user_profiles
        .iter()
        .find(|profile| profile.id == settings.selected_user_profile_id);
    let user_name = active_user
        .map(|profile| profile.name.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| settings.user_name.trim());
    let user_description = active_user
        .map(|profile| profile.description.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| settings.user_description.trim());

    if !user_name.is_empty() || !user_description.is_empty() {
        sections.push(format!(
            "\nUser profile:\nName: {}\nAbout user: {}",
            if user_name.is_empty() {
                "User"
            } else {
                user_name
            },
            if user_description.is_empty() {
                "No extra details."
            } else {
                user_description
            }
        ));
    }

    sections.push(format!(
        "\nCurrent date: {}\nConnected utilities: Google Calendar {}, Gmail {}, Telegram online, Voice {}, Image generation {}, User location {}",
        chrono::Local::now().format("%Y-%m-%d"),
        if settings.google_client_id.trim().is_empty() || settings.google_client_secret.trim().is_empty() {
            "offline".to_string()
        } else {
            "online".to_string()
        },
        if settings.google_client_id.trim().is_empty() || settings.google_client_secret.trim().is_empty() {
            "offline".to_string()
        } else {
            "online".to_string()
        },
        if preset.voice_path.trim().is_empty() && settings.selected_voice_path.trim().is_empty() {
            "not ready".to_string()
        } else {
            "ready".to_string()
        },
        "local Qwen image model".to_string(),
        if settings.user_location_label.trim().is_empty() {
            "unknown".to_string()
        } else {
            settings.user_location_label.trim().to_string()
        }
    ));

    let _ = fallback_system_prompt;

    sections.join("")
}

fn load_telegram_assistant_profile(
    fallback_system_prompt: &str,
    fallback_folders: &[String],
    fallback_google_client_id: &str,
    fallback_google_client_secret: &str,
) -> TelegramAssistantProfile {
    let settings = load_app_settings().unwrap_or_else(|_| AppSettings::default());
    let preset = settings
        .personality_presets
        .iter()
        .find(|preset| preset.id == settings.selected_personality_id)
        .cloned()
        .or_else(|| settings.personality_presets.first().cloned())
        .unwrap_or(PersonalityPreset {
            id: "default".to_string(),
            name: "Assistant".to_string(),
            prompt: settings.personality.clone(),
            avatar: String::new(),
            voice_path: String::new(),
        });
    let personality_memory = load_personality_memory(&preset.id);
    let personality_history = load_personality_chat_history(&preset.id);
    let character_files = character_store::load_character_files(
        preset.id.clone(),
        preset.name.clone(),
        if preset.prompt.trim().is_empty() {
            settings.personality.clone()
        } else {
            preset.prompt.clone()
        },
        preset.avatar.clone(),
        preset.voice_path.clone(),
    )
    .ok();
    let avatar_source = if !preset.avatar.trim().is_empty() {
        preset.avatar.trim().to_string()
    } else {
        character_files
            .as_ref()
            .map(|files| files.settings.avatar.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_default()
    };
    let active_user = settings
        .user_profiles
        .iter()
        .find(|profile| profile.id == settings.selected_user_profile_id);
    let user_name = active_user
        .map(|profile| profile.name.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| settings.user_name.trim())
        .to_string();

    TelegramAssistantProfile {
        personality_id: preset.id.clone(),
        personality_name: if preset.name.trim().is_empty() {
            "Assistant".to_string()
        } else {
            preset.name.trim().to_string()
        },
        user_name,
        greeting: build_personality_greeting(&preset.name, &preset.prompt, &personality_history),
        avatar_path: if !avatar_source.trim().is_empty() {
            Some(avatar_source)
        } else {
            None
        },
        voice_sample_path: if !preset.voice_path.trim().is_empty() {
            Some(preset.voice_path.trim().to_string())
        } else if !settings.selected_voice_path.trim().is_empty() {
            Some(settings.selected_voice_path.trim().to_string())
        } else {
            None
        },
        system_prompt: build_personality_runtime_prompt(
            &settings,
            &preset,
            &personality_memory,
            fallback_system_prompt,
        ),
        folders: if settings.linked_folders.is_empty() {
            fallback_folders.to_vec()
        } else {
            settings.linked_folders.clone()
        },
        google_client_id: if settings.google_client_id.trim().is_empty() {
            fallback_google_client_id.trim().to_string()
        } else {
            settings.google_client_id.trim().to_string()
        },
        google_client_secret: if settings.google_client_secret.trim().is_empty() {
            fallback_google_client_secret.trim().to_string()
        } else {
            settings.google_client_secret.trim().to_string()
        },
        personality_memory,
        thinking_enabled: settings.thinking_enabled,
        sampling: agent_react::SamplingConfig {
            temperature: settings.sampling_temperature,
            top_k: settings.top_k,
            top_p: settings.top_p,
            min_p: settings.min_p,
            repeat_last_n: settings.repeat_last_n,
            repeat_penalty: settings.repeat_penalty,
        },
    }
}

fn load_personality_chat_history(personality_id: &str) -> Vec<ReactChatMessage> {
    load_personality_chat_session(personality_id.to_string())
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<StoredChatSessionMessage>>(&raw).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|message| {
            (message.role == "user" || message.role == "assistant")
                && !message.content.trim().is_empty()
        })
        .map(|message| ReactChatMessage {
            role: message.role,
            content: json!(message.content),
        })
        .collect()
}

fn persist_personality_chat_history(personality_id: &str, history: &[ReactChatMessage]) {
    let compact = history
        .iter()
        .rev()
        .take(80)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .enumerate()
        .map(|(index, message)| StoredChatSessionMessage {
            id: format!("telegram-{}-{}", now_unix(), index),
            role: message.role,
            content: extract_message_text(&message.content)
                .chars()
                .take(12_000)
                .collect::<String>(),
            thinking: None,
        })
        .filter(|message| !message.content.trim().is_empty())
        .collect::<Vec<_>>();

    if let Ok(raw) = serde_json::to_string(&compact) {
        let _ = save_personality_chat_session(personality_id.to_string(), raw);
    }
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

fn ensure_personality_greeting(history: &mut Vec<ReactChatMessage>, greeting: &str) {
    if history.is_empty() {
        history.push(ReactChatMessage {
            role: "assistant".to_string(),
            content: json!(greeting),
        });
    }
}

fn telegram_context_block(profile: &TelegramAssistantProfile) -> String {
    let now = chrono::Local::now();
    format!(
        "Time: {}\nInterface: Telegram remote control\nActive character: {}\nConversation sync: Use the active character session and memory shared with Galaxy AI Hub.\nSafety: Read-only tools may run automatically. Write, delete, image, and system actions require approval in Galaxy AI Hub.",
        now.format("%A, %B %-d, %Y at %-I:%M:%S %p %Z"),
        profile.personality_name
    )
}

fn telegram_guest_context_block(profile: &TelegramAssistantProfile, guest_name: &str) -> String {
    let now = chrono::Local::now();
    format!(
        "Time: {}\nInterface: Telegram guest chat\nActive character: {}\nTelegram guest: {}\nAccess: chat-only. No tools, no private data, no file access, no Google access, no image generation, and no approvals.",
        now.format("%A, %B %-d, %Y at %-I:%M:%S %p %Z"),
        profile.personality_name,
        guest_name
    )
}

fn telegram_display_name(from: &Value) -> String {
    let first = from
        .get("first_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let last = from
        .get("last_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let joined = [first, last]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if !joined.trim().is_empty() {
        return joined;
    }
    from.get("username")
        .and_then(Value::as_str)
        .map(|value| format!("@{}", value.trim_start_matches('@')))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Telegram guest".to_string())
}

fn telegram_message_mentions_bot(message: &Value, bot_username: Option<&str>) -> bool {
    let Some(username) = bot_username
        .map(|value| value.trim_start_matches('@'))
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    let mention = format!("@{}", username).to_lowercase();
    let text = message
        .get("text")
        .or_else(|| message.get("caption"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    if text.contains(&mention) {
        return true;
    }
    message
        .get("reply_to_message")
        .and_then(|reply| reply.get("from"))
        .and_then(|from| from.get("username"))
        .and_then(Value::as_str)
        .map(|reply_username| reply_username.eq_ignore_ascii_case(username))
        .unwrap_or(false)
}

fn append_telegram_chat_log(user_id: i64, user_name: &str, user_text: &str, assistant_text: &str) {
    let log_dir = app_root_dir().join("logs").join("telegram-chats");
    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }
    let safe_name = user_name
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(40)
        .collect::<String>();
    let path = log_dir.join(format!(
        "{}-{}.jsonl",
        if safe_name.is_empty() {
            "guest"
        } else {
            &safe_name
        },
        user_id
    ));
    let line = json!({
        "timestamp": chrono::Local::now().to_rfc3339(),
        "user_id": user_id,
        "user_name": user_name,
        "user": user_text,
        "assistant": assistant_text,
    })
    .to_string();
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{}", line);
    }
}

async fn wait_for_llm_server_ready(timeout: Duration) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if client
            .get("http://127.0.0.1:8080/health")
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false)
        {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(750)).await;
    }
    false
}

async fn ensure_telegram_llm_ready(llama_state: Arc<LlamaState>) -> Result<(), String> {
    if llama_manager::active_model_path_if_running(&llama_state).is_some()
        && wait_for_llm_server_ready(Duration::from_secs(2)).await
    {
        return Ok(());
    }

    let settings = load_app_settings().unwrap_or_else(|_| AppSettings::default());
    let model_path = settings.selected_model_path.trim().to_string();
    if model_path.is_empty() {
        return Err(
            "Load a chat brain in Galaxy AI Hub first, or choose a GGUF model in the app settings."
                .to_string(),
        );
    }

    let system = crate::system_detect::check_system();
    let threads = system.cpu_threads.clamp(2, 8);
    let gpu_layers = if system.has_nvidia_gpu { 999 } else { 0 };
    let reduced_gpu_layers = if system.has_nvidia_gpu {
        system.recommended_task_gpu_layers.max(4)
    } else {
        0
    };

    let state_for_load = llama_state.clone();
    let status = tokio::task::spawn_blocking(move || {
        llama_manager::start_model_state(
            &state_for_load,
            model_path,
            settings.memory_size,
            threads,
            gpu_layers,
            reduced_gpu_layers,
        )
    })
    .await
    .map_err(|e| format!("Could not load the Telegram chat brain: {}", e))?;

    if status.status != "success" {
        return Err(status.message);
    }

    if wait_for_llm_server_ready(Duration::from_secs(180)).await {
        Ok(())
    } else {
        Err("The Telegram chat brain was launched but did not become ready in time.".to_string())
    }
}

fn telegram_detail_value(item: &ToolResultItem, label: &str) -> String {
    item.details
        .iter()
        .find(|field| field.label.eq_ignore_ascii_case(label))
        .map(|field| field.value.clone())
        .unwrap_or_default()
}

fn format_telegram_cards(cards: &[ToolResultCard]) -> String {
    let mut sections = Vec::new();
    for card in cards {
        let title = if card.summary.as_deref().unwrap_or_default().is_empty() {
            card.title.clone()
        } else {
            format!(
                "{}\n{}",
                card.title,
                card.summary.as_deref().unwrap_or_default()
            )
        };

        let items = card
            .items
            .iter()
            .take(10)
            .enumerate()
            .map(|(index, item)| match card.kind.as_str() {
                "gmail" => format!(
                    "{}. {}\nFrom: {}\nDate: {}\nPreview: {}",
                    index + 1,
                    item.title,
                    telegram_detail_value(item, "From"),
                    telegram_detail_value(item, "Date"),
                    telegram_detail_value(item, "Preview")
                ),
                "calendar" => {
                    let location = telegram_detail_value(item, "Location");
                    [
                        format!("{}. {}", index + 1, item.title),
                        format!("Start: {}", telegram_detail_value(item, "Start")),
                        format!("End: {}", telegram_detail_value(item, "End")),
                        if location.is_empty() {
                            String::new()
                        } else {
                            format!("Location: {}", location)
                        },
                    ]
                    .into_iter()
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
                }
                "file_search" | "folder" | "media" => {
                    let path = telegram_detail_value(item, "Path");
                    [
                        format!("{}. {}", index + 1, item.title),
                        format!("Type: {}", telegram_detail_value(item, "Type")),
                        format!("Size: {}", telegram_detail_value(item, "Size")),
                        if path.is_empty() {
                            item.subtitle.clone().unwrap_or_default()
                        } else {
                            format!("Path: {}", path)
                        },
                    ]
                    .into_iter()
                    .filter(|line| !line.trim().is_empty() && !line.ends_with(": "))
                    .collect::<Vec<_>>()
                    .join("\n")
                }
                "web_search" => format!(
                    "{}. {}\nSource: {}\nDetails: {}",
                    index + 1,
                    item.title,
                    item.subtitle.clone().unwrap_or_default(),
                    telegram_detail_value(item, "Details")
                ),
                _ => {
                    let details = item
                        .details
                        .iter()
                        .take(4)
                        .map(|field| format!("{}: {}", field.label, field.value))
                        .collect::<Vec<_>>()
                        .join("\n");
                    if details.is_empty() {
                        format!("{}. {}", index + 1, item.title)
                    } else {
                        format!("{}. {}\n{}", index + 1, item.title, details)
                    }
                }
            })
            .collect::<Vec<_>>();

        if items.is_empty() {
            sections.push(title);
        } else {
            sections.push(format!("{}\n\n{}", title, items.join("\n\n")));
        }
    }
    sections.join("\n\n")
}

fn telegram_user_wants_voice(text: &str) -> bool {
    let lower = normalize_text(text);
    [
        "voice",
        "voice note",
        "audio reply",
        "speak",
        "say it",
        "read it aloud",
        "noi bang giong",
        "gui giong",
        "tin nhan thoai",
        "doc bang giong",
        "doc len",
        "noi cho anh nghe",
        "noi cho em nghe",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TelegramVoiceIntent {
    None,
    Once,
    AutoOn,
    AutoOff,
}

fn text_contains_any(text: &str, phrases: &[&str]) -> bool {
    let lower = text.to_lowercase();
    let normalized = normalize_text(text);
    phrases
        .iter()
        .any(|phrase| lower.contains(phrase) || normalized.contains(phrase))
}

fn telegram_voice_intent(text: &str) -> TelegramVoiceIntent {
    if text_contains_any(
        text,
        &[
            "turn off voice",
            "voice mode off",
            "auto voice off",
            "stop voice",
            "text only",
            "reply with text",
            "don't send voice",
            "dont send voice",
            "tat giong",
            "tat che do giong",
            "tat tu dong giong",
            "dung gui giong",
            "khong gui giong",
            "chi tra loi bang chu",
            "tra loi bang chu thoi",
        ],
    ) {
        return TelegramVoiceIntent::AutoOff;
    }

    if text_contains_any(
        text,
        &[
            "turn on voice",
            "turn on auto voice",
            "voice mode on",
            "auto voice on",
            "always send voice",
            "always reply with voice",
            "send voice automatically",
            "reply by voice from now",
            "bat giong",
            "bat che do giong",
            "bat tu dong giong",
            "luon gui giong",
            "luon tra loi bang giong",
            "tu dong gui giong",
            "noi bang giong tu gio",
        ],
    ) {
        return TelegramVoiceIntent::AutoOn;
    }

    if telegram_user_wants_voice(text) {
        TelegramVoiceIntent::Once
    } else {
        TelegramVoiceIntent::None
    }
}

struct TelegramReplyParts {
    text: String,
    send_file_path: Option<String>,
    file_is_image: bool,
    file_caption: Option<String>,
    image_proposal: Option<ImageProposal>,
    action_proposal: Option<ActionProposal>,
}

fn telegram_prefers_vietnamese(text: &str) -> bool {
    telegram_speech_looks_vietnamese(text)
}

fn new_telegram_approval_id() -> String {
    format!("{:x}", now_millis())
}

fn telegram_approval_keyboard(approval_id: &str, vi: bool) -> Value {
    json!({
        "inline_keyboard": [[
            {
                "text": if vi { "\u{0110}\u{1ed3}ng \u{00fd}" } else { "Approve" },
                "callback_data": format!("gax:ok:{}", approval_id)
            },
            {
                "text": if vi { "Hu\u{1ef7}" } else { "Cancel" },
                "callback_data": format!("gax:no:{}", approval_id)
            }
        ]]
    })
}

fn telegram_image_approval_text(vi: bool) -> &'static str {
    if vi {
        "Em \u{0111}\u{00e3} chu\u{1ea9}n b\u{1ecb} y\u{00ea}u c\u{1ea7}u t\u{1ea1}o \u{1ea3}nh. Anh b\u{1ea5}m \u{0110}\u{1ed3}ng \u{00fd} \u{0111}\u{1ec3} em b\u{1eaf}t \u{0111}\u{1ea7}u nh\u{00e9}."
    } else {
        "I prepared the image request. Tap Approve when you're ready."
    }
}

fn proposal_string(proposal: &ActionProposal, key: &str) -> String {
    proposal
        .arguments
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn proposal_json_payload(proposal: &ActionProposal, key: &str) -> Option<String> {
    let value = proposal.arguments.get(key)?;
    if value.is_null() {
        None
    } else if let Some(text) = value.as_str() {
        (!text.trim().is_empty()).then(|| text.to_string())
    } else {
        Some(value.to_string())
    }
}

fn build_telegram_reply_parts(result: ReactChatResult) -> TelegramReplyParts {
    let mut text_lines: Vec<String> = Vec::new();
    let mut send_file_path: Option<String> = None;
    let mut file_is_image = false;
    let mut file_caption: Option<String> = None;
    let image_proposal = result.image_proposal.clone();
    let action_proposal = result.action_proposal.clone();

    if !result.answer.trim().is_empty() {
        text_lines.push(result.answer.trim().to_string());
    } else if !result.cards.is_empty() {
        let card_text = format_telegram_cards(&result.cards);
        if !card_text.is_empty() {
            text_lines.push(card_text);
        }
    }

    // File preview - send actual file when possible
    if let Some(preview) = result.file_preview {
        let path = preview.path.clone();
        let exists = std::path::Path::new(&path).exists();
        if exists {
            file_is_image = preview.mime_type.starts_with("image/");
            file_caption = Some(format!("*{}*", preview.name));
            send_file_path = Some(path);
        } else {
            text_lines.push(format!(
                "*{}*\n`{}`\nType: {}",
                preview.name, preview.path, preview.mime_type
            ));
        }
    }

    // Image proposal
    if let Some(proposal) = image_proposal.as_ref().filter(|_| false) {
        text_lines.push(format!(
            "*Image request queued for approval in Galaxy AI Hub*\nPrompt: _{}_",
            proposal.prompt
        ));
    }

    // Action proposal
    if let Some(action) = action_proposal.as_ref().filter(|_| false) {
        text_lines.push(format!(
            "*Action needs approval in Galaxy AI Hub*\nAction: {}\nRisk: {}\n{}",
            action.title, action.risk_level, action.details
        ));
    }

    TelegramReplyParts {
        text: text_lines
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n"),
        send_file_path,
        file_is_image,
        file_caption,
        image_proposal,
        action_proposal,
    }
}

async fn execute_telegram_action_proposal(
    profile: &TelegramAssistantProfile,
    proposal: &ActionProposal,
) -> Result<String, String> {
    match proposal.action_type.as_str() {
        "write_file" => {
            let root = proposal_string(proposal, "root_folder").trim().to_string();
            let root_folder = if root.is_empty() {
                profile.folders.first().cloned()
            } else {
                Some(root)
            };
            let result = file_tools::write_linked_text_file(
                proposal_string(proposal, "relative_path"),
                proposal_string(proposal, "content"),
                root_folder,
                profile.folders.clone(),
            )?;
            Ok(result.message)
        }
        "move_file" => {
            let root = proposal_string(proposal, "root_folder").trim().to_string();
            let root_folder = if root.is_empty() {
                profile.folders.first().cloned()
            } else {
                Some(root)
            };
            let result = file_tools::move_linked_file(
                proposal_string(proposal, "source"),
                proposal_string(proposal, "destination_relative_path"),
                root_folder,
                profile.folders.clone(),
            )?;
            Ok(result.message)
        }
        "delete_file" => {
            let result = file_tools::trash_linked_file(
                proposal_string(proposal, "source"),
                profile.folders.clone(),
            )?;
            Ok(result.message)
        }
        "gmail_send" => {
            google_calendar::send_google_gmail_message(
                profile.google_client_id.clone(),
                profile.google_client_secret.clone(),
                proposal_string(proposal, "to"),
                proposal_string(proposal, "subject"),
                proposal_string(proposal, "body"),
                Some(profile.user_name.clone()),
            )
            .await
        }
        "gmail_trash" => {
            google_calendar::trash_google_gmail_message(
                profile.google_client_id.clone(),
                profile.google_client_secret.clone(),
                proposal_string(proposal, "id"),
            )
            .await
        }
        "calendar_create" => {
            let result = google_calendar::create_google_calendar_event(
                profile.google_client_id.clone(),
                profile.google_client_secret.clone(),
                proposal_string(proposal, "title"),
                proposal_string(proposal, "start"),
                proposal_string(proposal, "end"),
                Some(proposal_string(proposal, "description")).filter(|v| !v.trim().is_empty()),
                Some(proposal_string(proposal, "location")).filter(|v| !v.trim().is_empty()),
            )
            .await?;
            Ok(format!(
                "Event created: {}{}",
                result.title,
                result
                    .html_link
                    .map(|link| format!(" ({})", link))
                    .unwrap_or_default()
            ))
        }
        "calendar_delete" => {
            google_calendar::delete_google_calendar_event(
                profile.google_client_id.clone(),
                profile.google_client_secret.clone(),
                proposal_string(proposal, "id"),
            )
            .await
        }
        "google_contact_delete" => {
            google_calendar::delete_google_contact(
                profile.google_client_id.clone(),
                profile.google_client_secret.clone(),
                proposal_string(proposal, "resource_name"),
            )
            .await
        }
        "google_action" => {
            google_calendar::execute_google_api(
                profile.google_client_id.clone(),
                profile.google_client_secret.clone(),
                proposal_string(proposal, "method"),
                proposal_string(proposal, "url"),
                proposal_json_payload(proposal, "payload"),
            )
            .await
        }
        "run_powershell" => Err(
            "System commands still need approval inside the app because they can affect the PC."
                .to_string(),
        ),
        other => Err(format!(
            "Telegram approval does not support this action yet: {}",
            other
        )),
    }
}

async fn execute_telegram_pending_approval(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    pending: TelegramPendingApproval,
    profile: TelegramAssistantProfile,
    llama_state: Arc<LlamaState>,
    session: Arc<Mutex<TelegramSessionState>>,
) -> Result<String, String> {
    match pending.payload {
        TelegramPendingApprovalPayload::Image(proposal) => {
            let status_loop = start_telegram_action_loop(
                client.clone(),
                token.to_string(),
                chat_id,
                "upload_photo",
            );
            let result = async {
                let state_for_stop = llama_state.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    llama_manager::stop_model_state(&state_for_stop)
                })
                .await;
                let settings = load_app_settings().unwrap_or_else(|_| AppSettings::default());
                let assistant_avatar_ref = profile
                    .avatar_path
                    .as_ref()
                    .and_then(|value| image_reference_data_url(value));
                let user_avatar_ref = image_reference_data_url(&settings.user_avatar);
                let recent_image_ref = pending
                    .reference_image_path
                    .as_deref()
                    .and_then(image_reference_data_url)
                    .or_else(|| {
                        session
                            .lock()
                            .ok()
                            .and_then(|guard| guard.last_image_by_chat.get(&chat_id).cloned())
                            .and_then(|path| image_reference_data_url(&path))
                    });
                let init_images = match proposal.mode.as_str() {
                    "image_to_image" => recent_image_ref.clone().into_iter().collect::<Vec<_>>(),
                    "avatar_image" => assistant_avatar_ref.clone().into_iter().collect::<Vec<_>>(),
                    "user_avatar_image" | "avatar_user_image" => {
                        user_avatar_ref.clone().into_iter().collect::<Vec<_>>()
                    }
                    "user_character_image" | "user_and_character_image" | "both_avatars_image" => {
                        [user_avatar_ref.clone(), assistant_avatar_ref.clone()]
                            .into_iter()
                            .flatten()
                            .collect::<Vec<_>>()
                    }
                    _ => Vec::new(),
                };
                append_runtime_log(
                    "telegram",
                    &format!(
                        "image approval mode={} refs={} user_avatar={} character_avatar={}",
                        proposal.mode,
                        init_images.len(),
                        user_avatar_ref.is_some(),
                        assistant_avatar_ref.is_some()
                    ),
                );
                if proposal.mode == "image_to_image" && init_images.is_empty() {
                    return Err(
                        "I need an input image before I can edit one from Telegram.".to_string()
                    );
                }
                if matches!(
                    proposal.mode.as_str(),
                    "user_character_image" | "user_and_character_image" | "both_avatars_image"
                ) && init_images.len() < 2
                {
                    return Err(
                        "I need both the selected user avatar and character avatar before I can use them as image references."
                            .to_string(),
                    );
                }
                if matches!(
                    proposal.mode.as_str(),
                    "avatar_image"
                        | "user_avatar_image"
                        | "avatar_user_image"
                        | "user_character_image"
                        | "user_and_character_image"
                        | "both_avatars_image"
                ) && init_images.is_empty()
                {
                    return Err(match proposal.mode.as_str() {
                        "avatar_image" => {
                            "I need the selected character avatar before I can send that image."
                        }
                        "user_avatar_image" | "avatar_user_image" => {
                            "I need the selected user avatar before I can use it as an image reference."
                        }
                        _ => "I need the selected profile avatars before I can use them as image references.",
                    }
                    .to_string());
                }
                let image = generate_image_with_sdcpp_qwen(
                    proposal.prompt,
                    None,
                    Some(init_images),
                    proposal.mask_prompt,
                    Some(settings.image_width),
                    Some(settings.image_height),
                )
                .await?;
                send_telegram_photo(client, token, chat_id, &image.file_path, None).await?;
                if let Ok(mut guard) = session.lock() {
                    guard.last_image_by_chat.insert(chat_id, image.file_path.clone());
                }
                Ok(if pending.prefers_vietnamese {
                    "\u{1ea2}nh \u{0111}\u{00e3} xong r\u{1ed3}i \u{0111}\u{00e2}y."
                } else {
                    "The image is ready."
                }
                .to_string())
            }
            .await;
            status_loop.store(false, Ordering::Relaxed);
            result
        }
        TelegramPendingApprovalPayload::Action(proposal) => {
            execute_telegram_action_proposal(&profile, &proposal).await
        }
    }
}

async fn telegram_poll_loop(
    token: String,
    owner_id: Option<i64>,
    bot_username: Option<String>,
    omnivoice_state: OmniVoiceRuntimeState,
    llama_state: Arc<LlamaState>,
    session: Arc<Mutex<TelegramSessionState>>,
    fallback_system_prompt: String,
    temperature: f32,
    max_tokens: u32,
    fallback_thinking_enabled: bool,
    fallback_google_client_id: String,
    fallback_google_client_secret: String,
    fallback_folders: Vec<String>,
    stop: Arc<AtomicBool>,
) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(35))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            append_runtime_log(
                "telegram",
                &format!("could not create HTTP client: {}", error),
            );
            return;
        }
    };
    let mut offset: i64 = 0;

    append_runtime_log("telegram", "polling started");

    while !stop.load(Ordering::SeqCst) {
        let active_profile = load_telegram_assistant_profile(
            &fallback_system_prompt,
            &fallback_folders,
            &fallback_google_client_id,
            &fallback_google_client_secret,
        );
        let greeting_chat_id = {
            let mut guard = session.lock().unwrap();
            if guard
                .last_personality_id
                .as_deref()
                .is_some_and(|id| id != active_profile.personality_id)
            {
                guard.last_personality_id = Some(active_profile.personality_id.clone());
                guard.last_chat_id
            } else if guard.last_personality_id.is_none() {
                guard.last_personality_id = Some(active_profile.personality_id.clone());
                None
            } else {
                None
            }
        };
        if let Some(chat_id) = greeting_chat_id {
            let greeting = build_telegram_switch_greeting(&active_profile).await;
            let _ = send_telegram_message(&client, &token, chat_id, &greeting).await;
        }

        let response = client
            .get(format!("https://api.telegram.org/bot{}/getUpdates", token))
            .query(&[
                ("timeout", "1".to_string()),
                ("offset", offset.to_string()),
                (
                    "allowed_updates",
                    r#"["message","callback_query"]"#.to_string(),
                ),
            ])
            .send()
            .await;

        let Ok(response) = response else {
            append_runtime_log("telegram", "getUpdates request failed");
            tokio::time::sleep(Duration::from_secs(3)).await;
            continue;
        };

        let Ok(body) = response.json::<Value>().await else {
            append_runtime_log("telegram", "getUpdates returned unreadable JSON");
            tokio::time::sleep(Duration::from_secs(3)).await;
            continue;
        };

        if !body.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            append_runtime_log("telegram", &format!("getUpdates returned error: {}", body));
            tokio::time::sleep(Duration::from_secs(5)).await;
            continue;
        }

        let updates = body
            .get("result")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        for update in updates {
            if let Some(update_id) = update.get("update_id").and_then(Value::as_i64) {
                offset = offset.max(update_id + 1);
            }

            if let Some(callback) = update.get("callback_query") {
                let callback_id = callback
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let from_id = callback
                    .get("from")
                    .and_then(|from| from.get("id"))
                    .and_then(Value::as_i64);
                if owner_id.is_none() || from_id != owner_id {
                    append_runtime_log(
                        "telegram",
                        &format!("ignored callback from unauthorized user {:?}", from_id),
                    );
                    answer_telegram_callback(&client, &token, callback_id, "Not allowed.").await;
                    continue;
                }
                let Some(data) = callback.get("data").and_then(Value::as_str) else {
                    continue;
                };
                let Some((action, approval_id)) = data
                    .strip_prefix("gax:")
                    .and_then(|rest| rest.split_once(':'))
                else {
                    continue;
                };
                let callback_chat_id = callback
                    .get("message")
                    .and_then(|message| message.get("chat"))
                    .and_then(|chat| chat.get("id"))
                    .and_then(Value::as_i64);
                let callback_message_id = callback
                    .get("message")
                    .and_then(|message| message.get("message_id"))
                    .and_then(Value::as_i64);
                if let (Some(chat_id), Some(message_id)) = (callback_chat_id, callback_message_id) {
                    clear_telegram_message_keyboard(&client, &token, chat_id, message_id).await;
                }
                let pending = {
                    let mut guard = session.lock().unwrap();
                    if action == "ok" {
                        guard.pending_approvals.remove(approval_id)
                    } else {
                        guard.pending_approvals.remove(approval_id)
                    }
                };
                let Some(pending) = pending else {
                    answer_telegram_callback(&client, &token, callback_id, "This request expired.")
                        .await;
                    continue;
                };
                let chat_id = callback_chat_id.unwrap_or(pending.chat_id);
                if action != "ok" {
                    let text = if pending.prefers_vietnamese {
                        "\u{0110}\u{00e3} hu\u{1ef7}."
                    } else {
                        "Cancelled."
                    };
                    answer_telegram_callback(&client, &token, callback_id, text).await;
                    continue;
                }

                let approved_text = if pending.prefers_vietnamese {
                    "\u{0110}\u{00e3} \u{0111}\u{1ed3}ng \u{00fd}."
                } else {
                    "Approved."
                };
                answer_telegram_callback(&client, &token, callback_id, approved_text).await;
                let profile = load_telegram_assistant_profile(
                    &fallback_system_prompt,
                    &fallback_folders,
                    &fallback_google_client_id,
                    &fallback_google_client_secret,
                );
                let result = execute_telegram_pending_approval(
                    &client,
                    &token,
                    chat_id,
                    pending.clone(),
                    profile.clone(),
                    llama_state.clone(),
                    session.clone(),
                )
                .await;
                let reply = match result {
                    Ok(text) => text,
                    Err(error) => error,
                };
                send_telegram_message_chunked(&client, &token, chat_id, &reply).await;
                let mut history = load_personality_chat_history(&pending.personality_id);
                history.push(ReactChatMessage {
                    role: "assistant".to_string(),
                    content: json!(reply),
                });
                if history.len() > 80 {
                    let remove_count = history.len() - 80;
                    history.drain(0..remove_count);
                }
                persist_personality_chat_history(&pending.personality_id, &history);
                continue;
            }

            let Some(message) = update.get("message") else {
                continue;
            };
            let Some(chat_id) = message
                .get("chat")
                .and_then(|chat| chat.get("id"))
                .and_then(Value::as_i64)
            else {
                continue;
            };
            let from_id = message
                .get("from")
                .and_then(|from| from.get("id"))
                .and_then(Value::as_i64);
            let chat_type = message
                .get("chat")
                .and_then(|chat| chat.get("type"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            let from_value = message.get("from").cloned().unwrap_or_default();
            let from_name = telegram_display_name(&from_value);
            let is_owner = owner_id.is_some() && from_id == owner_id;
            let is_group_chat = matches!(chat_type, "group" | "supergroup");
            let mentioned_bot = telegram_message_mentions_bot(message, bot_username.as_deref());
            let settings_for_access =
                load_app_settings().unwrap_or_else(|_| AppSettings::default());
            let guest = from_id.and_then(|id| {
                settings_for_access
                    .telegram_guests
                    .iter()
                    .find(|guest| guest.id == id.to_string())
                    .cloned()
            });
            let mut guest_name = guest.as_ref().map(|guest| guest.name.clone());
            if !is_owner && guest.is_none() && is_group_chat && mentioned_bot {
                if let Some(id) = from_id {
                    match crate::config_store::add_telegram_guest_if_missing(
                        id.to_string(),
                        from_name.clone(),
                    ) {
                        Ok(Some(guest)) => {
                            append_runtime_log(
                                "telegram",
                                &format!("auto-added telegram guest {} ({})", guest.name, guest.id),
                            );
                            guest_name = Some(guest.name);
                        }
                        Ok(None) => {
                            guest_name = Some(from_name.clone());
                        }
                        Err(error) => {
                            append_runtime_log(
                                "telegram",
                                &format!("could not auto-add telegram guest: {}", error),
                            );
                        }
                    }
                }
            }

            if !is_owner && guest_name.is_none() {
                append_runtime_log(
                    "telegram",
                    &format!("ignored message from unauthorized user {:?}", from_id),
                );
                continue;
            }
            let is_guest = !is_owner;
            if is_group_chat && !mentioned_bot {
                continue;
            }

            {
                let mut guard = session.lock().unwrap();
                guard.last_chat_id = Some(chat_id);
            }

            let text = message
                .get("text")
                .or_else(|| message.get("caption"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let voice_intent = telegram_voice_intent(text);
            let auto_voice = session.lock().unwrap().auto_voice;
            let wants_voice_reply =
                !is_guest && (auto_voice || voice_intent == TelegramVoiceIntent::Once);

            if text.is_empty() {
                let _ = send_telegram_message(
                    &client,
                    &token,
                    chat_id,
                    "Send me a text message and I'll answer properly.",
                )
                .await;
                continue;
            }

            let profile = load_telegram_assistant_profile(
                &fallback_system_prompt,
                &fallback_folders,
                &fallback_google_client_id,
                &fallback_google_client_secret,
            );
            let turn_thinking_enabled = load_app_settings()
                .map(|settings| settings.thinking_enabled)
                .unwrap_or(profile.thinking_enabled || fallback_thinking_enabled);

            let command_text = text.to_ascii_lowercase();
            let command_text = command_text.trim();
            if command_text == "/help" {
                let _ = send_telegram_message(
                    &client,
                    &token,
                    chat_id,
                    "Just talk to me naturally here. If you want voice, say something like \"send this as a voice message\" or \"turn on auto voice\".",
                )
                .await;
                continue;
            }
            if command_text == "/status" || command_text == "status" {
                let _ = send_telegram_message(
                    &client,
                    &token,
                    chat_id,
                    "I'm here. Send me what you need.",
                )
                .await;
                continue;
            }

            if !is_guest {
                match voice_intent {
                    TelegramVoiceIntent::AutoOn => {
                        {
                            let mut guard = session.lock().unwrap();
                            guard.auto_voice = true;
                        }
                        let reply = "Okay, I'll send my replies with voice from now on.";
                        let _ = send_telegram_message(&client, &token, chat_id, reply).await;
                        synthesize_and_send_telegram_voice(
                            &client,
                            &token,
                            chat_id,
                            omnivoice_state.clone(),
                            llama_state.clone(),
                            reply,
                            profile.voice_sample_path.clone(),
                            Some(&profile.personality_name),
                        )
                        .await;
                        continue;
                    }
                    TelegramVoiceIntent::AutoOff => {
                        {
                            let mut guard = session.lock().unwrap();
                            guard.auto_voice = false;
                        }
                        let _ = send_telegram_message(
                            &client,
                            &token,
                            chat_id,
                            "Okay, I'll reply by text only.",
                        )
                        .await;
                        continue;
                    }
                    TelegramVoiceIntent::None | TelegramVoiceIntent::Once => {}
                }
            }

            // Built-in commands
            match text.to_ascii_lowercase().trim() {
                "/start" => {
                    let mut history = load_personality_chat_history(&profile.personality_id);
                    ensure_personality_greeting(&mut history, &profile.greeting);
                    persist_personality_chat_history(&profile.personality_id, &history);
                    let _ =
                        send_telegram_message(&client, &token, chat_id, &profile.greeting).await;
                    continue;
                }
                "/help" => {
                    let _ = send_telegram_message(
                        &client,
                        &token,
                        chat_id,
                        "Just talk to me naturally here. If you want voice, say something like \"send this as a voice message\" or \"turn on auto voice\".",
                    )
                    .await;
                    continue;
                }
                "/status" | "status" => {
                    let _ = send_telegram_message(
                        &client,
                        &token,
                        chat_id,
                        "I'm here. Send me what you need.",
                    )
                    .await;
                    continue;
                }
                _ => {}
            }

            if let Err(error) = ensure_telegram_llm_ready(llama_state.clone()).await {
                append_runtime_log("telegram", &format!("LLM auto-load failed: {}", error));
                let _ = send_telegram_message(&client, &token, chat_id, &error).await;
                continue;
            }
            let started = Instant::now();
            let mut history = if is_guest {
                Vec::new()
            } else {
                load_personality_chat_history(&profile.personality_id)
            };
            if !is_guest {
                ensure_personality_greeting(&mut history, &profile.greeting);
            }
            history.push(ReactChatMessage {
                role: "user".to_string(),
                content: serde_json::json!(text),
            });
            let react_messages: Vec<ReactChatMessage> = history
                .iter()
                .rev()
                .take(16)
                .map(|m| ReactChatMessage {
                    role: m.role.clone(),
                    content: m.content.clone(),
                })
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();

            let sampling = agent_react::SamplingConfig {
                temperature,
                ..profile.sampling
            };
            let thinking_loop =
                start_telegram_action_loop(client.clone(), token.clone(), chat_id, "typing");
            let react_result = if is_guest {
                agent_react::agent_jan_chat_no_tools_core(
                    profile.system_prompt.clone(),
                    telegram_guest_context_block(
                        &profile,
                        guest_name.as_deref().unwrap_or(&from_name),
                    ),
                    react_messages,
                    sampling,
                    max_tokens,
                    turn_thinking_enabled,
                )
                .await
            } else {
                agent_react::agent_jan_chat_core(
                    profile.system_prompt.clone(),
                    telegram_context_block(&profile),
                    react_messages,
                    profile.folders.clone(),
                    profile.google_client_id.clone(),
                    profile.google_client_secret.clone(),
                    sampling,
                    max_tokens,
                    turn_thinking_enabled,
                )
                .await
            };
            thinking_loop.store(false, Ordering::Relaxed);

            let reply_text = match react_result {
                Err(e) => e,
                Ok(result) => {
                    let parts = build_telegram_reply_parts(result);
                    // Send file if one was flagged
                    if let Some(ref file_path) = parts.send_file_path {
                        let send_result = if parts.file_is_image {
                            send_telegram_photo(
                                &client,
                                &token,
                                chat_id,
                                file_path,
                                parts.file_caption.as_deref(),
                            )
                            .await
                        } else {
                            send_telegram_document(
                                &client,
                                &token,
                                chat_id,
                                file_path,
                                parts.file_caption.as_deref(),
                            )
                            .await
                        };
                        if let Err(e) = send_result {
                            append_runtime_log("telegram", &format!("file send failed: {}", e));
                        } else if parts.file_is_image {
                            if let Ok(mut guard) = session.lock() {
                                guard.last_image_by_chat.insert(chat_id, file_path.clone());
                            }
                        }
                    }
                    if let Some(proposal) = parts.image_proposal.clone() {
                        let vi = telegram_prefers_vietnamese(text);
                        let approval_id = new_telegram_approval_id();
                        {
                            let mut guard = session.lock().unwrap();
                            let reference_image_path =
                                guard.last_image_by_chat.get(&chat_id).cloned();
                            guard.pending_approvals.insert(
                                approval_id.clone(),
                                TelegramPendingApproval {
                                    chat_id,
                                    personality_id: profile.personality_id.clone(),
                                    prefers_vietnamese: vi,
                                    reference_image_path,
                                    payload: TelegramPendingApprovalPayload::Image(
                                        proposal.clone(),
                                    ),
                                },
                            );
                        }
                        let _ = send_telegram_message_with_keyboard(
                            &client,
                            &token,
                            chat_id,
                            telegram_image_approval_text(vi),
                            telegram_approval_keyboard(&approval_id, vi),
                        )
                        .await;
                    }
                    if let Some(proposal) = parts.action_proposal.clone() {
                        let vi = telegram_prefers_vietnamese(text);
                        let approval_id = new_telegram_approval_id();
                        {
                            let mut guard = session.lock().unwrap();
                            guard.pending_approvals.insert(
                                approval_id.clone(),
                                TelegramPendingApproval {
                                    chat_id,
                                    personality_id: profile.personality_id.clone(),
                                    prefers_vietnamese: vi,
                                    reference_image_path: None,
                                    payload: TelegramPendingApprovalPayload::Action(
                                        proposal.clone(),
                                    ),
                                },
                            );
                        }
                        let card = if vi {
                            format!(
                                "Y\u{00ea}u c\u{1ea7}u c\u{1ea7}n duy\u{1ec7}t\n\n{}\nM\u{1ee9}c r\u{1ee7}i ro: {}\n{}",
                                proposal.title, proposal.risk_level, proposal.details
                            )
                        } else {
                            format!(
                                "Approval required\n\n{}\nRisk: {}\n{}",
                                proposal.title, proposal.risk_level, proposal.details
                            )
                        };
                        let _ = send_telegram_message_with_keyboard(
                            &client,
                            &token,
                            chat_id,
                            &card,
                            telegram_approval_keyboard(&approval_id, vi),
                        )
                        .await;
                    }
                    if wants_voice_reply && !parts.text.trim().is_empty() {
                        synthesize_and_send_telegram_voice(
                            &client,
                            &token,
                            chat_id,
                            omnivoice_state.clone(),
                            llama_state.clone(),
                            &parts.text,
                            profile.voice_sample_path.clone(),
                            Some(&profile.personality_name),
                        )
                        .await;
                    }
                    parts.text
                }
            };

            if is_guest {
                if let Some(id) = from_id {
                    append_telegram_chat_log(
                        id,
                        guest_name.as_deref().unwrap_or(&from_name),
                        text,
                        &reply_text,
                    );
                }
            } else {
                history.push(ReactChatMessage {
                    role: "assistant".to_string(),
                    content: serde_json::json!(reply_text.clone()),
                });
                if history.len() > 80 {
                    let remove_count = history.len() - 80;
                    history.drain(0..remove_count);
                }
                persist_personality_chat_history(&profile.personality_id, &history);
                let updated_memory = update_personality_memory_after_turn(
                    &profile.personality_id,
                    &profile.personality_memory,
                    text,
                    &reply_text,
                );
                if updated_memory != profile.personality_memory {
                    append_runtime_log(
                        "telegram",
                        &format!(
                            "updated memory for active character {}",
                            profile.personality_name
                        ),
                    );
                }
            }
            append_runtime_log(
                "telegram",
                &format!("handled message in {} ms", started.elapsed().as_millis()),
            );

            if !reply_text.is_empty() {
                send_telegram_message_chunked(&client, &token, chat_id, &reply_text).await;
            }
        }
    }

    append_runtime_log("telegram", "polling stopped");
}

#[derive(Debug, Clone, Copy)]
struct WavFormat {
    audio_format: u16,
    channels: u16,
    sample_rate: u32,
    bits_per_sample: u16,
    block_align: u16,
}

fn read_u16_le(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn decode_wav_sample(
    data: &[u8],
    offset: usize,
    audio_format: u16,
    bits_per_sample: u16,
) -> Option<f32> {
    match (audio_format, bits_per_sample) {
        (1, 8) => data
            .get(offset)
            .map(|value| (*value as f32 - 128.0) / 128.0),
        (1, 16) => Some(
            i16::from_le_bytes(data.get(offset..offset + 2)?.try_into().ok()?) as f32 / 32768.0,
        ),
        (1, 24) => {
            let bytes = data.get(offset..offset + 3)?;
            let mut sample =
                (bytes[0] as i32) | ((bytes[1] as i32) << 8) | ((bytes[2] as i32) << 16);
            if sample & 0x800000 != 0 {
                sample |= !0x00ff_ffff;
            }
            Some(sample as f32 / 8_388_608.0)
        }
        (1, 32) => Some(
            i32::from_le_bytes(data.get(offset..offset + 4)?.try_into().ok()?) as f32
                / 2_147_483_648.0,
        ),
        (3, 32) => Some(
            f32::from_le_bytes(data.get(offset..offset + 4)?.try_into().ok()?).clamp(-1.0, 1.0),
        ),
        _ => None,
    }
}

fn decode_wav_mono_frame(data: &[u8], frame_index: usize, format: WavFormat) -> Option<(f32, f32)> {
    let bytes_per_sample = (format.bits_per_sample / 8).max(1) as usize;
    let frame_start = frame_index.checked_mul(format.block_align as usize)?;
    let mut sum = 0.0f32;
    let mut peak = 0.0f32;

    for channel in 0..format.channels as usize {
        let offset = frame_start + channel * bytes_per_sample;
        let sample = decode_wav_sample(data, offset, format.audio_format, format.bits_per_sample)?;
        sum += sample;
        peak = peak.max(sample.abs());
    }

    Some((sum / format.channels.max(1) as f32, peak))
}

fn stable_bytes_fingerprint(parts: &[&[u8]]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for part in parts {
        for byte in *part {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    hash
}

fn find_last_pause_start(
    peaks: &[f32],
    search_start: usize,
    search_end: usize,
    silence_threshold: f32,
    min_pause_frames: usize,
) -> Option<usize> {
    if search_end <= search_start || min_pause_frames == 0 {
        return None;
    }

    let mut run_start: Option<usize> = None;
    let mut last_pause_start: Option<usize> = None;

    for frame in search_start..search_end {
        if peaks.get(frame).copied().unwrap_or(0.0) <= silence_threshold {
            run_start.get_or_insert(frame);
        } else if let Some(start) = run_start.take() {
            if frame.saturating_sub(start) >= min_pause_frames {
                last_pause_start = Some(start);
            }
        }
    }

    if let Some(start) = run_start {
        if search_end.saturating_sub(start) >= min_pause_frames {
            last_pause_start = Some(start);
        }
    }

    last_pause_start
}

fn apply_fade(samples: &mut [f32], fade_in_frames: usize, fade_out_frames: usize) {
    if samples.is_empty() {
        return;
    }

    let fade_in_len = fade_in_frames.min(samples.len());
    for (index, sample) in samples.iter_mut().take(fade_in_len).enumerate() {
        let gain = (index as f32 + 1.0) / fade_in_len as f32;
        *sample *= gain;
    }

    let fade_out_len = fade_out_frames.min(samples.len());
    let total = samples.len();
    for index in 0..fade_out_len {
        let gain = (fade_out_len.saturating_sub(index) as f32) / fade_out_len as f32;
        if let Some(sample) = samples.get_mut(total - fade_out_len + index) {
            *sample *= gain;
        }
    }
}

fn normalize_samples(samples: &mut [f32]) {
    let peak = samples
        .iter()
        .fold(0.0f32, |current, sample| current.max(sample.abs()));
    if peak <= 0.0001 {
        return;
    }
    let gain = 0.999f32 / peak;
    for sample in samples.iter_mut() {
        *sample = (*sample * gain).clamp(-1.0, 1.0);
    }
}

fn resample_linear(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if samples.is_empty() || source_rate == 0 || target_rate == 0 || source_rate == target_rate {
        return samples.to_vec();
    }

    let target_len =
        ((samples.len() as u64 * target_rate as u64) / source_rate as u64).max(1) as usize;
    let step = source_rate as f64 / target_rate as f64;
    let mut output = Vec::with_capacity(target_len);

    for index in 0..target_len {
        let position = index as f64 * step;
        let left = position.floor() as usize;
        let right = (left + 1).min(samples.len().saturating_sub(1));
        let fraction = (position - left as f64) as f32;
        let left_sample = samples[left];
        let right_sample = samples[right];
        output.push(left_sample + (right_sample - left_sample) * fraction);
    }

    output
}

fn write_pcm16_mono_wav(path: &Path, sample_rate: u32, samples: &[f32]) -> Result<(), String> {
    let data_size = samples
        .len()
        .checked_mul(2)
        .ok_or_else(|| "Prepared voice sample is too large.".to_string())?
        as u32;
    let mut bytes = Vec::with_capacity(44 + data_size as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_size.to_le_bytes());

    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    std::fs::write(path, bytes).map_err(|e| format!("Could not write prepared voice sample: {}", e))
}

fn prepare_wav_voice_sample(input_path: &Path, output_path: &Path) -> Result<(), String> {
    let bytes = std::fs::read(input_path)
        .map_err(|e| format!("Could not read voice sample for preparation: {}", e))?;
    if bytes.get(0..4) != Some(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
        return Err("Only standard WAV voice samples can be prepared automatically.".to_string());
    }

    let mut offset = 12usize;
    let mut format: Option<WavFormat> = None;
    let mut data_slice: Option<&[u8]> = None;

    while offset + 8 <= bytes.len() {
        let chunk_id = bytes.get(offset..offset + 4).unwrap_or_default();
        let chunk_size = read_u32_le(&bytes, offset + 4).unwrap_or(0) as usize;
        let chunk_start = offset + 8;
        let chunk_end = chunk_start.saturating_add(chunk_size).min(bytes.len());

        if chunk_id == b"fmt " && chunk_end >= chunk_start + 16 {
            format = Some(WavFormat {
                audio_format: read_u16_le(&bytes, chunk_start).unwrap_or(0),
                channels: read_u16_le(&bytes, chunk_start + 2).unwrap_or(0),
                sample_rate: read_u32_le(&bytes, chunk_start + 4).unwrap_or(0),
                block_align: read_u16_le(&bytes, chunk_start + 12).unwrap_or(0),
                bits_per_sample: read_u16_le(&bytes, chunk_start + 14).unwrap_or(0),
            });
        } else if chunk_id == b"data" {
            data_slice = Some(&bytes[chunk_start..chunk_end]);
        }

        offset = chunk_start + chunk_size + (chunk_size % 2);
    }

    let format = format.ok_or_else(|| "The WAV voice sample has no format section.".to_string())?;
    let data = data_slice.ok_or_else(|| "The WAV voice sample has no audio data.".to_string())?;

    if !matches!(format.audio_format, 1 | 3)
        || format.channels == 0
        || format.channels > 8
        || format.sample_rate == 0
        || format.block_align == 0
        || !matches!(format.bits_per_sample, 8 | 16 | 24 | 32)
    {
        return Err("This WAV voice sample uses an unsupported audio format.".to_string());
    }

    let total_frames = data.len() / format.block_align as usize;
    if total_frames == 0 {
        return Err("The WAV voice sample is empty.".to_string());
    }

    let mut mono_samples = Vec::with_capacity(total_frames);
    let mut peaks = Vec::with_capacity(total_frames);
    for frame in 0..total_frames {
        let (sample, peak) = decode_wav_mono_frame(data, frame, format)
            .ok_or_else(|| "Could not decode the WAV voice sample.".to_string())?;
        mono_samples.push(sample);
        peaks.push(peak);
    }

    let silence_threshold = 0.01f32;
    let first_voice_frame = peaks
        .iter()
        .position(|peak| *peak > silence_threshold)
        .ok_or_else(|| "The WAV voice sample appears to contain only silence.".to_string())?;
    let pre_roll_frames = (format.sample_rate / 10) as usize;
    let start_frame = first_voice_frame.saturating_sub(pre_roll_frames);
    let max_frames = (format.sample_rate as usize).saturating_mul(8);
    let hard_end_frame = total_frames.min(start_frame.saturating_add(max_frames));
    let mut end_frame = hard_end_frame;

    while end_frame > start_frame {
        let frame = end_frame - 1;
        let peak = peaks.get(frame).copied().unwrap_or(0.0);
        if peak > silence_threshold {
            break;
        }
        end_frame -= 1;
    }

    let min_phrase_frames = (format.sample_rate / 2) as usize;
    let pause_frames = (format.sample_rate / 8) as usize;
    let tail_frames = (format.sample_rate / 20) as usize;
    if let Some(pause_start) = find_last_pause_start(
        &peaks,
        start_frame
            .saturating_add(min_phrase_frames)
            .min(hard_end_frame),
        hard_end_frame,
        silence_threshold,
        pause_frames,
    ) {
        end_frame = pause_start.saturating_add(tail_frames).min(hard_end_frame);
    } else {
        end_frame = end_frame.saturating_add(tail_frames).min(hard_end_frame);
    }

    if end_frame <= start_frame || end_frame - start_frame < (format.sample_rate / 3) as usize {
        return Err("The prepared voice sample would be too short.".to_string());
    }

    let mut prepared_samples = mono_samples[start_frame..end_frame].to_vec();
    prepared_samples = resample_linear(
        &prepared_samples,
        format.sample_rate,
        PREPARED_VOICE_SAMPLE_RATE,
    );
    let fade_in_frames = (format.sample_rate / 100).max(1) as usize;
    let fade_out_frames = (format.sample_rate / 50).max(1) as usize;
    let fade_in_frames = ((fade_in_frames as u64 * PREPARED_VOICE_SAMPLE_RATE as u64)
        / format.sample_rate.max(1) as u64)
        .max(1) as usize;
    let fade_out_frames = ((fade_out_frames as u64 * PREPARED_VOICE_SAMPLE_RATE as u64)
        / format.sample_rate.max(1) as u64)
        .max(1) as usize;
    apply_fade(&mut prepared_samples, fade_in_frames, fade_out_frames);
    normalize_samples(&mut prepared_samples);

    write_pcm16_mono_wav(output_path, PREPARED_VOICE_SAMPLE_RATE, &prepared_samples)
}

fn sanitized_file_stem(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("voice-sample");
    let cleaned: String = stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();

    if cleaned.trim_matches('_').is_empty() {
        "voice-sample".to_string()
    } else {
        cleaned
    }
}

fn find_existing_prepared_sample_by_fingerprint(fingerprint: u64) -> Option<PathBuf> {
    let dir = prepared_voice_samples_dir();
    let entries = std::fs::read_dir(&dir).ok()?;
    let suffix = format!("-{:016x}.wav", fingerprint);

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if file_name.ends_with(&suffix) {
            return Some(path);
        }
    }

    None
}

fn prepared_voice_cache_path(path: &Path, source_bytes: &[u8]) -> PathBuf {
    let fingerprint =
        stable_bytes_fingerprint(&[PREPARED_VOICE_SAMPLE_VERSION.as_bytes(), source_bytes]);

    if let Some(existing) = find_existing_prepared_sample_by_fingerprint(fingerprint) {
        return existing;
    }

    prepared_voice_samples_dir().join(format!(
        "{}-{:016x}.wav",
        sanitized_file_stem(path),
        fingerprint
    ))
}

fn voice_language_cache_key(path: &Path) -> Result<String, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("Could not inspect the selected voice sample: {}", e))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    Ok(format!(
        "{}|{}|{}",
        path.to_string_lossy(),
        metadata.len(),
        modified
    ))
}

fn detect_voice_language_from_path_blocking(
    audio_path: &Path,
) -> Result<DetectedVoiceLanguage, String> {
    ensure_voice_dirs()?;

    let stdout = run_voice_python(&[
        "transcribe",
        "--audio",
        audio_path.to_string_lossy().as_ref(),
        "--cache-dir",
        voice_cache_dir().to_string_lossy().as_ref(),
    ])?;

    if !stdout.status.success() {
        let stderr = String::from_utf8_lossy(&stdout.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Voice language detection failed.".to_string()
        } else {
            stderr
        });
    }

    let parsed: WhisperStdout = serde_json::from_slice(&stdout.stdout)
        .map_err(|e| format!("Could not read the voice helper result: {}", e))?;

    Ok(DetectedVoiceLanguage {
        language: parsed.language.trim().to_string(),
        language_probability: parsed.language_probability,
    })
}

fn prepare_voice_sample_for_omnivoice(file_path: &str) -> PathBuf {
    let path = PathBuf::from(file_path);
    let is_wav = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("wav"))
        .unwrap_or(false);

    if !is_wav {
        return path;
    }

    if let Err(error) = ensure_voice_dirs() {
        append_runtime_log("voice", &format!("voice sample prep skipped: {}", error));
        return path;
    }

    let source_bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => return path,
    };

    let cache_path = prepared_voice_cache_path(&path, &source_bytes);

    if cache_path.exists() {
        return cache_path;
    }

    let staging_path = prepared_voice_samples_dir().join(format!(
        "{}-{:016x}.tmp.wav",
        sanitized_file_stem(&path),
        stable_bytes_fingerprint(&[
            PREPARED_VOICE_SAMPLE_VERSION.as_bytes(),
            source_bytes.as_slice(),
            b"staging",
        ])
    ));

    let started = Instant::now();
    match prepare_wav_voice_sample(&path, &staging_path) {
        Ok(()) => {
            let _ = std::fs::rename(&staging_path, &cache_path);
            if !cache_path.exists() {
                let _ = std::fs::copy(&staging_path, &cache_path);
                let _ = std::fs::remove_file(&staging_path);
            }
            let original_size = source_bytes.len() as u64;
            let prepared_size = std::fs::metadata(&cache_path)
                .map(|meta| meta.len())
                .unwrap_or(0);
            append_runtime_log(
                "voice",
                &format!(
                    "prepared voice sample original={} prepared={} original_bytes={} prepared_bytes={} hz={} mono=true normalized=true took_ms={}",
                    path.display(),
                    cache_path.display(),
                    original_size,
                    prepared_size,
                    PREPARED_VOICE_SAMPLE_RATE,
                    started.elapsed().as_millis()
                ),
            );
            cache_path
        }
        Err(error) => {
            append_runtime_log(
                "voice",
                &format!("voice sample prep failed for {}: {}", path.display(), error),
            );
            let _ = std::fs::remove_file(&staging_path);
            path
        }
    }
}

pub(crate) fn prepare_voice_sample_for_omnivoice_path(file_path: &str) -> PathBuf {
    prepare_voice_sample_for_omnivoice(file_path)
}

fn prepared_voice_transcript_cache_path(audio_path: &Path) -> PathBuf {
    let stem = audio_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("voice-sample");
    audio_path.with_file_name(format!("{stem}.transcript.txt"))
}

pub(crate) fn transcribe_prepared_voice_sample_path(audio_path: &Path) -> Result<String, String> {
    ensure_voice_dirs()?;

    let transcript_cache_path = prepared_voice_transcript_cache_path(audio_path);
    if let Ok(cached) = std::fs::read_to_string(&transcript_cache_path) {
        let cached = cached.trim().to_string();
        if !cached.is_empty() {
            return Ok(cached);
        }
    }

    if !voice_python_path().exists() {
        return Err(
            "The shared voice helper is not installed yet. Start the voice input helper once so clone transcription can reuse it."
                .to_string(),
        );
    }

    let stdout = run_voice_python(&[
        "transcribe",
        "--audio",
        audio_path.to_string_lossy().as_ref(),
        "--cache-dir",
        voice_cache_dir().to_string_lossy().as_ref(),
    ])?;

    if !stdout.status.success() {
        let stderr = String::from_utf8_lossy(&stdout.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Voice sample transcription failed.".to_string()
        } else {
            stderr
        });
    }

    let parsed: WhisperStdout = serde_json::from_slice(&stdout.stdout)
        .map_err(|e| format!("Could not read the shared voice helper result: {}", e))?;

    let text = parsed.text.trim().to_string();
    if text.is_empty() {
        return Err("The shared voice helper returned an empty transcript.".to_string());
    }

    let _ = std::fs::write(&transcript_cache_path, &text);
    Ok(text)
}

#[tauri::command]
pub fn list_voice_samples(folder: Option<String>) -> Result<Vec<VoiceSample>, String> {
    let dir = voices_dir(folder.as_deref());
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut seen_names = std::collections::HashSet::new();
    let mut samples = Vec::new();
    collect_voice_samples(&dir, &mut seen_names, &mut samples);

    samples.sort_by(|left, right| left.label.cmp(&right.label));
    Ok(samples)
}

#[tauri::command]
pub fn start_voice_setup(state: State<'_, VoiceRuntimeState>) -> VoiceSetupStatus {
    let runtime_state = state.inner().clone();

    if current_voice_status(&runtime_state).ready {
        return current_voice_status(&runtime_state);
    }

    if runtime_state.installing.swap(true, Ordering::SeqCst) {
        return current_voice_status(&runtime_state);
    }

    std::thread::spawn(move || install_voice_runtime_blocking(runtime_state.clone()));

    current_voice_status(state.inner())
}

#[tauri::command]
pub fn get_voice_setup_status(state: State<'_, VoiceRuntimeState>) -> VoiceSetupStatus {
    current_voice_status(state.inner())
}

#[tauri::command]
pub async fn transcribe_audio(
    state: State<'_, VoiceRuntimeState>,
    audio_data_url: String,
) -> Result<TranscriptionResult, String> {
    let runtime_state = state.inner().clone();
    let status = current_voice_status(&runtime_state);
    if !status.ready {
        return Err(status.message);
    }

    let extension = audio_extension_from_data_url(&audio_data_url).to_string();
    let audio_bytes = decode_data_url(&audio_data_url)?;
    ensure_voice_dirs()?;

    let audio_path = voice_temp_dir().join(format!("recording-{}.{}", now_millis(), extension));
    std::fs::write(&audio_path, audio_bytes)
        .map_err(|e| format!("Could not save the recorded audio: {}", e))?;

    let stdout = tokio::task::spawn_blocking(move || {
        run_voice_python(&[
            "transcribe",
            "--audio",
            audio_path.to_string_lossy().as_ref(),
            "--cache-dir",
            voice_cache_dir().to_string_lossy().as_ref(),
        ])
    })
    .await
    .map_err(|e| format!("Voice listening task failed: {}", e))??;

    if !stdout.status.success() {
        let stderr = String::from_utf8_lossy(&stdout.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Voice listening failed.".to_string()
        } else {
            stderr
        });
    }

    let parsed: WhisperStdout = serde_json::from_slice(&stdout.stdout)
        .map_err(|e| format!("Could not read the voice helper result: {}", e))?;

    Ok(TranscriptionResult {
        text: parsed.text,
        language: parsed.language,
        language_probability: parsed.language_probability,
    })
}

#[tauri::command]
pub async fn detect_voice_sample_language(
    state: State<'_, VoiceRuntimeState>,
    sample_path: String,
) -> Result<DetectedVoiceLanguage, String> {
    let runtime_state = state.inner().clone();
    let status = current_voice_status(&runtime_state);
    if !status.ready {
        return Err(status.message);
    }

    let prepared_path = prepare_voice_sample_for_omnivoice(&sample_path);
    let cache_key = voice_language_cache_key(&prepared_path)?;
    if let Ok(cache) = runtime_state.detected_languages.lock() {
        if let Some(cached) = cache.get(&cache_key).cloned() {
            return Ok(cached);
        }
    }

    let detection_path = prepared_path.clone();
    let detected = tokio::task::spawn_blocking(move || {
        detect_voice_language_from_path_blocking(&detection_path)
    })
    .await
    .map_err(|e| format!("Voice language detection task failed: {}", e))??;

    if let Ok(mut cache) = runtime_state.detected_languages.lock() {
        cache.insert(cache_key, detected.clone());
        if cache.len() > 64 {
            if let Some(first_key) = cache.keys().next().cloned() {
                cache.remove(&first_key);
            }
        }
    }

    Ok(detected)
}

#[tauri::command]
pub async fn generate_image(
    prompt: String,
    init_image_data_url: Option<String>,
    init_image_data_urls: Option<Vec<String>>,
    mask_prompt: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<ImageGenerationResult, String> {
    generate_image_with_sdcpp_qwen(
        prompt,
        init_image_data_url,
        init_image_data_urls,
        mask_prompt,
        width,
        height,
    )
    .await
}

#[tauri::command]
pub async fn test_telegram_bot(token: String) -> Result<TelegramBotStatus, String> {
    let token = normalize_telegram_token(&token);
    if token.is_empty() {
        return Ok(TelegramBotStatus {
            success: false,
            message: "Add a Telegram bot token first.".to_string(),
            username: None,
        });
    }

    telegram_get_me(&reqwest::Client::new(), &token).await
}

#[tauri::command]
pub async fn start_telegram_bot(
    state: State<'_, TelegramRuntimeState>,
    omnivoice_state: State<'_, OmniVoiceRuntimeState>,
    llama_state: State<'_, LlamaState>,
    token: String,
    owner_user_id: String,
    system_prompt: String,
    temperature: f32,
    max_tokens: u32,
    thinking_enabled: bool,
    google_client_id: String,
    google_client_secret: String,
    folders: Vec<String>,
) -> Result<TelegramBotStatus, String> {
    let token = normalize_telegram_token(&token);
    if token.is_empty() {
        return Ok(TelegramBotStatus {
            success: false,
            message: "Add a Telegram bot token first.".to_string(),
            username: None,
        });
    }
    let owner_id = parse_telegram_owner_id(&owner_user_id)?;
    let client = reqwest::Client::new();
    let status = telegram_get_me(&client, &token).await?;
    if !status.success {
        return Ok(status);
    }

    {
        let mut guard = state.worker.lock().unwrap();
        if let Some(worker) = guard.as_ref() {
            if !worker.stop.load(Ordering::SeqCst)
                && worker.token == token
                && worker.owner_id == owner_id
            {
                return Ok(TelegramBotStatus {
                    success: true,
                    message: worker
                        .username
                        .as_ref()
                        .map(|name| format!("Telegram control is already running with @{}.", name))
                        .unwrap_or_else(|| "Telegram control is already running.".to_string()),
                    username: worker.username.clone(),
                });
            }
        }
        if let Some(worker) = guard.take() {
            worker.stop.store(true, Ordering::SeqCst);
        }

        {
            let profile = load_telegram_assistant_profile(
                &system_prompt,
                &folders,
                &google_client_id,
                &google_client_secret,
            );
            let mut session_guard = state.session.lock().unwrap();
            session_guard.last_personality_id = Some(profile.personality_id);
            session_guard.last_chat_id = None;
            session_guard.auto_voice = false;
        }

        let stop = Arc::new(AtomicBool::new(false));
        let worker = TelegramWorker {
            stop: stop.clone(),
            username: status.username.clone(),
            token: token.clone(),
            owner_id,
        };
        *guard = Some(worker);

        tauri::async_runtime::spawn(telegram_poll_loop(
            token,
            owner_id,
            status.username.clone(),
            omnivoice_state.inner().clone(),
            Arc::new(llama_state.inner().clone()),
            state.session.clone(),
            system_prompt,
            temperature,
            max_tokens,
            thinking_enabled,
            google_client_id,
            google_client_secret,
            folders,
            stop,
        ));
    }

    Ok(TelegramBotStatus {
        success: true,
        message: status
            .username
            .as_ref()
            .map(|name| format!("Telegram control is running with @{}.", name))
            .unwrap_or_else(|| "Telegram control is running.".to_string()),
        username: status.username,
    })
}

#[tauri::command]
pub fn stop_telegram_bot(state: State<'_, TelegramRuntimeState>) -> TelegramBotStatus {
    let mut guard = state.worker.lock().unwrap();
    if let Some(worker) = guard.take() {
        worker.stop.store(true, Ordering::SeqCst);
        TelegramBotStatus {
            success: true,
            message: "Telegram control stopped.".to_string(),
            username: worker.username,
        }
    } else {
        TelegramBotStatus {
            success: true,
            message: "Telegram control is already stopped.".to_string(),
            username: None,
        }
    }
}

#[tauri::command]
pub fn get_telegram_bot_status(state: State<'_, TelegramRuntimeState>) -> TelegramBotStatus {
    let guard = state.worker.lock().unwrap();
    if let Some(worker) = guard.as_ref() {
        TelegramBotStatus {
            success: true,
            message: worker
                .username
                .as_ref()
                .map(|name| format!("Telegram control is running with @{}.", name))
                .unwrap_or_else(|| "Telegram control is running.".to_string()),
            username: worker.username.clone(),
        }
    } else {
        TelegramBotStatus {
            success: false,
            message: "Telegram control is stopped.".to_string(),
            username: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_react::{ToolResultField, ToolResultItem};

    #[test]
    fn telegram_formats_gmail_cards_as_rows() {
        let cards = vec![ToolResultCard {
            kind: "gmail".to_string(),
            title: "1 Gmail messages".to_string(),
            summary: Some("Verified from Gmail API".to_string()),
            fields: Vec::new(),
            items: vec![ToolResultItem {
                title: "1. Real subject".to_string(),
                subtitle: Some("sender@example.com".to_string()),
                details: vec![
                    ToolResultField {
                        label: "From".to_string(),
                        value: "sender@example.com".to_string(),
                    },
                    ToolResultField {
                        label: "Date".to_string(),
                        value: "Today".to_string(),
                    },
                    ToolResultField {
                        label: "Preview".to_string(),
                        value: "Real preview".to_string(),
                    },
                ],
                url: None,
            }],
            text: None,
        }];
        let text = format_telegram_cards(&cards);
        assert!(text.contains("Real subject"));
        assert!(text.contains("From: sender@example.com"));
        assert!(text.contains("Preview: Real preview"));
    }

    #[test]
    fn telegram_reply_prefers_natural_answer_over_tool_cards() {
        let result = ReactChatResult {
            answer: "Your calendar today has one meeting at 9.".to_string(),
            thinking: Some("hidden thinking".to_string()),
            tool_used: Some("google_calendar_check".to_string()),
            observation: Some("raw observation".to_string()),
            cards: vec![ToolResultCard {
                kind: "calendar".to_string(),
                title: "1 calendar events".to_string(),
                summary: Some("Verified from Google Calendar API".to_string()),
                fields: Vec::new(),
                items: Vec::new(),
                text: None,
            }],
            image_proposal: None,
            file_preview: None,
            action_proposal: None,
            tool_trace: Vec::new(),
        };
        let parts = build_telegram_reply_parts(result);
        assert!(parts.text.contains("calendar today"));
        assert!(!parts.text.contains("Verified from Google Calendar API"));
        assert!(!parts.text.contains("hidden thinking"));
    }

    #[test]
    fn telegram_message_chunks_are_unicode_safe() {
        let text = format!(
            "{}\n\n{}",
            "\u{00e1}".repeat(3600),
            "\u{0110}\u{00e2}y l\u{00e0} \u{0111}o\u{1ea1}n sau."
        );
        let chunks = telegram_message_chunks(&text);
        assert!(chunks.len() >= 2);
        assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 3500));
        assert!(chunks[0].chars().all(|ch| ch == '\u{00e1}'));
        assert_eq!(
            chunks.last().map(String::as_str),
            Some("\u{0110}\u{00e2}y l\u{00e0} \u{0111}o\u{1ea1}n sau.")
        );
        assert_eq!(
            chunks
                .iter()
                .take(chunks.len() - 1)
                .map(|chunk| chunk.chars().count())
                .sum::<usize>(),
            3600
        );
    }

    #[test]
    fn telegram_speech_text_reads_lines_dates_and_units_naturally() {
        let text = "H\u{00f4}m nay 18/05/2026\nNhi\u{1ec7}t \u{0111}\u{1ed9} 30\u{00b0}C, gi\u{00f3} 12km/h, m\u{01b0}a 81%";
        let speech = sanitize_telegram_speech_text(text);
        assert!(speech.contains("H\u{00f4}m nay 18 th\u{00e1}ng 5 n\u{0103}m 2026."));
        assert!(speech.contains("30 \u{0111}\u{1ed9} C\u{00ea}"));
        assert!(speech.contains("12 ki l\u{00f4} m\u{00e9}t tr\u{00ea}n gi\u{1edd}"));
        assert!(speech.contains("81 ph\u{1ea7}n tr\u{0103}m"));
        let short_date =
            sanitize_telegram_speech_text("H\u{1eb9}n ng\u{00e0}y 08/05 (th\u{1ee9} s\u{00e1}u)");
        assert!(short_date.contains("8 th\u{00e1}ng 5"));
        assert!(short_date.contains(", th\u{1ee9} s\u{00e1}u,"));
    }

    #[test]
    fn telegram_detects_natural_voice_requests() {
        assert!(telegram_user_wants_voice("tra loi bang giong cho anh nghe"));
        assert!(telegram_user_wants_voice("send a voice note please"));
        assert!(!telegram_user_wants_voice("tra loi bang chu thoi"));
        assert_eq!(
            telegram_voice_intent("turn on auto voice please"),
            TelegramVoiceIntent::AutoOn
        );
        assert_eq!(
            telegram_voice_intent("chi tra loi bang chu thoi"),
            TelegramVoiceIntent::AutoOff
        );
    }

    #[test]
    fn pause_detection_finds_last_sentence_break() {
        let mut peaks = vec![0.2; 100];
        for peak in peaks.iter_mut().take(40).skip(32) {
            *peak = 0.0;
        }
        for peak in peaks.iter_mut().take(78).skip(70) {
            *peak = 0.0;
        }

        let pause = find_last_pause_start(&peaks, 10, 90, 0.01, 4);
        assert_eq!(pause, Some(70));
    }

    #[test]
    fn fade_softens_edges() {
        let mut samples = vec![1.0; 8];
        apply_fade(&mut samples, 2, 3);
        assert!(samples[0] < 1.0);
        assert!(samples[7] < 1.0);
        assert!(samples[3] > 0.9);
    }

    #[test]
    fn normalize_pushes_peak_to_full_scale() {
        let mut samples = vec![0.25, -0.5, 0.2];
        normalize_samples(&mut samples);
        let peak = samples
            .iter()
            .fold(0.0f32, |current, sample| current.max(sample.abs()));
        assert!(peak > 0.99);
    }

    #[test]
    fn resample_changes_length_for_target_rate() {
        let source = vec![0.0, 0.5, -0.5, 0.25];
        let resampled = resample_linear(&source, 44_100, 22_050);
        assert_eq!(resampled.len(), 2);
    }
}

#[tauri::command]
pub fn get_graphics_power_status() -> GraphicsPowerStatus {
    let output = Command::new("nvidia-smi")
        .args([
            "--query-gpu=memory.used,memory.total,utilization.gpu",
            "--format=csv,noheader,nounits",
        ])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let line = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or_default()
                .to_string();
            let parts: Vec<_> = line.split(',').map(|value| value.trim()).collect();

            if parts.len() >= 3 {
                let used_mb = parts[0].parse::<u32>().unwrap_or(0);
                let total_mb = parts[1].parse::<u32>().unwrap_or(0);
                let percent = if total_mb == 0 {
                    0
                } else {
                    ((used_mb as f32 / total_mb as f32) * 100.0).round() as u8
                };

                GraphicsPowerStatus {
                    available: true,
                    used_mb,
                    total_mb,
                    percent,
                    summary: format!("{} MB of {} MB in use", used_mb, total_mb),
                }
            } else {
                GraphicsPowerStatus {
                    available: false,
                    used_mb: 0,
                    total_mb: 0,
                    percent: 0,
                    summary: "Graphics Power monitor is unavailable.".to_string(),
                }
            }
        }
        _ => GraphicsPowerStatus {
            available: false,
            used_mb: 0,
            total_mb: 0,
            percent: 0,
            summary: "Graphics Power monitor is unavailable.".to_string(),
        },
    }
}

#[tauri::command]
pub fn get_system_resource_status() -> crate::resource_monitor::SystemResourceStatus {
    crate::resource_monitor::get_system_resource_status()
}

#[tauri::command]
pub fn get_vram_memory_status() -> crate::resource_monitor::VramMemoryStatus {
    crate::resource_monitor::get_vram_memory_status()
}
