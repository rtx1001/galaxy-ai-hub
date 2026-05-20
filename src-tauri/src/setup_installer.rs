use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::app_paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupFile {
    pub label: String,
    pub url: String,
    pub destination: String,
    pub size_hint: String,
    pub extract_to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupPartCatalog {
    pub key: String,
    pub title: String,
    pub files: Vec<SetupFile>,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupCatalog {
    pub tier: String,
    pub parts: Vec<SetupPartCatalog>,
    pub brain_model_folder: String,
    pub selected_brain_model_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupInstallResult {
    pub success: bool,
    pub message: String,
    pub catalog: SetupCatalog,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetupInstallProgress {
    pub stage: String,
    pub part_key: String,
    pub label: String,
    pub file_index: usize,
    pub file_count: usize,
    pub percent: u32,
    pub message: String,
}

fn app_root_dir() -> PathBuf {
    app_paths::app_root_dir()
}

fn portable_models_dir() -> PathBuf {
    app_root_dir().join("assistant-runtime").join("models")
}

fn brain_model_folder_for_tier(tier: &str) -> PathBuf {
    portable_models_dir()
        .join("brain")
        .join(brain_choice(tier).folder_name)
}

fn selected_brain_model_path_for_tier(tier: &str) -> PathBuf {
    brain_model_folder_for_tier(tier).join("model.gguf")
}

struct BrainChoice {
    folder_name: &'static str,
    model_name: &'static str,
    repo: &'static str,
    file: &'static str,
    size_hint: &'static str,
    mmproj_repo: &'static str,
    mmproj_file: &'static str,
    mmproj_size_hint: &'static str,
}

fn brain_choice(tier: &str) -> BrainChoice {
    match tier {
        "light" => BrainChoice {
            folder_name: "Gemma-4-E2B-Hauhau-Q4_K_P",
            model_name: "Gemma 4 E2B Hauhau Q4",
            repo: "HauhauCS/Gemma-4-E2B-Uncensored-HauhauCS-Aggressive",
            file: "Gemma-4-E2B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf",
            size_hint: "about 3.2 GB",
            mmproj_repo: "HauhauCS/Gemma-4-E2B-Uncensored-HauhauCS-Aggressive",
            mmproj_file: "mmproj-Gemma-4-E2B-Uncensored-HauhauCS-Aggressive-f16.gguf",
            mmproj_size_hint: "about 940 MB",
        },
        "high" => BrainChoice {
            folder_name: "Gemma-4-E4B-Hauhau-Q8_K_P",
            model_name: "Gemma 4 E4B Hauhau Q8",
            repo: "HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive",
            file: "Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf",
            size_hint: "about 7.6 GB",
            mmproj_repo: "HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive",
            mmproj_file: "mmproj-Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-f16.gguf",
            mmproj_size_hint: "about 944 MB",
        },
        _ => BrainChoice {
            folder_name: "Gemma-4-E4B-Hauhau-Q4_K_P",
            model_name: "Gemma 4 E4B Hauhau Q4",
            repo: "HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive",
            file: "Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf",
            size_hint: "about 5.0 GB",
            mmproj_repo: "HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive",
            mmproj_file: "mmproj-Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-f16.gguf",
            mmproj_size_hint: "about 944 MB",
        },
    }
}

fn hf_url(repo: &str, file: &str) -> String {
    format!(
        "https://huggingface.co/{}/resolve/main/{}?download=true",
        repo,
        file.replace('\\', "/")
    )
}

fn relative_display(path: &Path) -> String {
    path.strip_prefix(app_root_dir())
        .unwrap_or(path)
        .display()
        .to_string()
}

fn setup_file(
    label: &str,
    repo: &str,
    file: &str,
    destination: PathBuf,
    size_hint: &str,
) -> SetupFile {
    SetupFile {
        label: label.to_string(),
        url: hf_url(repo, file),
        destination: relative_display(&destination),
        size_hint: size_hint.to_string(),
        extract_to: None,
    }
}

fn setup_archive_file(
    label: &str,
    url: &str,
    destination: PathBuf,
    extract_to: PathBuf,
    size_hint: &str,
) -> SetupFile {
    SetupFile {
        label: label.to_string(),
        url: url.to_string(),
        destination: relative_display(&destination),
        size_hint: size_hint.to_string(),
        extract_to: Some(relative_display(&extract_to)),
    }
}

fn brain_files(tier: &str) -> Vec<SetupFile> {
    let choice = brain_choice(tier);
    vec![
        setup_file(
            choice.model_name,
            choice.repo,
            choice.file,
            selected_brain_model_path_for_tier(tier),
            choice.size_hint,
        ),
        setup_file(
            "Gemma 4 vision projector",
            choice.mmproj_repo,
            choice.mmproj_file,
            brain_model_folder_for_tier(tier).join("mmproj.gguf"),
            choice.mmproj_size_hint,
        ),
    ]
}

fn voice_files(tier: &str) -> Vec<SetupFile> {
    let (base_file, tokenizer_file, quant_label, size_hint) = match tier {
        "light" => (
            "omnivoice-base-Q4_K_M.gguf",
            "omnivoice-tokenizer-Q4_K_M.gguf",
            "Q4",
            "about 650 MB",
        ),
        _ => (
            "omnivoice-base-Q8_0.gguf",
            "omnivoice-tokenizer-Q8_0.gguf",
            "Q8",
            "about 1.2 GB",
        ),
    };
    let root = app_root_dir()
        .join("assistant-runtime")
        .join("voice-tts")
        .join("models")
        .join("omnivoice.cpp");
    vec![
        setup_file(
            &format!("Voice base {}", quant_label),
            "Serveurperso/OmniVoice-GGUF",
            base_file,
            root.join(base_file),
            size_hint,
        ),
        setup_file(
            &format!("Voice tokenizer {}", quant_label),
            "Serveurperso/OmniVoice-GGUF",
            tokenizer_file,
            root.join(tokenizer_file),
            "about 30 MB",
        ),
    ]
}

fn sd_runtime_file(has_nvidia_gpu: bool) -> SetupFile {
    let cache = app_root_dir()
        .join("assistant-runtime")
        .join("download-cache");
    let extract_to = app_root_dir().join("bin").join("stable-diffusion");
    if has_nvidia_gpu {
        setup_archive_file(
            "Image engine CUDA",
            "https://sourceforge.net/projects/stable-diffusion-cpp.mirror/files/master-625-f683c88/sd-master-f683c88-bin-win-cuda12-x64.zip/download",
            cache.join("sd-master-f683c88-bin-win-cuda12-x64.zip"),
            extract_to,
            "about 362 MB",
        )
    } else {
        setup_archive_file(
            "Image engine CPU",
            "https://sourceforge.net/projects/stable-diffusion-cpp.mirror/files/master-625-f683c88/sd-master-f683c88-bin-win-avx2-x64.zip/download",
            cache.join("sd-master-f683c88-bin-win-avx2-x64.zip"),
            extract_to,
            "about 14 MB",
        )
    }
}

fn image_files(tier: &str, has_nvidia_gpu: bool) -> Vec<SetupFile> {
    let (image_file, image_size, encoder_file, encoder_size) = match tier {
        "light" => (
            "v23/Qwen-Rapid-NSFW-v23_Q3_K.gguf",
            "about 9.7 GB",
            "Qwen2.5-VL-7B-Instruct.Q3_K_M.gguf",
            "about 3.8 GB",
        ),
        "high" => (
            "v23/Qwen-Rapid-NSFW-v23_Q5_K.gguf",
            "about 14.5 GB",
            "Qwen2.5-VL-7B-Instruct.Q5_K_M.gguf",
            "about 5.2 GB",
        ),
        _ => (
            "v23/Qwen-Rapid-NSFW-v23_Q4_K.gguf",
            "about 12.2 GB",
            "Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf",
            "about 4.4 GB",
        ),
    };
    let root = app_root_dir()
        .join("assistant-runtime")
        .join("sdcpp")
        .join("models")
        .join("qwen-edit");
    vec![
        sd_runtime_file(has_nvidia_gpu),
        setup_file(
            "Qwen Image Edit",
            "Novice25/Qwen-Image-Edit-Rapid-AIO-GGUF",
            image_file,
            root.join(
                Path::new(image_file)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("Qwen-Rapid-NSFW-v23_Q4_K.gguf"),
            ),
            image_size,
        ),
        setup_file(
            "Image text encoder",
            "mradermacher/Qwen2.5-VL-7B-Instruct-GGUF",
            encoder_file,
            root.join("text_encoders").join(encoder_file),
            encoder_size,
        ),
        setup_file(
            "Image projector",
            "mradermacher/Qwen2.5-VL-7B-Instruct-GGUF",
            "Qwen2.5-VL-7B-Instruct.mmproj-Q8_0.gguf",
            root.join("text_encoders")
                .join("Qwen2.5-VL-7B-Instruct.mmproj-Q8_0.gguf"),
            "about 814 MB",
        ),
        setup_file(
            "Image VAE",
            "QuantStack/Qwen-Image-Edit-GGUF",
            "VAE/Qwen_Image-VAE.safetensors",
            root.join("vae").join("qwen_image_vae.safetensors"),
            "about 500 MB",
        ),
    ]
}

fn absolute_from_display(path: &str) -> PathBuf {
    app_root_dir().join(path)
}

fn file_installed(file: &SetupFile) -> bool {
    if let Some(extract_to) = &file.extract_to {
        let extract_path = absolute_from_display(extract_to);
        if extract_path.ends_with(Path::new("bin").join("stable-diffusion")) {
            return image_runtime_installed();
        }
        return extract_path.exists();
    }
    let path = absolute_from_display(&file.destination);
    path.exists()
        && path
            .metadata()
            .map(|meta| meta.len() > 1024 * 1024)
            .unwrap_or(false)
}

fn files_installed(files: &[SetupFile]) -> bool {
    files.iter().all(file_installed)
}

fn omnivoice_engine_installed() -> bool {
    let bin_dir = app_root_dir()
        .join("assistant-runtime")
        .join("voice-tts")
        .join("bin");
    let required_files = [
        "omnivoice-tts.exe",
        "ggml.dll",
        "ggml-base.dll",
        "ggml-cpu.dll",
        "ggml-cuda.dll",
    ];
    required_files.iter().all(|file_name| {
        bin_dir
            .join(file_name)
            .metadata()
            .map(|meta| meta.len() > 16 * 1024)
            .unwrap_or(false)
    })
}

fn image_runtime_installed() -> bool {
    let root = app_root_dir().join("bin").join("stable-diffusion");
    root.join("sd-cli.exe").exists() && root.join("stable-diffusion.dll").exists()
}

fn brain_metadata_installed(tier: &str) -> bool {
    let model_yml = brain_model_folder_for_tier(tier).join("model.yml");
    model_yml
        .metadata()
        .map(|meta| meta.len() > 32)
        .unwrap_or(false)
}

fn write_brain_model_yml(tier: &str) -> Result<(), String> {
    let folder = brain_model_folder_for_tier(tier);
    let model = folder.join("model.gguf");
    let mmproj = folder.join("mmproj.gguf");
    let model_bytes = std::fs::metadata(&model)
        .map_err(|e| format!("Could not read installed brain model metadata: {}", e))?
        .len();
    let mmproj_bytes = std::fs::metadata(&mmproj)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let total_bytes = model_bytes.saturating_add(mmproj_bytes);
    let name = folder
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("galaxy-brain");
    let relative_model = model
        .strip_prefix(app_root_dir())
        .unwrap_or(&model)
        .display()
        .to_string()
        .replace('\\', "/");
    let relative_mmproj = mmproj
        .strip_prefix(app_root_dir())
        .unwrap_or(&mmproj)
        .display()
        .to_string()
        .replace('\\', "/");
    let content = if mmproj.exists() {
        format!(
            "embedding: false\nmmproj_path: {}\nmodel_path: {}\nname: {}\nsize_bytes: {}\n",
            relative_mmproj, relative_model, name, total_bytes
        )
    } else {
        format!(
            "embedding: false\nmodel_path: {}\nname: {}\nsize_bytes: {}\n",
            relative_model, name, total_bytes
        )
    };
    std::fs::write(folder.join("model.yml"), content)
        .map_err(|e| format!("Could not write model.yml: {}", e))
}

fn part_key_for_file(file: &SetupFile) -> String {
    let destination = file.destination.replace('\\', "/").to_lowercase();
    let extract_to = file
        .extract_to
        .as_deref()
        .unwrap_or_default()
        .replace('\\', "/")
        .to_lowercase();
    if destination.contains("/brain/") {
        "brain".to_string()
    } else if destination.contains("/voice-tts/") {
        "voice".to_string()
    } else if destination.contains("/qwen-edit/") || extract_to.contains("/stable-diffusion") {
        "image".to_string()
    } else {
        String::new()
    }
}

fn emit_progress(
    app: &tauri::AppHandle,
    stage: &str,
    file: Option<&SetupFile>,
    file_index: usize,
    file_count: usize,
    message: String,
) {
    let percent = if file_count == 0 {
        0
    } else {
        ((file_index.min(file_count) as f32 / file_count as f32) * 100.0).round() as u32
    };
    let progress = SetupInstallProgress {
        stage: stage.to_string(),
        part_key: file.map(part_key_for_file).unwrap_or_default(),
        label: file.map(|item| item.label.clone()).unwrap_or_default(),
        file_index,
        file_count,
        percent,
        message,
    };
    let _ = app.emit("setup-install-progress", progress);
}

fn find_dir_containing(root: &Path, file_name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case(file_name))
                .unwrap_or(false)
        {
            return path.parent().map(|parent| parent.to_path_buf());
        }
        if path.is_dir() {
            if let Some(found) = find_dir_containing(&path, file_name) {
                return Some(found);
            }
        }
    }
    None
}

fn copy_runtime_files(source_dir: &Path, destination_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(destination_dir).map_err(|e| {
        format!(
            "Could not create image engine folder {}: {}",
            destination_dir.display(),
            e
        )
    })?;
    for entry in std::fs::read_dir(source_dir)
        .map_err(|e| format!("Could not read extracted image engine: {}", e))?
        .flatten()
    {
        let path = entry.path();
        if path.is_file() {
            let target = destination_dir.join(entry.file_name());
            std::fs::copy(&path, &target).map_err(|e| {
                format!(
                    "Could not copy image engine file {}: {}",
                    path.display(),
                    e
                )
            })?;
        }
    }
    Ok(())
}

fn extract_archive(file: &SetupFile, archive_path: &Path) -> Result<(), String> {
    let extract_to = file
        .extract_to
        .as_ref()
        .map(|path| absolute_from_display(path))
        .ok_or_else(|| format!("{} is not an archive setup item.", file.label))?;
    if extract_to.exists() {
        let _ = std::fs::remove_dir_all(&extract_to);
    }
    std::fs::create_dir_all(&extract_to).map_err(|e| {
        format!(
            "Could not create extraction folder {}: {}",
            extract_to.display(),
            e
        )
    })?;
    let mut command = Command::new("tar.exe");
    command.arg("-xf").arg(archive_path).arg("-C").arg(&extract_to);
    crate::process_util::hide_window(&mut command);
    let status = command
        .status()
        .map_err(|e| format!("Could not start archive extractor: {}", e))?;
    if !status.success() {
        return Err(format!("Could not extract {}", file.label));
    }
    if !image_runtime_installed() {
        if let Some(runtime_dir) = find_dir_containing(&extract_to, "sd-cli.exe") {
            copy_runtime_files(&runtime_dir, &extract_to)?;
        }
    }
    if !file_installed(file) {
        return Err(format!("{} extracted, but required files were not found.", file.label));
    }
    Ok(())
}

fn download_file(
    app: &tauri::AppHandle,
    file: &SetupFile,
    file_index: usize,
    file_count: usize,
) -> Result<(), String> {
    let destination = absolute_from_display(&file.destination);
    if file_installed(file) {
        emit_progress(
            app,
            "ready",
            Some(file),
            file_index,
            file_count,
            format!("{} is already installed.", file.label),
        );
        return Ok(());
    }
    emit_progress(
        app,
        "downloading",
        Some(file),
        file_index.saturating_sub(1),
        file_count,
        format!("Downloading {} ({})...", file.label, file.size_hint),
    );
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create model folder {}: {}", parent.display(), e))?;
    }
    let temp = destination.with_extension("download");
    let mut command = Command::new("curl.exe");
    command
        .arg("--ssl-no-revoke")
        .arg("-L")
        .arg("-C")
        .arg("-")
        .arg("-o")
        .arg(&temp)
        .arg(&file.url);
    crate::process_util::hide_window(&mut command);
    let status = command
        .status()
        .map_err(|e| format!("Could not start downloader: {}", e))?;
    if !status.success() {
        return Err(format!("Download failed for {}", file.label));
    }
    if temp
        .metadata()
        .map(|meta| meta.len() <= 1024 * 1024)
        .unwrap_or(true)
    {
        return Err(format!("Downloaded file looks incomplete: {}", file.label));
    }
    if file.extract_to.is_some() {
        extract_archive(file, &temp)?;
        let _ = std::fs::remove_file(&temp);
    } else {
        if destination.exists() {
            let _ = std::fs::remove_file(&destination);
        }
        std::fs::rename(&temp, &destination)
            .map_err(|e| format!("Could not move downloaded file into place: {}", e))?;
    }
    emit_progress(
        app,
        "done",
        Some(file),
        file_index,
        file_count,
        format!("Installed {}.", file.label),
    );
    Ok(())
}

#[tauri::command]
pub fn get_setup_catalog(tier: String, has_nvidia_gpu: Option<bool>) -> SetupCatalog {
    let tier = match tier.as_str() {
        "light" | "balanced" | "high" => tier,
        _ => "balanced".to_string(),
    };
    let has_nvidia_gpu = has_nvidia_gpu.unwrap_or(false);
    let brain = brain_files(&tier);
    let voice = voice_files(&tier);
    let image = image_files(&tier, has_nvidia_gpu);
    SetupCatalog {
        tier: tier.clone(),
        parts: vec![
            SetupPartCatalog {
                key: "brain".to_string(),
                title: "Brain".to_string(),
                installed: files_installed(&brain) && brain_metadata_installed(&tier),
                files: brain,
            },
            SetupPartCatalog {
                key: "voice".to_string(),
                title: "Voice".to_string(),
                installed: files_installed(&voice) && omnivoice_engine_installed(),
                files: voice,
            },
            SetupPartCatalog {
                key: "image".to_string(),
                title: "Image Studio".to_string(),
                installed: files_installed(&image) && image_runtime_installed(),
                files: image,
            },
        ],
        brain_model_folder: portable_models_dir().join("brain").display().to_string(),
        selected_brain_model_path: selected_brain_model_path_for_tier(&tier)
            .display()
            .to_string(),
    }
}

#[tauri::command]
pub async fn install_setup_bundle(
    app: tauri::AppHandle,
    tier: String,
    has_nvidia_gpu: Option<bool>,
) -> Result<SetupInstallResult, String> {
    let tier = match tier.as_str() {
        "light" | "balanced" | "high" => tier,
        _ => "balanced".to_string(),
    };
    let install_tier = tier.clone();
    let install_has_nvidia_gpu = has_nvidia_gpu.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || -> Result<SetupInstallResult, String> {
        let mut all_files = Vec::new();
        all_files.extend(brain_files(&install_tier));
        all_files.extend(voice_files(&install_tier));
        all_files.extend(image_files(&install_tier, install_has_nvidia_gpu));
        let file_count = all_files.len();
        emit_progress(
            &app,
            "starting",
            None,
            0,
            file_count,
            "Preparing local model folders...".to_string(),
        );
        for (index, file) in all_files.iter().enumerate() {
            download_file(&app, file, index + 1, file_count)?;
        }
        emit_progress(
            &app,
            "metadata",
            None,
            file_count,
            file_count,
            "Writing model metadata...".to_string(),
        );
        write_brain_model_yml(&install_tier)?;
        emit_progress(
            &app,
            "complete",
            None,
            file_count,
            file_count,
            "Local companion models are installed.".to_string(),
        );
        Ok(SetupInstallResult {
            success: true,
            message: "Local companion models are installed.".to_string(),
            catalog: get_setup_catalog(install_tier, Some(install_has_nvidia_gpu)),
        })
    })
    .await
    .map_err(|e| format!("Installer task failed: {}", e))?
}
