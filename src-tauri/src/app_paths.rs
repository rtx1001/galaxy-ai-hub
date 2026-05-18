use std::path::{Path, PathBuf};

fn looks_like_project_root(path: &Path) -> bool {
    path.join("config").join("settings.json").exists()
        || (path.join("src-tauri").join("Cargo.toml").exists()
            && path.join("package.json").exists())
}

fn push_candidate(candidates: &mut Vec<PathBuf>, path: PathBuf) {
    for candidate in path.ancestors() {
        let candidate = candidate.to_path_buf();
        if !candidates.iter().any(|existing| existing == &candidate) {
            candidates.push(candidate);
        }
    }
}

fn normalize_portable_root(path: PathBuf) -> PathBuf {
    if path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("src-tauri"))
        .unwrap_or(false)
    {
        path.parent()
            .map(|parent| parent.to_path_buf())
            .unwrap_or(path)
    } else {
        path
    }
}

pub fn app_root_dir() -> PathBuf {
    let mut candidates = Vec::new();

    let manifest_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(project_root) = manifest_root.parent() {
        push_candidate(&mut candidates, project_root.to_path_buf());
    }

    if let Ok(current_dir) = std::env::current_dir() {
        push_candidate(&mut candidates, current_dir);
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            push_candidate(&mut candidates, parent.to_path_buf());
        }
    }

    candidates
        .iter()
        .find(|candidate| looks_like_project_root(candidate))
        .cloned()
        .or_else(|| {
            std::env::current_dir()
                .map(normalize_portable_root)
                .ok()
                .or_else(|| {
                    std::env::current_exe().ok().map(|path| {
                        let base = path
                            .parent()
                            .map(|parent| parent.to_path_buf())
                            .unwrap_or_else(|| PathBuf::from("."));
                        normalize_portable_root(base)
                    })
                })
        })
        .unwrap_or_else(|| PathBuf::from("."))
}
