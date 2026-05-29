use super::*;

pub(super) static WORKSPACE_INDEX: OnceLock<Mutex<WorkspaceIndexCache>> = OnceLock::new();

#[derive(Debug, Clone)]
pub(super) struct IndexedFile {
    pub(super) path: PathBuf,
    pub(super) path_text: String,
    pub(super) name: String,
    pub(super) normalized_name: String,
    pub(super) normalized_path: String,
    pub(super) folder: String,
    pub(super) extension: String,
    pub(super) size_bytes: u64,
    pub(super) modified_unix: u64,
}

#[derive(Debug, Clone)]
pub(super) struct WorkspaceIndex {
    pub(super) files_by_root: Vec<Vec<IndexedFile>>,
    pub(super) fingerprint: String,
    pub(super) built_at: u64,
}

#[derive(Default)]
pub(super) struct WorkspaceIndexCache {
    index: Option<WorkspaceIndex>,
}

pub(super) fn normalize_roots(folders: &[String]) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    folders
        .iter()
        .filter_map(|folder| std::fs::canonicalize(folder).ok())
        .filter(|path| path.is_dir())
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

pub(super) fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

pub(crate) fn normalize_text(value: &str) -> String {
    value.to_lowercase()
}

pub(super) fn path_is_within(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct MatchScore {
    pub(super) rank: u8,
    pub(super) name_gap: usize,
    pub(super) path_gap: usize,
}

pub(super) fn compare_match_scores(left: MatchScore, right: MatchScore) -> std::cmp::Ordering {
    left.rank
        .cmp(&right.rank)
        .then_with(|| left.name_gap.cmp(&right.name_gap))
        .then_with(|| left.path_gap.cmp(&right.path_gap))
}

pub(super) fn resolve_direct_candidate(
    input: &str,
    roots: &[PathBuf],
) -> Result<Option<PathBuf>, String> {
    let trimmed = input.trim().trim_matches('"');
    if trimmed.is_empty() {
        return Ok(None);
    }

    let candidate = PathBuf::from(trimmed);
    let candidates = if candidate.is_absolute() {
        vec![candidate]
    } else {
        roots
            .iter()
            .map(|root| root.join(trimmed))
            .chain(std::iter::once(candidate))
            .collect::<Vec<_>>()
    };

    for candidate in candidates {
        if !candidate.exists() {
            continue;
        }
        let canonical = std::fs::canonicalize(&candidate)
            .map_err(|e| format!("Could not inspect that path: {}", e))?;
        if roots.iter().any(|root| path_is_within(&canonical, root)) {
            return Ok(Some(canonical));
        }
        return Err("That path is outside the permitted workspace folders.".to_string());
    }

    Ok(None)
}

pub(super) fn file_match_score(query: &str, file: &IndexedFile) -> Option<MatchScore> {
    let normalized_query = normalize_text(query);
    if normalized_query.is_empty() {
        return None;
    }

    let name = &file.normalized_name;
    let path = &file.normalized_path;

    let rank = if path == &normalized_query {
        0
    } else if name == &normalized_query {
        1
    } else if path.ends_with(&normalized_query) {
        2
    } else if name.starts_with(&normalized_query) {
        3
    } else if name.contains(&normalized_query) {
        4
    } else if path.contains(&normalized_query) {
        5
    } else {
        return None;
    };

    Some(MatchScore {
        rank,
        name_gap: name.len().saturating_sub(normalized_query.len()),
        path_gap: path.len().saturating_sub(normalized_query.len()),
    })
}

pub(super) fn ranked_file_matches(
    query: &str,
    folders: &[String],
    limit: usize,
) -> Result<Vec<(MatchScore, IndexedFile)>, String> {
    let normalized_query = normalize_text(query.trim());
    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }

    let mut matches = workspace_index(folders)?
        .files_by_root
        .into_iter()
        .flatten()
        .filter_map(|file| file_match_score(&normalized_query, &file).map(|score| (score, file)))
        .collect::<Vec<_>>();

    matches.sort_by(|left, right| {
        compare_match_scores(left.0, right.0)
            .then_with(|| right.1.modified_unix.cmp(&left.1.modified_unix))
            .then_with(|| left.1.path_text.cmp(&right.1.path_text))
    });
    matches.truncate(limit);
    Ok(matches)
}

pub(super) fn directory_match_score(query: &str, name: &str, path: &str) -> Option<MatchScore> {
    let normalized_query = normalize_text(query);
    if normalized_query.is_empty() {
        return None;
    }

    let normalized_name = normalize_text(name);
    let normalized_path = normalize_text(path);
    let rank = if normalized_path == normalized_query {
        0
    } else if normalized_name == normalized_query {
        1
    } else if normalized_path.ends_with(&normalized_query) {
        2
    } else if normalized_name.starts_with(&normalized_query) {
        3
    } else if normalized_name.contains(&normalized_query) {
        4
    } else if normalized_path.contains(&normalized_query) {
        5
    } else {
        return None;
    };

    Some(MatchScore {
        rank,
        name_gap: normalized_name.len().saturating_sub(normalized_query.len()),
        path_gap: normalized_path.len().saturating_sub(normalized_query.len()),
    })
}

pub(super) fn resolve_existing_permitted_path(
    input: &str,
    folders: &[String],
) -> Result<PathBuf, String> {
    let roots = normalize_roots(folders);
    if roots.is_empty() {
        return Err("Add a workspace folder first.".to_string());
    }

    if let Some(candidate) = resolve_direct_candidate(input, &roots)? {
        return Ok(candidate);
    }

    let query = input.trim().trim_matches('"');
    if query.is_empty() {
        return Err("Tell me which file to use.".to_string());
    }

    let mut matches = ranked_file_matches(query, folders, 12)?;

    match matches.len() {
        0 => Err(format!(
            "I could not find a matching file for \"{}\".",
            input
        )),
        1 => Ok(matches.remove(0).1.path),
        _ if compare_match_scores(matches[0].0, matches[1].0).is_lt() => {
            Ok(matches.remove(0).1.path)
        }
        _ => Err(format!(
            "I found multiple matching files. Be more specific: {}",
            matches
                .iter()
                .take(5)
                .map(|(_, file)| file.path.to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join("; ")
        )),
    }
}

pub(super) fn resolve_existing_permitted_folder_path(
    input: &str,
    folders: &[String],
) -> Result<PathBuf, String> {
    let roots = normalize_roots(folders);
    if roots.is_empty() {
        return Err("Add a workspace folder first.".to_string());
    }

    if let Some(candidate) = resolve_direct_candidate(input, &roots)? {
        if candidate.is_dir() {
            return Ok(candidate);
        }
        return Err("That is a file. Choose a folder to list.".to_string());
    }

    let query = input.trim().trim_matches('"');
    if query.is_empty() {
        return Err("Tell me which folder to list.".to_string());
    }

    let index = workspace_index(folders)?;
    let mut matches: HashMap<String, (MatchScore, PathBuf)> = HashMap::new();
    for root in &roots {
        let root_text = root.to_string_lossy().to_string();
        let root_name = root
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&root_text);
        if let Some(score) = directory_match_score(query, root_name, &root_text) {
            matches.insert(root_text.clone(), (score, root.clone()));
        }
    }

    for files in index.files_by_root {
        for file in files {
            for root in &roots {
                if !path_is_within(&file.path, root) {
                    continue;
                }
                let mut current = file.path.parent();
                while let Some(directory) = current {
                    let path_text = directory.to_string_lossy().to_string();
                    let name = directory
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or(&path_text);
                    if let Some(score) = directory_match_score(query, name, &path_text) {
                        let key = path_text.clone();
                        let replace = matches
                            .get(&key)
                            .map(|(existing_score, _)| {
                                compare_match_scores(score, *existing_score).is_lt()
                            })
                            .unwrap_or(true);
                        if replace {
                            matches.insert(key, (score, directory.to_path_buf()));
                        }
                    }
                    if directory == root {
                        break;
                    }
                    current = directory.parent();
                }
            }
        }
    }

    let mut ranked = matches.into_values().collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        compare_match_scores(left.0, right.0)
            .then_with(|| left.1.to_string_lossy().cmp(&right.1.to_string_lossy()))
    });

    match ranked.len() {
        0 => Err(format!(
            "I could not find a matching folder for \"{}\".",
            input
        )),
        1 => Ok(ranked.remove(0).1),
        _ if compare_match_scores(ranked[0].0, ranked[1].0).is_lt() => Ok(ranked.remove(0).1),
        _ => Err(format!(
            "I found multiple matching folders. Be more specific: {}",
            ranked
                .iter()
                .take(5)
                .map(|(_, path)| path.to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join("; ")
        )),
    }
}

pub(super) fn workspace_index_cache() -> &'static Mutex<WorkspaceIndexCache> {
    WORKSPACE_INDEX.get_or_init(|| Mutex::new(WorkspaceIndexCache::default()))
}

pub(super) fn folder_fingerprint(root: &Path) -> String {
    let metadata = std::fs::metadata(root).ok();
    let modified = metadata
        .and_then(|value| value.modified().ok())
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or_default();
    format!("{}:{}", root.to_string_lossy(), modified)
}

pub(super) fn index_fingerprint(roots: &[PathBuf]) -> String {
    roots
        .iter()
        .map(|root| folder_fingerprint(root))
        .collect::<Vec<_>>()
        .join("|")
}

pub(super) fn indexed_file_from_path(path: PathBuf, root: &Path) -> Option<IndexedFile> {
    let metadata = std::fs::metadata(&path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let name = path.file_name()?.to_str()?.to_string();
    let path_text = path.to_string_lossy().to_string();
    let folder = path.parent().unwrap_or(root).to_string_lossy().to_string();
    let extension = extension_for(&path);
    let modified_unix = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or_default();
    Some(IndexedFile {
        normalized_name: normalize_text(&name),
        normalized_path: normalize_text(&path_text),
        path,
        path_text,
        name,
        folder,
        extension,
        size_bytes: metadata.len(),
        modified_unix,
    })
}

pub(super) fn walk_index(
    root: &Path,
    current: &Path,
    results: &mut Vec<IndexedFile>,
    limit: usize,
) {
    if results.len() >= limit {
        return;
    }
    let entries = match std::fs::read_dir(current) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if results.len() >= limit {
            return;
        }
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if path.is_dir() {
            if matches!(name, ".git" | "node_modules" | "target" | ".galaxy_trash") {
                continue;
            }
            walk_index(root, &path, results, limit);
        } else if let Some(file) = indexed_file_from_path(path, root) {
            results.push(file);
        }
    }
}

pub(super) fn build_workspace_index(roots: Vec<PathBuf>) -> WorkspaceIndex {
    let mut files_by_root = Vec::new();
    for root in &roots {
        let mut files = Vec::new();
        walk_index(root, root, &mut files, 20_000);
        files.sort_by(|left, right| {
            left.name
                .to_lowercase()
                .cmp(&right.name.to_lowercase())
                .then_with(|| left.path_text.cmp(&right.path_text))
        });
        files_by_root.push(files);
    }
    let fingerprint = index_fingerprint(&roots);
    WorkspaceIndex {
        files_by_root,
        fingerprint,
        built_at: now_unix(),
    }
}

pub(super) fn workspace_index(folders: &[String]) -> Result<WorkspaceIndex, String> {
    let roots = normalize_roots(folders);
    if roots.is_empty() {
        return Err("Add a workspace folder first.".to_string());
    }
    let fingerprint = index_fingerprint(&roots);
    let mut cache = workspace_index_cache()
        .lock()
        .map_err(|_| "Could not lock workspace index.".to_string())?;
    if let Some(index) = &cache.index {
        if index.fingerprint == fingerprint && now_unix().saturating_sub(index.built_at) < 30 {
            return Ok(index.clone());
        }
    }
    let index = build_workspace_index(roots);
    cache.index = Some(index.clone());
    Ok(index)
}

pub(super) fn indexed_to_search_result(file: &IndexedFile) -> FileSearchResult {
    FileSearchResult {
        path: file.path_text.clone(),
        name: file.name.clone(),
        folder: file.folder.clone(),
        extension: file.extension.clone(),
        size_bytes: file.size_bytes,
    }
}

pub(super) fn interleave_indexed(
    mut per_root: Vec<Vec<IndexedFile>>,
    limit: usize,
) -> Vec<FileSearchResult> {
    for files in &mut per_root {
        files.sort_by(|left, right| {
            left.name
                .to_lowercase()
                .cmp(&right.name.to_lowercase())
                .then_with(|| right.modified_unix.cmp(&left.modified_unix))
        });
    }
    let mut results = Vec::new();
    for index in 0..limit {
        for files in &per_root {
            if let Some(file) = files.get(index) {
                results.push(indexed_to_search_result(file));
                if results.len() >= limit {
                    return results;
                }
            }
        }
    }
    results
}

pub(super) fn interleave_scored_matches(
    mut per_root: Vec<Vec<(MatchScore, IndexedFile)>>,
    limit: usize,
) -> Vec<FileSearchResult> {
    for matches in &mut per_root {
        matches.sort_by(|left, right| {
            compare_match_scores(left.0, right.0)
                .then_with(|| right.1.modified_unix.cmp(&left.1.modified_unix))
                .then_with(|| left.1.path_text.cmp(&right.1.path_text))
        });
    }

    let mut seen_paths = HashSet::new();
    let mut results = Vec::new();
    for index in 0..limit {
        let mut added_any = false;
        for matches in &per_root {
            if let Some((_, file)) = matches.get(index) {
                if seen_paths.insert(file.path_text.clone()) {
                    results.push(indexed_to_search_result(file));
                    added_any = true;
                    if results.len() >= limit {
                        return results;
                    }
                }
            }
        }
        if !added_any {
            break;
        }
    }
    results
}

pub(super) fn resolve_new_permitted_path(
    root_folder: Option<String>,
    relative_path: &str,
    folders: &[String],
) -> Result<PathBuf, String> {
    let roots = normalize_roots(folders);
    if roots.is_empty() {
        return Err("Add a workspace folder first.".to_string());
    }

    let root = if let Some(folder) = root_folder.filter(|value| !value.trim().is_empty()) {
        let canonical = std::fs::canonicalize(folder)
            .map_err(|e| format!("Could not inspect that workspace folder: {}", e))?;
        if !roots.iter().any(|allowed| allowed == &canonical) {
            return Err("That folder is not in the permitted workspace list.".to_string());
        }
        canonical
    } else if roots.len() > 1 {
        return Err(
            "Choose the exact workspace folder for this file action when multiple workspace folders are linked."
                .to_string(),
        );
    } else {
        roots[0].clone()
    };

    let relative = PathBuf::from(relative_path.trim().trim_matches('"'));
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("Use a normal file name or a path inside the workspace folder.".to_string());
    }

    let target = root.join(relative);
    let parent = target
        .parent()
        .ok_or_else(|| "That file path is not usable.".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Could not create the destination folder: {}", e))?;
    let parent_canonical = std::fs::canonicalize(parent)
        .map_err(|e| format!("Could not inspect the destination folder: {}", e))?;
    if !path_is_within(&parent_canonical, &root) {
        return Err("The destination must stay inside the permitted workspace folder.".to_string());
    }

    Ok(target)
}

pub(super) fn extension_for(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

pub(super) fn mime_for_extension(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "pdf" => "application/pdf",
        "txt" | "md" | "log" | "csv" | "json" | "xml" | "html" | "css" | "js" | "ts" | "tsx"
        | "jsx" | "rs" | "py" | "toml" | "yaml" | "yml" | "ini" => "text/plain",
        _ => "application/octet-stream",
    }
}

pub(super) fn media_kind_for_extension(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" => "image",
        "mp3" | "wav" | "ogg" | "flac" | "m4a" | "aac" => "audio",
        "mp4" | "webm" | "mov" | "mkv" => "video",
        "pdf" => "document",
        "txt" | "md" | "log" | "csv" | "json" | "xml" | "html" | "css" | "js" | "ts" | "tsx"
        | "jsx" | "rs" | "py" | "toml" | "yaml" | "yml" | "ini" => "text",
        _ => "other",
    }
}

pub(super) fn media_kind_matches(extension: &str, kind: &str) -> bool {
    let file_kind = media_kind_for_extension(extension);
    let requested = kind.trim().to_ascii_lowercase();
    requested.is_empty()
        || requested == "any"
        || requested == file_kind
        || (requested == "song" && file_kind == "audio")
        || (requested == "music" && file_kind == "audio")
        || (requested == "movie" && file_kind == "video")
        || (requested == "document" && matches!(file_kind, "document" | "text"))
}
