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
    mmproj_repo: &'static str,
    mmproj_file: &'static str,
    mmproj_size_hint: &'static str,
}

fn brain_choice(tier: &str) -> BrainChoice {
    match tier {
        "light" => BrainChoice {
            folder_name: "gemma-4-E2B-it-Q4_K_M",
            model_name: "Gemma 4 E2B Q4_K_M",
            repo: "lmstudio-community/gemma-4-E2B-it-GGUF",
            file: "gemma-4-E2B-it-Q4_K_M.gguf",
            size_hint: "about 3.7 GB",
            mmproj_repo: "lmstudio-community/gemma-4-E2B-it-GGUF",
            mmproj_file: "mmproj-gemma-4-E2B-it-BF16.gguf",
            mmproj_size_hint: "about 987 MB",
        },
        "high" => BrainChoice {
            folder_name: "gemma-4-E4B-it-Q8_0",
            model_name: "Gemma 4 E4B Q8_0",
            repo: "unsloth/gemma-4-E4B-it-GGUF",
            file: "gemma-4-E4B-it-Q8_0.gguf",
            size_hint: "about 8.2 GB",
            mmproj_repo: "unsloth/gemma-4-E4B-it-GGUF",
            mmproj_file: "mmproj-BF16.gguf",
            mmproj_size_hint: "about 987 MB",
        },
        _ => BrainChoice {
            folder_name: "gemma-4-E4B-it-Q5_K_M",
            model_name: "Gemma 4 E4B Q5_K_M",
            repo: "unsloth/gemma-4-E4B-it-GGUF",
            file: "gemma-4-E4B-it-Q5_K_M.gguf",
            size_hint: "about 5.6 GB",
            mmproj_repo: "unsloth/gemma-4-E4B-it-GGUF",
            mmproj_file: "mmproj-BF16.gguf",
            mmproj_size_hint: "about 987 MB",
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

fn image_files(tier: &str) -> Vec<SetupFile> {
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
    let voice = voice_files(&tier);
    let image = image_files(&tier);
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
) -> Result<SetupInstallResult, String> {
    let tier = match tier.as_str() {
        "light" | "balanced" | "high" => tier,
        _ => "balanced".to_string(),
    };
    let install_tier = tier.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<SetupInstallResult, String> {
        let mut all_files = Vec::new();
        all_files.extend(brain_files(&install_tier));
        all_files.extend(voice_files(&install_tier));
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
