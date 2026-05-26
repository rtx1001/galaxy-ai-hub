use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use sysinfo::Disks;
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

fn preflight_check(key: &str, label: &str, ok: bool, message: String) -> SetupPreflightCheck {
    SetupPreflightCheck {
        key: key.to_string(),
        label: label.to_string(),
        status: if ok { "ok" } else { "attention" }.to_string(),
        message,
    }
}

fn command_available(command_name: &str) -> bool {
    let mut command = Command::new("where.exe");
    command.arg(command_name);
    crate::process_util::hide_window(&mut command);
    command
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn webview2_available() -> bool {
    let registry_keys = [
        r"HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F1E7A2DF-5D0D-4D6B-8E1D-95E2C5DB0B21}",
        r"HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F1E7A2DF-5D0D-4D6B-8E1D-95E2C5DB0B21}",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F1E7A2DF-5D0D-4D6B-8E1D-95E2C5DB0B21}",
    ];
    registry_keys.iter().any(|key| {
        let mut command = Command::new("reg.exe");
        command.arg("query").arg(key).arg("/v").arg("pv");
        command.stdout(Stdio::null()).stderr(Stdio::null());
        crate::process_util::hide_window(&mut command);
        command
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    })
}

fn app_folder_writable() -> bool {
    let probe = app_root_dir().join("logs").join(format!(
        "preflight-{}.tmp",
        chrono::Utc::now().timestamp_millis()
    ));
    if let Some(parent) = probe.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(probe);
            true
        }
        Err(_) => false,
    }
}

fn app_disk_free_mb() -> Option<u64> {
    let root = app_root_dir();
    let disks = Disks::new_with_refreshed_list();
    disks
        .iter()
        .filter(|disk| root.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len())
        .map(|disk| disk.available_space() / 1024 / 1024)
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

struct WhisperChoice {
    model_name: &'static str,
    repo: &'static str,
    size_hint: &'static str,
}

fn whisper_choice(tier: &str) -> WhisperChoice {
    match tier {
        "light" => WhisperChoice {
            model_name: "faster-whisper-base",
            repo: "Systran/faster-whisper-base",
            size_hint: "about 145 MB",
        },
        "high" => WhisperChoice {
            model_name: "faster-whisper-medium",
            repo: "Systran/faster-whisper-medium",
            size_hint: "about 1.53 GB",
        },
        _ => WhisperChoice {
            model_name: "faster-whisper-small",
            repo: "Systran/faster-whisper-small",
            size_hint: "about 484 MB",
        },
    }
}

fn voice_helper_model_dir(tier: &str) -> PathBuf {
    let choice = whisper_choice(tier);
    app_root_dir()
        .join("assistant-runtime")
        .join("voice")
        .join("models")
        .join(choice.model_name)
}

fn voice_helper_marker_path() -> PathBuf {
    app_root_dir()
        .join("assistant-runtime")
        .join("voice")
        .join("selected-whisper-model.txt")
}

fn voice_helper_files(tier: &str) -> Vec<SetupFile> {
    let choice = whisper_choice(tier);
    let model_dir = voice_helper_model_dir(tier);
    vec![
        setup_archive_file(
            "Voice engine",
            "https://github.com/rtx1001/galaxy-ai-hub/releases/latest/download/GalaxyAIHub-voice-runtime-win64.zip",
            app_root_dir()
                .join("assistant-runtime")
                .join("download-cache")
                .join("GalaxyAIHub-voice-runtime-win64.zip"),
            app_root_dir()
                .join("assistant-runtime")
                .join("voice-tts")
                .join("bin"),
            "about 160 MB",
        ),
        setup_file(
            "Whisper config",
            choice.repo,
            "config.json",
            model_dir.join("config.json"),
            "about 3 KB",
        ),
        setup_file(
            "Whisper model",
            choice.repo,
            "model.bin",
            model_dir.join("model.bin"),
            choice.size_hint,
        ),
        setup_file(
            "Whisper tokenizer",
            choice.repo,
            "tokenizer.json",
            model_dir.join("tokenizer.json"),
            "about 2.2 MB",
        ),
        setup_file(
            "Whisper vocabulary",
            choice.repo,
            "vocabulary.txt",
            model_dir.join("vocabulary.txt"),
            "about 460 KB",
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
            "https://sourceforge.net/projects/stable-diffusion-cpp.mirror/files/master-650-1ceb5bd/sd-master-1ceb5bd-bin-win-cuda12-x64.zip/download",
            cache.join("sd-master-1ceb5bd-bin-win-cuda12-x64.zip"),
            extract_to,
            "about 337 MB",
        )
    } else {
        setup_archive_file(
            "Image engine CPU",
            "https://sourceforge.net/projects/stable-diffusion-cpp.mirror/files/master-650-1ceb5bd/sd-master-1ceb5bd-bin-win-avx2-x64.zip/download",
            cache.join("sd-master-1ceb5bd-bin-win-avx2-x64.zip"),
            extract_to,
            "about 14 MB",
        )
    }
}

fn image_files(tier: &str, has_nvidia_gpu: bool) -> Vec<SetupFile> {
    let mut files = vec![sd_runtime_file(has_nvidia_gpu)];
    if tier == "high" {
        let root = app_root_dir()
            .join("assistant-runtime")
            .join("sdcpp")
            .join("models")
            .join("qwen-edit");
        files.extend([
            setup_file(
                "Qwen Image Edit",
                "Novice25/Qwen-Image-Edit-Rapid-AIO-GGUF",
                "v23/Qwen-Rapid-NSFW-v23_Q5_K.gguf",
                root.join("Qwen-Rapid-NSFW-v23_Q5_K.gguf"),
                "about 14.5 GB",
            ),
            setup_file(
                "Image text encoder",
                "mradermacher/Qwen2.5-VL-7B-Instruct-GGUF",
                "Qwen2.5-VL-7B-Instruct.Q5_K_M.gguf",
                root.join("text_encoders")
                    .join("Qwen2.5-VL-7B-Instruct.Q5_K_M.gguf"),
                "about 5.2 GB",
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
        ]);
        return files;
    }

    let root = app_root_dir()
        .join("assistant-runtime")
        .join("sdcpp")
        .join("models")
        .join("z-image-turbo");
    let (model_file, model_size) = if tier == "light" {
        ("z_image_turbo-Q4_K.gguf", "about 3.6 GB")
    } else {
        ("z_image_turbo-Q6_K.gguf", "about 4.9 GB")
    };
    files.extend([
        setup_file(
            "Z-Image Turbo",
            "leejet/Z-Image-Turbo-GGUF",
            model_file,
            root.join(model_file),
            model_size,
        ),
        setup_file(
            "Image text encoder",
            "WeReCooking/flux2-klein-4B-uncensored-text-encoder",
            "qwen3-4b-abl-q4_0.gguf",
            root.join("qwen3-4b-abl-q4_0.gguf"),
            "about 2.3 GB",
        ),
        setup_file(
            "Image VAE",
            "Kijai/flux-fp8",
            "flux-vae-bf16.safetensors",
            root.join("ae.safetensors"),
            "about 320 MB",
        ),
    ]);
    files
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
        if extract_path.ends_with(Path::new("voice-tts").join("bin")) {
            return omnivoice_engine_installed();
        }
        return extract_path.exists();
    }
    let path = absolute_from_display(&file.destination);
    if !path.exists() {
        return false;
    }
    let min_size = match path.extension().and_then(|value| value.to_str()) {
        Some("json" | "txt" | "yml" | "yaml") => 16,
        _ => 1024 * 1024,
    };
    path.metadata()
        .map(|meta| meta.len() > min_size)
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
        "libomp140.x86_64.dll",
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
    root.join("sd-server.exe").exists() && root.join("stable-diffusion.dll").exists()
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
    } else if extract_to.contains("/voice-tts/bin") {
        "voice_helper".to_string()
    } else if destination.contains("/voice-tts/") {
        "voice".to_string()
    } else if destination.contains("/voice/models/") {
        "voice_helper".to_string()
    } else if destination.contains("/qwen-edit/")
        || destination.contains("/z-image-turbo/")
        || extract_to.contains("/stable-diffusion")
    {
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
            "Could not create runtime folder {}: {}",
            destination_dir.display(),
            e
        )
    })?;
    for entry in std::fs::read_dir(source_dir)
        .map_err(|e| format!("Could not read extracted runtime: {}", e))?
        .flatten()
    {
        let path = entry.path();
        if path.is_file() {
            let target = destination_dir.join(entry.file_name());
            std::fs::copy(&path, &target)
                .map_err(|e| format!("Could not copy runtime file {}: {}", path.display(), e))?;
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
    command
        .arg("-xf")
        .arg(archive_path)
        .arg("-C")
        .arg(&extract_to);
    crate::process_util::hide_window(&mut command);
    let status = command
        .status()
        .map_err(|e| format!("Could not start archive extractor: {}", e))?;
    if !status.success() {
        return Err(format!("Could not extract {}", file.label));
    }
    if extract_to.ends_with(Path::new("bin").join("stable-diffusion")) && !image_runtime_installed()
    {
        if let Some(runtime_dir) = find_dir_containing(&extract_to, "sd-server.exe") {
            copy_runtime_files(&runtime_dir, &extract_to)?;
        }
    }
    if extract_to.ends_with(Path::new("voice-tts").join("bin")) && !omnivoice_engine_installed() {
        if let Some(runtime_dir) = find_dir_containing(&extract_to, "omnivoice-tts.exe") {
            copy_runtime_files(&runtime_dir, &extract_to)?;
        }
    }
    if !file_installed(file) {
        return Err(format!(
            "{} extracted, but required files were not found.",
            file.label
        ));
    }
    Ok(())
}

fn remove_incomplete_download(temp: &Path) {
    if temp.exists() {
        let _ = std::fs::remove_file(temp);
    }
}

fn run_curl_download(file: &SetupFile, temp: &Path, resume: bool) -> Result<(), String> {
    let mut command = Command::new("curl.exe");
    command
        .arg("--ssl-no-revoke")
        .arg("-L")
        .arg("--fail")
        .arg("--retry")
        .arg("3")
        .arg("--retry-delay")
        .arg("2")
        .arg("--connect-timeout")
        .arg("20");
    if resume {
        command.arg("-C").arg("-");
    }
    command.arg("-o").arg(temp).arg(&file.url);
    crate::process_util::hide_window(&mut command);
    let status = command
        .status()
        .map_err(|e| format!("Could not start downloader: {}", e))?;
    if !status.success() {
        return Err(format!("Download failed for {}", file.label));
    }
    Ok(())
}

fn minimum_download_bytes(file: &SetupFile) -> u64 {
    let destination = file.destination.replace('\\', "/").to_ascii_lowercase();
    if destination.ends_with(".json") || destination.ends_with(".txt") {
        16
    } else if destination.ends_with(".download") {
        1024
    } else {
        1024 * 1024
    }
}

fn install_downloaded_file(
    file: &SetupFile,
    temp: &Path,
    destination: &Path,
) -> Result<(), String> {
    let min_bytes = minimum_download_bytes(file);
    if temp
        .metadata()
        .map(|meta| meta.len() < min_bytes)
        .unwrap_or(true)
    {
        return Err(format!("Downloaded file looks incomplete: {}", file.label));
    }
    if file.extract_to.is_some() {
        extract_archive(file, temp)?;
        let _ = std::fs::remove_file(temp);
    } else {
        if destination.exists() {
            let _ = std::fs::remove_file(destination);
        }
        std::fs::rename(temp, destination)
            .map_err(|e| format!("Could not move downloaded file into place: {}", e))?;
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
    let mut last_error = None;
    for attempt in 0..2 {
        let resume = attempt == 0 && temp.exists();
        let download_result = run_curl_download(file, &temp, resume);
        if let Err(error) = download_result {
            last_error = Some(error);
            remove_incomplete_download(&temp);
            continue;
        }
        let result = install_downloaded_file(file, &temp, &destination);
        match result {
            Ok(()) => {
                last_error = None;
                break;
            }
            Err(error) => {
                last_error = Some(error);
                remove_incomplete_download(&temp);
                if let Some(extract_to) = &file.extract_to {
                    let extract_path = absolute_from_display(extract_to);
                    if extract_path.exists() && !file_installed(file) {
                        let _ = std::fs::remove_dir_all(extract_path);
                    }
                }
            }
        }
    }
    if let Some(error) = last_error {
        return Err(error);
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

fn setup_files_for_part(
    tier: &str,
    part_key: &str,
    has_nvidia_gpu: bool,
) -> Result<Vec<SetupFile>, String> {
    match part_key {
        "brain" => Ok(brain_files(tier)),
        "voice" => Ok(voice_files(tier)),
        "voice_helper" => Ok(voice_helper_files(tier)),
        "image" => Ok(image_files(tier, has_nvidia_gpu)),
        _ => Err(format!("Unknown setup part: {}", part_key)),
    }
}

fn write_metadata_for_part(tier: &str, part_key: &str) -> Result<(), String> {
    if part_key == "voice_helper" {
        write_voice_helper_marker(tier)?;
    }
    Ok(())
}

fn write_voice_helper_marker(tier: &str) -> Result<(), String> {
    let model_dir = voice_helper_model_dir(tier);
    if let Some(parent) = voice_helper_marker_path().parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create voice helper folder: {}", e))?;
    }
    std::fs::write(
        voice_helper_marker_path(),
        model_dir.to_string_lossy().to_string(),
    )
    .map_err(|e| format!("Could not write selected voice helper model: {}", e))
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
                title: "Voice".to_string(),
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
                "Brain, Voice, and Image Studio parts are ready.".to_string()
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
