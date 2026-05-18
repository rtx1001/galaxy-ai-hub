use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;

static WORKSPACE_INDEX: OnceLock<Mutex<WorkspaceIndexCache>> = OnceLock::new();

#[derive(Debug, Clone)]
struct IndexedFile {
    path: PathBuf,
    path_text: String,
    name: String,
    normalized_name: String,
    normalized_path: String,
    folder: String,
    extension: String,
    size_bytes: u64,
    modified_unix: u64,
}

#[derive(Debug, Clone)]
struct WorkspaceIndex {
    files_by_root: Vec<Vec<IndexedFile>>,
    fingerprint: String,
    built_at: u64,
}

#[derive(Default)]
struct WorkspaceIndexCache {
    index: Option<WorkspaceIndex>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileSearchResult {
    pub path: String,
    pub name: String,
    pub folder: String,
    pub extension: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct FolderEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct TextFileResult {
    pub path: String,
    pub name: String,
    pub content: String,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct FileActionResult {
    pub success: bool,
    pub message: String,
    pub path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FilePreviewResult {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub data_url: Option<String>,
    pub text: Option<String>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct LocalImageDataUrl {
    pub data_url: String,
    pub path: String,
}

fn normalize_roots(folders: &[String]) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    folders
        .iter()
        .filter_map(|folder| std::fs::canonicalize(folder).ok())
        .filter(|path| path.is_dir())
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

pub(crate) fn normalize_text(value: &str) -> String {
    value.to_lowercase()
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct MatchScore {
    rank: u8,
    name_gap: usize,
    path_gap: usize,
}

fn compare_match_scores(left: MatchScore, right: MatchScore) -> std::cmp::Ordering {
    left.rank
        .cmp(&right.rank)
        .then_with(|| left.name_gap.cmp(&right.name_gap))
        .then_with(|| left.path_gap.cmp(&right.path_gap))
}

fn resolve_direct_candidate(input: &str, roots: &[PathBuf]) -> Result<Option<PathBuf>, String> {
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

fn file_match_score(query: &str, file: &IndexedFile) -> Option<MatchScore> {
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

fn ranked_file_matches(
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

fn directory_match_score(query: &str, name: &str, path: &str) -> Option<MatchScore> {
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

fn resolve_existing_permitted_path(input: &str, folders: &[String]) -> Result<PathBuf, String> {
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

fn resolve_existing_permitted_folder_path(
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

fn workspace_index_cache() -> &'static Mutex<WorkspaceIndexCache> {
    WORKSPACE_INDEX.get_or_init(|| Mutex::new(WorkspaceIndexCache::default()))
}

fn folder_fingerprint(root: &Path) -> String {
    let metadata = std::fs::metadata(root).ok();
    let modified = metadata
        .and_then(|value| value.modified().ok())
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or_default();
    format!("{}:{}", root.to_string_lossy(), modified)
}

fn index_fingerprint(roots: &[PathBuf]) -> String {
    roots
        .iter()
        .map(|root| folder_fingerprint(root))
        .collect::<Vec<_>>()
        .join("|")
}

fn indexed_file_from_path(path: PathBuf, root: &Path) -> Option<IndexedFile> {
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

fn walk_index(root: &Path, current: &Path, results: &mut Vec<IndexedFile>, limit: usize) {
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

fn build_workspace_index(roots: Vec<PathBuf>) -> WorkspaceIndex {
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

fn workspace_index(folders: &[String]) -> Result<WorkspaceIndex, String> {
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

fn indexed_to_search_result(file: &IndexedFile) -> FileSearchResult {
    FileSearchResult {
        path: file.path_text.clone(),
        name: file.name.clone(),
        folder: file.folder.clone(),
        extension: file.extension.clone(),
        size_bytes: file.size_bytes,
    }
}

fn interleave_indexed(mut per_root: Vec<Vec<IndexedFile>>, limit: usize) -> Vec<FileSearchResult> {
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

fn interleave_scored_matches(
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

fn resolve_new_permitted_path(
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

fn extension_for(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn mime_for_extension(extension: &str) -> &'static str {
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

fn media_kind_for_extension(extension: &str) -> &'static str {
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

fn media_kind_matches(extension: &str, kind: &str) -> bool {
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

#[tauri::command]
pub fn search_linked_files(
    query: String,
    folders: Vec<String>,
    limit: Option<u32>,
) -> Result<Vec<FileSearchResult>, String> {
    if normalize_text(query.trim()).is_empty() {
        return Err("Tell me what file name to search for.".to_string());
    }

    let max_results = limit.unwrap_or(24).clamp(1, 100) as usize;
    let index = workspace_index(&folders)?;
    let per_root = index
        .files_by_root
        .into_iter()
        .map(|files| {
            files
                .into_iter()
                .filter_map(|file| file_match_score(&query, &file).map(|score| (score, file)))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    Ok(interleave_scored_matches(per_root, max_results))
}

#[tauri::command]
pub fn list_linked_folder(
    folder: String,
    folders: Vec<String>,
) -> Result<Vec<FolderEntry>, String> {
    let roots = normalize_roots(&folders);
    if roots.is_empty() {
        return Err("Add a workspace folder first.".to_string());
    }

    let target = if folder.trim().is_empty() {
        roots[0].clone()
    } else {
        resolve_existing_permitted_folder_path(&folder, &folders)?
    };

    if !target.is_dir() {
        return Err("That is a file. Choose a folder to list.".to_string());
    }

    let mut entries = Vec::new();
    for entry in
        std::fs::read_dir(&target).map_err(|e| format!("Could not read that folder: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Could not read a folder item: {}", e))?;
        let path = entry.path();
        let metadata = entry.metadata().ok();
        entries.push(FolderEntry {
            path: path.to_string_lossy().to_string(),
            name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            is_dir: path.is_dir(),
            size_bytes: metadata.map(|value| value.len()).unwrap_or(0),
        });
    }

    entries.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn read_linked_text_file(
    file: String,
    folders: Vec<String>,
    max_bytes: Option<u32>,
) -> Result<TextFileResult, String> {
    let path = resolve_existing_permitted_path(&file, &folders)?;
    if !path.is_file() {
        return Err("That is a folder. Choose a text file to read.".to_string());
    }

    let max = max_bytes.unwrap_or(64_000).clamp(1_024, 512_000) as usize;
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read that file: {}", e))?;
    let truncated = bytes.len() > max;
    let content = String::from_utf8_lossy(&bytes[..bytes.len().min(max)]).to_string();

    Ok(TextFileResult {
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string(),
        content,
        truncated,
    })
}

#[tauri::command]
pub fn list_linked_media_files(
    kind: String,
    folders: Vec<String>,
    limit: Option<u32>,
) -> Result<Vec<FileSearchResult>, String> {
    let max_results = limit.unwrap_or(24).clamp(1, 20_000) as usize;
    let index = workspace_index(&folders)?;
    let per_root = index
        .files_by_root
        .into_iter()
        .map(|files| {
            files
                .into_iter()
                .filter(|file| {
                    media_kind_matches(&file.extension, &kind)
                        && media_kind_for_extension(&file.extension) != "other"
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    Ok(interleave_indexed(per_root, max_results))
}

#[tauri::command]
pub fn preview_linked_file(
    file: String,
    folders: Vec<String>,
    max_bytes: Option<u32>,
) -> Result<FilePreviewResult, String> {
    let path = resolve_existing_permitted_path(&file, &folders)?;
    if !path.is_file() {
        return Err("That is a folder. Choose a file to show or play.".to_string());
    }

    let metadata =
        std::fs::metadata(&path).map_err(|e| format!("Could not inspect that file: {}", e))?;
    let extension = extension_for(&path);
    let mime_type = mime_for_extension(&extension).to_string();
    let file_kind = media_kind_for_extension(&extension);
    if file_kind == "other" {
        return Err(format!(
            "I can find this file, but I cannot preview .{} inside chat yet. Use the file path to open it with Windows: {}",
            extension,
            path.to_string_lossy()
        ));
    }

    let max = max_bytes.unwrap_or(80_000_000).clamp(4_096, 120_000_000) as usize;
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read that file: {}", e))?;
    let truncated = bytes.len() > max;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();

    if file_kind == "text" {
        let text = String::from_utf8_lossy(&bytes[..bytes.len().min(max)]).to_string();
        return Ok(FilePreviewResult {
            path: path.to_string_lossy().to_string(),
            name,
            extension,
            mime_type,
            size_bytes: metadata.len(),
            data_url: None,
            text: Some(text),
            truncated,
        });
    }

    if truncated {
        return Err(format!(
            "That file is too large to embed in chat safely ({} MB). Path: {}",
            metadata.len() / 1024 / 1024,
            path.to_string_lossy()
        ));
    }

    let encoded = general_purpose::STANDARD.encode(bytes);
    Ok(FilePreviewResult {
        path: path.to_string_lossy().to_string(),
        name,
        extension,
        mime_type: mime_type.clone(),
        size_bytes: metadata.len(),
        data_url: Some(format!("data:{};base64,{}", mime_type, encoded)),
        text: None,
        truncated: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("galaxy_bot_{}_{}", name, unique))
    }

    #[test]
    fn media_scan_uses_all_workspace_folders() {
        let first = temp_root("first");
        let second = temp_root("second");
        fs::create_dir_all(&first).expect("create first temp folder");
        fs::create_dir_all(&second).expect("create second temp folder");
        fs::write(first.join("first.mp3"), b"first").expect("write first mp3");
        fs::write(second.join("second.mp3"), b"second").expect("write second mp3");

        let results = list_linked_media_files(
            "audio".to_string(),
            vec![
                first.to_string_lossy().to_string(),
                second.to_string_lossy().to_string(),
            ],
            Some(10),
        )
        .expect("list media");
        let names = results
            .into_iter()
            .map(|file| file.name)
            .collect::<Vec<_>>();

        let _ = fs::remove_dir_all(&first);
        let _ = fs::remove_dir_all(&second);

        assert!(names.iter().any(|name| name == "first.mp3"));
        assert!(names.iter().any(|name| name == "second.mp3"));
    }

    #[test]
    fn audio_scan_does_not_return_images() {
        let root = temp_root("audio_only");
        fs::create_dir_all(&root).expect("create temp folder");
        fs::write(root.join("cover.png"), b"image").expect("write png");
        fs::write(root.join("song.mp3"), b"audio").expect("write mp3");

        let results = list_linked_media_files(
            "audio".to_string(),
            vec![root.to_string_lossy().to_string()],
            Some(10),
        )
        .expect("list audio");

        let _ = fs::remove_dir_all(&root);

        assert!(results.iter().any(|file| file.name == "song.mp3"));
        assert!(!results.iter().any(|file| file.name == "cover.png"));
    }

    #[test]
    fn media_scan_can_return_more_than_first_page_for_random_selection() {
        let root = temp_root("large_audio_set");
        fs::create_dir_all(&root).expect("create temp folder");
        for index in 0..120 {
            fs::write(root.join(format!("song-{index:03}.mp3")), b"audio").expect("write mp3");
        }

        let results = list_linked_media_files(
            "audio".to_string(),
            vec![root.to_string_lossy().to_string()],
            Some(200),
        )
        .expect("list audio");

        let _ = fs::remove_dir_all(&root);

        assert_eq!(results.len(), 120);
        assert!(results.iter().any(|file| file.name == "song-119.mp3"));
    }

    #[test]
    fn search_matches_vietnamese_names_with_accents() {
        let root = temp_root("vietnamese_search");
        fs::create_dir_all(&root).expect("create temp folder");
        fs::write(root.join("Công việc tháng 6.txt"), b"note").expect("write note");

        let results = search_linked_files(
            "công việc tháng".to_string(),
            vec![root.to_string_lossy().to_string()],
            Some(10),
        )
        .expect("search files");

        let _ = fs::remove_dir_all(&root);

        assert!(results
            .iter()
            .any(|file| file.name == "Công việc tháng 6.txt"));
    }
    #[test]
    fn read_file_prefers_exact_name_over_fuzzy_match() {
        let root = temp_root("exact_match");
        fs::create_dir_all(&root).expect("create temp folder");
        fs::write(root.join("archive-report.txt"), b"older").expect("write fuzzy file");
        fs::write(root.join("report.txt"), b"exact").expect("write exact file");

        let result = read_linked_text_file(
            "report.txt".to_string(),
            vec![root.to_string_lossy().to_string()],
            Some(10_000),
        )
        .expect("read exact file");

        let _ = fs::remove_dir_all(&root);

        assert_eq!(result.name, "report.txt");
        assert_eq!(result.content, "exact");
    }

    #[test]
    fn list_folder_accepts_folder_name_without_absolute_path() {
        let root = temp_root("folder_lookup");
        let target = root.join("Projects");
        fs::create_dir_all(&target).expect("create nested folder");
        fs::write(target.join("notes.txt"), b"hello").expect("write nested file");

        let results = list_linked_folder(
            "Projects".to_string(),
            vec![root.to_string_lossy().to_string()],
        )
        .expect("list folder by name");

        let _ = fs::remove_dir_all(&root);

        assert!(results.iter().any(|entry| entry.name == "notes.txt"));
    }

    #[test]
    fn file_search_interleaves_results_across_workspace_roots() {
        let first = temp_root("search_first");
        let second = temp_root("search_second");
        fs::create_dir_all(&first).expect("create first temp folder");
        fs::create_dir_all(&second).expect("create second temp folder");
        fs::write(first.join("report-a.txt"), b"a").expect("write first match");
        fs::write(first.join("report-b.txt"), b"b").expect("write second match");
        fs::write(second.join("report-c.txt"), b"c").expect("write third match");
        fs::write(second.join("report-d.txt"), b"d").expect("write fourth match");

        let results = search_linked_files(
            "report".to_string(),
            vec![
                first.to_string_lossy().to_string(),
                second.to_string_lossy().to_string(),
            ],
            Some(4),
        )
        .expect("search files");

        let _ = fs::remove_dir_all(&first);
        let _ = fs::remove_dir_all(&second);

        assert_eq!(results.len(), 4);
        assert!(results[0].folder.contains("search_first"));
        assert!(results[1].folder.contains("search_second"));
    }

    #[test]
    fn write_requires_explicit_root_when_multiple_workspaces_are_linked() {
        let first = temp_root("write_first");
        let second = temp_root("write_second");
        fs::create_dir_all(&first).expect("create first temp folder");
        fs::create_dir_all(&second).expect("create second temp folder");

        let result = write_linked_text_file(
            "note.txt".to_string(),
            "hello".to_string(),
            None,
            vec![
                first.to_string_lossy().to_string(),
                second.to_string_lossy().to_string(),
            ],
        );

        let _ = fs::remove_dir_all(&first);
        let _ = fs::remove_dir_all(&second);

        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("Choose the exact workspace folder"));
    }
}

#[tauri::command]
pub fn write_linked_text_file(
    relative_path: String,
    content: String,
    root_folder: Option<String>,
    folders: Vec<String>,
) -> Result<FileActionResult, String> {
    let path = resolve_new_permitted_path(root_folder, &relative_path, &folders)?;
    std::fs::write(&path, content).map_err(|e| format!("Could not write that file: {}", e))?;
    Ok(FileActionResult {
        success: true,
        message: format!("Saved {}", path.to_string_lossy()),
        path: Some(path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub fn move_linked_file(
    source: String,
    destination_relative_path: String,
    root_folder: Option<String>,
    folders: Vec<String>,
) -> Result<FileActionResult, String> {
    let source_path = resolve_existing_permitted_path(&source, &folders)?;
    let destination =
        resolve_new_permitted_path(root_folder, &destination_relative_path, &folders)?;
    if destination.exists() {
        return Err("The destination already exists.".to_string());
    }

    std::fs::rename(&source_path, &destination)
        .map_err(|e| format!("Could not move that file: {}", e))?;
    Ok(FileActionResult {
        success: true,
        message: format!("Moved to {}", destination.to_string_lossy()),
        path: Some(destination.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub fn trash_linked_file(source: String, folders: Vec<String>) -> Result<FileActionResult, String> {
    let source_path = resolve_existing_permitted_path(&source, &folders)?;
    let roots = normalize_roots(&folders);
    let root = roots
        .iter()
        .find(|root| path_is_within(&source_path, root))
        .ok_or_else(|| "That file is outside the permitted workspace folders.".to_string())?;
    let trash = root.join(".galaxy_trash");
    std::fs::create_dir_all(&trash).map_err(|e| format!("Could not create trash folder: {}", e))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let destination = trash.join(format!("{}-{}", timestamp, name));

    std::fs::rename(&source_path, &destination)
        .map_err(|e| format!("Could not move that file to trash: {}", e))?;
    Ok(FileActionResult {
        success: true,
        message: format!("Moved to trash: {}", destination.to_string_lossy()),
        path: Some(destination.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub fn open_in_explorer(path: String, folders: Vec<String>) -> Result<(), String> {
    let permitted_path = resolve_existing_permitted_path(&path, &folders)?;
    let path_text = permitted_path.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path_text])
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path_text])
            .spawn()
            .map_err(|e| format!("Failed to open finder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        let dir = permitted_path.parent().unwrap_or(permitted_path.as_path());
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_local_image_data_url(path: String) -> Result<LocalImageDataUrl, String> {
    let target = PathBuf::from(path.trim());
    if !target.exists() || !target.is_file() {
        return Err("That image file is no longer available.".to_string());
    }
    let extension = extension_for(&target);
    let mime_type = mime_for_extension(&extension);
    if !mime_type.starts_with("image/") {
        return Err("Please choose a picture file.".to_string());
    }
    let bytes =
        std::fs::read(&target).map_err(|e| format!("Could not read that image file: {}", e))?;
    let encoded = general_purpose::STANDARD.encode(bytes);
    Ok(LocalImageDataUrl {
        data_url: format!("data:{};base64,{}", mime_type, encoded),
        path: target.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn reveal_file_location(path: String) -> Result<(), String> {
    let target = PathBuf::from(path.trim());
    if !target.exists() {
        return Err("That image is no longer available on disk.".to_string());
    }
    let path_text = target.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        if target.is_file() {
            std::process::Command::new("explorer")
                .args(["/select,", &path_text])
                .spawn()
                .map_err(|e| format!("Failed to open explorer: {}", e))?;
        } else {
            std::process::Command::new("explorer")
                .arg(&path_text)
                .spawn()
                .map_err(|e| format!("Failed to open explorer: {}", e))?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        if target.is_file() {
            std::process::Command::new("open")
                .args(["-R", &path_text])
                .spawn()
                .map_err(|e| format!("Failed to open finder: {}", e))?;
        } else {
            std::process::Command::new("open")
                .arg(&path_text)
                .spawn()
                .map_err(|e| format!("Failed to open finder: {}", e))?;
        }
    }
    #[cfg(target_os = "linux")]
    {
        let dir = if target.is_file() {
            target.parent().unwrap_or(target.as_path())
        } else {
            target.as_path()
        };
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }

    Ok(())
}
