use super::*;

pub(in crate::assistant_runtime) fn image_reference_data_url(value: &str) -> Option<String> {
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

pub(in crate::assistant_runtime) fn telegram_input_dir() -> PathBuf {
    assistant_runtime_dir().join("telegram-input")
}

pub(in crate::assistant_runtime) fn sanitize_telegram_file_name(name: &str) -> String {
    let trimmed = name.trim();
    let cleaned = trimmed
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ' ') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let without_paths = Path::new(&cleaned)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("telegram-file")
        .trim()
        .to_string();
    if without_paths.is_empty() {
        "telegram-file".to_string()
    } else {
        without_paths.chars().take(96).collect()
    }
}

pub(in crate::assistant_runtime) fn extension_from_mime_or_name(
    mime: &str,
    file_name: &str,
) -> String {
    if let Some(extension) = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim_start_matches('.').to_ascii_lowercase())
        .filter(|value| !value.is_empty() && value.len() <= 12)
    {
        return extension;
    }
    match mime.to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "application/pdf" => "pdf",
        "text/plain" => "txt",
        "audio/mpeg" => "mp3",
        "audio/ogg" => "ogg",
        "audio/wav" | "audio/x-wav" => "wav",
        "video/mp4" => "mp4",
        _ => "bin",
    }
    .to_string()
}

pub(in crate::assistant_runtime) fn save_telegram_downloaded_file(
    bytes: &[u8],
    display_name: &str,
    mime_type: &str,
) -> Result<PathBuf, String> {
    let input_dir = telegram_input_dir();
    std::fs::create_dir_all(&input_dir)
        .map_err(|error| format!("Could not create Telegram input folder: {}", error))?;
    let safe_name = sanitize_telegram_file_name(display_name);
    let extension = extension_from_mime_or_name(mime_type, &safe_name);
    let hash = stable_bytes_hash(bytes);

    for entry in std::fs::read_dir(&input_dir)
        .map_err(|error| format!("Could not read Telegram input folder: {}", error))?
        .flatten()
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if !file_name.starts_with(&format!("telegram-{}-", hash)) {
            continue;
        }
        if std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0) == bytes.len() as u64 {
            return Ok(path);
        }
    }

    let stem = Path::new(&safe_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("file");
    let output = input_dir.join(format!("telegram-{}-{}.{}", hash, stem, extension));
    std::fs::write(&output, bytes)
        .map_err(|error| format!("Could not save Telegram file: {}", error))?;
    Ok(output)
}

pub(crate) fn stable_bytes_hash(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}
