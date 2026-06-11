use super::*;

pub(in crate::agent_react) fn first_previewable_search_result(
    matches: &[file_tools::FileSearchResult],
    folders: &[String],
    user_text: &str,
) -> Option<file_tools::FilePreviewResult> {
    for file in matches {
        let Ok(preview) =
            file_tools::preview_linked_file(file.path.clone(), folders.to_vec(), Some(80_000_000))
        else {
            continue;
        };
        if preview_kind_matches_request(&preview, user_text) {
            return Some(preview);
        }
    }
    None
}

pub(in crate::agent_react) fn preview_kind_matches_request(
    preview: &file_tools::FilePreviewResult,
    user_text: &str,
) -> bool {
    match inferred_media_kind(user_text) {
        Some("audio") => preview.mime_type.starts_with("audio/"),
        Some("video") => preview.mime_type.starts_with("video/"),
        Some("image") => preview.mime_type.starts_with("image/"),
        Some("document") => {
            preview.mime_type == "application/pdf" || preview.mime_type.starts_with("text/")
        }
        Some("text") => preview.mime_type.starts_with("text/"),
        _ => true,
    }
}

pub(in crate::agent_react) fn requested_kind_label(user_text: &str) -> &'static str {
    inferred_media_kind(user_text).unwrap_or("previewable")
}
