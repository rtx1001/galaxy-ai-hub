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
}

fn brain_choice(tier: &str) -> BrainChoice {
    match tier {
        "light" => BrainChoice {
            folder_name: "gemma-4-E2B-it-Q4_K_M",
            model_name: "Gemma 4 E2B Q4_K_M",
            repo: "DuoNeural/Gemma-4-E2B-GGUF",
            file: "gemma-4-E2B-it.Q4_K_M.gguf",
            size_hint: "about 3.5 GB",
        },
        "high" => BrainChoice {
            folder_name: "gemma-4-E4B-it-Q6_K",
            model_name: "Gemma 4 E4B Q6_K",
            repo: "unsloth/gemma-4-E4B-it-GGUF",
            file: "gemma-4-E4B-it-Q6_K.gguf",
            size_hint: "about 6.3 GB",
        },
        _ => BrainChoice {
            folder_name: "gemma-4-E4B-it-Q5_K_M",
            model_name: "Gemma 4 E4B Q5_K_M",
            repo: "unsloth/gemma-4-E4B-it-GGUF",
            file: "gemma-4-E4B-it-Q5_K_M.gguf",
            size_hint: "about 5.6 GB",
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

fn setup_file(label: &str, repo: &str, file: &str, destination: PathBuf, size_hint: &str) -> SetupFile {
    SetupFile {
        label: label.to_string(),
        url: hf_url(repo, file),
        destination: relative_display(&destination),
        size_hint: size_hint.to_string(),
    }
}

fn brain_files(tier: &str) -> Vec<SetupFile> {
    let choice = brain_choice(tier);
    vec![setup_file(
        choice.model_name,
        choice.repo,
        choice.file,
        selected_brain_model_path_for_tier(tier),
        choice.size_hint,
    )]
}

fn voice_files() -> Vec<SetupFile> {
    let root = app_root_dir()
        .join("assistant-runtime")
        .join("voice-tts")
        .join("models")
        .join("omnivoice.cpp");
    vec![
        setup_file(
            "Voice base Q8",
            "Serveurperso/OmniVoice-GGUF",
            "omnivoice-base-Q8_0.gguf",
            root.join("omnivoice-base-Q8_0.gguf"),
            "about 1.2 GB",
        ),
        setup_file(
            "Voice tokenizer Q8",
            "Serveurperso/OmniVoice-GGUF",
            "omnivoice-tokenizer-Q8_0.gguf",
            root.join("omnivoice-tokenizer-Q8_0.gguf"),
            "about 30 MB",
        ),
    ]
}

fn image_files(tier: &str) -> Vec<SetupFile> {
    let image_quant = match tier {
        "light" => ("v23/Qwen-Rapid-NSFW-v23_Q4_K.gguf", "about 12.2 GB"),
        _ => ("v23/Qwen-Rapid-NSFW-v23_Q4_K.gguf", "about 12.2 GB"),
    };
    let root = app_root_dir()
        .join("assistant-runtime")
        .join("sdcpp")
        .join("models")
        .join("qwen-edit");
    vec![
        setup_file(
            "Qwen Image Edit",
            "Novice25/Qwen-Image-Edit-Rapid-AIO-GGUF",
            image_quant.0,
            root.join("Qwen-Rapid-NSFW-v23_Q4_K.gguf"),
            image_quant.1,
        ),
        setup_file(
            "Image text encoder",
            "mradermacher/Qwen2.5-VL-7B-Instruct-GGUF",
            "Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf",
            root.join("text_encoders")
                .join("Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf"),
            "about 4.4 GB",
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
    let path = absolute_from_display(&file.destination);
    path.exists() && path.metadata().map(|meta| meta.len() > 1024 * 1024).unwrap_or(false)
}

fn files_installed(files: &[SetupFile]) -> bool {
    files.iter().all(file_installed)
}

fn write_brain_model_yml(tier: &str) -> Result<(), String> {
    let folder = brain_model_folder_for_tier(tier);
    let model = folder.join("model.gguf");
    let bytes = std::fs::metadata(&model)
        .map_err(|e| format!("Could not read installed brain model metadata: {}", e))?
        .len();
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
    let content = format!(
        "embedding: false\nmodel_path: {}\nname: {}\nsize_bytes: {}\n",
        relative_model, name, bytes
    );
    std::fs::write(folder.join("model.yml"), content)
        .map_err(|e| format!("Could not write model.yml: {}", e))
}

fn part_key_for_file(file: &SetupFile) -> String {
    let destination = file.destination.replace('\\', "/").to_lowercase();
    if destination.contains("/brain/") {
        "brain".to_string()
    } else if destination.contains("/voice-tts/") {
        "voice".to_string()
    } else if destination.contains("/qwen-edit/") {
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

fn download_file(app: &tauri::AppHandle, file: &SetupFile, file_index: usize, file_count: usize) -> Result<(), String> {
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
    let status = Command::new("curl.exe")
        .arg("--ssl-no-revoke")
        .arg("-L")
        .arg("-C")
        .arg("-")
        .arg("-o")
        .arg(&temp)
        .arg(&file.url)
        .status()
        .map_err(|e| format!("Could not start downloader: {}", e))?;
    if !status.success() {
        return Err(format!("Download failed for {}", file.label));
    }
    if temp.metadata().map(|meta| meta.len() <= 1024 * 1024).unwrap_or(true) {
        return Err(format!("Downloaded file looks incomplete: {}", file.label));
    }
    if destination.exists() {
        let _ = std::fs::remove_file(&destination);
    }
    std::fs::rename(&temp, &destination)
        .map_err(|e| format!("Could not move downloaded file into place: {}", e))?;
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
pub fn get_setup_catalog(tier: String) -> SetupCatalog {
    let tier = match tier.as_str() {
        "light" | "balanced" | "high" => tier,
        _ => "balanced".to_string(),
    };
    let brain = brain_files(&tier);
    let voice = voice_files();
    let image = image_files(&tier);
    SetupCatalog {
        tier: tier.clone(),
        parts: vec![
            SetupPartCatalog {
                key: "brain".to_string(),
                title: "Brain".to_string(),
                installed: files_installed(&brain),
                files: brain,
            },
            SetupPartCatalog {
                key: "voice".to_string(),
                title: "Voice".to_string(),
                installed: files_installed(&voice),
                files: voice,
            },
            SetupPartCatalog {
                key: "image".to_string(),
                title: "Image Studio".to_string(),
                installed: files_installed(&image),
                files: image,
            },
        ],
        brain_model_folder: portable_models_dir()
            .join("brain")
            .display()
            .to_string(),
        selected_brain_model_path: selected_brain_model_path_for_tier(&tier)
            .display()
            .to_string(),
    }
}

#[tauri::command]
pub async fn install_setup_bundle(app: tauri::AppHandle, tier: String) -> Result<SetupInstallResult, String> {
    let tier = match tier.as_str() {
        "light" | "balanced" | "high" => tier,
        _ => "balanced".to_string(),
    };
    let install_tier = tier.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<SetupInstallResult, String> {
        let mut all_files = Vec::new();
        all_files.extend(brain_files(&install_tier));
        all_files.extend(voice_files());
        all_files.extend(image_files(&install_tier));
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
            catalog: get_setup_catalog(install_tier),
        })
    })
    .await
    .map_err(|e| format!("Installer task failed: {}", e))?
}
