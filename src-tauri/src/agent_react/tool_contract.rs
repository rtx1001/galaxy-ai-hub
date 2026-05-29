use super::*;

pub(super) const AVAILABLE_TOOL_NAMES: &[&str] = &[
    "get_current_time",
    "list_files_in_directory",
    "search_directory",
    "read_file",
    "list_media_files",
    "preview_random_media",
    "preview_file",
    "weather_forecast",
    "web_search",
    "gmail_recent",
    "google_calendar_check",
    "propose_image_generation",
    "propose_write_file",
    "propose_move_file",
    "propose_delete_file",
    "run_powershell",
    "google_drive_search",
    "google_docs_read",
    "google_sheets_read",
    "google_contacts_search",
    "google_api_read",
    "propose_gmail_send",
    "propose_gmail_trash",
    "propose_calendar_create",
    "propose_calendar_delete",
    "propose_google_contact_delete",
    "propose_google_action",
];

pub(super) fn known_tool(tool: &str) -> bool {
    AVAILABLE_TOOL_NAMES.contains(&tool)
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
    let normalized = format!(" {} ", normalize_text(prompt));
    contains_any(
        &normalized,
        &[
            " tao anh ",
            " ve anh ",
            " tao hinh ",
            " dang ",
            " khong ",
            " mac ",
            " ngoi ",
            " dung ",
            " phong cach ",
            " anh sang ",
            " tu nhien ",
            " dep ",
            " toan than ",
            " ban than ",
        ],
    )
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

pub(super) fn string_arg<'a>(arguments: &'a Value, names: &[&str]) -> Option<&'a str> {
    names
        .iter()
        .find_map(|name| arguments.get(*name).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub(super) fn repaired_unknown_tool_call(
    call: &ToolCall,
    route: Option<ToolRoute>,
    latest_user_text: &str,
) -> Option<ToolCall> {
    if known_tool(&call.tool) {
        return Some(call.clone());
    }
    let compact = call
        .tool
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    let text = normalize_text(&format!(
        "{} {}",
        call.tool,
        extract_value_text(&call.arguments)
    ));

    let wants_audio_alias = compact.contains("music")
        || compact.contains("song")
        || compact.contains("audio")
        || contains_any(&text, &["music", "song", "audio", "bai hat", "nhac"]);
    let wants_image_alias = compact.contains("image")
        || compact.contains("photo")
        || compact.contains("picture")
        || contains_any(&text, &["image", "photo", "picture"]);

    if route == Some(ToolRoute::MediaPreview) || wants_audio_alias || wants_image_alias {
        if let Some(path) = string_arg(&call.arguments, &["path", "file", "filename"]) {
            return Some(ToolCall {
                tool: "preview_file".to_string(),
                arguments: json!({ "path": path }),
            });
        }
        let query = string_arg(&call.arguments, &["query", "song", "title", "name"])
            .filter(|value| !media_constraint_query_is_generic(value));
        let kind = if wants_image_alias {
            "image"
        } else if wants_audio_alias || route == Some(ToolRoute::MediaPreview) {
            "audio"
        } else {
            "any"
        };
        let mut arguments = json!({ "kind": kind, "_user_text": latest_user_text });
        if let Some(query) = query {
            arguments["query"] = Value::String(query.to_string());
        }
        return Some(ToolCall {
            tool: "preview_random_media".to_string(),
            arguments,
        });
    }

    if compact.contains("weather") || route == Some(ToolRoute::Weather) {
        if let Some(location) = string_arg(&call.arguments, &["location", "city", "place"]) {
            return Some(ToolCall {
                tool: "weather_forecast".to_string(),
                arguments: json!({ "location": location }),
            });
        }
    }

    if compact.contains("searchweb") || compact.contains("websearch") {
        if let Some(query) = string_arg(&call.arguments, &["query", "q"]) {
            return Some(ToolCall {
                tool: "web_search".to_string(),
                arguments: json!({ "query": query }),
            });
        }
    }

    None
}

pub(super) fn repair_tool_call_for_capability(
    call: ToolCall,
    route: Option<ToolRoute>,
    latest_user_text: &str,
) -> ToolCall {
    repaired_unknown_tool_call(&call, route, latest_user_text).unwrap_or(call)
}

pub(super) fn repair_tool_call_from_model_text(
    text: &str,
    route: Option<ToolRoute>,
    latest_user_text: &str,
) -> Option<ToolCall> {
    let normalized = normalize_text(text);
    if route == Some(ToolRoute::MediaPreview)
        && contains_any(
            &normalized,
            &[
                "play_music",
                "play music",
                "search_music",
                "search music",
                "open_song",
                "open song",
                "play_song",
                "play song",
                "music",
                "song",
                "audio",
            ],
        )
    {
        return Some(ToolCall {
            tool: "preview_random_media".to_string(),
            arguments: json!({ "kind": "audio", "_user_text": latest_user_text }),
        });
    }
    None
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

pub(super) fn tool_schema() -> Value {
    json!([
        { "type": "function", "function": { "name": "get_current_time", "description": "Returns local date and time", "parameters": { "type": "object", "properties": {}, "required": [] } } },
        { "type": "function", "function": { "name": "list_files_in_directory", "description": "Lists folders/files in a permitted workspace folder", "parameters": { "type": "object", "properties": { "path": { "type": "string", "description": "optional permitted folder path" } }, "required": [] } } },
        { "type": "function", "function": { "name": "search_directory", "description": "Search for matching files in permitted workspace folders", "parameters": { "type": "object", "properties": { "query": { "type": "string", "description": "file name or keyword" } }, "required": ["query"] } } },
        { "type": "function", "function": { "name": "read_file", "description": "Returns text content from a permitted workspace file", "parameters": { "type": "object", "properties": { "path": { "type": "string", "description": "file path or file name" } }, "required": ["path"] } } },
        { "type": "function", "function": { "name": "list_media_files", "description": "Lists previewable media files in workspace", "parameters": { "type": "object", "properties": { "kind": { "type": "string", "description": "audio, video, image, document, text, or any" } }, "required": ["kind"] } } },
        { "type": "function", "function": { "name": "preview_random_media", "description": "Returns one real random previewable workspace file as a chat card. Include query when the user asks for a specific language, topic, artist, filename clue, or media style.", "parameters": { "type": "object", "properties": { "kind": { "type": "string", "description": "audio, video, image, document, text, or any" }, "query": { "type": "string", "description": "optional filename/path keyword constraint, e.g. Thai, jazz, beach, invoice" } }, "required": ["kind"] } } },
        { "type": "function", "function": { "name": "preview_file", "description": "Returns a file preview card inside chat when possible", "parameters": { "type": "object", "properties": { "path": { "type": "string", "description": "file path or file name" } }, "required": ["path"] } } },
        { "type": "function", "function": { "name": "weather_forecast", "description": "Returns a structured weather forecast for a real city using Open-Meteo. Use this for weather, rain, temperature, humidity, wind, and weekend forecast questions instead of generic web search whenever a city is known.", "parameters": { "type": "object", "properties": { "location": { "type": "string", "description": "city or area name, e.g. Ha Noi or Tokyo" }, "days": { "type": "integer", "description": "optional number of forecast days, usually 1 to 10" } }, "required": ["location"] } } },
        { "type": "function", "function": { "name": "web_search", "description": "Returns fresh web search results from DuckDuckGo", "parameters": { "type": "object", "properties": { "query": { "type": "string", "description": "search query" } }, "required": ["query"] } } },
        { "type": "function", "function": { "name": "gmail_recent", "description": "Returns recent Gmail messages", "parameters": { "type": "object", "properties": { "count": { "type": "integer", "description": "optional number requested by user" }, "query": { "type": "string", "description": "optional Gmail search query" } }, "required": [] } } },
        { "type": "function", "function": { "name": "google_calendar_check", "description": "Returns calendar events for that day or month", "parameters": { "type": "object", "properties": { "date": { "type": "string", "description": "today, tomorrow, YYYY-MM-DD, or YYYY-MM" } }, "required": ["date"] } } },
        { "type": "function", "function": { "name": "propose_image_generation", "description": "Returns an image creation approval card; never runs shell. The prompt argument must be English-first, translated from the user's language when needed, while preserving names, places, brands, and quoted visible text. Build a creative, context-aware visual prompt instead of merely copying or translating a short user request. Use image_to_image when editing an attached or earlier chat image. Use avatar_image when the user asks for the current assistant/character to send or make its own image. Use user_avatar_image when the user asks to generate/edit from the selected user profile avatar. Use user_character_image when the user asks for an image involving both the selected user avatar and the selected character avatar.", "parameters": { "type": "object", "properties": { "prompt": { "type": "string", "description": "rich English-first visual prompt for the image model, usually 2 to 4 concise sentences including subject, action, setting, style, composition/framing, lighting, mood, and important constraints" }, "mode": { "type": "string", "description": "text_to_image, image_to_image, avatar_image, user_avatar_image, or user_character_image" }, "mask_prompt": { "type": "string", "description": "for image_to_image only: short English-first visual region/object to edit, such as head, hair, shirt, background, face, hands; omit for whole-image style changes" } }, "required": ["prompt", "mode"] } } },
        { "type": "function", "function": { "name": "propose_write_file", "description": "Returns approval card for writing a file", "parameters": { "type": "object", "properties": { "relative_path": { "type": "string", "description": "path inside workspace" }, "content": { "type": "string", "description": "file content" }, "root_folder": { "type": "string", "description": "optional exact workspace root" } }, "required": ["relative_path", "content"] } } },
        { "type": "function", "function": { "name": "propose_move_file", "description": "Returns approval card for moving/renaming a file", "parameters": { "type": "object", "properties": { "source": { "type": "string", "description": "existing file" }, "destination_relative_path": { "type": "string", "description": "new path inside workspace" }, "root_folder": { "type": "string", "description": "optional exact workspace root" } }, "required": ["source", "destination_relative_path"] } } },
        { "type": "function", "function": { "name": "propose_delete_file", "description": "Returns approval card for moving a file to app trash", "parameters": { "type": "object", "properties": { "source": { "type": "string", "description": "existing file" } }, "required": ["source"] } } },
        { "type": "function", "function": { "name": "run_powershell", "description": "Returns approval card for a local system action", "parameters": { "type": "object", "properties": { "purpose": { "type": "string", "description": "human reason" }, "command": { "type": "string", "description": "PowerShell command" }, "working_directory": { "type": "string", "description": "optional folder" }, "timeout_seconds": { "type": "integer", "description": "timeout in seconds" } }, "required": ["purpose", "command"] } } },
        { "type": "function", "function": { "name": "google_drive_search", "description": "Searches Google Drive files and returns verified Drive results with IDs, mime types, and links. Use this first to locate a Google Doc or Google Sheet when the user gives a title instead of an ID. You can also filter by mime_type and sort recent files.", "parameters": { "type": "object", "properties": { "query": { "type": "string", "description": "optional Drive file name keyword, e.g. budget or meeting notes" }, "mime_type": { "type": "string", "description": "optional Google Drive mime type, e.g. application/vnd.google-apps.spreadsheet" }, "recent": { "type": "boolean", "description": "optional true to sort newest modified files first" }, "page_size": { "type": "integer", "description": "optional number of files to return" } }, "required": [] } } },
        { "type": "function", "function": { "name": "google_docs_read", "description": "Reads a Google Docs document by document_id using the Docs API and returns the raw document JSON. Use when the user asks to read or inspect a specific Google Doc.", "parameters": { "type": "object", "properties": { "document_id": { "type": "string", "description": "Google Docs document ID" } }, "required": ["document_id"] } } },
        { "type": "function", "function": { "name": "google_sheets_read", "description": "Reads a Google Sheets spreadsheet by spreadsheet_id. If range is provided, returns cell values for that range. If range is omitted, returns spreadsheet metadata. Use when the user asks to inspect a specific Google Sheet.", "parameters": { "type": "object", "properties": { "spreadsheet_id": { "type": "string", "description": "Google Sheets spreadsheet ID" }, "range": { "type": "string", "description": "optional A1 range like Sheet1!A1:D20" } }, "required": ["spreadsheet_id"] } } },
        { "type": "function", "function": { "name": "google_contacts_search", "description": "Reads Google Contacts from the user's contact list. If query is provided, searches contacts by name, email, or phone. If query is omitted, returns the first contacts from the list. Use for address book and People API read tasks.", "parameters": { "type": "object", "properties": { "query": { "type": "string", "description": "optional contact name, email, or phone keyword" }, "page_size": { "type": "integer", "description": "optional number of contacts to return, 1 to 50" } }, "required": [] } } },
        { "type": "function", "function": { "name": "google_api_read", "description": "Calls a Google REST API GET URL and returns raw JSON. Use for advanced Google read access when no more specific Google tool fits. Only use official googleapis.com URLs.", "parameters": { "type": "object", "properties": { "url": { "type": "string", "description": "full Google REST API URL, e.g. https://www.googleapis.com/drive/v3/files" } }, "required": ["url"] } } },
        { "type": "function", "function": { "name": "propose_gmail_send", "description": "Returns an approval card to send an email via Gmail on the user's behalf", "parameters": { "type": "object", "properties": { "to": { "type": "string", "description": "recipient email address" }, "subject": { "type": "string", "description": "email subject" }, "body": { "type": "string", "description": "plain text email body" } }, "required": ["to", "subject", "body"] } } },
        { "type": "function", "function": { "name": "propose_gmail_trash", "description": "Returns an approval card to move a Gmail message to Trash. First use gmail_recent to find the message ID.", "parameters": { "type": "object", "properties": { "id": { "type": "string", "description": "Gmail message ID to trash" }, "reason": { "type": "string", "description": "brief reason shown on the approval card" } }, "required": ["id", "reason"] } } },
        { "type": "function", "function": { "name": "propose_calendar_create", "description": "Returns an approval card to create a new Google Calendar event", "parameters": { "type": "object", "properties": { "title": { "type": "string", "description": "event title" }, "start": { "type": "string", "description": "ISO 8601 start time, e.g. 2024-06-01T14:00:00" }, "end": { "type": "string", "description": "ISO 8601 end time" }, "description": { "type": "string", "description": "optional event description" }, "location": { "type": "string", "description": "optional location" } }, "required": ["title", "start", "end"] } } },
        { "type": "function", "function": { "name": "propose_calendar_delete", "description": "Returns an approval card to delete a Google Calendar event. First use google_calendar_check to find the event ID.", "parameters": { "type": "object", "properties": { "id": { "type": "string", "description": "Calendar event ID to delete" }, "title": { "type": "string", "description": "Title of the event being deleted, shown on approval card" } }, "required": ["id", "title"] } } },
        { "type": "function", "function": { "name": "propose_google_contact_delete", "description": "Returns an approval card to delete a Google contact. First use google_contacts_search and use the exact Resource Name field, e.g. people/c123.", "parameters": { "type": "object", "properties": { "resource_name": { "type": "string", "description": "verified People API resource name from google_contacts_search, e.g. people/c123" }, "name": { "type": "string", "description": "contact display name shown on the approval card" } }, "required": ["resource_name"] } } },
        { "type": "function", "function": { "name": "propose_google_action", "description": "Returns an approval card for any Google Workspace write or modify action not covered by other tools, including Docs, Sheets, Drive, Contacts, Chat, or Cloud Storage. Use the exact Google REST API URL and JSON payload. Only use official googleapis.com URLs.", "parameters": { "type": "object", "properties": { "action_summary": { "type": "string", "description": "human-readable explanation of what this will do, shown on the approval card" }, "method": { "type": "string", "description": "HTTP method: POST, PUT, PATCH, or DELETE" }, "url": { "type": "string", "description": "full Google REST API URL" }, "payload": { "type": "string", "description": "optional JSON body as a string" } }, "required": ["action_summary", "method", "url"] } } }
    ])
}

pub(super) fn tool_allowed_for_capability(tool: &str, route: Option<ToolRoute>) -> bool {
    match route {
        Some(ToolRoute::MediaPreview) => {
            matches!(
                tool,
                "preview_random_media" | "preview_file" | "list_media_files"
            )
        }
        Some(ToolRoute::Gmail) => matches!(
            tool,
            "gmail_recent" | "propose_gmail_send" | "propose_gmail_trash"
        ),
        Some(ToolRoute::Calendar) => matches!(
            tool,
            "google_calendar_check" | "propose_calendar_create" | "propose_calendar_delete"
        ),
        Some(ToolRoute::Weather) => tool == "weather_forecast",
        Some(ToolRoute::FileSearch) => matches!(
            tool,
            "list_files_in_directory"
                | "search_directory"
                | "read_file"
                | "preview_file"
                | "list_media_files"
                | "preview_random_media"
                | "propose_write_file"
                | "propose_move_file"
                | "propose_delete_file"
        ),
        Some(ToolRoute::WebSearch) => tool == "web_search",
        Some(ToolRoute::GoogleWorkspace) => matches!(
            tool,
            "google_drive_search"
                | "google_docs_read"
                | "google_sheets_read"
                | "google_contacts_search"
                | "google_api_read"
                | "propose_google_action"
                | "propose_google_contact_delete"
        ),
        None => true,
    }
}

pub(super) fn filtered_tool_schema(route: Option<ToolRoute>) -> Value {
    let tools = tool_schema();
    let Some(array) = tools.as_array() else {
        return tools;
    };
    Value::Array(
        array
            .iter()
            .filter(|tool| {
                tool.get("function")
                    .and_then(|function| function.get("name"))
                    .and_then(Value::as_str)
                    .is_some_and(|name| tool_allowed_for_capability(name, route))
            })
            .cloned()
            .collect(),
    )
}

pub(super) fn tool_names_for_capability(route: Option<ToolRoute>) -> Vec<&'static str> {
    AVAILABLE_TOOL_NAMES
        .iter()
        .copied()
        .filter(|tool| tool_allowed_for_capability(tool, route))
        .collect()
}
