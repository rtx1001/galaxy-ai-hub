use super::*;

pub(super) fn normalize_roots(folders: &[String]) -> Vec<PathBuf> {
    folders
        .iter()
        .filter_map(|folder| std::fs::canonicalize(folder).ok())
        .filter(|path| path.is_dir())
        .collect()
}

fn workspace_folder_error(folders: &[String]) -> String {
    if folders.iter().all(|folder| folder.trim().is_empty()) {
        return "No workspace folder is permitted.".to_string();
    }
    let missing = folders
        .iter()
        .filter_map(|folder| {
            let trimmed = folder.trim();
            if trimmed.is_empty() {
                return None;
            }
            (!PathBuf::from(trimmed).is_dir()).then(|| trimmed.to_string())
        })
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return format!(
            "Workspace folder no longer exists or cannot be opened: {}",
            missing.join("; ")
        );
    }
    "No workspace folder is permitted.".to_string()
}

pub(super) fn path_is_within(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

pub(super) fn resolve_directory(
    input: Option<&str>,
    folders: &[String],
) -> Result<PathBuf, String> {
    let roots = normalize_roots(folders);
    if roots.is_empty() {
        return Err(workspace_folder_error(folders));
    }

    let Some(raw) = input.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(roots[0].clone());
    };

    let candidate = PathBuf::from(raw.trim_matches('"'));
    if candidate.is_absolute() && !candidate.exists() {
        return Err(format!(
            "Workspace folder no longer exists or cannot be opened: {}",
            candidate.display()
        ));
    }
    let resolved = if candidate.exists() {
        std::fs::canonicalize(candidate)
            .map_err(|e| format!("Could not inspect directory: {}", e))?
    } else if raw.contains(':') || raw.contains('\\') || raw.contains('/') {
        return Err(format!(
            "Directory does not exist or cannot be opened: {}",
            raw
        ));
    } else {
        roots[0].join(raw)
    };
    let resolved = std::fs::canonicalize(resolved)
        .map_err(|e| format!("Directory does not exist or cannot be opened: {}", e))?;

    if !resolved.is_dir() {
        return Err("That path is not a folder.".to_string());
    }
    if !roots.iter().any(|root| path_is_within(&resolved, root)) {
        return Err("That folder is outside the permitted workspace folders.".to_string());
    }
    Ok(resolved)
}
