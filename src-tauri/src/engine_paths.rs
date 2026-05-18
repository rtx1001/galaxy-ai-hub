use std::path::{Path, PathBuf};
use std::process::Command;

fn push_unique(candidates: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !candidates.iter().any(|existing| existing == &candidate) {
        candidates.push(candidate);
    }
}

pub fn runtime_engine_dir() -> PathBuf {
    std::env::current_dir()
        .map(|dir| dir.join("engine"))
        .or_else(|_| {
            std::env::current_exe().map(|path| {
                path.parent()
                    .map(|parent| parent.join("engine"))
                    .unwrap_or_else(|| PathBuf::from("engine"))
            })
        })
        .unwrap_or_else(|_| PathBuf::from("engine"))
}

pub fn bundled_engine_dirs() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        push_unique(
            &mut candidates,
            current_dir.join("src-tauri").join("engine"),
        );
    }

    candidates
}

pub fn engine_dir_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    push_unique(&mut candidates, runtime_engine_dir());

    for candidate in bundled_engine_dirs() {
        push_unique(&mut candidates, candidate);
    }

    candidates
}

pub fn existing_engine_dir() -> Option<PathBuf> {
    engine_dir_candidates()
        .into_iter()
        .find(|dir| dir.join("llama-server.exe").exists())
}

pub fn ensure_runtime_engine_dir() -> std::io::Result<PathBuf> {
    let engine_dir = runtime_engine_dir();
    std::fs::create_dir_all(&engine_dir)?;
    Ok(engine_dir)
}

pub fn llama_server_path() -> std::io::Result<PathBuf> {
    Ok(existing_engine_dir()
        .unwrap_or_else(runtime_engine_dir)
        .join("llama-server.exe"))
}

pub fn engine_log_path() -> std::io::Result<PathBuf> {
    Ok(existing_engine_dir()
        .unwrap_or_else(runtime_engine_dir)
        .join("llama.log"))
}

pub fn read_server_help(server_path: &Path) -> Option<String> {
    Command::new(server_path)
        .arg("--help")
        .output()
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn read_server_version(server_path: &Path) -> Option<String> {
    Command::new(server_path)
        .arg("--version")
        .output()
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn supports_mmproj(server_path: &Path) -> bool {
    read_server_help(server_path)
        .map(|help| help.contains("--mmproj"))
        .unwrap_or(false)
}

pub fn build_number(server_path: &Path) -> Option<u32> {
    let version_text = read_server_version(server_path)?;
    let version_line = version_text
        .lines()
        .find(|line| line.trim_start().starts_with("version:"))?;
    let build = version_line
        .split(':')
        .nth(1)?
        .trim()
        .split_whitespace()
        .next()?;

    build.parse::<u32>().ok()
}
