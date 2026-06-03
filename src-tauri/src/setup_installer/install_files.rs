use super::*;

pub(super) fn absolute_from_display(path: &str) -> PathBuf {
    app_root_dir().join(path)
}

pub(super) fn file_installed(file: &SetupFile) -> bool {
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

pub(super) fn files_installed(files: &[SetupFile]) -> bool {
    files.iter().all(file_installed)
}

pub(super) fn omnivoice_engine_installed() -> bool {
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

pub(super) fn image_runtime_installed() -> bool {
    let root = app_root_dir().join("bin").join("stable-diffusion");
    let server_exists =
        root.join("sd-server.exe").exists() || root.join("sd-server-galaxy.exe").exists();
    server_exists && root.join("stable-diffusion.dll").exists()
}

pub(super) fn part_key_for_file(file: &SetupFile) -> String {
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

pub(super) fn emit_progress(
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

pub(super) fn find_dir_containing(root: &Path, file_name: &str) -> Option<PathBuf> {
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

pub(super) fn copy_runtime_files(source_dir: &Path, destination_dir: &Path) -> Result<(), String> {
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

pub(super) fn extract_archive(file: &SetupFile, archive_path: &Path) -> Result<(), String> {
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

pub(super) fn remove_incomplete_download(temp: &Path) {
    if temp.exists() {
        let _ = std::fs::remove_file(temp);
    }
}

pub(super) fn run_curl_download(file: &SetupFile, temp: &Path, resume: bool) -> Result<(), String> {
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

pub(super) fn minimum_download_bytes(file: &SetupFile) -> u64 {
    let destination = file.destination.replace('\\', "/").to_ascii_lowercase();
    if destination.ends_with(".json") || destination.ends_with(".txt") {
        16
    } else if destination.ends_with(".download") {
        1024
    } else {
        1024 * 1024
    }
}

pub(super) fn install_downloaded_file(
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

pub(super) fn download_file(
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

pub(super) fn setup_files_for_part(
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

pub(super) fn write_metadata_for_part(tier: &str, part_key: &str) -> Result<(), String> {
    if part_key == "voice_helper" {
        write_voice_helper_marker(tier)?;
    }
    Ok(())
}

pub(super) fn write_voice_helper_marker(tier: &str) -> Result<(), String> {
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
