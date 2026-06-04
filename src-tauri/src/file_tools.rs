use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use unicode_normalization::UnicodeNormalization;

mod workspace;
pub(crate) use workspace::normalize_text;
use workspace::*;

#[derive(Debug, Clone, Serialize)]
pub struct FileSearchResult {
    pub path: String,
    pub name: String,
    pub folder: String,
    pub extension: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CandidateScore {
    score: u16,
    path_gap: usize,
}

fn fold_workspace_search_text(value: &str) -> String {
    let mut folded = String::new();
    for ch in value.nfd() {
        let code = ch as u32;
        if (0x0300..=0x036F).contains(&code) {
            continue;
        }
        match ch {
            '\u{0111}' | '\u{0110}' => folded.push('d'),
            _ => folded.extend(ch.to_lowercase()),
        }
    }
    folded
}

fn candidate_tokens(query: &str, clues: &[String]) -> Vec<String> {
    let mut tokens = clues
        .iter()
        .map(String::as_str)
        .chain(std::iter::once(query))
        .flat_map(|value| {
            fold_workspace_search_text(value)
                .split(|ch: char| !ch.is_alphanumeric())
                .filter(|token| token.chars().count() >= 2)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    let mut expanded = Vec::new();
    for token in &tokens {
        if token.chars().count() >= 6 {
            expanded.push(token.chars().take(4).collect::<String>());
        }
    }
    tokens.extend(expanded);
    tokens.sort();
    tokens.dedup();
    tokens
}

fn file_kind_matches_extension(kind: &str, extension: &str) -> bool {
    let kind = kind.trim().to_ascii_lowercase();
    if kind.is_empty() || kind == "any" {
        return true;
    }
    let extension = extension.trim_start_matches('.').to_ascii_lowercase();
    match kind.as_str() {
        "audio" | "song" | "music" => matches!(
            extension.as_str(),
            "mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg" | "opus" | "wma"
        ),
        "video" | "movie" => matches!(
            extension.as_str(),
            "mp4" | "mkv" | "webm" | "mov" | "avi" | "wmv" | "m4v"
        ),
        "image" | "photo" | "picture" => matches!(
            extension.as_str(),
            "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "tif" | "tiff"
        ),
        "document" => matches!(
            extension.as_str(),
            "pdf"
                | "doc"
                | "docx"
                | "xls"
                | "xlsx"
                | "ppt"
                | "pptx"
                | "md"
                | "txt"
                | "rtf"
                | "csv"
                | "json"
                | "xml"
        ),
        "text" => matches!(
            extension.as_str(),
            "txt" | "md" | "json" | "csv" | "xml" | "html" | "css" | "js" | "ts" | "tsx" | "rs"
        ),
        _ => true,
    }
}

fn workspace_candidate_score(file: &IndexedFile, tokens: &[String]) -> Option<CandidateScore> {
    if tokens.is_empty() {
        return Some(CandidateScore {
            score: 1,
            path_gap: file.normalized_path.len(),
        });
    }
    let folded_name = fold_workspace_search_text(&file.name);
    let folded_folder = fold_workspace_search_text(&file.folder);
    let folded_path = fold_workspace_search_text(&file.path_text);
    let mut score = 0u16;
    for token in tokens {
        if folded_name == *token {
            score = score.saturating_add(40);
        } else if folded_name.starts_with(token) {
            score = score.saturating_add(28);
        } else if folded_name.contains(token) {
            score = score.saturating_add(20);
        } else if folded_folder.contains(token) {
            score = score.saturating_add(14);
        } else if folded_path.contains(token) {
            score = score.saturating_add(8);
        }
    }
    (score > 0).then_some(CandidateScore {
        score,
        path_gap: folded_path.len(),
    })
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

#[derive(Debug, Serialize)]
pub struct WorkspaceFolderStatus {
    pub path: String,
    pub exists: bool,
    pub message: String,
}

#[tauri::command]
pub fn validate_workspace_folders(folders: Vec<String>) -> Vec<WorkspaceFolderStatus> {
    folders
        .into_iter()
        .filter(|folder| !folder.trim().is_empty())
        .map(|folder| {
            let path = PathBuf::from(folder.trim());
            let exists = path.is_dir();
            WorkspaceFolderStatus {
                path: folder,
                exists,
                message: if exists {
                    "Ready".to_string()
                } else {
                    "Folder no longer exists or cannot be opened.".to_string()
                },
            }
        })
        .collect()
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

pub fn find_workspace_candidates(
    query: String,
    clues: Vec<String>,
    kind: String,
    root_folder: Option<String>,
    folders: Vec<String>,
    limit: Option<u32>,
) -> Result<Vec<FileSearchResult>, String> {
    let scoped_folders = if let Some(root_folder) = root_folder
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        vec![display_path(&resolve_existing_permitted_folder_path(
            root_folder,
            &folders,
        )?)]
    } else {
        folders
    };
    let max_results = limit.unwrap_or(24).clamp(1, 80) as usize;
    let tokens = candidate_tokens(&query, &clues);
    let mut matches = workspace_index(&scoped_folders)?
        .files_by_root
        .into_iter()
        .flatten()
        .filter(|file| file_kind_matches_extension(&kind, &file.extension))
        .filter_map(|file| workspace_candidate_score(&file, &tokens).map(|score| (score, file)))
        .collect::<Vec<_>>();

    matches.sort_by(|left, right| {
        right
            .0
            .score
            .cmp(&left.0.score)
            .then_with(|| left.0.path_gap.cmp(&right.0.path_gap))
            .then_with(|| right.1.modified_unix.cmp(&left.1.modified_unix))
            .then_with(|| left.1.path_text.cmp(&right.1.path_text))
    });
    matches.truncate(max_results);
    Ok(matches
        .into_iter()
        .map(|(_, file)| FileSearchResult {
            path: file.path_text,
            name: file.name,
            folder: file.folder,
            extension: file.extension,
            size_bytes: file.size_bytes,
        })
        .collect())
}

#[tauri::command]
pub fn list_linked_folder(
    folder: String,
    folders: Vec<String>,
) -> Result<Vec<FolderEntry>, String> {
    let roots = normalize_roots(&folders);
    if roots.is_empty() {
        return Err(workspace_folder_error(&folders));
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
            path: display_path(&path),
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
        path: display_path(&path),
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
            display_path(&path)
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
            path: display_path(&path),
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
            display_path(&path)
        ));
    }

    let encoded = general_purpose::STANDARD.encode(bytes);
    Ok(FilePreviewResult {
        path: display_path(&path),
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
        let name = "C\u{00f4}ng vi\u{1ec7}c th\u{00e1}ng 6.txt";
        fs::write(root.join(name), b"note").expect("write note");

        let results = search_linked_files(
            "c\u{00f4}ng vi\u{1ec7}c th\u{00e1}ng".to_string(),
            vec![root.to_string_lossy().to_string()],
            Some(10),
        )
        .expect("search files");

        let _ = fs::remove_dir_all(&root);

        assert!(results.iter().any(|file| file.name == name));
    }

    #[test]
    fn workspace_candidates_match_broad_non_audio_file_clues() {
        let root = temp_root("workspace_candidates");
        let docs = root.join("Work Documents");
        fs::create_dir_all(&docs).expect("create temp folder");
        let report_name = "C\u{00f4}ng vi\u{1ec7}c th\u{00e1}ng 6.pdf";
        fs::write(docs.join(report_name), b"pdf").expect("write pdf");
        fs::write(docs.join("holiday-photo.jpg"), b"image").expect("write image");

        let results = find_workspace_candidates(
            "monthly work document".to_string(),
            vec![
                "cong viec".to_string(),
                "thang 6".to_string(),
                "report".to_string(),
            ],
            "document".to_string(),
            None,
            vec![root.to_string_lossy().to_string()],
            Some(10),
        )
        .expect("find candidates");

        let _ = fs::remove_dir_all(&root);

        assert!(results.iter().any(|file| file.name == report_name));
        assert!(!results.iter().any(|file| file.name == "holiday-photo.jpg"));
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

fn extension_from_image_data_url(data_url: &str) -> &'static str {
    let header = data_url
        .split_once(',')
        .map(|(header, _)| header)
        .unwrap_or(data_url)
        .to_ascii_lowercase();
    if header.contains("image/jpeg") || header.contains("image/jpg") {
        "jpg"
    } else if header.contains("image/webp") {
        "webp"
    } else if header.contains("image/gif") {
        "gif"
    } else {
        "png"
    }
}

#[tauri::command]
pub fn save_chat_input_image_data_url(data_url: String) -> Result<LocalImageDataUrl, String> {
    let value = data_url.trim();
    if !value.starts_with("data:image/") {
        return Err("That clipboard item is not a picture.".to_string());
    }
    let (_, encoded) = value
        .split_once(',')
        .ok_or_else(|| "Clipboard image data is not readable.".to_string())?;
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Could not decode clipboard image: {}", e))?;
    if bytes.is_empty() {
        return Err("Clipboard image data is empty.".to_string());
    }

    let input_dir = crate::app_paths::app_root_dir()
        .join("assistant-runtime")
        .join("chat-inputs");
    std::fs::create_dir_all(&input_dir)
        .map_err(|e| format!("Could not prepare chat image folder: {}", e))?;
    let extension = extension_from_image_data_url(value);
    let hash = crate::assistant_runtime::stable_bytes_hash(&bytes);
    let path = input_dir.join(format!("clipboard-{}.{}", hash, extension));
    if !path.exists() {
        std::fs::write(&path, &bytes)
            .map_err(|e| format!("Could not save clipboard image: {}", e))?;
    }
    Ok(LocalImageDataUrl {
        data_url: value.to_string(),
        path: path.to_string_lossy().to_string(),
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
