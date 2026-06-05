use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use sysinfo::Disks;
use tauri::Emitter;

use crate::app_paths;

mod catalog;
mod install_files;
mod preflight;
use catalog::*;
use install_files::*;
use preflight::*;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupPreflightCheck {
    pub key: String,
    pub label: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupPreflightReport {
    pub checks: Vec<SetupPreflightCheck>,
    pub ready: bool,
}

fn app_root_dir() -> PathBuf {
    app_paths::app_root_dir()
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
    let voice_helper = voice_helper_files(&tier);
    let image = image_files(&tier, has_nvidia_gpu);
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
                title: "Speech".to_string(),
                installed: files_installed(&voice),
                files: voice,
            },
            SetupPartCatalog {
                key: "voice_helper".to_string(),
                title: "Voice Helper".to_string(),
                installed: files_installed(&voice_helper) && omnivoice_engine_installed(),
                files: voice_helper,
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

fn size_hint_to_mb(size_hint: &str) -> u64 {
    let label = size_hint.to_lowercase();
    let number = label
        .split_whitespace()
        .find_map(|item| item.parse::<f64>().ok())
        .unwrap_or(0.0);
    if label.contains("gb") {
        (number * 1024.0) as u64
    } else {
        number as u64
    }
}

#[tauri::command]
pub fn get_setup_preflight(tier: String, has_nvidia_gpu: Option<bool>) -> SetupPreflightReport {
    let tier = match tier.as_str() {
        "light" | "balanced" | "high" => tier,
        _ => "balanced".to_string(),
    };
    let has_nvidia_gpu = has_nvidia_gpu.unwrap_or(false);
    let catalog = get_setup_catalog(tier, Some(has_nvidia_gpu));
    let webview_ok = webview2_available();
    let curl_ok = command_available("curl.exe");
    let tar_ok = command_available("tar.exe");
    let writable_ok = app_folder_writable();
    let gpu_ok = !has_nvidia_gpu || command_available("nvidia-smi.exe");
    let missing_mb = catalog
        .parts
        .iter()
        .filter(|part| !part.installed)
        .flat_map(|part| part.files.iter())
        .map(|file| size_hint_to_mb(&file.size_hint))
        .sum::<u64>();
    let needed_mb = missing_mb.saturating_add(4096);
    let free_mb = app_disk_free_mb();
    let disk_ok = free_mb.map(|free| free > needed_mb).unwrap_or(false);
    let all_components_ready = catalog.parts.iter().all(|part| part.installed);

    let checks = vec![
        preflight_check(
            "webview2",
            "Windows app runtime",
            webview_ok,
            if webview_ok {
                "WebView runtime is available.".to_string()
            } else {
                "WebView runtime was not detected. If the app opened normally, this PC is probably still OK.".to_string()
            },
        ),
        preflight_check(
            "downloader",
            "Downloader tools",
            curl_ok && tar_ok,
            if curl_ok && tar_ok {
                "Windows download and archive tools are available.".to_string()
            } else {
                "Windows curl.exe or tar.exe is missing, so automatic setup may not work."
                    .to_string()
            },
        ),
        preflight_check(
            "writable",
            "Portable folder access",
            writable_ok,
            if writable_ok {
                "The app folder is writable.".to_string()
            } else {
                "The app folder is not writable. Move it outside protected folders and try again."
                    .to_string()
            },
        ),
        preflight_check(
            "disk",
            "Storage space",
            disk_ok,
            match free_mb {
                Some(free) => format!(
                    "About {:.1} GB free. Setup may need about {:.1} GB.",
                    free as f64 / 1024.0,
                    needed_mb as f64 / 1024.0
                ),
                None => "Could not read free disk space for this folder.".to_string(),
            },
        ),
        preflight_check(
            "gpu",
            "GPU driver",
            gpu_ok,
            if has_nvidia_gpu {
                "NVIDIA driver tools are visible to the app.".to_string()
            } else {
                "No NVIDIA GPU detected. CPU/light setup can still run.".to_string()
            },
        ),
        preflight_check(
            "components",
            "Local AI parts",
            all_components_ready,
            if all_components_ready {
                "Brain, Speech, and Image Studio parts are ready.".to_string()
            } else {
                "Some AI parts still need to be installed or repaired.".to_string()
            },
        ),
    ];
    let ready = checks
        .iter()
        .filter(|check| check.key != "components")
        .all(|check| check.status == "ok");
    SetupPreflightReport { checks, ready }
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
        all_files.extend(voice_helper_files(&install_tier));
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
            "Finalizing local companion models...".to_string(),
        );
        write_voice_helper_marker(&install_tier)?;
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

#[tauri::command]
pub async fn install_setup_part(
    app: tauri::AppHandle,
    tier: String,
    part_key: String,
    has_nvidia_gpu: Option<bool>,
) -> Result<SetupInstallResult, String> {
    let tier = match tier.as_str() {
        "light" | "balanced" | "high" => tier,
        _ => "balanced".to_string(),
    };
    let install_tier = tier.clone();
    let install_part_key = part_key.clone();
    let install_has_nvidia_gpu = has_nvidia_gpu.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || -> Result<SetupInstallResult, String> {
        let files = setup_files_for_part(&install_tier, &install_part_key, install_has_nvidia_gpu)?;
        let file_count = files.len();
        emit_progress(
            &app,
            "starting",
            None,
            0,
            file_count,
            format!("Preparing {} files...", install_part_key),
        );
        for (index, file) in files.iter().enumerate() {
            download_file(&app, file, index + 1, file_count)?;
        }
        write_metadata_for_part(&install_tier, &install_part_key)?;
        emit_progress(
            &app,
            "complete",
            None,
            file_count,
            file_count,
            format!("{} is ready.", install_part_key),
        );
        Ok(SetupInstallResult {
            success: true,
            message: format!("{} is ready.", install_part_key),
            catalog: get_setup_catalog(install_tier, Some(install_has_nvidia_gpu)),
        })
    })
    .await
    .map_err(|e| format!("Installer task failed: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_progress_maps_every_part_file_to_component_key() {
        for tier in ["light", "balanced", "high"] {
            for file in brain_files(tier) {
                assert_eq!(part_key_for_file(&file), "brain", "{:?}", file);
            }
            for file in voice_files(tier) {
                assert_eq!(part_key_for_file(&file), "voice", "{:?}", file);
            }
            for file in voice_helper_files(tier) {
                assert_eq!(part_key_for_file(&file), "voice_helper", "{:?}", file);
            }
            for file in image_files(tier, true) {
                assert_eq!(part_key_for_file(&file), "image", "{:?}", file);
            }
        }
    }

    #[test]
    fn setup_allows_small_metadata_downloads_but_not_empty_files() {
        let json = setup_file(
            "Whisper config",
            "example/repo",
            "config.json",
            PathBuf::from("assistant-runtime/voice/models/test/config.json"),
            "about 3 KB",
        );
        let text = setup_file(
            "Whisper vocabulary",
            "example/repo",
            "vocabulary.txt",
            PathBuf::from("assistant-runtime/voice/models/test/vocabulary.txt"),
            "about 460 KB",
        );
        let model = setup_file(
            "Model",
            "example/repo",
            "model.bin",
            PathBuf::from("assistant-runtime/voice/models/test/model.bin"),
            "about 145 MB",
        );
        assert_eq!(minimum_download_bytes(&json), 16);
        assert_eq!(minimum_download_bytes(&text), 16);
        assert_eq!(minimum_download_bytes(&model), 1024 * 1024);
    }
}
