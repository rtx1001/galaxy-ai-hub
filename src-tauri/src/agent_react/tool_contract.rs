use super::*;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ToolDescriptor {
    pub name: &'static str,
    pub purpose: &'static str,
}

pub(super) const TOOL_REGISTRY: &[ToolDescriptor] = &[
    ToolDescriptor {
        name: "get_current_time",
        purpose: "Read the real local date, time, weekday, timezone, and nearby relative dates.",
    },
    ToolDescriptor {
        name: "list_files_in_directory",
        purpose: "List folders and files inside a permitted workspace folder.",
    },
    ToolDescriptor {
        name: "search_directory",
        purpose: "Search permitted workspace folders by file name or keyword.",
    },
    ToolDescriptor {
        name: "find_workspace_candidates",
        purpose: "Find real workspace file candidates from broad descriptions, attributes, time clues, or partial memory when the exact file is unknown.",
    },
    ToolDescriptor {
        name: "read_file",
        purpose: "Read text content from a permitted workspace file.",
    },
    ToolDescriptor {
        name: "list_media_files",
        purpose: "List existing workspace media files when the user asks for a list, not when they ask to play/open one item.",
    },
    ToolDescriptor {
        name: "preview_random_media",
        purpose: "Show one existing workspace media item, especially random music/video/image or a replacement after the user rejects the current media.",
    },
    ToolDescriptor {
        name: "preview_file",
        purpose: "Show/open one specific existing workspace file, including ordinal follow-ups after candidate results.",
    },
    ToolDescriptor {
        name: "weather_forecast",
        purpose: "Get real weather forecast for a known city or area, with an optional exact date.",
    },
    ToolDescriptor {
        name: "web_search",
        purpose: "Search the web for fresh/current public information.",
    },
    ToolDescriptor {
        name: "gmail_recent",
        purpose: "Read recent Gmail messages or search Gmail.",
    },
    ToolDescriptor {
        name: "google_calendar_check",
        purpose: "Read Google Calendar events or answer whether the user is busy/free/available for a date or month.",
    },
    ToolDescriptor {
        name: "propose_image_generation",
        purpose: "Ask approval to create/edit an image; choose one image mode from text_image, image_image, bot_image, user_image, user_bot_image.",
    },
    ToolDescriptor {
        name: "propose_write_file",
        purpose: "Create an approval card to write a file inside a workspace.",
    },
    ToolDescriptor {
        name: "propose_move_file",
        purpose: "Create an approval card to move or rename a workspace file.",
    },
    ToolDescriptor {
        name: "propose_delete_file",
        purpose: "Create an approval card to move a workspace file to app trash.",
    },
    ToolDescriptor {
        name: "run_powershell",
        purpose: "Create an approval card for a local PowerShell/system action.",
    },
    ToolDescriptor {
        name: "google_drive_search",
        purpose: "Search Google Drive files and return verified Drive IDs, MIME types, and links.",
    },
    ToolDescriptor {
        name: "google_docs_read",
        purpose: "Read a Google Docs document by document ID.",
    },
    ToolDescriptor {
        name: "google_sheets_read",
        purpose: "Read a Google Sheets spreadsheet or range by spreadsheet ID.",
    },
    ToolDescriptor {
        name: "google_contacts_search",
        purpose: "Read or search Google Contacts by name, email, or phone.",
    },
    ToolDescriptor {
        name: "google_api_read",
        purpose: "Call an official Google REST API GET URL when no more specific read tool fits.",
    },
    ToolDescriptor {
        name: "propose_gmail_send",
        purpose: "Ask approval to send or reply to an email, including follow-ups to a previously read email.",
    },
    ToolDescriptor {
        name: "propose_gmail_trash",
        purpose: "Create an approval card to move a Gmail message to Trash.",
    },
    ToolDescriptor {
        name: "propose_calendar_create",
        purpose: "Ask approval to create a calendar event, reminder, scheduled automation, or recurring future task.",
    },
    ToolDescriptor {
        name: "propose_calendar_delete",
        purpose: "Create an approval card to delete a Google Calendar event.",
    },
    ToolDescriptor {
        name: "propose_google_contact_delete",
        purpose: "Ask approval to delete a Google contact after the target is sufficiently identified.",
    },
    ToolDescriptor {
        name: "propose_google_action",
        purpose: "Create an approval card for Google Workspace write/modify actions not covered by a more specific propose_* tool.",
    },
];

pub(super) fn available_tool_names() -> Vec<&'static str> {
    TOOL_REGISTRY.iter().map(|tool| tool.name).collect()
}

fn tool_descriptor(name: &str) -> Option<&'static ToolDescriptor> {
    TOOL_REGISTRY.iter().find(|tool| tool.name == name)
}

pub(super) fn known_tool(tool: &str) -> bool {
    tool_descriptor(tool).is_some()
}

pub(super) fn default_tool_arguments(tool: &str) -> Value {
    match tool {
        "preview_random_media" | "list_media_files" | "find_workspace_candidates" => {
            json!({ "kind": "any" })
        }
        "get_current_time" | "gmail_recent" | "google_contacts_search" | "google_drive_search" => {
            json!({})
        }
        _ => json!({}),
    }
}

pub(super) fn image_prompt_argument(call: &ToolCall) -> String {
    call.arguments
        .get("prompt")
        .or_else(|| call.arguments.get("description"))
        .or_else(|| call.arguments.get("visual_prompt"))
        .or_else(|| call.arguments.get("image_prompt"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub(super) fn image_prompt_needs_english_rewrite(prompt: &str) -> bool {
    if prompt.trim().is_empty() {
        return false;
    }
    let (english_words, non_english_words) = prompt_language_word_counts(prompt);
    let has_non_english_script = text_has_thai_script(prompt)
        || text_has_cjk_script(prompt)
        || text_has_vietnamese_diacritic(prompt);
    if has_non_english_script {
        if english_words >= 4 && english_words >= non_english_words.saturating_mul(2) {
            return false;
        }
        if non_english_words <= 5 && english_words >= 4 {
            return false;
        }
        return true;
    }
    false
}

pub(super) fn prompt_language_word_counts(prompt: &str) -> (usize, usize) {
    let mut english_words = 0usize;
    let mut non_english_words = 0usize;
    for token in prompt.split(|ch: char| !ch.is_alphabetic()) {
        if token.is_empty() {
            continue;
        }
        if token.chars().all(|ch| ch.is_ascii_alphabetic()) {
            english_words += 1;
        } else {
            non_english_words += 1;
        }
    }
    (english_words, non_english_words)
}

fn malformed_argument_key(key: &str) -> bool {
    key.trim().is_empty()
        || key
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '"' | '\'' | '{' | '}' | '[' | ']'))
        || key.trim_start().starts_with(',')
}

pub(super) const CHAT_ATTACHMENT_WORKSPACE_TOOL_ERROR: &str =
    "Attached chat images are conversation inputs, not workspace files. Output NO_TOOL so the vision chat path can answer, or use propose_image_generation only for image creation/editing.";

fn is_chat_attachment_reference(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }
    let normalized = trimmed
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .replace('/', "\\")
        .to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "[image attached]"
            | "image attached"
            | "attached_image_from_user_message"
            | "current_attached_image"
            | "current_chat_image"
            | "latest_chat_image"
    ) || normalized.contains("\\assistant-runtime\\chat-inputs\\")
        || normalized.contains("\\assistant-runtime\\chat-inputs")
        || normalized.contains("assistant-runtime\\chat-inputs\\")
        || normalized.contains("assistant-runtime\\chat-inputs")
}

fn string_argument<'a>(call: &'a ToolCall, keys: &[&str]) -> &'a str {
    keys.iter()
        .find_map(|key| call.arguments.get(*key).and_then(Value::as_str))
        .unwrap_or_default()
        .trim()
}

fn workspace_tool_targets_chat_attachment(call: &ToolCall) -> bool {
    match call.tool.as_str() {
        "preview_file" | "read_file" => is_chat_attachment_reference(string_argument(
            call,
            &["path", "file", "file_path", "source"],
        )),
        "search_directory" => is_chat_attachment_reference(string_argument(call, &["query"])),
        "find_workspace_candidates" => {
            is_chat_attachment_reference(string_argument(call, &["query"]))
                || call
                    .arguments
                    .get("clues")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .any(is_chat_attachment_reference)
                    })
                    .unwrap_or(false)
        }
        _ => false,
    }
}

pub(super) fn validate_tool_call(call: &ToolCall) -> Result<(), String> {
    if !known_tool(&call.tool) {
        return Err(format!(
            "Unknown tool '{}'. Use exactly one tool from AVAILABLE TOOLS.",
            call.tool
        ));
    }
    if !call.arguments.is_object() {
        return Err("Tool arguments must be a JSON object.".to_string());
    }
    if let Some(object) = call.arguments.as_object() {
        if let Some(key) = object.keys().find(|key| malformed_argument_key(key)) {
            return Err(format!(
                "Tool arguments are malformed near key '{}'. Return one clean JSON object for arguments.",
                key
            ));
        }
    }
    if workspace_tool_targets_chat_attachment(call) {
        return Err(CHAT_ATTACHMENT_WORKSPACE_TOOL_ERROR.to_string());
    }
    if matches!(
        call.tool.as_str(),
        "preview_random_media" | "list_media_files"
    ) {
        let kind = call
            .arguments
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("any")
            .trim()
            .to_ascii_lowercase();
        if !matches!(
            kind.as_str(),
            "" | "any"
                | "audio"
                | "video"
                | "image"
                | "document"
                | "text"
                | "song"
                | "music"
                | "movie"
        ) {
            return Err(
                "Media kind must be audio, video, image, document, text, or any.".to_string(),
            );
        }
    }
    if matches!(call.tool.as_str(), "search_directory" | "web_search")
        && call
            .arguments
            .get("query")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    {
        return Err(format!("{} requires a non-empty query.", call.tool));
    }
    if call.tool == "preview_file"
        && call
            .arguments
            .get("path")
            .or_else(|| call.arguments.get("file"))
            .or_else(|| call.arguments.get("file_path"))
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    {
        return Err("preview_file requires a non-empty path.".to_string());
    }
    if call.tool == "find_workspace_candidates" {
        let query = call
            .arguments
            .get("query")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        let has_clues = call
            .arguments
            .get("clues")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .any(|value| !value.trim().is_empty())
            })
            .unwrap_or(false);
        if query.is_empty() && !has_clues {
            return Err("find_workspace_candidates requires query or non-empty clues.".to_string());
        }
    }
    if call.tool == "weather_forecast"
        && call
            .arguments
            .get("location")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    {
        return Err("weather_forecast requires a non-empty location.".to_string());
    }
    if call.tool == "propose_image_generation" {
        let prompt = image_prompt_argument(call);
        if prompt.is_empty() {
            return Err("propose_image_generation requires a non-empty prompt.".to_string());
        }
        let mode = call
            .arguments
            .get("mode")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("text_image");
        if canonical_image_mode(mode).is_none() {
            return Err(
                "Image generation mode must be one of: text_image, image_image, bot_image, user_image, user_bot_image.".to_string(),
            );
        }
        if image_prompt_needs_english_rewrite(&prompt) {
            return Err("Image generation prompt must be mainly written in English. Rewrite the user's visual request into an English-first prompt, while preserving names, places, brands, quoted text, mode, and mask_prompt.".to_string());
        }
        let mask_prompt = call
            .arguments
            .get("mask_prompt")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        if !mask_prompt.is_empty() && image_prompt_needs_english_rewrite(mask_prompt) {
            return Err(
                "Image generation mask_prompt must be mainly written in English.".to_string(),
            );
        }
    }
    if matches!(call.tool.as_str(), "google_drive_search")
        && call
            .arguments
            .get("query")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
        && call
            .arguments
            .get("mime_type")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    {
        return Err("google_drive_search requires a query or mime_type filter.".to_string());
    }
    if matches!(call.tool.as_str(), "google_docs_read")
        && call
            .arguments
            .get("document_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    {
        return Err("google_docs_read requires document_id.".to_string());
    }
    if matches!(call.tool.as_str(), "google_sheets_read")
        && call
            .arguments
            .get("spreadsheet_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    {
        return Err("google_sheets_read requires spreadsheet_id.".to_string());
    }
    if call.tool == "google_contacts_search" {
        let page_size = call
            .arguments
            .get("page_size")
            .and_then(Value::as_u64)
            .unwrap_or(10);
        if !(1..=50).contains(&page_size) {
            return Err("google_contacts_search page_size must be between 1 and 50.".to_string());
        }
    }
    if matches!(
        call.tool.as_str(),
        "google_api_read" | "propose_google_action"
    ) {
        let url = call
            .arguments
            .get("url")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        if url.is_empty() {
            return Err(format!("{} requires a Google API URL.", call.tool));
        }
        if !google_api_url_allowed(url) {
            return Err("Use an official Google API URL on googleapis.com.".to_string());
        }
        if url
            .chars()
            .any(|ch| ch.is_whitespace() || matches!(ch, '<' | '>' | '"'))
        {
            return Err("Google API URL contains invalid markup or whitespace.".to_string());
        }
    }
    if call.tool == "propose_google_action" {
        let method = call
            .arguments
            .get("method")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("POST")
            .to_ascii_uppercase();
        if !matches!(method.as_str(), "POST" | "PUT" | "PATCH" | "DELETE") {
            return Err("Google write actions must use POST, PUT, PATCH, or DELETE.".to_string());
        }
        let summary = call
            .arguments
            .get("action_summary")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        if summary.is_empty() || summary.contains("<tool_call") || summary.contains("<|tool_call|>")
        {
            return Err("Google action summary is missing or malformed.".to_string());
        }
        let payload = call.arguments.get("payload").unwrap_or(&Value::Null);
        if !matches!(payload, Value::Null | Value::String(_) | Value::Object(_)) {
            return Err(
                "Google action payload must be a JSON object, string, or null.".to_string(),
            );
        }
    }
    if call.tool == "propose_google_contact_delete" {
        let resource_name = call
            .arguments
            .get("resource_name")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        if !resource_name.starts_with("people/") || resource_name.contains(':') {
            return Err(
                "Google contact delete requires a verified People resource name.".to_string(),
            );
        }
    }
    Ok(())
}

pub(super) fn with_user_text(mut call: ToolCall, user_text: &str) -> ToolCall {
    let mut object = call.arguments.as_object().cloned().unwrap_or_default();
    object.insert(
        "_user_text".to_string(),
        Value::String(user_text.to_string()),
    );
    call.arguments = Value::Object(object);
    call
}

pub(super) fn google_api_url_allowed(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url.trim()) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    matches!(
        host,
        "www.googleapis.com"
            | "drive.googleapis.com"
            | "docs.googleapis.com"
            | "sheets.googleapis.com"
            | "people.googleapis.com"
            | "storage.googleapis.com"
            | "gmail.googleapis.com"
            | "chat.googleapis.com"
    )
}
