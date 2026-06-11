use super::*;

pub(super) fn content_text(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        if let Ok(parsed) = serde_json::from_str::<Value>(text.trim()) {
            if parsed.is_array() || parsed.is_object() {
                return content_text(&parsed);
            }
        }
        return text.to_string();
    }

    content
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| {
                    if part.get("type").and_then(Value::as_str) == Some("text") {
                        return part.get("text").and_then(Value::as_str).map(str::to_string);
                    }
                    if part.get("type").and_then(Value::as_str) == Some("image_url") {
                        return Some("[image attached]".to_string());
                    }
                    if part.get("type").and_then(Value::as_str) == Some("file_preview") {
                        let preview = part.get("file_preview")?;
                        let name = preview
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("file");
                        let path = preview
                            .get("path")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        let mime = preview
                            .get("mime_type")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        return Some(format!(
                            "[file attached: {}]\nPath: {}\nType: {}",
                            name, path, mime
                        ));
                    }
                    if part.get("type").and_then(Value::as_str) == Some("image_proposal") {
                        let prompt = part
                            .get("image_proposal")
                            .and_then(|proposal| proposal.get("prompt"))
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        return Some(format!("[image request: {}]", prompt));
                    }
                    if part.get("type").and_then(Value::as_str) == Some("action_proposal") {
                        let title = part
                            .get("action_proposal")
                            .and_then(|proposal| proposal.get("title"))
                            .and_then(Value::as_str)
                            .unwrap_or("action request");
                        return Some(format!("[action request: {}]", title));
                    }
                    None
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

pub(super) fn model_image_part_from_image_url(image: &Value) -> Option<Value> {
    let url = image
        .get("url")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let local_path = image
        .get("local_path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let final_url = if !local_path.is_empty() {
        file_tools::read_local_image_data_url(local_path.to_string())
            .ok()
            .map(|image| image.data_url)
    } else if !url.is_empty() {
        Some(url.to_string())
    } else {
        None
    }?;
    if final_url.trim().is_empty() {
        return None;
    }
    Some(json!({
        "type": "image_url",
        "image_url": {
            "url": final_url
        }
    }))
}

pub(super) fn model_image_part_from_file_preview(preview: &Value) -> Option<Value> {
    let mime = preview
        .get("mime_type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !mime.starts_with("image/") {
        return None;
    }
    if let Some(data_url) = preview
        .get("data_url")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        return Some(json!({
            "type": "image_url",
            "image_url": {
                "url": data_url
            }
        }));
    }
    preview
        .get("path")
        .and_then(Value::as_str)
        .and_then(|path| {
            file_tools::read_local_image_data_url(path.to_string())
                .ok()
                .map(|image| {
                    json!({
                        "type": "image_url",
                        "image_url": {
                            "url": image.data_url
                        }
                    })
                })
        })
}

pub(super) fn model_content_parts(content: &Value) -> Option<Value> {
    let parts = content.as_array()?;
    let mut model_parts = Vec::new();
    for part in parts {
        match part.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = part
                    .get("text")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                {
                    model_parts.push(json!({ "type": "text", "text": text }));
                }
            }
            Some("image_url") => {
                if let Some(image_part) = part
                    .get("image_url")
                    .and_then(model_image_part_from_image_url)
                {
                    model_parts.push(image_part);
                }
            }
            Some("file_preview") => {
                if let Some(image_part) = part
                    .get("file_preview")
                    .and_then(model_image_part_from_file_preview)
                {
                    model_parts.push(image_part);
                } else {
                    let text = content_text(&json!([part]));
                    if !text.trim().is_empty() {
                        model_parts.push(json!({ "type": "text", "text": text }));
                    }
                }
            }
            Some("image_proposal") | Some("action_proposal") => {
                let text = content_text(&json!([part]));
                if !text.trim().is_empty() {
                    model_parts.push(json!({ "type": "text", "text": text }));
                }
            }
            _ => {}
        }
    }
    if model_parts.is_empty() {
        None
    } else {
        Some(Value::Array(model_parts))
    }
}

pub(super) fn content_has_image(content: &Value) -> bool {
    if let Some(text) = content.as_str() {
        if let Ok(parsed) = serde_json::from_str::<Value>(text.trim()) {
            if parsed.is_array() || parsed.is_object() {
                return content_has_image(&parsed);
            }
        }
    }
    content.as_array().is_some_and(|parts| {
        parts.iter().any(|part| {
            if part.get("type").and_then(Value::as_str) == Some("image_url") {
                return true;
            }
            if part.get("type").and_then(Value::as_str) == Some("file_preview") {
                return part
                    .get("file_preview")
                    .and_then(|preview| preview.get("mime_type"))
                    .and_then(Value::as_str)
                    .is_some_and(|mime| mime.to_ascii_lowercase().starts_with("image/"));
            }
            false
        })
    })
}

pub(super) fn chat_content_for_model(message: &ReactChatMessage) -> Value {
    let parsed = message
        .content
        .as_str()
        .and_then(|text| serde_json::from_str::<Value>(text.trim()).ok())
        .filter(|value| value.is_array() || value.is_object())
        .unwrap_or_else(|| message.content.clone());

    if message.role == "assistant" && content_has_image(&parsed) {
        return Value::String(content_text(&parsed));
    }

    if let Some(parts) = model_content_parts(&parsed) {
        return parts;
    }

    if parsed.is_array() || parsed.is_object() {
        return Value::String(content_text(&parsed));
    }

    parsed
}

pub(super) fn recent_image_context(messages: &[ReactChatMessage]) -> bool {
    messages
        .iter()
        .rev()
        .take(10)
        .any(|message| content_has_image(&message.content))
}

pub(super) fn context_block_has_chat_image_reference(context_block: &str) -> bool {
    let lowered = context_block.to_ascii_lowercase();
    lowered.contains("recent chat image reference: yes")
        || lowered.contains("chat_image_available=true")
        || lowered.contains("latest prior image path:")
}

pub(super) fn user_wants_vietnamese(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if contains_vietnamese_diacritic(text) {
        return true;
    }
    if contains_any_folded(
        &lowered,
        &normalized,
        &[
            "th\u{1edd}i ti\u{1ebf}t",
            "th\u{01b0} m\u{1ee5}c",
            "s\u{1ef1} ki\u{1ec7}n",
            "h\u{00f4}m nay",
            "ng\u{00e0}y mai",
        ],
    ) {
        return true;
    }
    has_word_folded(
        &lowered,
        &normalized,
        &[
            "t\u{00f4}i",
            "b\u{1ea1}n",
            "anh",
            "em",
            "kh\u{00f4}ng",
            "l\u{1ecb}ch",
            "t\u{1ec7}p",
            "ng\u{00e0}y",
            "th\u{00e1}ng",
            "n\u{0103}m",
            "m\u{1edf}",
            "ph\u{00e1}t",
            "xem",
            "\u{0111}\u{1ecdc}",
            "t\u{00ec}m",
            "ki\u{1ebf}m",
        ],
    )
}

pub(super) fn image_approval_answer(vi: bool) -> String {
    if vi {
        "Em c\u{00f3} th\u{1ec3} t\u{1ea1}o \u{1ea3}nh n\u{00e0}y. Anh duy\u{1ec7}t \u{0111}\u{1ec3} em b\u{1eaf}t \u{0111}\u{1ea7}u nh\u{00e9}.".to_string()
    } else {
        "I can create this image. Approve it when you're ready.".to_string()
    }
}

pub(super) fn action_approval_answer(vi: bool) -> String {
    if vi {
        "Em \u{0111}\u{00e3} chu\u{1ea9}n b\u{1ecb} thao t\u{00e1}c n\u{00e0}y v\u{00e0} c\u{1ea7}n anh duy\u{1ec7}t tr\u{01b0}\u{1edb}c khi th\u{1ef1}c hi\u{1ec7}n.".to_string()
    } else {
        "I prepared an action that needs your approval before anything changes.".to_string()
    }
}

pub(super) fn latest_user_text(messages: &[ReactChatMessage]) -> String {
    messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .map(|message| content_text(&message.content))
        .unwrap_or_default()
}

pub(super) fn call_user_text(call: &ToolCall) -> String {
    call.arguments
        .get("_user_text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub(super) fn random_index(len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    let mut bytes = [0u8; 8];
    if getrandom(&mut bytes).is_ok() {
        return (u64::from_ne_bytes(bytes) as usize) % len;
    }
    let fallback = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos() as usize)
        .unwrap_or_default();
    fallback % len
}

pub(super) fn text_has_thai_script(text: &str) -> bool {
    text.chars()
        .any(|ch| (0x0E00..=0x0E7F).contains(&(ch as u32)))
}

pub(super) fn text_has_cjk_script(text: &str) -> bool {
    text.chars().any(|ch| {
        let code = ch as u32;
        (0x3040..=0x30FF).contains(&code)
            || (0x3400..=0x4DBF).contains(&code)
            || (0x4E00..=0x9FFF).contains(&code)
            || (0xAC00..=0xD7AF).contains(&code)
    })
}

pub(super) fn text_has_vietnamese_diacritic(text: &str) -> bool {
    text.chars().any(|ch| {
        let code = ch as u32;
        matches!(
            code,
            0x0102
                | 0x0103
                | 0x00C2
                | 0x00E2
                | 0x0110
                | 0x0111
                | 0x00CA
                | 0x00EA
                | 0x00D4
                | 0x00F4
                | 0x01A0
                | 0x01A1
                | 0x01AF
                | 0x01B0
        ) || (0x1EA0..=0x1EF9).contains(&code)
    })
}

pub(super) fn media_constraint_terms(user_text: &str, explicit_query: Option<&str>) -> Vec<String> {
    let _ = user_text;
    let mut terms = explicit_query
        .map(str::trim)
        .filter(|query| !query.is_empty())
        .filter(|query| !media_constraint_query_is_generic(query))
        .map(|query| {
            normalize_text(query)
                .split(|ch: char| !ch.is_alphanumeric())
                .filter(|token| !token.is_empty())
                .filter(|token| !media_constraint_query_is_generic(token))
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    terms.sort();
    terms.dedup();
    terms
}

pub(super) fn media_constraint_query_is_generic(query: &str) -> bool {
    let normalized = normalize_text(query);
    let tokens = normalized
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        return true;
    }
    let generic = [
        "a", "an", "any", "audio", "file", "listen", "media", "music", "open", "play", "random",
        "song", "track",
    ];
    tokens.iter().all(|token| generic.contains(token))
}

pub(super) fn media_matches_constraints(
    file: &file_tools::FileSearchResult,
    terms: &[String],
) -> bool {
    if terms.is_empty() {
        return true;
    }
    let haystack = format!("{} {} {}", file.name, file.folder, file.path).to_lowercase();
    terms.iter().any(|term| {
        haystack.contains(term) || (text_has_thai_script(term) && text_has_thai_script(&haystack))
    })
}

pub(super) fn preview_final_answer(
    _preview: &file_tools::FilePreviewResult,
    user_text: &str,
) -> String {
    if user_wants_vietnamese(user_text) {
        return "Em \u{0111}\u{00e3} m\u{1edf} file n\u{00e0}y cho anh.".to_string();
    }
    "Opened this from your workspace.".to_string()
}
pub(super) fn random_media_scan_limit() -> u32 {
    20_000
}

pub(super) fn random_selection_summary(
    total: usize,
    selected: &file_tools::FileSearchResult,
) -> String {
    format!(
        "Randomly selected 1 file from {} matching workspace media files.\nSelected: {}\nPath: {}",
        total, selected.name, selected.path
    )
}

pub(super) fn random_selection_summary_vi(
    total: usize,
    selected: &file_tools::FileSearchResult,
) -> String {
    format!(
        "\u{0110}\u{00e3} ch\u{1ecd}n ng\u{1eab}u nhi\u{00ea}n 1 t\u{1ec7}p t\u{1eeb} {} t\u{1ec7}p media ph\u{00f9} h\u{1ee3}p trong workspace.\nT\u{1ec7}p \u{0111}\u{00e3} ch\u{1ecd}n: {}\n\u{0110}\u{01b0}\u{1edd}ng d\u{1eab}n: {}",
        total, selected.name, selected.path
    )
}
pub(super) fn random_selection_observation(
    total: usize,
    selected: &file_tools::FileSearchResult,
    preview: &file_tools::FilePreviewResult,
    user_text: &str,
) -> String {
    if user_wants_vietnamese(user_text) {
        format!(
            "{}\nLo\u{1ea1}i: {}\nDung l\u{01b0}\u{1ee3}ng: {} bytes",
            random_selection_summary_vi(total, selected),
            preview.mime_type,
            preview.size_bytes
        )
    } else {
        format!(
            "{}\nType: {}\nSize: {} bytes",
            random_selection_summary(total, selected),
            preview.mime_type,
            preview.size_bytes
        )
    }
}
pub(super) fn extract_first_number(text: &str) -> Option<u32> {
    text.split(|ch: char| !ch.is_ascii_digit())
        .find_map(|part| {
            if part.is_empty() {
                None
            } else {
                part.parse::<u32>().ok()
            }
        })
}

pub(super) fn requested_item_count(text: &str, fallback: u32, max: u32) -> u32 {
    extract_first_number(text).unwrap_or(fallback).clamp(1, max)
}

pub(super) fn inferred_media_kind(text: &str) -> Option<&'static str> {
    let normalized = normalize_text(text);

    if contains_any(
        &normalized,
        &["audio", "song", "music", "mp3", "wav", "flac", "m4a"],
    ) {
        return Some("audio");
    }

    if contains_any(
        &normalized,
        &["image", "photo", "picture", "png", "jpg", "jpeg", "webp"],
    ) {
        return Some("image");
    }

    if contains_any(&normalized, &["video", "movie", "mp4", "mkv", "mov", "avi"]) {
        return Some("video");
    }

    if contains_any(
        &normalized,
        &[
            "pdf",
            "document",
            "doc",
            "docx",
            "spreadsheet",
            "sheet",
            "presentation",
            "slides",
            "book",
            "paper",
        ],
    ) {
        return Some("document");
    }

    if contains_any(
        &normalized,
        &["txt", "text", "note", "notes", "md", "markdown"],
    ) {
        return Some("text");
    }

    None
}
pub(super) fn request_wants_preview(text: &str) -> bool {
    let normalized = normalize_text(text);
    contains_any(
        &normalized,
        &[
            "open", "play", "show", "preview", "view", "display", "listen",
        ],
    ) || request_names_specific_file(text)
}

pub(super) fn request_names_specific_file(text: &str) -> bool {
    let normalized = normalize_text(text);
    normalized.split_whitespace().any(|raw| {
        let token = raw.trim_matches(|ch: char| {
            !(ch.is_ascii_alphanumeric()
                || ch == '.'
                || ch == '_'
                || ch == '-'
                || ch == '\\'
                || ch == '/'
                || ch == ':')
        });
        let Some((_, ext)) = token.rsplit_once('.') else {
            return false;
        };
        matches!(
            ext,
            "aac"
                | "csv"
                | "doc"
                | "docx"
                | "flac"
                | "gif"
                | "jpeg"
                | "jpg"
                | "json"
                | "m4a"
                | "md"
                | "mkv"
                | "mov"
                | "mp3"
                | "mp4"
                | "pdf"
                | "png"
                | "rs"
                | "tsx"
                | "txt"
                | "wav"
                | "webm"
                | "webp"
                | "xls"
                | "xlsx"
        )
    })
}
