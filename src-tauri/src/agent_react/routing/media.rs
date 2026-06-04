use super::*;

pub(in crate::agent_react) fn recent_media_kind(
    messages: &[ReactChatMessage],
) -> Option<&'static str> {
    messages
        .iter()
        .rev()
        .skip(1)
        .take(8)
        .find_map(|message| inferred_media_kind(&content_text(&message.content)))
}

pub(in crate::agent_react) fn recent_context_wants_media_preview(
    messages: &[ReactChatMessage],
) -> bool {
    messages.iter().rev().skip(1).take(4).any(|message| {
        let text = content_text(&message.content);
        route_for_request(&text) == Some(ToolRoute::MediaPreview)
            || contains_any(
                &normalize_text(&text),
                &["preview_random_media", "open a", "play a"],
            )
            || contains_any_folded(
                &text.to_lowercase(),
                &normalize_text(&text),
                &["mở giúp", "mở một"],
            )
    })
}

pub(in crate::agent_react) fn extract_path_from_line(line: &str) -> Option<String> {
    let lower = normalize_text(line);
    for label in ["path:", "đường dẫn:"] {
        if let Some(index) = lower.find(label) {
            let start = index + label.len();
            let original_start = line
                .char_indices()
                .nth(start)
                .map(|(i, _)| i)
                .unwrap_or(start);
            let value = line[original_start..].trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

pub(in crate::agent_react) fn recent_preview_paths(messages: &[ReactChatMessage]) -> Vec<String> {
    let mut paths = Vec::new();
    for message in messages.iter().rev().skip(1).take(8) {
        for line in content_text(&message.content).lines() {
            if let Some(path) = extract_path_from_line(line) {
                paths.push(path);
            }
        }
    }
    paths
}

#[cfg(test)]
pub(in crate::agent_react) fn random_media_preview_allowed(
    text: &str,
    allow_follow_up: bool,
) -> bool {
    if request_wants_avatar_image_generation(text) {
        return false;
    }
    (request_wants_preview(text)
        && request_mentions_media(text)
        && super::super::chat_media::request_is_broad_media_preview(text)
        && !super::super::chat_media::request_names_specific_file(text))
        || allow_follow_up
}

#[cfg(test)]
pub(in crate::agent_react) fn deterministic_preview_call(
    messages: &[ReactChatMessage],
) -> Option<ToolCall> {
    let latest_text = latest_user_text(messages);
    if request_wants_avatar_image_generation(&latest_text) {
        return None;
    }
    if contextual_route_for_messages(messages) != Some(ToolRoute::MediaPreview)
        || !random_media_preview_allowed(&latest_text, false)
    {
        return None;
    }

    let mut call = ToolCall {
        tool: "preview_random_media".to_string(),
        arguments: json!({
            "kind": inferred_media_kind(&latest_text).unwrap_or("any")
        }),
    };

    if recent_context_wants_media_preview(messages) {
        call = enrich_contextual_tool_call(call, messages, &latest_text);
    } else {
        call = with_user_text(call, &latest_text);
    }
    Some(call)
}

pub(in crate::agent_react) fn enrich_contextual_tool_call(
    mut call: ToolCall,
    messages: &[ReactChatMessage],
    latest_text: &str,
) -> ToolCall {
    call = with_user_text(call, latest_text);
    if call.tool != "preview_random_media" || !recent_context_wants_media_preview(messages) {
        return call;
    }

    let mut object = call.arguments.as_object().cloned().unwrap_or_default();
    object.insert("_preview_context".to_string(), json!("follow_up"));
    let current_kind = object
        .get("kind")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if matches!(current_kind.as_str(), "" | "any") {
        if let Some(kind) = recent_media_kind(messages) {
            object.insert("kind".to_string(), json!(kind));
        }
    }
    if !object.contains_key("exclude_paths") {
        let paths = recent_preview_paths(messages);
        if !paths.is_empty() {
            object.insert("exclude_paths".to_string(), json!(paths));
        }
    }
    call.arguments = Value::Object(object);
    call
}

pub(in crate::agent_react) fn promote_media_list_to_preview_in_preview_flow(
    mut call: ToolCall,
    messages: &[ReactChatMessage],
    latest_text: &str,
) -> ToolCall {
    if call.tool != "list_media_files"
        || !(request_wants_preview(latest_text) || recent_context_wants_media_preview(messages))
    {
        return call;
    }

    call.tool = "preview_random_media".to_string();
    call = with_user_text(call, latest_text);
    let mut object = call.arguments.as_object().cloned().unwrap_or_default();
    object.insert("_preview_context".to_string(), json!("follow_up"));
    let current_kind = object
        .get("kind")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if matches!(current_kind.as_str(), "" | "any") {
        if let Some(kind) = recent_media_kind(messages) {
            object.insert("kind".to_string(), json!(kind));
        }
    }
    if !object.contains_key("exclude_paths") {
        let paths = recent_preview_paths(messages);
        if !paths.is_empty() {
            object.insert("exclude_paths".to_string(), json!(paths));
        }
    }
    call.arguments = Value::Object(object);
    call
}

#[cfg(test)]
pub(in crate::agent_react) fn should_continue_after_observation(
    tool: &str,
    user_text: &str,
) -> bool {
    matches!(
        tool,
        "search_directory" | "list_media_files" | "find_workspace_candidates"
    ) && request_wants_preview(user_text)
}

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
