use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;

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
