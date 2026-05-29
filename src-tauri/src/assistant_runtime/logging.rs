use super::*;

pub(crate) fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub(crate) fn append_runtime_log(area: &str, message: &str) {
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

pub(crate) fn compact_trace_text(text: &str, limit: usize) -> String {
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
