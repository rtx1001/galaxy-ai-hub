use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, TimeZone};
use getrandom::getrandom;
use serde_json::{json, Value};

use crate::{agent_store, agent_web, file_tools, google_calendar, weather};

mod types;
pub use types::{
    ActionProposal, ImageProposal, ReactChatMessage, ReactChatResult, SamplingConfig,
    ToolResultCard, ToolResultField, ToolResultItem, ToolTrace,
};
use types::{ToolCall, ToolOutcome, ToolRoute};

fn app_root() -> PathBuf {
    crate::app_paths::app_root_dir()
}

fn read_master_system_prompt() -> String {
    let path = app_root().join("config").join("system_prompt.md");
    std::fs::read_to_string(path).unwrap_or_else(|_| {
        "You are Galaxy AI Hub, an Autonomous Operating Agent. Use tools for real data. Keep final answers concise.".to_string()
    })
}

fn tool_protocol_prompt() -> String {
    [
        "Tool protocol:",
        "- Use tools when the user asks for current data, files, media, Google/Gmail/Calendar/Contacts, web lookup, image generation, file changes, or local actions.",
        "- If a tool is needed, emit exactly one structured tool call and stop. Do not describe or narrate the call.",
        "- Preferred format is native OpenAI-compatible tool_calls. If native tool_calls are unavailable, output exactly: <tool_call>{\"name\":\"tool_name\",\"arguments\":{...}}</tool_call>",
        "- Never invent tool results. Final answers must be based only on the returned tool observation.",
        "- Destructive or write actions must use propose_* tools and wait for approval.",
        "- If no tool is needed, answer normally without mentioning tools.",
    ]
    .join("\n")
}

fn normalize_roots(folders: &[String]) -> Vec<PathBuf> {
    folders
        .iter()
        .filter_map(|folder| std::fs::canonicalize(folder).ok())
        .filter(|path| path.is_dir())
        .collect()
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn resolve_directory(input: Option<&str>, folders: &[String]) -> Result<PathBuf, String> {
    let roots = normalize_roots(folders);
    if roots.is_empty() {
        return Err("No workspace folder is permitted.".to_string());
    }

    let Some(raw) = input.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(roots[0].clone());
    };

    let candidate = PathBuf::from(raw.trim_matches('"'));
    let resolved = if candidate.exists() {
        std::fs::canonicalize(candidate)
            .map_err(|e| format!("Could not inspect directory: {}", e))?
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

fn extract_chat_reply_text(body: &Value) -> String {
    body.get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .or_else(|| body.get("content").and_then(Value::as_str))
        .or_else(|| body.get("response").and_then(Value::as_str))
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub async fn generate_plain_text_reply(
    messages: Vec<Value>,
    sampling: SamplingConfig,
    max_tokens: u32,
) -> Result<String, String> {
    let reply = call_chat(messages, None, sampling, max_tokens, false).await?;
    Ok(extract_chat_reply_text(&reply))
}

fn extract_value_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(extract_value_text)
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join(""),
        Value::Object(map) => {
            for key in ["text", "content", "reasoning_content", "reasoning"] {
                if let Some(inner) = map.get(key) {
                    let text = extract_value_text(inner);
                    if !text.trim().is_empty() {
                        return text;
                    }
                }
            }
            String::new()
        }
        other => other.to_string(),
    }
}

fn extract_chat_reasoning_text(body: &Value) -> String {
    body.get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .map(|message| {
            [
                message.get("reasoning_content"),
                message.get("reasoning"),
                body.get("reasoning"),
            ]
            .into_iter()
            .flatten()
            .map(extract_value_text)
            .find(|text| !text.trim().is_empty())
            .unwrap_or_default()
        })
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn append_thinking(accumulated: &mut String, next: &str) {
    let sanitized = sanitize_thinking_for_display(next);
    let trimmed = sanitized.trim();
    if trimmed.is_empty() {
        return;
    }
    let mut existing_blocks = accumulated
        .split("\n\n")
        .map(normalize_thinking_block)
        .filter(|block| !block.is_empty())
        .collect::<Vec<_>>();
    let mut fresh_blocks = Vec::new();
    for block in trimmed.split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        let normalized = normalize_thinking_block(block);
        if normalized.is_empty() || existing_blocks.iter().any(|seen| seen == &normalized) {
            continue;
        }
        existing_blocks.push(normalized);
        fresh_blocks.push(block.to_string());
    }
    if fresh_blocks.is_empty() {
        return;
    }
    if !accumulated.trim().is_empty() {
        accumulated.push_str("\n\n");
    }
    accumulated.push_str(&fresh_blocks.join("\n\n"));
    const MAX_THINKING_CHARS: usize = 4_000;
    if accumulated.len() > MAX_THINKING_CHARS {
        let mut start = accumulated.len().saturating_sub(MAX_THINKING_CHARS);
        while start < accumulated.len() && !accumulated.is_char_boundary(start) {
            start += 1;
        }
        let shortened = accumulated[start..].trim_start().to_string();
        *accumulated = format!("...\n\n{}", shortened);
    }
}

fn normalize_thinking_block(text: &str) -> String {
    normalize_text(text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn sanitize_thinking_for_display(next: &str) -> String {
    let mut kept = Vec::new();
    for line in next.lines() {
        let lowered = line.to_lowercase();
        let compact = lowered.replace(char::is_whitespace, "");
        let is_raw_tool_line = lowered.contains("tool_call")
            || lowered.contains("tool_code")
            || lowered.trim_start().starts_with("call:")
            || AVAILABLE_TOOL_NAMES
                .iter()
                .any(|tool| compact.contains(&format!("{}(", tool.to_lowercase())));
        if !is_raw_tool_line {
            kept.push(line);
        }
    }
    let sanitized = kept.join("\n").trim().to_string();
    if sanitized.is_empty() && parse_inline_tool_markup(next).is_some() {
        "Tool call prepared.".to_string()
    } else {
        sanitized
    }
}

fn thinking_result(thinking_enabled: bool, thinking: &str) -> Option<String> {
    (thinking_enabled && !thinking.trim().is_empty()).then(|| thinking.to_string())
}

fn parse_inline_tool_markup(text: &str) -> Option<(String, Value)> {
    let compact = text.trim();
    let mut candidates = Vec::new();
    if let Some(payload) = extract_tagged_tool_payload(compact) {
        candidates.push(payload);
    }
    candidates.push(compact);

    for payload in candidates {
        if let Some(parsed) = parse_json_tool_payload(payload) {
            return Some(parsed);
        }
        if let Some(parsed) = parse_function_style_tool_call(payload) {
            return Some(parsed);
        }
        if let Some(parsed) = parse_loose_named_tool_call(payload) {
            return Some(parsed);
        }
    }
    None
}

fn canonical_tool_name(raw: &str) -> String {
    let trimmed = raw.trim();
    if known_tool(trimmed) {
        return trimmed.to_string();
    }
    let compact = trimmed
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    AVAILABLE_TOOL_NAMES
        .iter()
        .find(|tool| {
            tool.chars()
                .filter(|ch| ch.is_ascii_alphanumeric())
                .collect::<String>()
                .eq_ignore_ascii_case(&compact)
        })
        .copied()
        .unwrap_or(trimmed)
        .to_string()
}

fn extract_tagged_tool_payload(text: &str) -> Option<&str> {
    for (open, close) in [
        ("<tool_call>", "</tool_call>"),
        ("<toolcall>", "</toolcall>"),
        ("<|tool_call|>", "</|tool_call|>"),
        ("<|tool_call>", "</|tool_call>"),
        ("<|toolcall|>", "</|toolcall|>"),
        ("<|toolcall>", "</|toolcall>"),
        ("<tool_call|>", "<tool_call|"),
        ("<toolcall|>", "<toolcall|"),
        ("<tool_code>", "</tool_code>"),
        ("<tool>", "</tool>"),
    ] {
        if let Some(open_index) = text.find(open) {
            let start = open_index + open.len();
            let end = text[start..]
                .find(close)
                .map(|offset| start + offset)
                .unwrap_or(text.len());
            return Some(text[start..end].trim());
        }
    }
    None
}

fn parse_json_tool_payload(payload: &str) -> Option<(String, Value)> {
    let value = serde_json::from_str::<Value>(payload.trim()).ok()?;
    let name = value
        .get("name")
        .or_else(|| value.get("tool"))
        .and_then(Value::as_str)?
        .trim()
        .to_string();
    if name.is_empty() {
        return None;
    }
    let arguments = value.get("arguments").cloned().unwrap_or_else(|| json!({}));
    if !arguments.is_object() {
        return None;
    }

    Some((canonical_tool_name(&name), arguments))
}

fn parse_function_style_tool_call(text: &str) -> Option<(String, Value)> {
    let mut candidates = AVAILABLE_TOOL_NAMES
        .iter()
        .filter_map(|tool| find_function_call_span(text, tool).map(|span| (*tool, span)))
        .collect::<Vec<_>>();
    candidates.sort_by_key(|(_, (start, _))| *start);
    let (name, (open_index, close_index)) = candidates.first().cloned()?;
    let args = &text[open_index + 1..close_index];
    Some((canonical_tool_name(name), parse_function_arguments(args)))
}

fn parse_loose_named_tool_call(text: &str) -> Option<(String, Value)> {
    let compact_text = text
        .chars()
        .filter(|ch| !ch.is_whitespace() && *ch != '_')
        .collect::<String>()
        .to_ascii_lowercase();
    let mut candidates = AVAILABLE_TOOL_NAMES
        .iter()
        .filter_map(|tool| {
            text.find(tool)
                .map(|start| (*tool, start, tool.len()))
                .or_else(|| {
                    let compact_tool = tool.replace('_', "").to_ascii_lowercase();
                    compact_text
                        .find(&compact_tool)
                        .and_then(|_| text.to_ascii_lowercase().find(&compact_tool))
                        .map(|start| (*tool, start, compact_tool.len()))
                })
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|(_, start, _)| *start);
    let (name, start, matched_len) = candidates.first().cloned()?;
    let after_tool = start + matched_len;
    let mut args = text[after_tool..].trim();
    args = args
        .trim_start_matches(|ch: char| matches!(ch, ':' | '=' | '-' | '>' | '<'))
        .trim();
    if args.starts_with('(') {
        return None;
    }
    if let Some(json_args) = parse_json_object_prefix(args) {
        return Some((name.to_string(), json_args));
    }
    args = args
        .trim_start_matches(|ch: char| matches!(ch, '{' | '['))
        .trim();
    args = args
        .trim_end_matches(|ch: char| matches!(ch, '<' | '>' | '}' | ']' | ';'))
        .trim();
    let arguments = parse_function_arguments(args);
    if arguments
        .as_object()
        .is_some_and(|object| !object.is_empty())
    {
        Some((canonical_tool_name(name), arguments))
    } else {
        None
    }
}

fn parse_json_object_prefix(input: &str) -> Option<Value> {
    let trimmed = input.trim();
    if !trimmed.starts_with('{') {
        return None;
    }
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut depth = 0i32;
    for (index, ch) in trimmed.char_indices() {
        if let Some(q) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == q {
                quote = None;
            }
            continue;
        }
        match ch {
            '"' | '\'' => quote = Some(ch),
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let candidate = &trimmed[..=index];
                    let value = serde_json::from_str::<Value>(candidate).ok()?;
                    return value.is_object().then_some(value);
                }
            }
            _ => {}
        }
    }
    None
}

fn find_function_call_span(text: &str, tool: &str) -> Option<(usize, usize)> {
    let mut search_from = 0;
    while let Some(relative) = text[search_from..].find(tool) {
        let start = search_from + relative;
        let before = text[..start].chars().next_back();
        let after_tool = start + tool.len();
        let after = text[after_tool..].chars().next();
        let boundary_before = before
            .map(|ch| !(ch.is_alphanumeric() || ch == '_'))
            .unwrap_or(true);
        let boundary_after = after
            .map(|ch| !(ch.is_alphanumeric() || ch == '_'))
            .unwrap_or(true);
        if boundary_before && boundary_after {
            let rest = &text[after_tool..];
            let whitespace = rest.len() - rest.trim_start().len();
            let open = after_tool + whitespace;
            if text[open..].starts_with('(') {
                let close = find_matching_paren(text, open)
                    .unwrap_or_else(|| fallback_tool_call_end(text, open + 1));
                return Some((open, close));
            }
        }
        search_from = after_tool;
    }
    None
}

fn fallback_tool_call_end(text: &str, start: usize) -> usize {
    [
        "</tool_call>",
        "<tool_call>",
        "</|tool_call|>",
        "<|tool_call|>",
        "</|tool_call>",
        "<|tool_call>",
        "<tool_call|",
        "</tool_code>",
        "<tool_code>",
        "</tool>",
        "<tool>",
    ]
    .iter()
    .filter_map(|marker| text[start..].find(marker).map(|offset| start + offset))
    .min()
    .unwrap_or(text.len())
}

fn find_matching_paren(text: &str, open_index: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (index, ch) in text
        .char_indices()
        .skip_while(|(index, _)| *index < open_index)
    {
        if let Some(q) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == q {
                quote = None;
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            continue;
        }
        if ch == '(' {
            depth += 1;
        } else if ch == ')' {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

fn parse_function_arguments(args: &str) -> Value {
    let mut map = serde_json::Map::new();
    let comma_parts = split_top_level_commas(args);
    let loose_parts = if comma_parts.len() <= 1 {
        split_loose_key_value_segments(args)
    } else {
        Vec::new()
    };
    let parts = if loose_parts.len() > 1 {
        loose_parts
    } else {
        comma_parts
    };
    for part in parts {
        let Some((key, value)) = split_key_value(part) else {
            continue;
        };
        let key = key.trim().trim_matches(|ch| ch == '"' || ch == '\'');
        if key.is_empty() {
            continue;
        }
        map.insert(key.to_string(), parse_loose_scalar(value.trim()));
    }
    Value::Object(map)
}

fn split_loose_key_value_segments(input: &str) -> Vec<&str> {
    let mut starts = Vec::new();
    let chars = input.char_indices().collect::<Vec<_>>();
    let mut cursor = 0;
    while cursor < chars.len() {
        let (index, ch) = chars[cursor];
        let boundary = index == 0
            || input[..index]
                .chars()
                .next_back()
                .is_some_and(|prev| prev.is_whitespace() || matches!(prev, ',' | '{' | '('));
        if boundary && (ch.is_ascii_alphabetic() || ch == '_') {
            let mut end_cursor = cursor + 1;
            while end_cursor < chars.len()
                && (chars[end_cursor].1.is_ascii_alphanumeric() || chars[end_cursor].1 == '_')
            {
                end_cursor += 1;
            }
            let mut probe = if end_cursor < chars.len() {
                chars[end_cursor].0
            } else {
                input.len()
            };
            while probe < input.len() {
                let Some(next) = input[probe..].chars().next() else {
                    break;
                };
                if next.is_whitespace() {
                    probe += next.len_utf8();
                } else {
                    break;
                }
            }
            if input[probe..].starts_with(':') || input[probe..].starts_with('=') {
                starts.push(index);
            }
            cursor = end_cursor;
            continue;
        }
        cursor += 1;
    }

    starts
        .iter()
        .enumerate()
        .filter_map(|(position, start)| {
            let end = starts.get(position + 1).copied().unwrap_or(input.len());
            let segment = input[*start..end].trim().trim_end_matches(',');
            (!segment.is_empty()).then_some(segment)
        })
        .collect()
}

fn split_top_level_commas(input: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut depth = 0i32;
    for (index, ch) in input.char_indices() {
        if let Some(q) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == q {
                quote = None;
            }
            continue;
        }
        match ch {
            '"' | '\'' => quote = Some(ch),
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth -= 1,
            ',' if depth == 0 => {
                parts.push(input[start..index].trim());
                start = index + ch.len_utf8();
            }
            _ => {}
        }
    }
    if start <= input.len() {
        let tail = input[start..].trim();
        if !tail.is_empty() {
            parts.push(tail);
        }
    }
    parts
}

fn split_key_value(input: &str) -> Option<(&str, &str)> {
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (index, ch) in input.char_indices() {
        if let Some(q) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == q {
                quote = None;
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            continue;
        }
        if ch == '=' || ch == ':' {
            return Some((&input[..index], &input[index + ch.len_utf8()..]));
        }
    }
    None
}

fn parse_loose_scalar(raw: &str) -> Value {
    let mut cleaned = raw
        .trim()
        .trim_matches(|ch: char| matches!(ch, '<' | '>' | '{' | '}' | '`' | ')' | ';'))
        .trim()
        .to_string();
    cleaned = clean_tool_markup_fragments(&cleaned);
    if (cleaned.starts_with('"') && !cleaned.ends_with('"'))
        || (cleaned.starts_with('\'') && !cleaned.ends_with('\''))
    {
        cleaned = cleaned[1..]
            .trim_matches(|ch: char| matches!(ch, '<' | '>' | '{' | '}' | '`' | ')' | ';'))
            .trim()
            .to_string();
        cleaned = clean_tool_markup_fragments(&cleaned);
    }
    let trimmed = cleaned.as_str();
    if let Some(inner) = trimmed
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .or_else(|| {
            trimmed
                .strip_prefix('\'')
                .and_then(|value| value.strip_suffix('\''))
        })
    {
        let cleaned_inner = inner
            .trim_matches(|ch: char| matches!(ch, '<' | '>' | '{' | '}' | '`' | ')' | ';'))
            .trim();
        if cleaned_inner != inner {
            return Value::String(cleaned_inner.replace("\\\"", "\"").replace("\\'", "'"));
        }
    }
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return value;
    }
    if let Some(value) = trimmed
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .or_else(|| {
            trimmed
                .strip_prefix('\'')
                .and_then(|value| value.strip_suffix('\''))
        })
    {
        return Value::String(value.replace("\\\"", "\"").replace("\\'", "'"));
    }
    match trimmed.to_ascii_lowercase().as_str() {
        "true" => Value::Bool(true),
        "false" => Value::Bool(false),
        "null" | "none" => Value::Null,
        _ => trimmed
            .parse::<i64>()
            .map(|value| json!(value))
            .or_else(|_| trimmed.parse::<f64>().map(|value| json!(value)))
            .unwrap_or_else(|_| Value::String(trimmed.to_string())),
    }
}

const AVAILABLE_TOOL_NAMES: &[&str] = &[
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

fn known_tool(tool: &str) -> bool {
    AVAILABLE_TOOL_NAMES.contains(&tool)
}

fn image_prompt_argument(call: &ToolCall) -> String {
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

fn image_prompt_needs_english_rewrite(prompt: &str) -> bool {
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

fn prompt_language_word_counts(prompt: &str) -> (usize, usize) {
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

fn validate_tool_call(call: &ToolCall) -> Result<(), String> {
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

fn with_user_text(mut call: ToolCall, user_text: &str) -> ToolCall {
    let mut object = call.arguments.as_object().cloned().unwrap_or_default();
    object.insert(
        "_user_text".to_string(),
        Value::String(user_text.to_string()),
    );
    call.arguments = Value::Object(object);
    call
}

fn google_api_url_allowed(url: &str) -> bool {
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

fn tool_schema() -> Value {
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

fn clean_summary(text: &str) -> String {
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() > 240 {
        format!("{}...", one_line.chars().take(237).collect::<String>())
    } else {
        one_line
    }
}

fn action_risk(action_type: &str, arguments: &Value) -> String {
    let text = format!("{} {}", action_type, arguments).to_ascii_lowercase();
    if [
        "delete",
        "trash",
        "remove-item",
        "del ",
        "format ",
        "shutdown",
        "restart-computer",
        "reg delete",
        "diskpart",
    ]
    .iter()
    .any(|term| text.contains(term))
    {
        "high".to_string()
    } else if [
        "write",
        "move",
        "rename",
        "copy",
        "start-process",
        "invoke-webrequest",
    ]
    .iter()
    .any(|term| text.contains(term))
    {
        "medium".to_string()
    } else {
        "low".to_string()
    }
}

fn proposed_action(
    action_type: &str,
    title: &str,
    details: String,
    arguments: Value,
) -> ToolOutcome {
    let risk_level = action_risk(action_type, &arguments);
    ToolOutcome {
        observation: format!(
            "Approval required. Proposed action: {}. Risk: {}. Details: {}",
            title, risk_level, details
        ),
        cards: Vec::new(),
        file_preview: None,
        image_proposal: None,
        action_proposal: Some(ActionProposal {
            action_type: action_type.to_string(),
            title: title.to_string(),
            details,
            risk_level,
            arguments,
        }),
        success: true,
    }
}

fn text_outcome(observation: String) -> ToolOutcome {
    ToolOutcome {
        observation,
        cards: Vec::new(),
        file_preview: None,
        image_proposal: None,
        action_proposal: None,
        success: true,
    }
}

fn image_proposal_outcome(proposal: ImageProposal, _vi: bool) -> ToolOutcome {
    ToolOutcome {
        observation: format!(
            "Image generation proposal prepared. Mode: {}. Prompt: {}",
            proposal.mode, proposal.prompt
        ),
        cards: Vec::new(),
        file_preview: None,
        image_proposal: Some(proposal),
        action_proposal: None,
        success: true,
    }
}
fn error_outcome(error: String) -> ToolOutcome {
    ToolOutcome {
        observation: format!("ERROR: {}", error),
        cards: vec![ToolResultCard {
            kind: "error".to_string(),
            title: "Tool error".to_string(),
            summary: Some(error),
            fields: Vec::new(),
            items: Vec::new(),
            text: None,
        }],
        file_preview: None,
        image_proposal: None,
        action_proposal: None,
        success: false,
    }
}

fn log_tool_run(tool: &ToolCall, outcome: &ToolOutcome, duration_ms: i64) {
    let _ = agent_store::record_agent_tool_run(agent_store::AgentToolRun {
        tool_name: tool.tool.clone(),
        input_json: tool.arguments.to_string(),
        output_text: clean_summary(&outcome.observation),
        success: outcome.success,
        duration_ms,
    });
}

fn normalize_text(value: &str) -> String {
    value.to_lowercase()
}

fn contains_any(text: &str, terms: &[&str]) -> bool {
    terms.iter().any(|term| text.contains(term))
}

fn contains_vietnamese_diacritic(text: &str) -> bool {
    text.chars().any(|ch| {
        let code = ch as u32;
        (0x00C0..=0x1EF9).contains(&code)
    })
}

fn has_word_unicode(text: &str, term: &str) -> bool {
    text.split(|ch: char| !ch.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .any(|word| word == term)
}

fn contains_any_folded(text: &str, folded: &str, terms: &[&str]) -> bool {
    terms.iter().any(|term| {
        let lower = term.to_lowercase();
        text.contains(&lower) || folded.contains(&normalize_text(&lower))
    })
}

fn has_word_folded(text: &str, folded: &str, terms: &[&str]) -> bool {
    terms.iter().any(|term| {
        let lower = term.to_lowercase();
        let folded_term = normalize_text(&lower);
        has_word_unicode(text, &lower) || has_word_unicode(folded, &folded_term)
    })
}

fn contains_vietnamese_intent(lowered: &str, exact_terms: &[&str]) -> bool {
    exact_terms.iter().any(|term| lowered.contains(term))
}

fn vietnamese_image_term(text: &str) -> bool {
    contains_any(text, &["ảnh", "hình", "hình ảnh", "tấm ảnh", "bức ảnh"])
}

fn vietnamese_create_image_term(text: &str) -> bool {
    contains_any(
        text,
        &[
            "tạo",
            "vẽ",
            "làm",
            "dựng",
            "render",
            "gửi ảnh",
            "cho xem ảnh",
            "cho anh xem ảnh",
        ],
    )
}

fn vietnamese_audio_term(text: &str) -> bool {
    contains_any(
        text,
        &[
            "nhạc",
            "âm thanh",
            "bài hát",
            "ca khúc",
            "mp3",
            "wav",
            "flac",
            "m4a",
        ],
    )
}

fn vietnamese_preview_action_term(text: &str) -> bool {
    contains_any(text, &["mở", "phát", "bật", "xem"])
        || (has_word_unicode(text, "nghe") && vietnamese_audio_term(text))
        || contains_any(
            text,
            &[
                "nghe nhạc",
                "nghe bài hát",
                "nghe ca khúc",
                "cho nghe nhạc",
                "cho nghe bài",
            ],
        )
}

fn vietnamese_media_followup_term(text: &str) -> bool {
    contains_any(
        text,
        &[
            "khác đi",
            "cái khác",
            "bài khác",
            "ảnh khác",
            "hình khác",
            "tìm cái khác",
            "mở cái khác",
            "mở bài khác",
            "tìm ảnh khác",
            "bài hát tiếng",
            "tiếng thái",
            "thái lan",
            "đâu thấy",
            "không thấy",
            "chưa thấy",
        ],
    )
}

#[cfg(test)]
fn trim_inline_token(token: &str) -> &str {
    token.trim_matches(|ch: char| {
        matches!(
            ch,
            '"' | '\'' | '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>' | ',' | '.' | ';'
        )
    })
}

fn trim_natural_language_token(token: &str) -> &str {
    token.trim_matches(|ch: char| !(ch.is_alphanumeric() || matches!(ch, '-' | '_' | '/' | '.')))
}

fn natural_language_tokens<'a>(text: &'a str) -> Vec<&'a str> {
    text.split_whitespace()
        .map(trim_natural_language_token)
        .filter(|token| !token.is_empty())
        .collect()
}

#[cfg(test)]
fn extract_google_id_from_marker(text: &str, marker: &str) -> Option<String> {
    text.split_whitespace().find_map(|raw| {
        let token = trim_inline_token(raw);
        let index = token.find(marker)?;
        let after = &token[index + marker.len()..];
        let id: String = after
            .chars()
            .take_while(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
            .collect();
        if id.is_empty() {
            None
        } else {
            Some(id)
        }
    })
}

#[cfg(test)]
fn extract_google_doc_id(text: &str) -> Option<String> {
    extract_google_id_from_marker(text, "/document/d/")
}

#[cfg(test)]
fn extract_google_sheet_id(text: &str) -> Option<String> {
    extract_google_id_from_marker(text, "/spreadsheets/d/")
}

#[cfg(test)]
fn infer_google_drive_query(text: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let mut parts = text.split(quote);
        let _ = parts.next();
        if let Some(candidate) = parts
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(candidate.to_string());
        }
    }

    let stop_words = [
        "find",
        "search",
        "locate",
        "open",
        "read",
        "show",
        "inspect",
        "check",
        "list",
        "the",
        "a",
        "an",
        "my",
        "in",
        "on",
        "from",
        "google",
        "drive",
        "docs",
        "doc",
        "document",
        "sheets",
        "sheet",
        "spreadsheet",
        "workspace",
        "please",
        "giúp",
        "tìm",
        "kiếm",
        "mở",
        "đọc",
        "xem",
        "google",
        "drive",
        "tài",
        "liệu",
        "bảng",
        "tính",
        "trang",
        "tiếp",
        "cho",
        "anh",
        "em",
    ];
    let words: Vec<String> = text
        .split_whitespace()
        .map(trim_inline_token)
        .filter(|token| !token.is_empty())
        .filter(|token| {
            let folded = normalize_text(token);
            !stop_words.contains(&folded.as_str())
        })
        .map(|token| token.to_string())
        .collect();
    if words.is_empty() {
        None
    } else {
        Some(words.join(" "))
    }
}

#[cfg(test)]
fn infer_google_contacts_query(text: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let mut parts = text.split(quote);
        let _ = parts.next();
        if let Some(candidate) = parts
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(candidate.to_string());
        }
    }

    let stop_words = [
        "find",
        "search",
        "lookup",
        "look",
        "up",
        "show",
        "list",
        "get",
        "read",
        "check",
        "the",
        "a",
        "an",
        "my",
        "in",
        "from",
        "google",
        "contacts",
        "contact",
        "people",
        "phonebook",
        "address",
        "book",
        "contactlist",
        "contact-list",
        "sổ",
        "danh",
        "bạ",
        "liên",
        "hệ",
        "danhbạ",
        "trong",
        "của",
        "với",
        "về",
        "kiếm",
        "tìm",
        "kiểmtra",
        "danhsách",
        "cho",
        "anh",
        "em",
    ];
    let words: Vec<String> = text
        .split_whitespace()
        .map(trim_inline_token)
        .filter(|token| !token.is_empty())
        .filter(|token| {
            let folded = normalize_text(token);
            !stop_words.contains(&folded.as_str())
        })
        .map(|token| token.to_string())
        .collect();
    if words.is_empty() {
        None
    } else {
        Some(words.join(" "))
    }
}

fn content_text(content: &Value) -> String {
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
                    } else {
                        return None;
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn content_has_image(content: &Value) -> bool {
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

fn chat_content_for_model(message: &ReactChatMessage) -> Value {
    let parsed = message
        .content
        .as_str()
        .and_then(|text| serde_json::from_str::<Value>(text.trim()).ok())
        .filter(|value| value.is_array() || value.is_object())
        .unwrap_or_else(|| message.content.clone());

    if message.role == "assistant" && content_has_image(&parsed) {
        return Value::String(content_text(&parsed));
    }

    parsed
}

fn recent_image_context(messages: &[ReactChatMessage]) -> bool {
    messages
        .iter()
        .rev()
        .take(10)
        .any(|message| content_has_image(&message.content))
}

fn user_wants_vietnamese(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if contains_vietnamese_diacritic(text) {
        return true;
    }
    if contains_any_folded(
        &lowered,
        &normalized,
        &["thời tiết", "thư mục", "sự kiện", "hôm nay", "ngày mai"],
    ) {
        return true;
    }
    has_word_folded(
        &lowered,
        &normalized,
        &[
            "tôi", "bạn", "anh", "em", "không", "lịch", "tệp", "ngày", "tháng", "năm", "mở",
            "phát", "xem", "đọc", "tìm", "kiếm",
        ],
    )
}

fn conversation_wants_vietnamese(messages: &[ReactChatMessage]) -> bool {
    let recent_user_texts = messages
        .iter()
        .rev()
        .filter(|message| message.role == "user")
        .take(6)
        .map(|message| content_text(&message.content))
        .collect::<Vec<_>>();

    recent_user_texts
        .iter()
        .any(|text| user_wants_vietnamese(text))
}

fn image_approval_answer(vi: bool) -> String {
    if vi {
        "Em có thể tạo ảnh này. Anh duyệt để em bắt đầu nhé.".to_string()
    } else {
        "I can create this image. Approve it when you're ready.".to_string()
    }
}

fn action_approval_answer(vi: bool) -> String {
    if vi {
        "Em đã chuẩn bị thao tác này và cần anh duyệt trước khi thực hiện.".to_string()
    } else {
        "I prepared an action that needs your approval before anything changes.".to_string()
    }
}

fn random_index(len: usize) -> usize {
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

fn text_has_thai_script(text: &str) -> bool {
    text.chars()
        .any(|ch| (0x0E00..=0x0E7F).contains(&(ch as u32)))
}

fn text_has_cjk_script(text: &str) -> bool {
    text.chars().any(|ch| {
        let code = ch as u32;
        (0x3040..=0x30FF).contains(&code)
            || (0x3400..=0x4DBF).contains(&code)
            || (0x4E00..=0x9FFF).contains(&code)
            || (0xAC00..=0xD7AF).contains(&code)
    })
}

fn text_has_vietnamese_diacritic(text: &str) -> bool {
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

fn looks_like_latin_english_media_path(text: &str) -> bool {
    let lower = text.to_lowercase();
    !text_has_thai_script(text)
        && !text_has_cjk_script(text)
        && !text_has_vietnamese_diacritic(text)
        && !contains_any(
            &lower,
            &[
                "viet",
                "vietnam",
                "nhac viet",
                "nhạc việt",
                "thai",
                "thais",
                "thailand",
            ],
        )
        && text.chars().any(|ch| ch.is_ascii_alphabetic())
}

fn media_constraint_terms(user_text: &str, explicit_query: Option<&str>) -> Vec<String> {
    let constraint_source = explicit_query
        .map(|query| format!("{} {}", user_text, query))
        .unwrap_or_else(|| user_text.to_string());
    let lowered = constraint_source.to_lowercase();
    let normalized = normalize_text(&constraint_source);
    let mut terms = explicit_query
        .map(str::trim)
        .filter(|query| !query.is_empty())
        .filter(|query| !media_constraint_query_is_generic(query))
        .map(|query| vec![query.to_lowercase()])
        .unwrap_or_default();
    if contains_any(&lowered, &["thái", "thai", "thái lan", "เพลงไทย"])
        || text_has_thai_script(user_text)
    {
        terms.extend(
            ["thai", "thais", "thailand", "เพลง", "ไทย"]
                .iter()
                .map(|term| term.to_string()),
        );
    }
    if contains_any_folded(
        &lowered,
        &normalized,
        &[
            "tiếng việt",
            "tieng viet",
            "việt nam",
            "viet nam",
            "vietnamese",
            "nhạc việt",
            "nhac viet",
        ],
    ) {
        terms.extend(
            [
                "viet",
                "vietnam",
                "vietnamese",
                "việt",
                "việt nam",
                "nhạc việt",
                "nhac viet",
            ]
            .iter()
            .map(|term| term.to_string()),
        );
    }
    if contains_any_folded(
        &lowered,
        &normalized,
        &[
            "tiếng anh",
            "tieng anh",
            "nhạc anh",
            "nhac anh",
            "english",
            "us uk",
            "us-uk",
            "western song",
        ],
    ) {
        terms.extend(
            [
                "english",
                "us-uk",
                "usuk",
                "western",
                "__latin_english_media__",
            ]
            .iter()
            .map(|term| term.to_string()),
        );
    }
    terms.sort();
    terms.dedup();
    terms
}

fn media_constraint_query_is_generic(query: &str) -> bool {
    let normalized = normalize_text(query);
    let tokens = normalized
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        return true;
    }
    let generic = [
        "a", "an", "any", "audio", "bai", "bài", "ca", "cho", "file", "hat", "hát", "listen",
        "media", "mot", "một", "music", "nao", "nào", "nghe", "nhac", "nhạc", "open", "play",
        "random", "song", "track",
    ];
    tokens.iter().all(|token| generic.contains(token))
}

fn media_matches_constraints(file: &file_tools::FileSearchResult, terms: &[String]) -> bool {
    if terms.is_empty() {
        return true;
    }
    let haystack = format!("{} {} {}", file.name, file.folder, file.path).to_lowercase();
    terms.iter().any(|term| {
        (term == "__latin_english_media__" && looks_like_latin_english_media_path(&haystack))
            || haystack.contains(term)
            || (text_has_thai_script(term) && text_has_thai_script(&haystack))
    })
}

fn preview_final_answer(preview: &file_tools::FilePreviewResult, user_text: &str) -> String {
    if user_wants_vietnamese(user_text) {
        return format!("Em đã tìm thấy và mở **{}** cho anh.", preview.name);
    }
    format!("Here is **{}** from your workspace.", preview.name)
}

fn random_media_scan_limit() -> u32 {
    20_000
}

fn random_selection_summary(total: usize, selected: &file_tools::FileSearchResult) -> String {
    format!(
        "Randomly selected 1 file from {} matching workspace media files.\nSelected: {}\nPath: {}",
        total, selected.name, selected.path
    )
}

fn random_selection_summary_vi(total: usize, selected: &file_tools::FileSearchResult) -> String {
    format!(
        "Đã chọn ngẫu nhiên 1 tệp từ {} tệp media phù hợp trong workspace.\nTệp đã chọn: {}\nĐường dẫn: {}",
        total, selected.name, selected.path
    )
}

fn random_selection_observation(
    total: usize,
    selected: &file_tools::FileSearchResult,
    preview: &file_tools::FilePreviewResult,
    user_text: &str,
) -> String {
    if user_wants_vietnamese(user_text) {
        format!(
            "{}\nLoại: {}\nDung lượng: {} bytes",
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

fn latest_user_text(messages: &[ReactChatMessage]) -> String {
    messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .map(|message| content_text(&message.content))
        .unwrap_or_default()
}

fn call_user_text(call: &ToolCall) -> String {
    call.arguments
        .get("_user_text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn extract_first_number(text: &str) -> Option<u32> {
    text.split(|ch: char| !ch.is_ascii_digit())
        .find_map(|part| {
            if part.is_empty() {
                None
            } else {
                part.parse::<u32>().ok()
            }
        })
}

fn requested_item_count(text: &str, fallback: u32, max: u32) -> u32 {
    extract_first_number(text).unwrap_or(fallback).clamp(1, max)
}

fn inferred_media_kind(text: &str) -> Option<&'static str> {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if vietnamese_audio_term(&lowered) {
        return Some("audio");
    }
    if vietnamese_image_term(&lowered) {
        return Some("image");
    }
    if contains_any(&lowered, &["tài liệu", "văn bản"]) {
        return Some("document");
    }
    if contains_any(&lowered, &["ghi chú"]) {
        return Some("text");
    }
    if contains_any(
        &normalized,
        &["audio", "song", "music", "mp3", "wav", "flac", "m4a"],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &["nhạc", "âm thanh", "bài hát", "ca khúc"],
    ) {
        return Some("audio");
    }
    if contains_any(&normalized, &["video", "movie", "mp4", "mkv", "webm"])
        || has_word_folded(&lowered, &normalized, &["phim"])
    {
        return Some("video");
    }
    if contains_any(
        &normalized,
        &["image", "photo", "picture", "png", "jpg", "jpeg", "webp"],
    ) || contains_any_folded(&lowered, &normalized, &["hình ảnh"])
        || has_word_unicode(&lowered, "ảnh")
        || has_word_unicode(&lowered, "hình")
        || contains_any(&lowered, &["mở ảnh", "xem ảnh", "mở hình", "xem hình"])
    {
        return Some("image");
    }
    if contains_any(&normalized, &["pdf", "document", "docx", "book", "paper"])
        || contains_any_folded(&lowered, &normalized, &["tài liệu", "văn bản"])
    {
        return Some("document");
    }
    if contains_any(&normalized, &["text", "txt", "note", "markdown"])
        || contains_any_folded(&lowered, &normalized, &["ghi chú"])
    {
        return Some("text");
    }
    None
}

fn request_wants_preview(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if vietnamese_preview_action_term(&lowered) {
        return true;
    }
    contains_any(
        &normalized,
        &[
            "open", "play", "show", "preview", "view", "display", "listen",
        ],
    ) || has_word_folded(&lowered, &normalized, &["mở", "phát", "bật", "xem"])
        || contains_any_folded(
            &lowered,
            &normalized,
            &[
                "nghe nhạc",
                "nghe bài hát",
                "nghe ca khúc",
                "cho nghe nhạc",
                "cho nghe bài",
            ],
        )
}

fn request_mentions_media(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if vietnamese_media_followup_term(&lowered)
        || contains_any(&lowered, &["tệp", "thư mục", "ngẫu nhiên", "bất kỳ"])
    {
        return true;
    }
    inferred_media_kind(text).is_some()
        || contains_any(
            &normalized,
            &[
                "file",
                "media",
                "workspace",
                "random",
                "any",
                "another",
                "other",
            ],
        )
        || contains_any_folded(
            &lowered,
            &normalized,
            &["tệp", "thư mục", "ngẫu nhiên", "bất kỳ"],
        )
        || has_word_folded(&lowered, &normalized, &["khác"])
}

#[allow(dead_code)]
fn request_wants_another(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if vietnamese_media_followup_term(&lowered) {
        return true;
    }
    contains_any(&normalized, &["another", "other", "different"])
        || contains_any_folded(&lowered, &normalized, &["khác", "bài khác", "ảnh khác"])
}

fn request_is_broad_media_preview(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if vietnamese_media_followup_term(&lowered) || contains_any(&lowered, &["ngẫu nhiên", "bất kỳ"])
    {
        return true;
    }
    inferred_media_kind(text).is_some()
        || contains_any(
            &normalized,
            &[
                "random",
                "any",
                "anything",
                "workspace",
                "media",
                "another",
                "other",
            ],
        )
        || contains_any_folded(&lowered, &normalized, &["ngẫu nhiên", "bất kỳ"])
        || has_word_folded(&lowered, &normalized, &["khác"])
}

fn request_names_specific_file(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if contains_any(
        &normalized,
        &["named", "called", "file named", "file called"],
    ) || contains_any_folded(&lowered, &normalized, &["tên file", "có tên", "đường dẫn"])
    {
        return true;
    }

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
                | "md"
                | "mkv"
                | "mov"
                | "mp3"
                | "mp4"
                | "pdf"
                | "png"
                | "rs"
                | "tsx"
                | "ts"
                | "txt"
                | "wav"
                | "webm"
                | "webp"
                | "xlsx"
        )
    })
}

fn is_confirmation(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    let words = normalized
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    matches!(
        words.as_slice(),
        ["ok"] | ["oke"] | ["yes"] | ["yeah"] | ["yep"]
    ) || has_word_folded(&lowered, &normalized, &["có", "được"])
        || contains_any_folded(&lowered, &normalized, &["làm đi", "mở đi"])
}

fn request_mentions_mail(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(&normalized, &["mailbox", "gmail", "email", "mail"])
        || contains_any_folded(
            &lowered,
            &normalized,
            &["hộp thư", "thư đến", "thư gửi", "email"],
        )
}

fn request_mentions_calendar(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(&normalized, &["calendar", "schedule", "event", "agenda"])
        || contains_any_folded(&lowered, &normalized, &["lịch", "sự kiện"])
}

#[cfg(test)]
fn request_wants_calendar_write(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    request_mentions_calendar(text)
        && (contains_any(
            &normalized,
            &["create", "add", "book", "delete", "remove", "cancel"],
        ) || contains_any_folded(
            &lowered,
            &normalized,
            &["tạo", "thêm", "đặt lịch", "xóa", "hủy"],
        ))
}

#[cfg(test)]
fn request_wants_recent_mail(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    request_mentions_mail(text)
        && (extract_first_number(text).is_some()
            || contains_any(&normalized, &["recent", "latest", "newest", "inbox", "all"])
            || contains_any_folded(
                &lowered,
                &normalized,
                &["gần nhất", "mới nhất", "hộp thư đến", "tất cả"],
            ))
}

#[cfg(test)]
fn request_wants_mail_write(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    request_mentions_mail(text)
        && (contains_any(
            &normalized,
            &["send", "reply", "trash", "delete", "remove", "archive"],
        ) || contains_any_folded(
            &lowered,
            &normalized,
            &["gửi", "trả lời", "xóa", "bỏ", "lưu trữ"],
        ))
}

fn request_has_search_intent(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(
        &normalized,
        &[
            "search", "find", "lookup", "look up", "check", "show", "list",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &["tìm", "kiếm", "tra cứu", "kiểm tra", "cho biết"],
    )
}

fn request_has_action_intent(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(
        &normalized,
        &[
            "search",
            "find",
            "lookup",
            "look up",
            "check",
            "show",
            "list",
            "open",
            "play",
            "preview",
            "read",
            "create",
            "add",
            "delete",
            "remove",
            "send",
            "summarize",
            "summary",
            "forecast",
            "need",
            "want",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "tìm",
            "kiếm",
            "tra cứu",
            "kiểm tra",
            "cho biết",
            "xem",
            "mở",
            "phát",
            "đọc",
            "tạo",
            "thêm",
            "xóa",
            "gửi",
            "tóm tắt",
            "tóm lược",
            "dự báo",
            "cần",
            "muốn",
        ],
    )
}

fn request_has_question_intent(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    text.contains('?')
        || contains_any(
            &normalized,
            &[
                "what",
                "when",
                "where",
                "why",
                "how",
                "which",
                "can you",
                "could you",
                "will it",
                "does it",
                "is it",
            ],
        )
        || contains_any_folded(
            &lowered,
            &normalized,
            &[
                "thế nào",
                "như nào",
                "ra sao",
                "có phải",
                "có không",
                "co ko",
                "không",
                "ko",
                "bao nhiêu",
                "ở đâu",
                "khi nào",
                "vì sao",
                "tại sao",
            ],
        )
}

fn request_mentions_workspace_files(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(
        &normalized,
        &[
            "workspace",
            "folder",
            "file",
            "directory",
            "path",
            "repo",
            "project",
            "code",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "thư mục",
            "tệp",
            "đường dẫn",
            "dự án",
            "mã nguồn",
            "workspace",
        ],
    )
}

fn request_mentions_weather(text: &str) -> bool {
    let lowered = text.to_lowercase();
    contains_any(
        &lowered,
        &[
            "weather",
            "forecast",
            "rain",
            "storm",
            "temperature",
            "humidity",
            "wind",
            "weekend",
            "sunny",
            "cloudy",
        ],
    ) || contains_vietnamese_intent(
        &lowered,
        &[
            "thời tiết",
            "dự báo",
            "mưa",
            "bão",
            "nhiệt độ",
            "độ ẩm",
            "gió",
            "cuối tuần",
            "nắng",
            "mây",
        ],
    )
}

fn request_mentions_web_facts(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(
        &normalized,
        &[
            "web", "website", "internet", "online", "news", "weather", "price", "market", "search",
            "google",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &["thông tin", "tin tức", "thời tiết", "giá", "trên web"],
    )
}

fn request_mentions_google_workspace(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(
        &normalized,
        &[
            "google docs",
            "google doc",
            "docs.google.com",
            "google sheets",
            "google sheet",
            "sheets.google.com",
            "google drive",
            "drive.google.com",
            "spreadsheet",
            "spreadsheets",
            "google workspace",
            "google document",
            "google spreadsheet",
            "google contacts",
            "google contact",
            "contact list",
            "contacts list",
            "address book",
            "phonebook",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "tài liệu google",
            "google drive",
            "google docs",
            "google sheets",
            "bảng tính google",
            "trang tính google",
            "tệp drive",
            "danh bạ",
            "liên hệ",
            "sổ liên lạc",
        ],
    )
}

fn request_wants_file_search(text: &str) -> bool {
    request_mentions_workspace_files(text) && request_has_search_intent(text)
}

fn request_wants_weather(text: &str) -> bool {
    if !request_mentions_weather(text) {
        return false;
    }
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    request_has_action_intent(text)
        || request_has_question_intent(text)
        || contains_any(&normalized, &["forecast"])
        || contains_any_folded(&lowered, &normalized, &["dự báo", "thời tiết thế nào"])
}

fn request_is_casual_weather_observation(text: &str) -> bool {
    request_mentions_weather(text) && !request_wants_weather(text)
}

fn request_wants_web_search(text: &str) -> bool {
    request_mentions_web_facts(text)
        && (request_has_search_intent(text) || request_has_question_intent(text))
}

fn request_wants_google_workspace(text: &str) -> bool {
    request_mentions_google_workspace(text)
}

fn request_is_conversational_turn(text: &str) -> bool {
    if request_is_casual_weather_observation(text) {
        return true;
    }
    if route_for_request(text).is_some() {
        return false;
    }

    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    let words = normalized
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    if words.is_empty() {
        return false;
    }

    if contains_any(
        &normalized,
        &[
            "how are you",
            "are you happy",
            "are you sad",
            "do you like",
            "do you miss",
            "what do you think of me",
            "do you love",
        ],
    ) {
        return true;
    }

    if contains_any_folded(
        &lowered,
        &normalized,
        &[
            "có vui",
            "có buồn",
            "có nhớ",
            "có thích",
            "có ghét",
            "gặp anh",
            "gặp em",
            "cảm thấy",
            "nghĩ sao",
            "chán chết",
            "buồn quá",
            "vui không",
        ],
    ) {
        return true;
    }

    words.len() <= 8
        && words.iter().any(|word| {
            matches!(
                *word,
                "anh"
                    | "em"
                    | "tôi"
                    | "bạn"
                    | "mình"
                    | "tao"
                    | "cậu"
                    | "vui"
                    | "buồn"
                    | "nhớ"
                    | "thich"
                    | "ghet"
                    | "yêu"
                    | "chán"
            )
        })
        && !request_has_search_intent(text)
}

fn route_for_request(text: &str) -> Option<ToolRoute> {
    if request_wants_image_generation(text)
        || broad_image_generation_signal(text)
        || request_wants_avatar_image_generation(text)
        || request_wants_user_avatar_image_generation(text)
        || request_targets_user_and_character_images(text)
    {
        return None;
    }
    if request_wants_preview(text) && request_mentions_media(text) {
        return Some(ToolRoute::MediaPreview);
    }
    if request_mentions_mail(text) {
        return Some(ToolRoute::Gmail);
    }
    if request_wants_weather(text) {
        return Some(ToolRoute::Weather);
    }
    if request_mentions_calendar(text) {
        return Some(ToolRoute::Calendar);
    }
    if request_wants_google_workspace(text) {
        return Some(ToolRoute::GoogleWorkspace);
    }
    if request_wants_file_search(text) {
        return Some(ToolRoute::FileSearch);
    }
    if request_wants_web_search(text) {
        return Some(ToolRoute::WebSearch);
    }
    None
}

fn previous_explicit_route(messages: &[ReactChatMessage]) -> Option<ToolRoute> {
    let latest_index = messages.iter().rposition(|message| message.role == "user");
    messages
        .iter()
        .enumerate()
        .rev()
        .filter(|(index, message)| message.role == "user" && Some(*index) != latest_index)
        .next()
        .and_then(|(_, message)| route_for_request(&content_text(&message.content)))
}

fn request_adds_context_details(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    let words = normalized
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if words.is_empty() {
        return false;
    }

    let starts_with_context_marker = words
        .first()
        .map(|word| matches!(*word, "ở" | "tại" | "in" | "for" | "at" | "vào" | "lúc"))
        .unwrap_or(false);
    if starts_with_context_marker {
        return true;
    }

    contains_any(
        &normalized,
        &["today", "tomorrow", "weekend", "this week", "this month"],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "hôm nay",
            "ngày mai",
            "cuối tuần",
            "tuần này",
            "tháng này",
            "năm nay",
        ],
    )
}

fn weather_location_stop_words() -> &'static [&'static str] {
    &[
        "anh",
        "em",
        "cho",
        "ngoài",
        "đó",
        "đây",
        "biết",
        "xem",
        "giúp",
        "với",
        "nhé",
        "nha",
        "được",
        "thời",
        "tiết",
        "dự",
        "báo",
        "mưa",
        "gió",
        "độ",
        "ẩm",
        "nhiệt",
        "ngày",
        "nay",
        "mai",
        "hôm",
        "qua",
        "cuối",
        "tuần",
        "có",
        "không",
        "ko",
        "sau",
        "trước",
        "khi",
        "lúc",
        "tiếp",
        "thế",
        "như",
        "nào",
        "nao",
        "ra",
        "sao",
        "trời",
        "xám",
        "xì",
        "nhiều",
        "it",
        "sẽ",
        "rồi",
        "what",
        "weather",
        "forecast",
        "rain",
        "wind",
        "humidity",
        "temperature",
        "today",
        "tomorrow",
        "this",
        "weekend",
        "week",
        "city",
        "area",
        "need",
        "want",
        "info",
        "thông",
        "tin",
        "cụ",
    ]
}

fn looks_like_bare_weather_location(text: &str) -> bool {
    let tokens = natural_language_tokens(text);
    if tokens.is_empty() || tokens.len() > 4 {
        return false;
    }

    let folded_tokens = tokens
        .iter()
        .map(|token| normalize_text(token))
        .collect::<Vec<_>>();
    let stop_words = weather_location_stop_words();
    let meaningful = tokens
        .iter()
        .zip(folded_tokens.iter())
        .filter(|(_, folded)| !stop_words.contains(&folded.as_str()))
        .collect::<Vec<_>>();
    if meaningful.is_empty() || meaningful.len() > 3 {
        return false;
    }

    let folded = meaningful
        .iter()
        .map(|(_, folded)| folded.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    if contains_any(
        &folded,
        &[
            "hà nội",
            "hanoi",
            "đà nẵng",
            "ho chi minh",
            "hcm",
            "sài gòn",
            "saigon",
            "huế",
            "nha trang",
            "đà lạt",
            "cần thơ",
            "hải phòng",
            "paris",
            "tokyo",
            "seoul",
            "london",
            "new york",
        ],
    ) {
        return true;
    }

    meaningful.iter().any(|(original, _)| {
        original
            .chars()
            .next()
            .map(|ch| ch.is_uppercase())
            .unwrap_or(false)
    })
}

fn is_contextual_follow_up(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    let words = normalized
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if words.is_empty() {
        return false;
    }
    if is_confirmation(text) {
        return true;
    }
    if words.len() <= 5 && !request_wants_preview(text) && request_adds_context_details(text) {
        return true;
    }
    contains_any(
        &normalized,
        &[
            "result",
            "results",
            "summary",
            "summarize",
            "dont send link",
            "don't send link",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "kết quả",
            "tóm lược",
            "tóm tắt",
            "đừng gửi link",
            "không gửi link",
            "xem rồi",
        ],
    )
}

fn request_wants_explanation_only(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(
        &normalized,
        &[
            "explain",
            "clarify",
            "what do you mean",
            "meaning",
            "why",
            "how so",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "giải thích",
            "nghĩa là sao",
            "ý là gì",
            "tại sao",
            "vì sao",
            "thế là sao",
            "sao vậy",
            "dễ hiểu",
        ],
    )
}

fn contextual_route_for_messages(messages: &[ReactChatMessage]) -> Option<ToolRoute> {
    let latest_text = latest_user_text(messages);
    route_for_request(&latest_text).or_else(|| {
        let previous = previous_explicit_route(messages);
        if previous == Some(ToolRoute::MediaPreview)
            && (vietnamese_media_followup_term(&latest_text.to_lowercase())
                || request_wants_another(&latest_text))
        {
            return previous;
        }
        if is_contextual_follow_up(&latest_text)
            || (previous == Some(ToolRoute::Weather)
                && looks_like_bare_weather_location(&latest_text))
        {
            previous
        } else {
            None
        }
    })
}

#[cfg(test)]
fn latest_explicit_route_text(messages: &[ReactChatMessage], route: ToolRoute) -> Option<String> {
    let latest_index = messages.iter().rposition(|message| message.role == "user");
    messages
        .iter()
        .enumerate()
        .rev()
        .filter(|(index, message)| message.role == "user" && Some(*index) != latest_index)
        .find_map(|(_, message)| {
            let text = content_text(&message.content);
            if route_for_request(&text) == Some(route) {
                Some(text)
            } else {
                None
            }
        })
}

fn recent_media_kind(messages: &[ReactChatMessage]) -> Option<&'static str> {
    messages
        .iter()
        .rev()
        .skip(1)
        .take(8)
        .find_map(|message| inferred_media_kind(&content_text(&message.content)))
}

fn recent_context_wants_media_preview(messages: &[ReactChatMessage]) -> bool {
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

fn extract_path_from_line(line: &str) -> Option<String> {
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

fn recent_preview_paths(messages: &[ReactChatMessage]) -> Vec<String> {
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

fn random_media_preview_allowed(text: &str, allow_follow_up: bool) -> bool {
    if request_wants_avatar_image_generation(text) {
        return false;
    }
    (request_wants_preview(text)
        && request_mentions_media(text)
        && request_is_broad_media_preview(text)
        && !request_names_specific_file(text))
        || allow_follow_up
}

#[cfg(test)]
fn deterministic_preview_call(messages: &[ReactChatMessage]) -> Option<ToolCall> {
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

fn enrich_contextual_tool_call(
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

#[cfg(test)]
fn weather_context_text(messages: &[ReactChatMessage]) -> Option<String> {
    let latest_text = latest_user_text(messages);
    if route_for_request(&latest_text) == Some(ToolRoute::Weather) {
        if let Some(previous) = latest_explicit_route_text(messages, ToolRoute::Weather) {
            if is_contextual_follow_up(&latest_text)
                || weather_location_from_text(&latest_text).is_none()
            {
                return Some(
                    format!("{} {}", previous.trim(), latest_text.trim())
                        .trim()
                        .to_string(),
                );
            }
        }
        return Some(latest_text);
    }
    latest_explicit_route_text(messages, ToolRoute::Weather).map(|previous| {
        format!("{} {}", previous.trim(), latest_text.trim())
            .trim()
            .to_string()
    })
}

#[cfg(test)]
fn weather_location_from_text(text: &str) -> Option<String> {
    let original_tokens = natural_language_tokens(text);
    if original_tokens.is_empty() {
        return None;
    }

    let folded_tokens = original_tokens
        .iter()
        .map(|token| normalize_text(token))
        .collect::<Vec<_>>();

    let marker_words = ["ở", "tại", "in", "for", "at"];
    let stop_words = weather_location_stop_words();

    for marker in marker_words {
        if let Some(index) = folded_tokens.iter().position(|token| token == marker) {
            let value = original_tokens
                .iter()
                .zip(folded_tokens.iter())
                .skip(index + 1)
                .take_while(|(_, folded)| !stop_words.contains(&folded.as_str()))
                .map(|(original, _)| (*original).to_string())
                .collect::<Vec<_>>()
                .join(" ");
            if !value.trim().is_empty() {
                return Some(value.trim().to_string());
            }
        }
    }

    if request_wants_weather(text) {
        let value = original_tokens
            .iter()
            .zip(folded_tokens.iter())
            .filter(|(_, folded)| !stop_words.contains(&folded.as_str()))
            .take(5)
            .map(|(original, _)| (*original).to_string())
            .collect::<Vec<_>>()
            .join(" ");

        return if value.trim().is_empty() {
            None
        } else {
            Some(value.trim().to_string())
        };
    }

    if !looks_like_bare_weather_location(text) {
        return None;
    }

    let value = original_tokens
        .iter()
        .zip(folded_tokens.iter())
        .filter(|(_, folded)| !stop_words.contains(&folded.as_str()))
        .take(4)
        .map(|(original, _)| (*original).to_string())
        .collect::<Vec<_>>()
        .join(" ");

    if value.trim().is_empty() {
        None
    } else {
        Some(value.trim().to_string())
    }
}

#[cfg(test)]
fn infer_weather_days(text: &str) -> u32 {
    let normalized = normalize_text(text);
    if contains_any(&normalized, &["weekend"])
        || contains_any_folded(&text.to_lowercase(), &normalized, &["cuối tuần"])
    {
        return 4;
    }
    if contains_any(&normalized, &["today", "tomorrow"])
        || contains_any_folded(&text.to_lowercase(), &normalized, &["hôm nay", "ngày mai"])
    {
        return 2;
    }
    requested_item_count(text, 7, 10)
}

#[cfg(test)]
fn deterministic_weather_call(messages: &[ReactChatMessage]) -> Option<ToolCall> {
    if contextual_route_for_messages(messages) != Some(ToolRoute::Weather) {
        return None;
    }

    let latest_text = latest_user_text(messages);
    let context_text = weather_context_text(messages).unwrap_or_else(|| latest_text.clone());
    let location = weather_location_from_text(&latest_text)
        .or_else(|| {
            latest_explicit_route_text(messages, ToolRoute::Weather)
                .and_then(|text| weather_location_from_text(&text))
        })
        .or_else(|| weather_location_from_text(&context_text))?;
    let days = infer_weather_days(&context_text);

    Some(with_user_text(
        ToolCall {
            tool: "weather_forecast".to_string(),
            arguments: json!({
                "location": location,
                "days": days
            }),
        },
        &context_text,
    ))
}

#[cfg(test)]
fn weather_missing_location_reply(messages: &[ReactChatMessage]) -> Option<String> {
    if contextual_route_for_messages(messages) != Some(ToolRoute::Weather) {
        return None;
    }

    let latest_text = latest_user_text(messages);
    let context_text = weather_context_text(messages).unwrap_or_else(|| latest_text.clone());
    if weather_location_from_text(&latest_text).is_some()
        || latest_explicit_route_text(messages, ToolRoute::Weather)
            .and_then(|text| weather_location_from_text(&text))
            .is_some()
        || weather_location_from_text(&context_text).is_some()
    {
        return None;
    }

    Some(if user_wants_vietnamese(&latest_text) {
        "Anh muốn xem thời tiết ở khu vực nào? Em cần tên thành phố hoặc khu vực cụ thể, ví dụ Hà Nội hoặc Đà Nẵng.".to_string()
    } else {
        "Which city or area do you want the weather for? I need a specific location, for example Hanoi or Da Nang.".to_string()
    })
}

#[cfg(test)]
fn deterministic_gmail_call(messages: &[ReactChatMessage]) -> Option<ToolCall> {
    let latest_text = latest_user_text(messages);
    if contextual_route_for_messages(messages) != Some(ToolRoute::Gmail) {
        return None;
    }
    if request_wants_mail_write(&latest_text) || !request_wants_recent_mail(&latest_text) {
        return None;
    }

    let count = requested_item_count(&latest_text, 10, 25);
    Some(with_user_text(
        ToolCall {
            tool: "gmail_recent".to_string(),
            arguments: json!({ "count": count }),
        },
        &latest_text,
    ))
}

#[cfg(test)]
fn deterministic_calendar_call(messages: &[ReactChatMessage]) -> Option<ToolCall> {
    let latest_text = latest_user_text(messages);
    if contextual_route_for_messages(messages) != Some(ToolRoute::Calendar) {
        return None;
    }
    if request_wants_calendar_write(&latest_text) {
        return None;
    }

    let date = infer_calendar_date(&latest_text).unwrap_or_else(|| {
        if contains_any(
            &normalize_text(&latest_text),
            &["calendar", "schedule", "agenda"],
        ) {
            "today".to_string()
        } else {
            Local::now().date_naive().format("%Y-%m-%d").to_string()
        }
    });

    Some(with_user_text(
        ToolCall {
            tool: "google_calendar_check".to_string(),
            arguments: json!({ "date": date }),
        },
        &latest_text,
    ))
}

#[cfg(test)]
fn deterministic_web_search_call(messages: &[ReactChatMessage]) -> Option<ToolCall> {
    let latest_text = latest_user_text(messages);
    if contextual_route_for_messages(messages) != Some(ToolRoute::WebSearch) {
        return None;
    }

    let query = if route_for_request(&latest_text) == Some(ToolRoute::WebSearch) {
        latest_text.trim().to_string()
    } else if is_confirmation(&latest_text) {
        latest_explicit_route_text(messages, ToolRoute::WebSearch)?
    } else if let Some(previous) = latest_explicit_route_text(messages, ToolRoute::WebSearch) {
        format!("{} {}", previous.trim(), latest_text.trim())
            .trim()
            .to_string()
    } else {
        latest_text.trim().to_string()
    };

    Some(with_user_text(
        ToolCall {
            tool: "web_search".to_string(),
            arguments: json!({ "query": query }),
        },
        &latest_text,
    ))
}

#[cfg(test)]
fn extract_people_resource_name(text: &str) -> Option<String> {
    text.split(|ch: char| {
        ch.is_whitespace()
            || matches!(
                ch,
                '`' | '"' | '\'' | ',' | ')' | '(' | '[' | ']' | '{' | '}' | '<' | '>'
            )
    })
    .map(|part| part.trim_matches(|ch: char| matches!(ch, '.' | ':' | ';' | '!' | '?')))
    .find(|part| part.starts_with("people/") && part.len() > "people/".len())
    .map(str::to_string)
}

#[cfg(test)]
fn text_mentions_contact_delete(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    (contains_any(&lowered, &["delete", "remove", "trash", "xóa", "xoá"])
        || contains_any_folded(&lowered, &normalized, &["xoa"]))
        && (contains_any(&lowered, &["contact", "contacts", "people", "danh bạ"])
            || contains_any_folded(&lowered, &normalized, &["danh ba"]))
}

#[cfg(test)]
fn deterministic_google_contact_delete_call(messages: &[ReactChatMessage]) -> Option<ToolCall> {
    let latest_text = latest_user_text(messages);
    let latest_mentions_delete = text_mentions_contact_delete(&latest_text);
    if !latest_mentions_delete && !is_confirmation(&latest_text) {
        return None;
    }

    if latest_mentions_delete {
        if let Some(resource_name) = extract_people_resource_name(&latest_text) {
            return Some(with_user_text(
                ToolCall {
                    tool: "propose_google_contact_delete".to_string(),
                    arguments: json!({ "resource_name": resource_name }),
                },
                &latest_text,
            ));
        }
    }

    for message in messages.iter().rev().skip(1).take(8) {
        let text = content_text(&message.content);
        if !text_mentions_contact_delete(&text) && !text.to_lowercase().contains("contact") {
            continue;
        }
        if let Some(resource_name) = extract_people_resource_name(&text) {
            return Some(with_user_text(
                ToolCall {
                    tool: "propose_google_contact_delete".to_string(),
                    arguments: json!({ "resource_name": resource_name }),
                },
                &latest_text,
            ));
        }
    }

    None
}

#[cfg(test)]
fn deterministic_google_workspace_call(messages: &[ReactChatMessage]) -> Option<ToolCall> {
    let latest_text = latest_user_text(messages);
    if contextual_route_for_messages(messages) != Some(ToolRoute::GoogleWorkspace) {
        return None;
    }

    let normalized = normalize_text(&latest_text);
    let wants_recent = contains_any(&normalized, &["recent", "latest", "newest"])
        || contains_any_folded(
            &latest_text.to_lowercase(),
            &normalized,
            &["gan nhat", "moi nhat"],
        );
    let wants_sheet = contains_any(
        &normalized,
        &[
            "sheet",
            "sheets",
            "spreadsheet",
            "google sheet",
            "google sheets",
        ],
    ) || contains_any_folded(
        &latest_text.to_lowercase(),
        &normalized,
        &["bang tinh", "trang tinh", "google sheet"],
    );
    let wants_doc = contains_any(
        &normalized,
        &["doc", "docs", "document", "google doc", "google docs"],
    ) || contains_any_folded(
        &latest_text.to_lowercase(),
        &normalized,
        &["tai lieu google", "google doc"],
    );
    if contains_any(
        &normalized,
        &["contact", "contacts", "people", "address book", "phonebook"],
    ) || contains_any_folded(
        &latest_text.to_lowercase(),
        &normalized,
        &["danh ba", "lien he"],
    ) {
        let query = infer_google_contacts_query(&latest_text);
        let page_size = if query.is_some() { 10 } else { 20 };
        return Some(with_user_text(
            ToolCall {
                tool: "google_contacts_search".to_string(),
                arguments: if let Some(query) = query {
                    json!({ "query": query, "page_size": page_size })
                } else {
                    json!({ "page_size": page_size })
                },
            },
            &latest_text,
        ));
    }

    if wants_recent && (wants_sheet || wants_doc) {
        let mime_type = if wants_sheet {
            "application/vnd.google-apps.spreadsheet"
        } else {
            "application/vnd.google-apps.document"
        };
        return Some(with_user_text(
            ToolCall {
                tool: "google_drive_search".to_string(),
                arguments: json!({
                    "mime_type": mime_type,
                    "recent": true,
                    "page_size": 10
                }),
            },
            &latest_text,
        ));
    }

    if let Some(document_id) = extract_google_doc_id(&latest_text) {
        return Some(with_user_text(
            ToolCall {
                tool: "google_docs_read".to_string(),
                arguments: json!({ "document_id": document_id }),
            },
            &latest_text,
        ));
    }

    if let Some(spreadsheet_id) = extract_google_sheet_id(&latest_text) {
        return Some(with_user_text(
            ToolCall {
                tool: "google_sheets_read".to_string(),
                arguments: json!({ "spreadsheet_id": spreadsheet_id }),
            },
            &latest_text,
        ));
    }

    if (request_has_search_intent(&latest_text)
        || contains_any(
            &normalized,
            &[
                "open",
                "read",
                "show",
                "inspect",
                "doc",
                "sheet",
                "document",
                "spreadsheet",
            ],
        ))
        && infer_google_drive_query(&latest_text).is_some()
    {
        return Some(with_user_text(
            ToolCall {
                tool: "google_drive_search".to_string(),
                arguments: json!({ "query": infer_google_drive_query(&latest_text).unwrap_or_default() }),
            },
            &latest_text,
        ));
    }

    None
}

fn is_gmail_tool(tool: &str) -> bool {
    tool == "gmail_recent" || tool.starts_with("gmail_") || tool.starts_with("propose_gmail_")
}

fn is_calendar_tool(tool: &str) -> bool {
    tool == "google_calendar_check" || tool.contains("calendar")
}

fn is_google_workspace_tool(tool: &str) -> bool {
    tool.starts_with("google_") || tool.starts_with("propose_google_")
}

fn is_workspace_file_tool(tool: &str) -> bool {
    matches!(
        tool,
        "list_files_in_directory" | "search_directory" | "read_file" | "preview_file"
    ) || tool.contains("file")
        || tool.contains("directory")
}

fn is_web_tool(tool: &str) -> bool {
    tool == "web_search" || tool.starts_with("web_")
}

fn is_media_preview_tool(tool: &str) -> bool {
    matches!(
        tool,
        "preview_random_media" | "preview_file" | "list_media_files"
    ) || tool.contains("media")
        || tool.starts_with("preview_")
}

fn tool_allowed_for_route_kind(call: &ToolCall, route: Option<ToolRoute>) -> Result<(), String> {
    match route {
        Some(ToolRoute::Gmail) => {
            if is_gmail_tool(&call.tool) {
                Ok(())
            } else {
                Err(format!(
                    "{} is not relevant to a mail request. Use Gmail tools for mailbox tasks.",
                    call.tool
                ))
            }
        }
        Some(ToolRoute::Calendar) => {
            if is_calendar_tool(&call.tool) {
                Ok(())
            } else {
                Err(format!(
                    "{} is not relevant to a calendar request. Use calendar tools for schedule tasks.",
                    call.tool
                ))
            }
        }
        Some(ToolRoute::Weather) => {
            if call.tool == "weather_forecast" {
                Ok(())
            } else {
                Err(format!(
                    "{} is not relevant to a weather request. Use weather_forecast for forecast and rain questions.",
                    call.tool
                ))
            }
        }
        Some(ToolRoute::GoogleWorkspace) => {
            if is_google_workspace_tool(&call.tool) {
                Ok(())
            } else {
                Err(format!(
                    "{} is not relevant to a Google Workspace request. Use Drive, Docs, Sheets, or Google Workspace tools.",
                    call.tool
                ))
            }
        }
        Some(ToolRoute::FileSearch) => {
            if is_workspace_file_tool(&call.tool) {
                Ok(())
            } else {
                Err(format!(
                    "{} is not relevant to a workspace file search request. Use file tools for workspace searches.",
                    call.tool
                ))
            }
        }
        Some(ToolRoute::WebSearch) => {
            if is_web_tool(&call.tool) {
                Ok(())
            } else {
                Err(format!(
                    "{} is not relevant to a web search request. Use web_search for external information lookups.",
                    call.tool
                ))
            }
        }
        Some(ToolRoute::MediaPreview) => {
            if is_media_preview_tool(&call.tool) {
                Ok(())
            } else {
                Err(format!(
                    "{} is not relevant to a media preview request.",
                    call.tool
                ))
            }
        }
        None => {
            if is_gmail_tool(&call.tool)
                || is_calendar_tool(&call.tool)
                || call.tool == "weather_forecast"
                || is_google_workspace_tool(&call.tool)
                || is_workspace_file_tool(&call.tool)
                || is_web_tool(&call.tool)
                || is_media_preview_tool(&call.tool)
            {
                Err(format!(
                    "{} is not relevant to this request. No matching tool route was detected.",
                    call.tool
                ))
            } else {
                Ok(())
            }
        }
    }
}

#[cfg(test)]
fn tool_allowed_for_route(call: &ToolCall, user_text: &str) -> Result<(), String> {
    tool_allowed_for_route_kind(call, route_for_request(user_text))
}

fn tool_allowed_for_context(call: &ToolCall, messages: &[ReactChatMessage]) -> Result<(), String> {
    let latest_text = latest_user_text(messages);
    if request_wants_avatar_image_generation(&latest_text)
        && matches!(
            call.tool.as_str(),
            "preview_random_media" | "preview_file" | "list_media_files"
        )
    {
        return Err(format!(
            "{} is not relevant here. The user is asking for the current assistant's own image, so use propose_image_generation with mode avatar_image.",
            call.tool
        ));
    }
    if request_wants_explanation_only(&latest_text) {
        return Err(format!(
            "{} is not relevant here. The user is asking for an explanation of the current conversation, not a new lookup.",
            call.tool
        ));
    }
    if call.tool == "propose_image_generation"
        && recent_image_context(messages)
        && request_looks_like_image_edit_follow_up(&latest_text)
    {
        return Ok(());
    }
    if call.tool == "propose_image_generation" {
        return Ok(());
    }
    if request_is_conversational_turn(&latest_text) {
        return Err(format!(
            "{} is not relevant here. The user is making normal conversation, so answer directly without tools.",
            call.tool
        ));
    }
    let route = contextual_route_for_messages(messages);
    if route.is_none() && is_media_preview_tool(&call.tool) {
        return Err(format!(
            "{} is not relevant here. Media preview tools require an explicit media open/play/view request.",
            call.tool
        ));
    }
    tool_allowed_for_route_kind(call, route)
}

fn should_continue_after_observation(tool: &str, user_text: &str) -> bool {
    matches!(tool, "search_directory" | "list_media_files") && request_wants_preview(user_text)
}

fn first_previewable_search_result(
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

fn month_name_to_number(value: &str) -> Option<u32> {
    match value {
        "jan" | "january" => Some(1),
        "feb" | "february" => Some(2),
        "mar" | "march" => Some(3),
        "apr" | "april" => Some(4),
        "may" => Some(5),
        "jun" | "june" => Some(6),
        "jul" | "july" => Some(7),
        "aug" | "august" => Some(8),
        "sep" | "sept" | "september" => Some(9),
        "oct" | "october" => Some(10),
        "nov" | "november" => Some(11),
        "dec" | "december" => Some(12),
        _ => None,
    }
}

fn infer_calendar_date(text: &str) -> Option<String> {
    let lower = normalize_text(text);
    let today = Local::now().date_naive();
    if contains_any(&lower, &["today", "hôm nay"]) {
        return Some(today.format("%Y-%m-%d").to_string());
    }
    if contains_any(&lower, &["tomorrow", "ngày mai"]) {
        return Some((today + Duration::days(1)).format("%Y-%m-%d").to_string());
    }

    let words = lower
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    for window in words.windows(2) {
        if matches!(window[0], "month" | "tháng") {
            if let Ok(month) = window[1].parse::<u32>() {
                if (1..=12).contains(&month) {
                    return Some(format!("{}-{month:02}", today.year()));
                }
            }
            if let Some(month) = month_name_to_number(window[1]) {
                return Some(format!("{}-{month:02}", today.year()));
            }
        }
    }

    for (index, word) in words.iter().enumerate() {
        if let Some(month) = month_name_to_number(word) {
            let year = words
                .get(index + 1)
                .and_then(|part| part.parse::<i32>().ok())
                .filter(|year| (2000..=2100).contains(year))
                .unwrap_or_else(|| today.year());
            return Some(format!("{year}-{month:02}"));
        }
    }

    None
}

fn preview_kind_matches_request(preview: &file_tools::FilePreviewResult, user_text: &str) -> bool {
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

fn requested_kind_label(user_text: &str) -> &'static str {
    inferred_media_kind(user_text).unwrap_or("previewable")
}

fn normalize_image_mode(raw_mode: &str) -> String {
    let cleaned = clean_tool_markup_fragments(raw_mode)
        .trim()
        .to_ascii_lowercase();
    match cleaned.as_str() {
        "txt2img" | "text2img" | "text-to-image" | "text_to_image" => "text_to_image",
        "img2img" | "image2image" | "image-to-image" | "image_to_image" | "edit_image" => {
            "image_to_image"
        }
        "user_avatar" | "user-avatar" | "user_avatar_image" | "avatar_user_image"
        | "user-image" | "user_image" => "user_avatar_image",
        "user_character"
        | "user-character"
        | "user_character_image"
        | "user_and_character_image"
        | "both_avatars"
        | "both_avatars_image"
        | "couple_avatar_image" => "user_character_image",
        "avatar" | "assistant_image" | "character_image" | "avatar-image" | "avatar_image" => {
            "avatar_image"
        }
        _ => "text_to_image",
    }
    .to_string()
}

fn clean_tool_markup_fragments(value: &str) -> String {
    let mut cleaned = value.to_string();
    for marker in [
        "<|\"|>",
        "<|\"|",
        "|\"|",
        "|\"|>",
        "<|'>",
        "<|'",
        "|'",
        "|'>",
        "<tool_call|",
        "<toolcall|",
        "<|tool_call>",
        "<|tool_call|>",
        "<|toolcall>",
        "<|toolcall|>",
        "</|tool_call>",
        "</|tool_call|>",
        "</|toolcall>",
        "</|toolcall|>",
        "<tool_call>",
        "</tool_call>",
        "<toolcall>",
        "</toolcall>",
        "<tool_code>",
        "</tool_code>",
        "<tool>",
        "</tool>",
    ] {
        cleaned = cleaned.replace(marker, "");
    }
    cleaned
        .trim()
        .trim_matches(|ch: char| matches!(ch, '<' | '>' | '{' | '}' | '`' | ';'))
        .trim()
        .to_string()
}

fn normalize_image_prompt_for_mode(prompt: String, mode: &str) -> String {
    let prompt = clean_tool_markup_fragments(&prompt);
    if mode == "text_to_image" {
        return prompt;
    }
    let normalized = normalize_text(&prompt);
    if contains_any(
        &normalized,
        &[
            "preserve",
            "keep the same",
            "only edit",
            "do not change",
            "giu nguyen",
            "chi sua",
        ],
    ) {
        return prompt;
    }
    format!(
        "Use the provided reference image or images. Preserve the source image identity, facial features, and important visual traits. Only change what the prompt requests. {}",
        prompt
    )
}

fn parse_image_proposal(call: &ToolCall) -> Result<ImageProposal, String> {
    let prompt = call
        .arguments
        .get("prompt")
        .or_else(|| call.arguments.get("description"))
        .or_else(|| call.arguments.get("visual_prompt"))
        .or_else(|| call.arguments.get("image_prompt"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if prompt.is_empty() {
        return Err("Image prompt is required.".to_string());
    }

    let raw_mode = call
        .arguments
        .get("mode")
        .and_then(Value::as_str)
        .or_else(|| {
            let normalized_prompt = normalize_text(&prompt);
            if contains_any(
                &normalized_prompt,
                &["mode: avatar_image", "mode avatar_image"],
            ) {
                Some("avatar_image")
            } else if contains_any(
                &normalized_prompt,
                &["mode: image_to_image", "mode image_to_image"],
            ) {
                Some("image_to_image")
            } else {
                None
            }
        })
        .unwrap_or("text_to_image")
        .trim();
    let user_text = call_user_text(call);
    let mode = if request_targets_user_and_character_images(&user_text) {
        "user_character_image".to_string()
    } else if request_wants_user_avatar_image_generation(&user_text) {
        "user_avatar_image".to_string()
    } else if request_wants_avatar_image_generation(&user_text) {
        "avatar_image".to_string()
    } else {
        normalize_image_mode(raw_mode)
    };

    let mask_prompt = call
        .arguments
        .get("mask_prompt")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let prompt = normalize_image_prompt_for_mode(prompt, &mode);

    Ok(ImageProposal {
        prompt,
        mode,
        mask_prompt,
    })
}

fn parse_pending_image_proposal_text(text: &str) -> Option<ImageProposal> {
    let mut inside_block = false;
    let mut prompt: Option<String> = None;
    let mut mode = "text_to_image".to_string();
    let mut mask_prompt: Option<String> = None;

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        let normalized = normalize_text(line);
        if contains_any(
            &normalized,
            &[
                "pending image proposal awaiting approval",
                "image request queued for approval",
                "tool result: image creation request",
                "tool result: yeu cau tao anh",
            ],
        ) {
            inside_block = true;
            continue;
        }
        if !inside_block {
            continue;
        }

        if let Some((label, value)) = line.split_once(':') {
            let label = normalize_text(label.trim());
            let value = value.trim();
            if value.is_empty() {
                continue;
            }
            match label.as_str() {
                "prompt" | "mo ta" => {
                    prompt = Some(value.to_string());
                    continue;
                }
                "mode" | "che do" => {
                    mode = normalize_image_mode(value);
                    continue;
                }
                "mask prompt" | "mask" | "vung sua" => {
                    mask_prompt = Some(value.to_string());
                    continue;
                }
                _ => {}
            }
        }

        if prompt.is_none()
            && !contains_any(
                &normalized,
                &[
                    "review the prompt below",
                    "approve it before i start",
                    "queued for approval",
                ],
            )
        {
            prompt = Some(line.to_string());
        }
    }

    prompt.map(|prompt| ImageProposal {
        prompt,
        mode,
        mask_prompt,
    })
}

fn recent_pending_image_proposal(messages: &[ReactChatMessage]) -> Option<ImageProposal> {
    messages
        .iter()
        .rev()
        .find(|message| message.role == "assistant")
        .and_then(|message| parse_pending_image_proposal_text(&content_text(&message.content)))
}

async fn call_chat(
    messages: Vec<Value>,
    tools: Option<Value>,
    sampling: SamplingConfig,
    max_tokens: u32,
    thinking_enabled: bool,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Could not prepare chat request: {}", e))?;

    let mut payload = json!({
        "messages": messages,
        "temperature": sampling.temperature.clamp(0.0, 2.0),
        "top_k": sampling.top_k.min(200),
        "top_p": sampling.top_p.clamp(0.0, 1.0),
        "min_p": sampling.min_p.clamp(0.0, 1.0),
        "repeat_last_n": sampling.repeat_last_n.clamp(-1, 4096),
        "repeat_penalty": sampling.repeat_penalty.clamp(0.8, 2.0),
        "max_tokens": max_tokens.clamp(64, 4096),
        "stream": false,
        "chat_template_kwargs": {
            "enable_thinking": thinking_enabled,
            "thinking": thinking_enabled
        }
    });

    if let Some(t) = tools {
        let obj = payload.as_object_mut().unwrap();
        obj.insert("tools".to_string(), t);
        obj.insert("tool_choice".to_string(), json!("auto"));
    }

    let response = client
        .post("http://127.0.0.1:8080/v1/chat/completions")
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            format!(
                "Connection to the brain failed while sending chat request to http://127.0.0.1:8080/v1/chat/completions: {}",
                e
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("The chat brain returned {}. {}", status, body));
    }

    response
        .json::<Value>()
        .await
        .map_err(|e| format!("Could not read chat response: {}", e))
}

fn format_google_events(
    events: Vec<google_calendar::GoogleCalendarEvent>,
    user_text: &str,
) -> String {
    let vi = user_wants_vietnamese(user_text);
    if events.is_empty() {
        return if vi {
            "Không tìm thấy sự kiện nào trong khoảng thời gian này.".to_string()
        } else {
            "No calendar events found in that range.".to_string()
        };
    }
    let mut lines = vec![if vi {
        format!("### Tim thay {} su kien", events.len())
    } else {
        format!("### Found {} calendar events", events.len())
    }];
    lines.extend(events.into_iter().enumerate().map(|(index, event)| {
        format!(
            "**{}. {}**\n- Date/Time: {} -> {}\n- Location: {}\n- Details: {}",
            index + 1,
            event.title,
            event.start,
            event.end,
            event.location.unwrap_or_default(),
            event.description.unwrap_or_default()
        )
    }));
    lines.join("\n\n")
}

fn format_gmail(messages: Vec<google_calendar::GoogleMailMessage>, user_text: &str) -> String {
    let vi = user_wants_vietnamese(user_text);
    if messages.is_empty() {
        return if vi {
            "Không tìm thấy email nào khớp yêu cầu.".to_string()
        } else {
            "No Gmail messages found.".to_string()
        };
    }
    let mut lines = vec![if vi {
        format!("### {} email gan day", messages.len())
    } else {
        format!("### Latest {} emails", messages.len())
    }];
    lines.extend(messages.into_iter().enumerate().map(|(index, message)| {
        format!(
            "**{}. {}**\n- From: {}\n- Date: {}\n- Preview: {}",
            index + 1,
            if message.subject.is_empty() {
                "(No subject)"
            } else {
                &message.subject
            },
            message.from,
            message.date,
            message.snippet
        )
    }));
    lines.push(if vi {
        "Muon mo email nao thi noi so thu tu.".to_string()
    } else {
        "Tell me the number if you want to inspect one email.".to_string()
    });
    lines.join("\n\n")
}

fn simple_card(kind: &str, title: impl Into<String>, summary: Option<String>) -> ToolResultCard {
    ToolResultCard {
        kind: kind.to_string(),
        title: title.into(),
        summary,
        fields: Vec::new(),
        items: Vec::new(),
        text: None,
    }
}

#[allow(dead_code)]
fn detail_value(item: &ToolResultItem, label: &str) -> String {
    item.details
        .iter()
        .find(|f| f.label.eq_ignore_ascii_case(label))
        .map(|f| f.value.clone())
        .unwrap_or_default()
}

fn parse_card_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

fn format_weather_day_label(value: &str, vi: bool) -> String {
    let Some(date) = parse_card_date(value) else {
        return value.to_string();
    };
    if vi {
        let weekday = match date.weekday().number_from_monday() {
            1 => "Thứ Hai",
            2 => "Thứ Ba",
            3 => "Thứ Tư",
            4 => "Thứ Năm",
            5 => "Thứ Sáu",
            6 => "Thứ Bảy",
            _ => "Chủ Nhật",
        };
        format!("{} ({})", weekday, date.format("%d/%m"))
    } else {
        date.format("%a %Y-%m-%d").to_string()
    }
}

fn user_asks_weather_rain(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(&normalized, &["rain", "storm", "umbrella"])
        || contains_vietnamese_intent(&lowered, &["mưa", "bão", "có mưa"])
}

fn user_asks_weather_weekend(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(&normalized, &["weekend"])
        || contains_any_folded(&lowered, &normalized, &["cuối tuần"])
}

fn weather_requested_focus_date(text: &str) -> Option<(NaiveDate, &'static str)> {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    let today = Local::now().date_naive();

    if contains_any(&normalized, &["tomorrow"])
        || contains_any_folded(&lowered, &normalized, &["ng\u{00e0}y mai"])
    {
        return Some((today + Duration::days(1), "tomorrow"));
    }

    if contains_any(&normalized, &["today"])
        || contains_any_folded(&lowered, &normalized, &["h\u{00f4}m nay"])
    {
        return Some((today, "today"));
    }

    None
}

fn select_weather_items<'a>(
    items: &'a [ToolResultItem],
    user_text: &str,
) -> Vec<&'a ToolResultItem> {
    if user_asks_weather_weekend(user_text) {
        let weekend = items
            .iter()
            .filter(|item| {
                parse_card_date(&detail_value(item, "Date"))
                    .map(|date| matches!(date.weekday().number_from_monday(), 6 | 7))
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        if !weekend.is_empty() {
            return weekend;
        }
    }
    items.iter().take(4).collect()
}

#[allow(dead_code)]
fn request_wants_file_followup(user_text: &str) -> bool {
    let lower = user_text.to_ascii_lowercase();
    [
        "open",
        "play",
        "show",
        "preview",
        "view",
        "read",
        "summarize",
        "listen",
        "display",
    ]
    .iter()
    .any(|w| lower.contains(w))
}

#[allow(dead_code)]
fn verified_answer_from_cards(cards: &[ToolResultCard], fallback: &str, user_text: &str) -> String {
    let Some(card) = cards.first() else {
        return fallback.to_string();
    };
    let vi = user_wants_vietnamese(user_text);
    let count = card.items.len();

    match card.kind.as_str() {
        "gmail" => {
            if count == 0 {
                return if vi {
                    "Không tìm thấy email nào khớp yêu cầu.".to_string()
                } else {
                    "No Gmail messages matched.".to_string()
                };
            }
            let heading = if vi {
                format!("Đã xác minh {} email từ Gmail.", count)
            } else {
                format!("Verified {} Gmail messages.", count)
            };
            let rows = card
                .items
                .iter()
                .take(5)
                .enumerate()
                .map(|(index, item)| {
                    format!(
                        "{}. {}\nFrom: {}\nDate: {}\nPreview: {}",
                        index + 1,
                        item.title,
                        detail_value(item, "From"),
                        detail_value(item, "Date"),
                        detail_value(item, "Preview")
                    )
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            format!("{}\n\n{}", heading, rows)
        }
        "calendar" => {
            if count == 0 {
                return if vi {
                    "Không tìm thấy sự kiện nào trong khoảng thời gian này.".to_string()
                } else {
                    "No calendar events matched that range.".to_string()
                };
            }
            let heading = if vi {
                format!("Đã xác minh {} sự kiện từ Google Calendar.", count)
            } else {
                format!("Verified {} Google Calendar events.", count)
            };
            let rows = card
                .items
                .iter()
                .take(8)
                .enumerate()
                .map(|(index, item)| {
                    let location = detail_value(item, "Location");
                    [
                        format!("{}. {}", index + 1, item.title),
                        format!("Start: {}", detail_value(item, "Start")),
                        format!("End: {}", detail_value(item, "End")),
                        if location.is_empty() {
                            String::new()
                        } else {
                            format!("Location: {}", location)
                        },
                    ]
                    .into_iter()
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            format!("{}\n\n{}", heading, rows)
        }
        "weather" => {
            if count == 0 {
                return if vi {
                    "Không tìm thấy dữ liệu thời tiết phù hợp.".to_string()
                } else {
                    "No weather forecast data was found.".to_string()
                };
            }
            let location = card
                .fields
                .iter()
                .find(|field| field.label == "Location")
                .map(|field| field.value.clone())
                .unwrap_or_else(|| card.title.clone());
            let items = select_weather_items(&card.items, user_text);
            if user_asks_weather_rain(user_text) {
                let rainy = items
                    .iter()
                    .filter_map(|item| {
                        let rain_prob = detail_value(item, "Rain chance")
                            .trim_end_matches('%')
                            .parse::<u32>()
                            .ok()
                            .unwrap_or(0);
                        let rain_mm = detail_value(item, "Rain")
                            .trim_end_matches(" mm")
                            .parse::<f64>()
                            .ok()
                            .unwrap_or(0.0);
                        if rain_prob >= 35 || rain_mm >= 0.2 {
                            Some(format!(
                                "{}: {} chance, {}",
                                format_weather_day_label(&detail_value(item, "Date"), vi),
                                detail_value(item, "Rain chance"),
                                detail_value(item, "Rain")
                            ))
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>();
                if vi {
                    if rainy.is_empty() {
                        return format!(
                            "Khả năng mưa ở {} khá thấp trong khoảng anh hỏi. Nếu có thì mưa nhẹ.",
                            location
                        );
                    }
                    return format!("Có khả năng mưa ở {}.\n\n{}", location, rainy.join("\n"));
                }
                if rainy.is_empty() {
                    return format!(
                        "Rain looks unlikely in {} for the period you asked about.",
                        location
                    );
                }
                return format!("Rain is possible in {}.\n\n{}", location, rainy.join("\n"));
            }

            let rows = items
                .iter()
                .map(|item| {
                    format!(
                        "{}: {}, {} / {}, rain {}, wind {}",
                        format_weather_day_label(&detail_value(item, "Date"), vi),
                        item.title,
                        detail_value(item, "High"),
                        detail_value(item, "Low"),
                        detail_value(item, "Rain chance"),
                        detail_value(item, "Wind")
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            if vi {
                format!("Dự báo cho {}:\n\n{}", location, rows)
            } else {
                format!("Forecast for {}:\n\n{}", location, rows)
            }
        }
        "file_search" | "folder" | "media" => {
            if count == 0 {
                return if vi {
                    card.summary
                        .clone()
                        .map(|summary| {
                            format!("Không tìm thấy mục phù hợp trong workspace: {}", summary)
                        })
                        .unwrap_or_else(|| {
                            "Không tìm thấy mục phù hợp trong workspace.".to_string()
                        })
                } else {
                    card.summary
                        .clone()
                        .unwrap_or_else(|| "No matching workspace items found.".to_string())
                };
            }
            let heading = if request_wants_file_followup(user_text) && count > 1 {
                if vi {
                    format!(
                        "Em tìm thấy {} mục phù hợp. Anh chọn đúng tệp muốn mở/phát bằng tên hoặc đường dẫn nhé.",
                        count
                    )
                } else {
                    format!(
                        "I found {} matching items. Choose the exact file to open/play by name or path.",
                        count
                    )
                }
            } else if vi {
                format!("Đã xác minh {} mục trong workspace.", count)
            } else {
                format!("Verified {} workspace items.", count)
            };
            let rows = card
                .items
                .iter()
                .take(10)
                .enumerate()
                .map(|(index, item)| {
                    let path = detail_value(item, "Path");
                    let type_name = detail_value(item, "Type");
                    let size = detail_value(item, "Size");
                    [
                        format!("{}. {}", index + 1, item.title),
                        if type_name.is_empty() {
                            String::new()
                        } else {
                            format!("Type: {}", type_name)
                        },
                        if size.is_empty() {
                            String::new()
                        } else {
                            format!("Size: {}", size)
                        },
                        if path.is_empty() {
                            item.subtitle.clone().unwrap_or_default()
                        } else {
                            format!("Path: {}", path)
                        },
                    ]
                    .into_iter()
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            format!("{}\n\n{}", heading, rows)
        }
        "web_search" => {
            if count == 0 {
                return if vi {
                    card.summary
                        .clone()
                        .map(|query| format!("Không tìm thấy kết quả web mới cho: {}", query))
                        .unwrap_or_else(|| "Không tìm thấy kết quả web mới.".to_string())
                } else {
                    card.summary
                        .clone()
                        .map(|query| format!("No fresh web results found for: {}", query))
                        .unwrap_or_else(|| "No fresh web results found.".to_string())
                };
            }
            let heading = if vi {
                format!("Tóm tắt nhanh từ {} nguồn web mới.", count)
            } else {
                format!("Quick summary from {} fresh web sources.", count)
            };
            let rows = card
                .items
                .iter()
                .take(5)
                .enumerate()
                .map(|(index, item)| {
                    let details = detail_value(item, "Details");
                    let body = if details.trim().is_empty() {
                        item.title.clone()
                    } else {
                        details
                    };
                    format!("{}. {}", index + 1, body)
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            format!("{}\n\n{}", heading, rows)
        }
        "google_drive" => {
            if count == 0 {
                return if vi {
                    "Không tìm thấy tệp Google Drive nào khớp yêu cầu.".to_string()
                } else {
                    "No Google Drive files matched.".to_string()
                };
            }
            let heading = if vi {
                format!("Đã xác minh {} tệp từ Google Drive.", count)
            } else {
                format!("Verified {} Google Drive files.", count)
            };
            let rows = card
                .items
                .iter()
                .take(8)
                .enumerate()
                .map(|(index, item)| {
                    let modified = detail_value(item, "Modified");
                    [
                        format!("{}. {}", index + 1, item.title),
                        item.subtitle
                            .clone()
                            .map(|value| format!("Type: {}", value))
                            .unwrap_or_default(),
                        if modified.is_empty() {
                            String::new()
                        } else {
                            format!("Modified: {}", modified)
                        },
                        format!("File ID: {}", detail_value(item, "File ID")),
                    ]
                    .into_iter()
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            format!("{}\n\n{}", heading, rows)
        }
        "google_contacts" => {
            if count == 0 {
                return if vi {
                    "Không tìm thấy liên hệ nào khớp trong danh bạ Google.".to_string()
                } else {
                    "No Google contacts matched.".to_string()
                };
            }
            let heading = if vi {
                format!("Đã xác minh {} liên hệ từ Google Contacts.", count)
            } else {
                format!("Verified {} Google contacts.", count)
            };
            let rows = card
                .items
                .iter()
                .take(8)
                .enumerate()
                .map(|(index, item)| {
                    let email = detail_value(item, "Email");
                    let phone = detail_value(item, "Phone");
                    let org = detail_value(item, "Organization");
                    [
                        format!("{}. {}", index + 1, item.title),
                        if email.is_empty() {
                            String::new()
                        } else {
                            format!("Email: {}", email)
                        },
                        if phone.is_empty() {
                            String::new()
                        } else {
                            format!("Phone: {}", phone)
                        },
                        if org.is_empty() {
                            String::new()
                        } else {
                            format!("Organization: {}", org)
                        },
                    ]
                    .into_iter()
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            format!("{}\n\n{}", heading, rows)
        }
        "google_doc" | "google_sheet" => {
            let heading = if vi {
                "Đã xác minh dữ liệu từ Google Workspace.".to_string()
            } else {
                "Verified Google Workspace data.".to_string()
            };
            let mut lines = vec![format!("Title: {}", card.title)];
            for field in &card.fields {
                lines.push(format!("{}: {}", field.label, field.value));
            }
            for (index, item) in card.items.iter().take(6).enumerate() {
                let mut row = vec![format!("{}. {}", index + 1, item.title)];
                if let Some(subtitle) = &item.subtitle {
                    if !subtitle.is_empty() {
                        row.push(format!("Type: {}", subtitle));
                    }
                }
                for detail in &item.details {
                    row.push(format!("{}: {}", detail.label, detail.value));
                }
                lines.push(row.join("\n"));
            }
            format!("{}\n\n{}", heading, lines.join("\n\n"))
        }
        "time" => card.summary.clone().unwrap_or_else(|| fallback.to_string()),
        "error" => card.summary.clone().unwrap_or_else(|| fallback.to_string()),
        _ => card
            .summary
            .clone()
            .filter(|summary| !summary.trim().is_empty())
            .unwrap_or_else(|| fallback.to_string()),
    }
}

fn files_card(
    kind: &str,
    title: impl Into<String>,
    summary: Option<String>,
    files: &[file_tools::FileSearchResult],
) -> ToolResultCard {
    ToolResultCard {
        kind: kind.to_string(),
        title: title.into(),
        summary,
        fields: Vec::new(),
        items: files
            .iter()
            .map(|file| ToolResultItem {
                title: file.name.clone(),
                subtitle: Some(file.path.clone()),
                details: vec![
                    ToolResultField {
                        label: "Type".to_string(),
                        value: file.extension.clone(),
                    },
                    ToolResultField {
                        label: "Size".to_string(),
                        value: format!("{} bytes", file.size_bytes),
                    },
                    ToolResultField {
                        label: "Folder".to_string(),
                        value: file.folder.clone(),
                    },
                    ToolResultField {
                        label: "Path".to_string(),
                        value: file.path.clone(),
                    },
                ],
                url: None,
            })
            .collect(),
        text: None,
    }
}

fn gmail_card(messages: &[google_calendar::GoogleMailMessage]) -> ToolResultCard {
    ToolResultCard {
        kind: "gmail".to_string(),
        title: format!("{} Gmail messages", messages.len()),
        summary: Some("Verified from Gmail API".to_string()),
        fields: vec![ToolResultField {
            label: "Order".to_string(),
            value: "Newest first from Gmail".to_string(),
        }],
        items: messages
            .iter()
            .enumerate()
            .map(|(index, message)| ToolResultItem {
                title: format!(
                    "{}. {}",
                    index + 1,
                    if message.subject.is_empty() {
                        "(No subject)"
                    } else {
                        &message.subject
                    }
                ),
                subtitle: Some(message.from.clone()),
                details: vec![
                    ToolResultField {
                        label: "From".to_string(),
                        value: message.from.clone(),
                    },
                    ToolResultField {
                        label: "Date".to_string(),
                        value: message.date.clone(),
                    },
                    ToolResultField {
                        label: "Message ID".to_string(),
                        value: message.id.clone(),
                    },
                    ToolResultField {
                        label: "Thread ID".to_string(),
                        value: message.thread_id.clone(),
                    },
                    ToolResultField {
                        label: "Preview".to_string(),
                        value: message.snippet.clone(),
                    },
                ],
                url: Some(message.web_link.clone()),
            })
            .collect(),
        text: None,
    }
}

fn calendar_card(events: &[google_calendar::GoogleCalendarEvent]) -> ToolResultCard {
    ToolResultCard {
        kind: "calendar".to_string(),
        title: format!("{} calendar events", events.len()),
        summary: Some("Verified from Google Calendar API".to_string()),
        fields: vec![ToolResultField {
            label: "Order".to_string(),
            value: "Start time ascending".to_string(),
        }],
        items: events
            .iter()
            .map(|event| ToolResultItem {
                title: event.title.clone(),
                subtitle: Some(format!("{} -> {}", event.start, event.end)),
                details: [
                    Some(ToolResultField {
                        label: "Start".to_string(),
                        value: event.start.clone(),
                    }),
                    Some(ToolResultField {
                        label: "End".to_string(),
                        value: event.end.clone(),
                    }),
                    Some(ToolResultField {
                        label: "All day".to_string(),
                        value: event.all_day.to_string(),
                    }),
                    Some(ToolResultField {
                        label: "Event ID".to_string(),
                        value: event.id.clone(),
                    }),
                    event.location.as_ref().map(|location| ToolResultField {
                        label: "Location".to_string(),
                        value: location.clone(),
                    }),
                    event
                        .description
                        .as_ref()
                        .map(|description| ToolResultField {
                            label: "Details".to_string(),
                            value: description.clone(),
                        }),
                ]
                .into_iter()
                .flatten()
                .collect(),
                url: event.html_link.clone(),
            })
            .collect(),
        text: None,
    }
}

fn weather_card(forecast: &weather::WeatherForecast) -> ToolResultCard {
    let location = if forecast.location.country.is_empty() {
        forecast.location.name.clone()
    } else {
        format!("{}, {}", forecast.location.name, forecast.location.country)
    };
    ToolResultCard {
        kind: "weather".to_string(),
        title: format!("Weather forecast for {}", location),
        summary: Some("Verified from Open-Meteo".to_string()),
        fields: vec![
            ToolResultField {
                label: "Location".to_string(),
                value: location,
            },
            ToolResultField {
                label: "Timezone".to_string(),
                value: forecast.location.timezone.clone(),
            },
        ],
        items: forecast
            .days
            .iter()
            .map(|day| ToolResultItem {
                title: day.summary.clone(),
                subtitle: None,
                details: vec![
                    ToolResultField {
                        label: "Date".to_string(),
                        value: day.date.clone(),
                    },
                    ToolResultField {
                        label: "High".to_string(),
                        value: format!("{:.0}°C", day.temperature_max_c),
                    },
                    ToolResultField {
                        label: "Low".to_string(),
                        value: format!("{:.0}°C", day.temperature_min_c),
                    },
                    ToolResultField {
                        label: "Rain chance".to_string(),
                        value: day
                            .precipitation_probability_max
                            .map(|value| format!("{}%", value))
                            .unwrap_or_else(|| "n/a".to_string()),
                    },
                    ToolResultField {
                        label: "Rain".to_string(),
                        value: format!("{:.1} mm", day.precipitation_sum_mm),
                    },
                    ToolResultField {
                        label: "Wind".to_string(),
                        value: format!("{:.0} km/h", day.wind_speed_max_kmh),
                    },
                ],
                url: None,
            })
            .collect(),
        text: None,
    }
}

fn json_string(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn google_drive_card(body: &Value) -> ToolResultCard {
    let files = body
        .get("files")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    ToolResultCard {
        kind: "google_drive".to_string(),
        title: format!("{} Google Drive files", files.len()),
        summary: Some("Verified from Google Drive".to_string()),
        fields: Vec::new(),
        items: files
            .iter()
            .map(|file| ToolResultItem {
                title: json_string(file.get("name")),
                subtitle: Some(json_string(file.get("mimeType"))),
                details: vec![
                    ToolResultField {
                        label: "File ID".to_string(),
                        value: json_string(file.get("id")),
                    },
                    ToolResultField {
                        label: "Modified".to_string(),
                        value: json_string(file.get("modifiedTime")),
                    },
                ]
                .into_iter()
                .filter(|field| !field.value.is_empty())
                .collect(),
                url: file
                    .get("webViewLink")
                    .and_then(Value::as_str)
                    .map(|v| v.to_string()),
            })
            .collect(),
        text: None,
    }
}

fn google_contacts_card(body: &Value) -> ToolResultCard {
    let people = body
        .get("results")
        .and_then(Value::as_array)
        .map(|results| {
            results
                .iter()
                .filter_map(|entry| entry.get("person").cloned())
                .collect::<Vec<_>>()
        })
        .or_else(|| body.get("connections").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    ToolResultCard {
        kind: "google_contacts".to_string(),
        title: format!("{} Google contacts", people.len()),
        summary: Some("Verified from Google Contacts".to_string()),
        fields: Vec::new(),
        items: people
            .iter()
            .map(|person| {
                let primary_name = person
                    .get("names")
                    .and_then(Value::as_array)
                    .and_then(|names| names.first())
                    .and_then(|name| name.get("displayName"))
                    .and_then(Value::as_str)
                    .unwrap_or("Unnamed contact")
                    .to_string();
                let email = person
                    .get("emailAddresses")
                    .and_then(Value::as_array)
                    .and_then(|values| values.first())
                    .and_then(|entry| entry.get("value"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let phone = person
                    .get("phoneNumbers")
                    .and_then(Value::as_array)
                    .and_then(|values| values.first())
                    .and_then(|entry| entry.get("value"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let org = person
                    .get("organizations")
                    .and_then(Value::as_array)
                    .and_then(|values| values.first())
                    .and_then(|entry| entry.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                ToolResultItem {
                    title: primary_name,
                    subtitle: if email.is_empty() {
                        None
                    } else {
                        Some(email.clone())
                    },
                    details: vec![
                        ToolResultField {
                            label: "Email".to_string(),
                            value: email,
                        },
                        ToolResultField {
                            label: "Phone".to_string(),
                            value: phone,
                        },
                        ToolResultField {
                            label: "Organization".to_string(),
                            value: org,
                        },
                        ToolResultField {
                            label: "Resource Name".to_string(),
                            value: person
                                .get("resourceName")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string(),
                        },
                    ]
                    .into_iter()
                    .filter(|field| !field.value.is_empty())
                    .collect(),
                    url: None,
                }
            })
            .collect(),
        text: None,
    }
}

fn google_doc_card(body: &Value) -> ToolResultCard {
    let title = body
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Google Doc")
        .to_string();
    ToolResultCard {
        kind: "google_doc".to_string(),
        title,
        summary: Some("Verified from Google Docs".to_string()),
        fields: vec![
            ToolResultField {
                label: "Document ID".to_string(),
                value: json_string(body.get("documentId")),
            },
            ToolResultField {
                label: "Tabs".to_string(),
                value: body
                    .get("tabs")
                    .and_then(Value::as_array)
                    .map(|tabs| tabs.len().to_string())
                    .unwrap_or_default(),
            },
        ]
        .into_iter()
        .filter(|field| !field.value.is_empty())
        .collect(),
        items: Vec::new(),
        text: None,
    }
}

fn google_sheet_card(body: &Value) -> ToolResultCard {
    if body.get("values").is_some() {
        let values = body
            .get("values")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        return ToolResultCard {
            kind: "google_sheet".to_string(),
            title: json_string(body.get("range")),
            summary: Some("Verified from Google Sheets".to_string()),
            fields: vec![
                ToolResultField {
                    label: "Rows".to_string(),
                    value: values.len().to_string(),
                },
                ToolResultField {
                    label: "Major dimension".to_string(),
                    value: json_string(body.get("majorDimension")),
                },
            ],
            items: values
                .iter()
                .take(8)
                .enumerate()
                .map(|(index, row)| ToolResultItem {
                    title: format!("Row {}", index + 1),
                    subtitle: None,
                    details: vec![ToolResultField {
                        label: "Values".to_string(),
                        value: row
                            .as_array()
                            .map(|cols| {
                                cols.iter()
                                    .map(|col| col.as_str().unwrap_or_default().to_string())
                                    .collect::<Vec<_>>()
                                    .join(" | ")
                            })
                            .unwrap_or_default(),
                    }],
                    url: None,
                })
                .collect(),
            text: None,
        };
    }

    let sheets = body
        .get("sheets")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    ToolResultCard {
        kind: "google_sheet".to_string(),
        title: body
            .get("properties")
            .and_then(|props| props.get("title"))
            .and_then(Value::as_str)
            .unwrap_or("Google Sheet")
            .to_string(),
        summary: Some("Verified from Google Sheets".to_string()),
        fields: vec![
            ToolResultField {
                label: "Spreadsheet ID".to_string(),
                value: json_string(body.get("spreadsheetId")),
            },
            ToolResultField {
                label: "Tabs".to_string(),
                value: sheets.len().to_string(),
            },
        ]
        .into_iter()
        .filter(|field| !field.value.is_empty())
        .collect(),
        items: sheets
            .iter()
            .map(|sheet| {
                let props = sheet.get("properties").unwrap_or(&Value::Null);
                ToolResultItem {
                    title: json_string(props.get("title")),
                    subtitle: Some(json_string(props.get("sheetType"))).filter(|v| !v.is_empty()),
                    details: vec![
                        ToolResultField {
                            label: "Sheet ID".to_string(),
                            value: props
                                .get("sheetId")
                                .and_then(Value::as_i64)
                                .map(|v| v.to_string())
                                .unwrap_or_default(),
                        },
                        ToolResultField {
                            label: "Index".to_string(),
                            value: props
                                .get("index")
                                .and_then(Value::as_i64)
                                .map(|v| v.to_string())
                                .unwrap_or_default(),
                        },
                    ]
                    .into_iter()
                    .filter(|field| !field.value.is_empty())
                    .collect(),
                    url: None,
                }
            })
            .collect(),
        text: None,
    }
}

fn calendar_day_range(input: Option<&str>) -> Result<(String, String), String> {
    let today = Local::now().date_naive();
    if let Some(value) = input.map(str::trim).filter(|value| !value.is_empty()) {
        if value.len() == 7 && value.as_bytes().get(4) == Some(&b'-') {
            let year = value[0..4]
                .parse::<i32>()
                .map_err(|_| "Use month as YYYY-MM.".to_string())?;
            let month = value[5..7]
                .parse::<u32>()
                .map_err(|_| "Use month as YYYY-MM.".to_string())?;
            let start_date = NaiveDate::from_ymd_opt(year, month, 1)
                .ok_or_else(|| "Invalid calendar month.".to_string())?;
            let (end_year, end_month) = if month == 12 {
                (year + 1, 1)
            } else {
                (year, month + 1)
            };
            let end_date = NaiveDate::from_ymd_opt(end_year, end_month, 1)
                .ok_or_else(|| "Invalid calendar month.".to_string())?;
            let start = Local
                .from_local_datetime(
                    &start_date
                        .and_hms_opt(0, 0, 0)
                        .ok_or("Invalid start date.")?,
                )
                .single()
                .ok_or("Could not resolve local start time.")?;
            let end = Local
                .from_local_datetime(&end_date.and_hms_opt(0, 0, 0).ok_or("Invalid end date.")?)
                .single()
                .ok_or("Could not resolve local end time.")?;
            return Ok((start.to_rfc3339(), end.to_rfc3339()));
        }
    }
    let date = match input.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) if value.eq_ignore_ascii_case("tomorrow") => today + Duration::days(1),
        Some(value) if value.eq_ignore_ascii_case("today") => today,
        Some(value) => NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map_err(|_| "Use date as today, tomorrow, or YYYY-MM-DD.".to_string())?,
        None => today,
    };
    let start = Local
        .from_local_datetime(&date.and_hms_opt(0, 0, 0).ok_or("Invalid start date.")?)
        .single()
        .ok_or("Could not resolve local start time.")?;
    let end_date = date + Duration::days(1);
    let end = Local
        .from_local_datetime(&end_date.and_hms_opt(0, 0, 0).ok_or("Invalid end date.")?)
        .single()
        .ok_or("Could not resolve local end time.")?;
    Ok((start.to_rfc3339(), end.to_rfc3339()))
}

async fn execute_tool_result(
    call: &ToolCall,
    folders: &[String],
    google_client_id: &str,
    google_client_secret: &str,
) -> Result<ToolOutcome, String> {
    let user_text = call_user_text(call);
    let vi = user_wants_vietnamese(&user_text);
    let result: Result<ToolOutcome, String> = match call.tool.as_str() {
        "get_current_time" => {
            let now: DateTime<Local> = Local::now();
            let observation = format!(
                "Time: {} | Unix: {}",
                now.format("%A, %B %-d, %Y at %-I:%M:%S %p %Z"),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|value| value.as_secs())
                    .unwrap_or_default()
            );
            let mut outcome = text_outcome(observation.clone());
            outcome.cards.push(ToolResultCard {
                kind: "time".to_string(),
                title: "Current time".to_string(),
                summary: Some(now.format("%A, %B %-d, %Y at %-I:%M:%S %p %Z").to_string()),
                fields: vec![ToolResultField {
                    label: "Unix".to_string(),
                    value: SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|value| value.as_secs().to_string())
                        .unwrap_or_default(),
                }],
                items: Vec::new(),
                text: None,
            });
            Ok(outcome)
        }
        "list_files_in_directory" => {
            let path_arg = call.arguments.get("path").and_then(Value::as_str);
            let directory = resolve_directory(path_arg, folders)?;
            let mut rows = Vec::new();
            let mut items = Vec::new();
            for entry in std::fs::read_dir(&directory)
                .map_err(|e| format!("Could not read directory: {}", e))?
                .flatten()
                .take(80)
            {
                let path = entry.path();
                let metadata = entry.metadata().ok();
                let name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default();
                let kind = if path.is_dir() { "folder" } else { "file" };
                let size = metadata.map(|value| value.len()).unwrap_or(0);
                let path_text = path.to_string_lossy().to_string();
                rows.push(format!(
                    "{} | {} | {} bytes | {}",
                    kind, name, size, path_text
                ));
                items.push(ToolResultItem {
                    title: name.to_string(),
                    subtitle: Some(path_text.clone()),
                    details: vec![
                        ToolResultField {
                            label: "Type".to_string(),
                            value: kind.to_string(),
                        },
                        ToolResultField {
                            label: "Size".to_string(),
                            value: format!("{} bytes", size),
                        },
                        ToolResultField {
                            label: "Path".to_string(),
                            value: path_text,
                        },
                    ],
                    url: None,
                });
            }
            if rows.is_empty() {
                let observation = format!("Directory: {}\nNo items found.", directory.display());
                let mut outcome = text_outcome(observation);
                outcome.cards.push(simple_card(
                    "folder",
                    directory.display().to_string(),
                    Some("No items found.".to_string()),
                ));
                Ok(outcome)
            } else {
                let observation =
                    format!("Directory: {}\n{}", directory.display(), rows.join("\n"));
                let mut outcome = text_outcome(observation);
                outcome.cards.push(ToolResultCard {
                    kind: "folder".to_string(),
                    title: directory.display().to_string(),
                    summary: Some(format!("{} items shown", rows.len())),
                    fields: vec![ToolResultField {
                        label: "Folder".to_string(),
                        value: directory.display().to_string(),
                    }],
                    items,
                    text: None,
                });
                Ok(outcome)
            }
        }
        "search_directory" => {
            let user_text = call_user_text(call);
            let query = call
                .arguments
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if query.is_empty() {
                return Ok(error_outcome("query is required.".to_string()));
            }
            let matches =
                file_tools::search_linked_files(query.to_string(), folders.to_vec(), Some(30))?;
            if matches.is_empty() {
                let mut outcome = text_outcome(format!("No matching files found for: {}", query));
                outcome.cards.push(simple_card(
                    "file_search",
                    "No matching files",
                    Some(query.to_string()),
                ));
                Ok(outcome)
            } else {
                let observation = matches
                    .iter()
                    .enumerate()
                    .map(|(index, file)| {
                        format!(
                            "{}. {}\nType: {}\nSize: {} bytes\nPath: {}",
                            index + 1,
                            file.name,
                            file.extension,
                            file.size_bytes,
                            file.path
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n");
                let has_previewable_media = matches.iter().any(|file| {
                    matches!(
                        file.extension.as_str(),
                        "mp3"
                            | "wav"
                            | "ogg"
                            | "flac"
                            | "m4a"
                            | "aac"
                            | "mp4"
                            | "webm"
                            | "mov"
                            | "mkv"
                            | "jpg"
                            | "jpeg"
                            | "png"
                            | "gif"
                            | "webp"
                            | "bmp"
                    )
                });
                if (should_continue_after_observation("search_directory", &user_text)
                    || has_previewable_media)
                    && !request_is_conversational_turn(&user_text)
                {
                    if let Some(preview) =
                        first_previewable_search_result(&matches, folders, &user_text)
                    {
                        let preview_observation = format!(
                            "{}\n\nPreview ready.\nTitle: {}\nType: {}\nPath: {}\nSize: {} bytes",
                            observation,
                            preview.name,
                            preview.mime_type,
                            preview.path,
                            preview.size_bytes
                        );
                        return Ok(ToolOutcome {
                            observation: preview_observation,
                            cards: Vec::new(),
                            file_preview: Some(preview),
                            image_proposal: None,
                            action_proposal: None,
                            success: true,
                        });
                    }
                }
                let mut outcome = text_outcome(observation);
                outcome.cards.push(files_card(
                    "file_search",
                    format!("{} matching files", matches.len()),
                    Some(query.to_string()),
                    &matches,
                ));
                Ok(outcome)
            }
        }
        "read_file" => {
            let path = call
                .arguments
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if path.is_empty() {
                return Ok(error_outcome("path is required.".to_string()));
            }
            let result = file_tools::read_linked_text_file(
                path.to_string(),
                folders.to_vec(),
                Some(120_000),
            )?;
            let observation = format!(
                "File: {}\nPath: {}\nTruncated: {}\nContent:\n{}",
                result.name, result.path, result.truncated, result.content
            );
            let mut outcome = text_outcome(observation);
            outcome.cards.push(ToolResultCard {
                kind: "file_content".to_string(),
                title: result.name,
                summary: Some(result.path),
                fields: vec![ToolResultField {
                    label: "Truncated".to_string(),
                    value: result.truncated.to_string(),
                }],
                items: Vec::new(),
                text: Some(result.content),
            });
            Ok(outcome)
        }
        "list_media_files" => {
            let user_text = call_user_text(call);
            let kind = inferred_media_kind(&user_text)
                .map(str::to_string)
                .or_else(|| {
                    call.arguments
                        .get("kind")
                        .and_then(Value::as_str)
                        .map(|value| value.trim().to_string())
                })
                .unwrap_or_else(|| "any".to_string());
            let matches =
                file_tools::list_linked_media_files(kind.clone(), folders.to_vec(), Some(30))?;
            if matches.is_empty() {
                let mut outcome = text_outcome(format!("No previewable {} files found.", kind));
                outcome
                    .cards
                    .push(simple_card("media", "No media files found", Some(kind)));
                Ok(outcome)
            } else {
                let observation = matches
                    .iter()
                    .enumerate()
                    .map(|(index, file)| {
                        format!(
                            "{}. {}\nType: {}\nSize: {} bytes\nPath: {}",
                            index + 1,
                            file.name,
                            file.extension,
                            file.size_bytes,
                            file.path
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n");
                let mut outcome = text_outcome(observation);
                outcome.cards.push(files_card(
                    "media",
                    format!("{} media files", matches.len()),
                    Some(kind),
                    &matches,
                ));
                Ok(outcome)
            }
        }
        "preview_random_media" => {
            let user_text = call_user_text(call);
            let allow_follow_up = call
                .arguments
                .get("_preview_context")
                .and_then(Value::as_str)
                == Some("follow_up");
            if !random_media_preview_allowed(&user_text, allow_follow_up) {
                return Ok(error_outcome(
                    "This request is not asking to open or play random media.".to_string(),
                ));
            }
            let kind = inferred_media_kind(&user_text)
                .map(str::to_string)
                .or_else(|| {
                    call.arguments
                        .get("kind")
                        .and_then(Value::as_str)
                        .map(|value| value.trim().to_string())
                })
                .unwrap_or_else(|| "any".to_string());
            let mut matches = file_tools::list_linked_media_files(
                kind.clone(),
                folders.to_vec(),
                Some(random_media_scan_limit()),
            )?;
            let explicit_query = call.arguments.get("query").and_then(Value::as_str);
            let constraint_terms = media_constraint_terms(&user_text, explicit_query);
            if !constraint_terms.is_empty() {
                matches = matches
                    .into_iter()
                    .filter(|file| media_matches_constraints(file, &constraint_terms))
                    .collect::<Vec<_>>();
                if matches.is_empty() {
                    return Ok(error_outcome(format!(
                        "No previewable {} files matched the requested media constraint: {}.",
                        kind,
                        constraint_terms.join(", ")
                    )));
                }
            }
            let exclude_paths = call
                .arguments
                .get("exclude_paths")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(|path| path.trim().to_ascii_lowercase())
                        .filter(|path| !path.is_empty())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if !exclude_paths.is_empty() {
                matches.retain(|file| {
                    !exclude_paths
                        .iter()
                        .any(|path| file.path.to_ascii_lowercase() == *path)
                });
            }
            if matches.is_empty() {
                return Ok(text_outcome(format!(
                    "No previewable {} files found.",
                    kind
                )));
            }
            let total_matches = matches.len();
            let selected = &matches[random_index(total_matches)];
            let preview = file_tools::preview_linked_file(
                selected.path.clone(),
                folders.to_vec(),
                Some(80_000_000),
            )?;
            if !preview_kind_matches_request(&preview, &user_text) {
                return Ok(error_outcome(format!(
                    "The selected file is {}, but the user asked for {}. Pick a matching real file path from the workspace and try again.",
                    preview.mime_type,
                    requested_kind_label(&user_text)
                )));
            }
            let observation =
                random_selection_observation(total_matches, selected, &preview, &user_text);
            Ok(ToolOutcome {
                observation,
                cards: Vec::new(),
                file_preview: Some(preview),
                image_proposal: None,
                action_proposal: None,
                success: true,
            })
        }
        "preview_file" => {
            let path = call
                .arguments
                .get("path")
                .or_else(|| call.arguments.get("file"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if path.is_empty() {
                return Ok(error_outcome("path is required.".to_string()));
            }
            let preview = file_tools::preview_linked_file(
                path.to_string(),
                folders.to_vec(),
                Some(80_000_000),
            )?;
            let user_text = call_user_text(call);
            if !preview_kind_matches_request(&preview, &user_text) {
                return Ok(error_outcome(format!(
                    "The selected file is {}, but the user asked for {}. Use a matching real file path from the previous observation, or ask the user to choose.",
                    preview.mime_type,
                    requested_kind_label(&user_text)
                )));
            }
            let observation = format!(
                "Preview ready.\nTitle: {}\nType: {}\nPath: {}\nSize: {} bytes",
                preview.name, preview.mime_type, preview.path, preview.size_bytes
            );
            Ok(ToolOutcome {
                observation,
                cards: Vec::new(),
                file_preview: Some(preview),
                image_proposal: None,
                action_proposal: None,
                success: true,
            })
        }
        "weather_forecast" => {
            let location = call
                .arguments
                .get("location")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if location.is_empty() {
                return Ok(error_outcome("location is required.".to_string()));
            }
            let days = call
                .arguments
                .get("days")
                .and_then(Value::as_u64)
                .map(|value| value.clamp(1, 10) as u32)
                .unwrap_or(7);
            let forecast = weather::fetch_weather_forecast(location, days).await?;
            let mut observation_lines = vec![format!(
                "Location: {}, {}",
                forecast.location.name, forecast.location.country
            )];
            let user_text = call_user_text(call);
            let focus_date = weather_requested_focus_date(&user_text);
            let focused_days = if let Some((date, label)) = focus_date {
                observation_lines.push(format!(
                    "Requested period: {} ({})",
                    label,
                    date.format("%Y-%m-%d")
                ));
                let matching = forecast
                    .days
                    .iter()
                    .filter(|day| parse_card_date(&day.date) == Some(date))
                    .collect::<Vec<_>>();
                if matching.is_empty() {
                    observation_lines.push(format!(
                        "No forecast row matched the requested date {}; full forecast follows.",
                        date.format("%Y-%m-%d")
                    ));
                    forecast.days.iter().collect::<Vec<_>>()
                } else {
                    observation_lines
                        .push("Answer only from the requested date row below.".to_string());
                    matching
                }
            } else {
                forecast.days.iter().collect::<Vec<_>>()
            };
            for day in focused_days {
                let rain_chance = day
                    .precipitation_probability_max
                    .map(|value| format!("{}%", value))
                    .unwrap_or_else(|| "n/a".to_string());
                observation_lines.push(format!(
                    "{} | {} | high {:.0}C | low {:.0}C | rain {} | {:.1} mm | wind {:.0} km/h",
                    day.date,
                    day.summary,
                    day.temperature_max_c,
                    day.temperature_min_c,
                    rain_chance,
                    day.precipitation_sum_mm,
                    day.wind_speed_max_kmh
                ));
            }
            let mut outcome = text_outcome(observation_lines.join("\n"));
            outcome.cards.push(weather_card(&forecast));
            Ok(outcome)
        }
        "web_search" => {
            let query = call
                .arguments
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if query.is_empty() {
                return Ok(error_outcome("query is required.".to_string()));
            }
            let results = agent_web::agent_web_search(query.to_string(), None, Some(5)).await?;
            if results.is_empty() {
                let mut outcome =
                    text_outcome(format!("No fresh web results found for: {}", query));
                outcome.cards.push(simple_card(
                    "web_search",
                    "No fresh web results",
                    Some(query.to_string()),
                ));
                Ok(outcome)
            } else {
                let observation = results
                    .iter()
                    .enumerate()
                    .map(|(index, result)| {
                        format!(
                            "{}. {}\nSource: {}\nURL: {}\nDetails: {}",
                            index + 1,
                            result.title,
                            result.source,
                            result.url,
                            result.snippet
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n");
                let mut outcome = text_outcome(observation);
                outcome.cards.push(ToolResultCard {
                    kind: "web_search".to_string(),
                    title: format!("{} web results", results.len()),
                    summary: Some(query.to_string()),
                    fields: Vec::new(),
                    items: results
                        .iter()
                        .map(|result| ToolResultItem {
                            title: result.title.clone(),
                            subtitle: Some(result.source.clone()),
                            details: vec![ToolResultField {
                                label: "Details".to_string(),
                                value: result.snippet.clone(),
                            }],
                            url: Some(result.url.clone()),
                        })
                        .collect(),
                    text: None,
                });
                Ok(outcome)
            }
        }
        "gmail_recent" => {
            if google_client_id.trim().is_empty() || google_client_secret.trim().is_empty() {
                return Err("Google OAuth client ID/secret are missing.".to_string());
            }
            let user_text = call_user_text(call);
            let model_count = call
                .arguments
                .get("count")
                .and_then(Value::as_u64)
                .map(|value| value.clamp(1, 25) as u32)
                .unwrap_or(5);
            let count = requested_item_count(&user_text, model_count, 25);
            let query = call
                .arguments
                .get("query")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
                .filter(|value| !value.trim().is_empty());
            let messages = google_calendar::list_google_gmail_messages(
                google_client_id.to_string(),
                google_client_secret.to_string(),
                Some(count),
                query,
            )
            .await?;
            let observation = format_gmail(messages.clone(), &user_text);
            let mut outcome = text_outcome(observation);
            outcome.cards.push(gmail_card(&messages));
            Ok(outcome)
        }
        "google_calendar_check" => {
            if google_client_id.trim().is_empty() || google_client_secret.trim().is_empty() {
                return Err("Google OAuth client ID/secret are missing.".to_string());
            }
            let user_text = call_user_text(call);
            let inferred_date = infer_calendar_date(&user_text);
            let date = inferred_date
                .as_deref()
                .or_else(|| call.arguments.get("date").and_then(Value::as_str));
            let (time_min, time_max) = calendar_day_range(date)?;
            let events = google_calendar::list_google_calendar_events(
                google_client_id.to_string(),
                google_client_secret.to_string(),
                time_min,
                time_max,
            )
            .await?;
            let observation = format_google_events(events.clone(), &user_text);
            let mut outcome = text_outcome(observation);
            outcome.cards.push(calendar_card(&events));
            Ok(outcome)
        }
        "propose_image_generation" => {
            parse_image_proposal(call).map(|proposal| image_proposal_outcome(proposal, vi))
        }
        "propose_write_file" => {
            let relative_path = call
                .arguments
                .get("relative_path")
                .or_else(|| call.arguments.get("path"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let content = call
                .arguments
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if relative_path.is_empty() {
                return Ok(error_outcome("relative_path is required.".to_string()));
            }
            Ok(proposed_action(
                "write_file",
                if vi { "Ghi tệp" } else { "Write file" },
                if vi {
                    format!("Tạo hoặc thay thế {} sau khi được duyệt.", relative_path)
                } else {
                    format!("Create or replace {} after approval.", relative_path)
                },
                json!({
                    "relative_path": relative_path,
                    "content": content,
                    "root_folder": call.arguments.get("root_folder").cloned().unwrap_or(Value::Null)
                }),
            ))
        }
        "propose_move_file" => {
            let source = call
                .arguments
                .get("source")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let destination = call
                .arguments
                .get("destination_relative_path")
                .or_else(|| call.arguments.get("destination"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if source.is_empty() || destination.is_empty() {
                return Ok(error_outcome(
                    "source and destination_relative_path are required.".to_string(),
                ));
            }
            Ok(proposed_action(
                "move_file",
                if vi {
                    "Di chuyển hoặc đổi tên tệp"
                } else {
                    "Move or rename file"
                },
                if vi {
                    format!(
                        "Di chuyển {} sang {} sau khi được duyệt.",
                        source, destination
                    )
                } else {
                    format!("Move {} to {} after approval.", source, destination)
                },
                json!({
                    "source": source,
                    "destination_relative_path": destination,
                    "root_folder": call.arguments.get("root_folder").cloned().unwrap_or(Value::Null)
                }),
            ))
        }
        "propose_delete_file" => {
            let source = call
                .arguments
                .get("source")
                .or_else(|| call.arguments.get("path"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if source.is_empty() {
                return Ok(error_outcome("source is required.".to_string()));
            }
            Ok(proposed_action(
                "delete_file",
                if vi {
                    "Đưa tệp vào thùng rác của ứng dụng"
                } else {
                    "Move file to app trash"
                },
                if vi {
                    format!("Đưa {} vào .galaxy_trash sau khi được duyệt.", source)
                } else {
                    format!("Move {} into .galaxy_trash after approval.", source)
                },
                json!({ "source": source }),
            ))
        }
        "run_powershell" => {
            let command = call
                .arguments
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if command.is_empty() {
                return Ok(error_outcome("command is required.".to_string()));
            }
            let purpose = call
                .arguments
                .get("purpose")
                .and_then(Value::as_str)
                .unwrap_or("Run the requested local system action.");
            Ok(proposed_action(
                "run_powershell",
                if vi {
                    "Chạy tác vụ hệ thống"
                } else {
                    "Run system action"
                },
                purpose.to_string(),
                json!({
                    "purpose": purpose,
                    "command": command,
                    "working_directory": call.arguments.get("working_directory").cloned().unwrap_or(Value::Null),
                    "timeout_seconds": call.arguments.get("timeout_seconds").cloned().unwrap_or(json!(30))
                }),
            ))
        }
        "google_api_read" => {
            if google_client_id.trim().is_empty() || google_client_secret.trim().is_empty() {
                return Err("Google OAuth client ID/secret are missing.".to_string());
            }
            let url = call
                .arguments
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if url.is_empty() {
                return Ok(error_outcome(
                    "url is required for google_api_read.".to_string(),
                ));
            }
            let body = google_calendar::execute_google_api(
                google_client_id.to_string(),
                google_client_secret.to_string(),
                "GET".to_string(),
                url.to_string(),
                None,
            )
            .await?;
            Ok(text_outcome(body))
        }
        "google_drive_search" => {
            if google_client_id.trim().is_empty() || google_client_secret.trim().is_empty() {
                return Err("Google OAuth client ID/secret are missing.".to_string());
            }
            let query = call
                .arguments
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let mime_type = call
                .arguments
                .get("mime_type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let recent = call
                .arguments
                .get("recent")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let page_size = call
                .arguments
                .get("page_size")
                .and_then(Value::as_u64)
                .unwrap_or(10)
                .clamp(1, 25);
            if query.is_empty() && mime_type.is_empty() {
                return Ok(error_outcome(
                    "query or mime_type is required for google_drive_search.".to_string(),
                ));
            }
            let mut url = url::Url::parse("https://www.googleapis.com/drive/v3/files")
                .map_err(|e| format!("Could not build Drive API URL: {}", e))?;
            let mut filters = vec!["trashed=false".to_string()];
            if !query.is_empty() {
                filters.push(format!("name contains '{}'", query.replace('\'', "\\'")));
            }
            if !mime_type.is_empty() {
                filters.push(format!("mimeType='{}'", mime_type.replace('\'', "\\'")));
            }
            url.query_pairs_mut()
                .append_pair("pageSize", &page_size.to_string())
                .append_pair("includeItemsFromAllDrives", "true")
                .append_pair("supportsAllDrives", "true")
                .append_pair(
                    "fields",
                    "files(id,name,mimeType,modifiedTime,webViewLink,iconLink)",
                )
                .append_pair("q", &filters.join(" and "));
            if recent {
                url.query_pairs_mut()
                    .append_pair("orderBy", "modifiedTime desc");
            }
            let body = google_calendar::execute_google_api(
                google_client_id.to_string(),
                google_client_secret.to_string(),
                "GET".to_string(),
                url.to_string(),
                None,
            )
            .await?;
            let parsed: Value =
                serde_json::from_str(&body).unwrap_or_else(|_| json!({ "files": [] }));
            let mut outcome = text_outcome(body);
            outcome.cards.push(google_drive_card(&parsed));
            Ok(outcome)
        }
        "google_docs_read" => {
            if google_client_id.trim().is_empty() || google_client_secret.trim().is_empty() {
                return Err("Google OAuth client ID/secret are missing.".to_string());
            }
            let document_id = call
                .arguments
                .get("document_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if document_id.is_empty() {
                return Ok(error_outcome(
                    "document_id is required for google_docs_read.".to_string(),
                ));
            }
            let url = format!("https://docs.googleapis.com/v1/documents/{}", document_id);
            let body = google_calendar::execute_google_api(
                google_client_id.to_string(),
                google_client_secret.to_string(),
                "GET".to_string(),
                url,
                None,
            )
            .await?;
            let parsed: Value = serde_json::from_str(&body).unwrap_or_else(|_| json!({}));
            let mut outcome = text_outcome(body);
            outcome.cards.push(google_doc_card(&parsed));
            Ok(outcome)
        }
        "google_sheets_read" => {
            if google_client_id.trim().is_empty() || google_client_secret.trim().is_empty() {
                return Err("Google OAuth client ID/secret are missing.".to_string());
            }
            let spreadsheet_id = call
                .arguments
                .get("spreadsheet_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if spreadsheet_id.is_empty() {
                return Ok(error_outcome(
                    "spreadsheet_id is required for google_sheets_read.".to_string(),
                ));
            }
            let range = call
                .arguments
                .get("range")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let url = if let Some(range) = range {
                let encoded_range: String =
                    url::form_urlencoded::byte_serialize(range.as_bytes()).collect();
                format!(
                    "https://sheets.googleapis.com/v4/spreadsheets/{}/values/{}?majorDimension=ROWS",
                    spreadsheet_id, encoded_range
                )
            } else {
                format!(
                    "https://sheets.googleapis.com/v4/spreadsheets/{}?includeGridData=false",
                    spreadsheet_id
                )
            };
            let body = google_calendar::execute_google_api(
                google_client_id.to_string(),
                google_client_secret.to_string(),
                "GET".to_string(),
                url,
                None,
            )
            .await?;
            let parsed: Value = serde_json::from_str(&body).unwrap_or_else(|_| json!({}));
            let mut outcome = text_outcome(body);
            outcome.cards.push(google_sheet_card(&parsed));
            Ok(outcome)
        }
        "google_contacts_search" => {
            if google_client_id.trim().is_empty() || google_client_secret.trim().is_empty() {
                return Err("Google OAuth client ID/secret are missing.".to_string());
            }
            let query = call
                .arguments
                .get("query")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let page_size = call
                .arguments
                .get("page_size")
                .and_then(Value::as_u64)
                .unwrap_or(10)
                .clamp(1, 50);
            let url = if let Some(query) = query {
                let mut url =
                    url::Url::parse("https://people.googleapis.com/v1/people:searchContacts")
                        .map_err(|e| format!("Could not build People API URL: {}", e))?;
                url.query_pairs_mut()
                    .append_pair(
                        "readMask",
                        "names,emailAddresses,phoneNumbers,organizations",
                    )
                    .append_pair("pageSize", &page_size.to_string())
                    .append_pair("query", query);
                url.to_string()
            } else {
                let mut url =
                    url::Url::parse("https://people.googleapis.com/v1/people/me/connections")
                        .map_err(|e| format!("Could not build People API URL: {}", e))?;
                url.query_pairs_mut()
                    .append_pair(
                        "personFields",
                        "names,emailAddresses,phoneNumbers,organizations",
                    )
                    .append_pair("pageSize", &page_size.to_string())
                    .append_pair("sortOrder", "LAST_MODIFIED_ASCENDING");
                url.to_string()
            };
            let body = google_calendar::execute_google_api(
                google_client_id.to_string(),
                google_client_secret.to_string(),
                "GET".to_string(),
                url,
                None,
            )
            .await?;
            let parsed: Value = serde_json::from_str(&body).unwrap_or_else(|_| json!({}));
            let mut outcome = text_outcome(body);
            outcome.cards.push(google_contacts_card(&parsed));
            Ok(outcome)
        }
        "propose_gmail_send" => {
            let to = call
                .arguments
                .get("to")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let subject = call
                .arguments
                .get("subject")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let body = call
                .arguments
                .get("body")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if to.is_empty() || subject.is_empty() {
                return Ok(error_outcome("to and subject are required.".to_string()));
            }
            Ok(proposed_action(
                "gmail_send",
                "Send email via Gmail",
                format!("Send email to: {}\nSubject: {}", to, subject),
                json!({ "to": to, "subject": subject, "body": body }),
            ))
        }
        "propose_gmail_trash" => {
            let id = call
                .arguments
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let reason = call
                .arguments
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("Move this email to Trash");
            if id.is_empty() {
                return Ok(error_outcome("id is required.".to_string()));
            }
            Ok(proposed_action(
                "gmail_trash",
                "Delete email (move to Trash)",
                reason.to_string(),
                json!({ "id": id }),
            ))
        }
        "propose_calendar_create" => {
            let title = call
                .arguments
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let start = call
                .arguments
                .get("start")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let end = call
                .arguments
                .get("end")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if title.is_empty() || start.is_empty() || end.is_empty() {
                return Ok(error_outcome(
                    "title, start, and end are required.".to_string(),
                ));
            }
            Ok(proposed_action(
                "calendar_create",
                "Create calendar event",
                format!("Event: {}\nStart: {}\nEnd: {}", title, start, end),
                json!({
                    "title": title,
                    "start": start,
                    "end": end,
                    "description": call.arguments.get("description").cloned().unwrap_or(Value::Null),
                    "location": call.arguments.get("location").cloned().unwrap_or(Value::Null),
                }),
            ))
        }
        "propose_calendar_delete" => {
            let id = call
                .arguments
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let title = call
                .arguments
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if id.is_empty() {
                return Ok(error_outcome("id is required.".to_string()));
            }
            Ok(proposed_action(
                "calendar_delete",
                "Delete calendar event",
                format!("Event: {}", title),
                json!({
                    "id": id,
                    "title": title,
                }),
            ))
        }
        "propose_google_contact_delete" => {
            let resource_name = call
                .arguments
                .get("resource_name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let name = call
                .arguments
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("Google contact")
                .trim();
            if resource_name.is_empty() {
                return Ok(error_outcome(
                    "resource_name is required for propose_google_contact_delete.".to_string(),
                ));
            }
            Ok(proposed_action(
                "google_contact_delete",
                "Delete Google contact",
                format!("Contact: {}", name),
                json!({
                    "resource_name": resource_name,
                    "name": name,
                }),
            ))
        }
        "propose_google_action" => {
            let summary = call
                .arguments
                .get("action_summary")
                .and_then(Value::as_str)
                .unwrap_or("Google action")
                .trim();
            let method = call
                .arguments
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or("POST")
                .trim();
            let url = call
                .arguments
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if url.is_empty() {
                return Ok(error_outcome(
                    "url is required for propose_google_action.".to_string(),
                ));
            }
            Ok(proposed_action(
                "google_action",
                "Google Workspace action",
                summary.to_string(),
                json!({
                    "method": method,
                    "url": url,
                    "payload": call.arguments.get("payload").cloned().unwrap_or(Value::Null),
                }),
            ))
        }
        other => Err(format!("Unknown tool: {}", other)),
    };

    result
}

async fn execute_tool(
    call: &ToolCall,
    folders: &[String],
    google_client_id: &str,
    google_client_secret: &str,
) -> ToolOutcome {
    let started_at = Instant::now();
    let outcome = execute_tool_result(call, folders, google_client_id, google_client_secret)
        .await
        .unwrap_or_else(error_outcome);
    log_tool_run(
        call,
        &outcome,
        started_at.elapsed().as_millis().min(i64::MAX as u128) as i64,
    );
    outcome
}

fn empty_react_result(answer: String, thinking: Option<String>) -> ReactChatResult {
    ReactChatResult {
        answer,
        thinking,
        tool_used: None,
        observation: None,
        cards: Vec::new(),
        image_proposal: None,
        file_preview: None,
        action_proposal: None,
        tool_trace: Vec::new(),
    }
}

fn first_model_tool_call(
    message: &Value,
    assistant_text: &str,
) -> Option<(String, Value, String, bool)> {
    if let Some(tool_call_data) = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .and_then(|tool_calls| tool_calls.first())
    {
        let tool_call_id = tool_call_data
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("tool_call")
            .to_string();
        let empty_func = json!({});
        let func = tool_call_data.get("function").unwrap_or(&empty_func);
        let name = func
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if name.trim().is_empty() {
            return None;
        }
        let arguments_str = func
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or("{}");
        let arguments = serde_json::from_str(arguments_str).unwrap_or(json!({}));
        return Some((canonical_tool_name(&name), arguments, tool_call_id, true));
    }

    if let Some(parsed) = parse_inline_tool_markup(assistant_text) {
        return Some((parsed.0, parsed.1, "fallback_id".to_string(), false));
    }

    let reasoning_text = [message.get("reasoning_content"), message.get("reasoning")]
        .into_iter()
        .flatten()
        .map(extract_value_text)
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    parse_inline_tool_markup(&reasoning_text)
        .map(|(name, arguments)| (name, arguments, "fallback_id".to_string(), false))
}

fn looks_like_unexecuted_tool_narration(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let mentions_tool = AVAILABLE_TOOL_NAMES
        .iter()
        .any(|tool| lowered.contains(&tool.to_lowercase()));
    let mentions_markup = lowered.contains("<tool_call")
        || lowered.contains("<toolcall")
        || lowered.contains("<|tool_call|>")
        || lowered.contains("<|tool_call>")
        || lowered.contains("<|toolcall|>")
        || lowered.contains("<|toolcall>")
        || lowered.contains("<tool_code")
        || lowered.contains("tool_code");
    let compact = lowered.replace(char::is_whitespace, "");
    let function_style_call = AVAILABLE_TOOL_NAMES
        .iter()
        .any(|tool| compact.contains(&format!("{}(", tool.to_lowercase())));
    if !mentions_tool && !mentions_markup {
        return false;
    }
    if mentions_markup || function_style_call {
        return true;
    }

    contains_any(
        &lowered,
        &[
            "calling",
            "called",
            "i will call",
            "i'm calling",
            "i have called",
            "tool call",
            "tool result",
            "image:",
            "file:",
            "will be displayed",
            "queued for approval",
            "review the prompt",
            "gọi tool",
            "gọi hàm",
            "đã gọi",
            "sẽ gọi",
            "kết quả tool",
            "được hiển thị tại đây",
            "sẽ được hiển thị",
        ],
    )
}

fn request_wants_image_generation(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if vietnamese_image_term(&lowered) && vietnamese_create_image_term(&lowered) {
        return true;
    }
    let image_terms = [
        "image",
        "picture",
        "photo",
        "art",
        "drawing",
        "poster",
        "wallpaper",
        "ảnh",
        "hình",
    ];
    let create_terms = [
        "create", "generate", "draw", "paint", "make", "render", "tạo", "vẽ", "làm",
    ];
    contains_any_folded(&lowered, &normalized, &image_terms)
        && contains_any_folded(&lowered, &normalized, &create_terms)
}

fn broad_image_generation_signal(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if vietnamese_image_term(&lowered) && vietnamese_create_image_term(&lowered) {
        return true;
    }
    let image_terms = [
        "image", "picture", "photo", "avatar", "portrait", "selfie", "img2img", "txt2img", "ảnh",
        "hình",
    ];
    let action_terms = [
        "create", "generate", "draw", "paint", "make", "render", "send", "edit", "change",
        "replace", "inpaint", "tạo", "vẽ", "làm", "gửi", "sửa", "đổi", "thay",
    ];
    contains_any_folded(&lowered, &normalized, &image_terms)
        && contains_any_folded(&lowered, &normalized, &action_terms)
}

fn request_targets_assistant_self(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if contains_any(
        &lowered,
        &[
            "của em",
            "ảnh em",
            "hình em",
            "chính em",
            "bản thân em",
            "em trong",
            "em đang",
            "gửi em",
        ],
    ) {
        return true;
    }
    contains_any(
        &normalized,
        &[
            "yourself",
            "your own",
            "your picture",
            "your photo",
            "your image",
            "of you",
            "assistant",
            "character",
            "avatar",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "của em",
            "ảnh em",
            "hình em",
            "chính em",
            "bản thân em",
            "em trong",
            "em đang",
            "gửi em",
        ],
    )
}

fn request_wants_avatar_image_generation(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if vietnamese_image_term(&lowered)
        && request_targets_assistant_self(text)
        && vietnamese_create_image_term(&lowered)
    {
        return true;
    }
    let has_image_target = contains_any(
        &normalized,
        &["image", "picture", "photo", "portrait", "selfie", "avatar"],
    ) || contains_any_folded(&lowered, &normalized, &["ảnh", "hình"]);
    if !has_image_target || !request_targets_assistant_self(text) {
        return false;
    }

    contains_any(
        &normalized,
        &[
            "send", "show", "create", "generate", "draw", "make", "render", "see", "view",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &["gửi", "cho xem", "xem", "tạo", "vẽ", "làm"],
    )
}

fn request_targets_user_profile_image(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(
        &normalized,
        &[
            "my avatar",
            "my profile",
            "my photo",
            "my picture",
            "my image",
            "user avatar",
            "user profile",
            "profile avatar",
            "of me",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "ảnh anh",
            "hình anh",
            "ảnh của anh",
            "hình của anh",
            "avatar anh",
            "profile anh",
            "ảnh đại ca",
            "hình đại ca",
        ],
    )
}

fn request_targets_user_and_character_images(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    let has_pair = contains_any(
        &normalized,
        &[
            "both of us",
            "you and me",
            "me and you",
            "user and character",
            "my avatar and your avatar",
            "our avatars",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "anh và em",
            "anh voi em",
            "em và anh",
            "em voi anh",
            "hai đứa",
            "hai dua",
            "cả hai",
            "ca hai",
        ],
    );
    has_pair && (request_targets_user_profile_image(text) || request_targets_assistant_self(text))
}

fn request_wants_user_avatar_image_generation(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    let has_image_target = contains_any(
        &normalized,
        &["image", "picture", "photo", "portrait", "selfie", "avatar"],
    ) || contains_any_folded(&lowered, &normalized, &["ảnh", "hình"]);
    has_image_target && request_targets_user_profile_image(text)
}

fn request_looks_like_image_edit_follow_up(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if contains_any(
        &lowered,
        &[
            "sửa",
            "chỉnh",
            "đổi",
            "thay",
            "thêm",
            "xóa",
            "bỏ",
            "làm lại",
            "tạo lại",
            "gắn",
            "đội",
            "mặc",
        ],
    ) {
        return true;
    }
    contains_any(
        &normalized,
        &[
            "edit",
            "change",
            "replace",
            "add",
            "remove",
            "redo",
            "fix",
            "adjust",
            "inpaint",
            "try again",
            "make it",
            "put",
            "wearing",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "sửa",
            "chỉnh",
            "đổi",
            "thay",
            "thêm",
            "xóa",
            "bỏ",
            "làm lại",
            "tạo lại",
            "gắn",
            "đội",
            "mặc",
        ],
    )
}

fn request_effectively_wants_image_generation(
    latest_user_text: &str,
    pending_image_proposal: Option<&ImageProposal>,
    has_recent_image_context: bool,
) -> bool {
    request_wants_image_generation(latest_user_text)
        || broad_image_generation_signal(latest_user_text)
        || request_wants_user_avatar_image_generation(latest_user_text)
        || request_targets_user_and_character_images(latest_user_text)
        || request_wants_avatar_image_generation(latest_user_text)
        || (pending_image_proposal.is_some() && is_contextual_follow_up(latest_user_text))
        || (has_recent_image_context && request_looks_like_image_edit_follow_up(latest_user_text))
}

fn answer_claims_unverified_tool_result(
    answer: &str,
    latest_user_text: &str,
    contextual_route: Option<ToolRoute>,
    pending_image_proposal: Option<&ImageProposal>,
    has_recent_image_context: bool,
) -> bool {
    if contextual_route.is_none()
        && !request_effectively_wants_image_generation(
            latest_user_text,
            pending_image_proposal,
            has_recent_image_context,
        )
    {
        return false;
    }

    let lowered = answer.to_lowercase();
    let normalized = normalize_text(answer);
    if answer_is_clarification_or_refusal(answer) {
        return false;
    }

    contains_any(
        &normalized,
        &[
            "i found",
            "i checked",
            "i searched",
            "i created",
            "i generated",
            "here is",
            "here are",
            "result",
            "forecast",
            "verified",
            "created the image",
            "generated the image",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "em đã",
            "đã tìm",
            "đã kiểm tra",
            "đã tạo",
            "sẽ tạo",
            "đang tạo",
            "tạo xong",
            "tìm thấy",
            "kết quả",
            "dưới đây",
            "xem thử",
            "dự báo",
        ],
    )
}

fn answer_is_clarification_or_refusal(answer: &str) -> bool {
    let lowered = answer.to_lowercase();
    let normalized = normalize_text(answer);
    contains_any(
        &normalized,
        &[
            "i cannot",
            "i can't",
            "i need",
            "please provide",
            "tell me",
            "which",
            "what location",
            "need more",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "em cần",
            "anh cho",
            "bạn cho",
            "không thể",
            "chưa thể",
            "cần thêm",
            "ở đâu",
            "khu vực nào",
        ],
    )
}

fn protocol_retry_for_missing_tool(
    latest_user_text: &str,
    contextual_route: Option<ToolRoute>,
    pending_image_proposal: Option<&ImageProposal>,
    has_recent_image_context: bool,
) -> Option<&'static str> {
    if request_effectively_wants_image_generation(
        latest_user_text,
        pending_image_proposal,
        has_recent_image_context,
    ) {
        return Some(
            "Protocol error: the user asked for image generation. Use propose_image_generation with the visual prompt, or ask a clarification if the image request is ambiguous. Do not claim an image was created without the tool.",
        );
    }
    if contextual_route.is_some() {
        return Some(
            "Protocol error: this user request requires a tool for live, local, or external data. Produce exactly one structured tool call, or ask a clarification. Do not claim that you checked, found, created, opened, or verified anything without a tool result.",
        );
    }
    None
}

fn route_label(route: ToolRoute) -> &'static str {
    match route {
        ToolRoute::MediaPreview => "workspace media preview",
        ToolRoute::Gmail => "Gmail",
        ToolRoute::Calendar => "calendar",
        ToolRoute::Weather => "weather",
        ToolRoute::FileSearch => "workspace file",
        ToolRoute::WebSearch => "web search",
        ToolRoute::GoogleWorkspace => "Google Workspace",
    }
}

fn tool_planner_instruction(
    latest_user_text: &str,
    contextual_route: Option<ToolRoute>,
    pending_image_proposal: Option<&ImageProposal>,
    has_recent_image_context: bool,
    step: usize,
) -> String {
    let image_required = request_effectively_wants_image_generation(
        latest_user_text,
        pending_image_proposal,
        has_recent_image_context,
    );
    let recent_image_hint = if has_recent_image_context {
        "Recent context contains an image. A short follow-up may refer to that image; decide from the whole conversation. If unclear, output NO_TOOL so the final answer can ask one short clarification."
    } else {
        "No recent image context was detected."
    };
    let required_hint = if image_required {
        if request_targets_user_and_character_images(latest_user_text) {
            "This turn needs the image tool with mode user_character_image."
        } else if request_wants_user_avatar_image_generation(latest_user_text) {
            "This turn needs the image tool with mode user_avatar_image."
        } else if request_wants_avatar_image_generation(latest_user_text) {
            "This turn needs the image tool with mode avatar_image."
        } else if has_recent_image_context
            && request_looks_like_image_edit_follow_up(latest_user_text)
        {
            "This turn needs the image tool with mode image_to_image."
        } else {
            "This turn needs the image tool with mode text_to_image unless an earlier pending proposal should be reused."
        }
    } else if let Some(route) = contextual_route {
        match route {
            ToolRoute::MediaPreview => "This turn needs a real workspace media/file preview tool.",
            ToolRoute::Gmail => "This turn needs a Gmail tool.",
            ToolRoute::Calendar => "This turn needs a calendar tool.",
            ToolRoute::Weather => {
                "This turn needs the weather_forecast tool when the location is known."
            }
            ToolRoute::FileSearch => "This turn needs a workspace file tool.",
            ToolRoute::WebSearch => "This turn needs web_search.",
            ToolRoute::GoogleWorkspace => "This turn needs a Google Workspace tool.",
        }
    } else {
        "Decide from the full meaning of the latest user message, not isolated words. Use NO_TOOL for normal conversation, opinion, writing, explanation, or anything that can be answered without external/live/local data. If the intent is unclear, output NO_TOOL so the final answer can ask a short clarification."
    };

    let route_text = contextual_route
        .map(route_label)
        .unwrap_or(if image_required {
            "image generation"
        } else {
            "none"
        });
    [
        "PRIVATE TOOL PLANNER. This message is not visible to the user.",
        "Your entire output must be either exactly NO_TOOL or exactly one structured tool call.",
        "Never write a user-facing answer in this planner step.",
        "Do not overthink. Make the smallest defensible decision from the current turn and recent context.",
        "Do not infer a tool from one keyword. Use a tool only when the full request clearly asks for app data, local files, live/external info, image generation/editing, voice, or a system/account action.",
        "Never say that a tool was called, checked, found, opened, created, or verified. Only the app may execute tools.",
        "If a sufficient verified tool result is already present in the conversation, output NO_TOOL so the final answer can be written.",
        "Use read-only tools directly for harmless lookup/preview tasks. Use propose_* tools for writes, deletes, sending email, calendar changes, contact changes, image generation, or local system actions.",
        "For propose_image_generation, the prompt and mask_prompt arguments must be written in English even when the user chats in another language.",
        "For propose_image_generation, write a rich, creative, context-aware English-first prompt. Do not merely translate the user's short request. Expand it into 2-4 concise sentences with subject, action, setting, style, composition/framing, lighting, mood, and must-preserve details. Keep names, places, brands, and quoted visible text exactly when useful.",
        "Keep image prompts faithful to the user's intent; do not add unrelated people, objects, nudity, violence, brands, or identity changes unless requested.",
        "Image modes: text_to_image uses no reference; image_to_image uses the current attached/chat image; avatar_image uses the character avatar; user_avatar_image uses the selected user profile avatar; user_character_image uses both selected user and character avatars.",
        recent_image_hint,
        "If a tool is required but a mandatory argument is missing, output NO_TOOL and the final answer should ask for that missing detail.",
        required_hint,
        &format!("Detected route: {route_text}. Tool planning step: {}.", step + 1),
    ]
    .join("\n")
}

fn reasoning_style_prompt(thinking_enabled: bool) -> &'static str {
    if thinking_enabled {
        "Reasoning style: think briefly and only as much as needed. Do not spend long chains on ordinary conversation. If the user's intent is unclear, ask one short clarifying question instead of guessing or calling a tool."
    } else {
        "Reasoning style: answer directly. If the user's intent is unclear, ask one short clarifying question instead of guessing or calling a tool."
    }
}

fn planner_sampling(sampling: SamplingConfig) -> SamplingConfig {
    SamplingConfig {
        temperature: 0.0,
        top_k: 1,
        top_p: 1.0,
        min_p: 0.0,
        repeat_last_n: sampling.repeat_last_n,
        repeat_penalty: sampling.repeat_penalty,
    }
}

async fn rewrite_image_prompt_to_english(
    prompt: &str,
    latest_user_text: &str,
    mode: &str,
    sampling: SamplingConfig,
) -> Result<Option<String>, String> {
    if !image_prompt_needs_english_rewrite(prompt) {
        return Ok(None);
    }

    let reply = call_chat(
        vec![
            json!({
                "role": "system",
                "content": "Rewrite the image generation prompt into natural English-first text for an image model. Preserve all visual details, style, composition, identity, clothing, action, edit intent, names, places, brands, and quoted visible text. Return only the final prompt. Do not add quotes, markdown, explanation, or tool markup."
            }),
            json!({
                "role": "user",
                "content": format!(
                    "Mode: {mode}\nUser request:\n{}\n\nCurrent prompt:\n{}",
                    latest_user_text.trim(),
                    prompt.trim()
                )
            }),
        ],
        None,
        planner_sampling(sampling),
        320,
        false,
    )
    .await?;
    let rewritten = clean_tool_markup_fragments(&extract_chat_reply_text(&reply));
    let rewritten = rewritten
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string();
    if rewritten.is_empty() || image_prompt_needs_english_rewrite(&rewritten) {
        return Ok(None);
    }
    Ok(Some(rewritten))
}

async fn ensure_image_tool_call_prompt_english(
    mut call: ToolCall,
    latest_user_text: &str,
    sampling: SamplingConfig,
) -> Result<ToolCall, String> {
    if call.tool != "propose_image_generation" {
        return Ok(call);
    }
    let prompt = image_prompt_argument(&call);
    let mode = call
        .arguments
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("text_to_image")
        .to_string();
    if let Some(rewritten) =
        rewrite_image_prompt_to_english(&prompt, latest_user_text, &mode, sampling).await?
    {
        let mut object = call.arguments.as_object().cloned().unwrap_or_default();
        object.insert("prompt".to_string(), Value::String(rewritten));
        object.remove("description");
        object.remove("visual_prompt");
        object.remove("image_prompt");
        call.arguments = Value::Object(object);
    }
    let mask_prompt = call
        .arguments
        .get("mask_prompt")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    if !mask_prompt.is_empty() {
        if let Some(rewritten) =
            rewrite_image_prompt_to_english(&mask_prompt, latest_user_text, &mode, sampling).await?
        {
            let mut object = call.arguments.as_object().cloned().unwrap_or_default();
            object.insert("mask_prompt".to_string(), Value::String(rewritten));
            call.arguments = Value::Object(object);
        }
    }
    Ok(call)
}

async fn plan_next_tool_call(
    base_messages: &[Value],
    tools: &Value,
    sampling: SamplingConfig,
    latest_user_text: &str,
    contextual_route: Option<ToolRoute>,
    pending_image_proposal: Option<&ImageProposal>,
    has_recent_image_context: bool,
    step: usize,
) -> Result<(Option<ToolCall>, String), String> {
    let mut accumulated_thinking = String::new();
    let tool_required = contextual_route.is_some()
        || request_effectively_wants_image_generation(
            latest_user_text,
            pending_image_proposal,
            has_recent_image_context,
        );
    if tool_required {
        let route_text = contextual_route
            .map(route_label)
            .unwrap_or("image generation");
        append_thinking(
            &mut accumulated_thinking,
            &format!("Tool planning: checked this turn before running tools. Route: {route_text}."),
        );
    }

    let mut planner_messages = base_messages.to_vec();
    planner_messages.push(json!({
        "role": "system",
        "content": tool_planner_instruction(
            latest_user_text,
            contextual_route,
            pending_image_proposal,
            has_recent_image_context,
            step,
        )
    }));

    for attempt in 0..2 {
        let reply = call_chat(
            planner_messages.clone(),
            Some(tools.clone()),
            planner_sampling(sampling),
            256,
            false,
        )
        .await?;
        append_thinking(
            &mut accumulated_thinking,
            &extract_chat_reasoning_text(&reply),
        );

        let choice = reply
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first());
        let message = choice
            .and_then(|choice| choice.get("message"))
            .cloned()
            .unwrap_or_default();
        let assistant_text = message
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();

        if let Some((name, arguments, _, _)) = first_model_tool_call(&message, &assistant_text) {
            let call = ensure_image_tool_call_prompt_english(
                ToolCall {
                    tool: name,
                    arguments,
                },
                latest_user_text,
                sampling,
            )
            .await?;
            return Ok((Some(call), accumulated_thinking));
        }

        let normalized = normalize_text(&assistant_text);
        if normalized.trim() == "no_tool" || normalized.contains("no_tool") {
            return Ok((None, accumulated_thinking));
        }

        if !tool_required {
            return Ok((None, accumulated_thinking));
        }

        if attempt == 0 {
            planner_messages.push(json!({
                "role": "system",
                "content": "Planner correction: this turn appears to need a tool. Output exactly one valid tool call, or NO_TOOL only if a required argument is missing. Do not answer the user."
            }));
        }
    }

    Ok((None, accumulated_thinking))
}

fn push_tool_validation_error(
    request_messages: &mut Vec<Value>,
    tool_call_id: &str,
    native_tool_call: bool,
    error: String,
) {
    if native_tool_call {
        request_messages.push(json!({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": format!("INVALID TOOL CALL: {}", error)
        }));
    } else {
        request_messages.push(json!({
            "role": "user",
            "content": format!("The tool call was invalid: {}. Choose a valid tool call or answer without a tool.", error)
        }));
    }
}

#[tauri::command]
pub async fn agent_jan_chat(
    runtime_prompt: String,
    context_block: String,
    messages: Vec<ReactChatMessage>,
    folders: Vec<String>,
    google_client_id: String,
    google_client_secret: String,
    temperature: f32,
    top_k: u32,
    top_p: f32,
    min_p: f32,
    repeat_last_n: i32,
    repeat_penalty: f32,
    max_tokens: u32,
    thinking_enabled: bool,
) -> Result<ReactChatResult, String> {
    agent_jan_chat_core(
        runtime_prompt,
        context_block,
        messages,
        folders,
        google_client_id,
        google_client_secret,
        SamplingConfig {
            temperature,
            top_k,
            top_p,
            min_p,
            repeat_last_n,
            repeat_penalty,
        },
        max_tokens,
        thinking_enabled,
    )
    .await
}

pub async fn agent_jan_chat_core(
    runtime_prompt: String,
    context_block: String,
    messages: Vec<ReactChatMessage>,
    folders: Vec<String>,
    google_client_id: String,
    google_client_secret: String,
    sampling: SamplingConfig,
    max_tokens: u32,
    thinking_enabled: bool,
) -> Result<ReactChatResult, String> {
    let mut request_messages = Vec::new();
    let system_prompt = [
        read_master_system_prompt(),
        tool_protocol_prompt(),
        reasoning_style_prompt(thinking_enabled).to_string(),
        runtime_prompt.trim().to_string(),
        (!context_block.trim().is_empty())
            .then(|| format!("Runtime context:\n{}", context_block.trim()))
            .unwrap_or_default(),
    ]
    .into_iter()
    .filter(|part| !part.trim().is_empty())
    .collect::<Vec<_>>()
    .join("\n\n");
    if !system_prompt.trim().is_empty() {
        request_messages.push(json!({ "role": "system", "content": system_prompt }));
    }

    for message in messages
        .iter()
        .rev()
        .take(18)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
    {
        if !content_text(&message.content).trim().is_empty() {
            request_messages
                .push(json!({ "role": message.role, "content": chat_content_for_model(message) }));
        }
    }

    let latest_text = latest_user_text(&messages);
    let vi = user_wants_vietnamese(&latest_text) || conversation_wants_vietnamese(&messages);
    let contextual_route = contextual_route_for_messages(&messages);
    let pending_image_proposal = recent_pending_image_proposal(&messages);
    let has_recent_image_context = recent_image_context(&messages);
    let tools = tool_schema();
    let mut accumulated_thinking = String::new();
    let mut tool_trace = Vec::new();
    let mut last_tool: Option<String> = None;
    let mut last_observation: Option<String> = None;
    let mut last_cards: Vec<ToolResultCard> = Vec::new();
    if is_confirmation(&latest_text) {
        if let Some(proposal) = pending_image_proposal.clone() {
            let outcome = image_proposal_outcome(proposal.clone(), vi);
            tool_trace.push(ToolTrace {
                tool: "propose_image_generation".to_string(),
                success: true,
                summary: clean_summary(&outcome.observation),
            });
            return Ok(ReactChatResult {
                answer: image_approval_answer(vi),
                thinking: None,
                tool_used: Some("propose_image_generation".to_string()),
                observation: Some(outcome.observation),
                cards: outcome.cards,
                image_proposal: Some(proposal),
                file_preview: None,
                action_proposal: None,
                tool_trace,
            });
        }
    }

    for step in 0..8 {
        let (planned_tool_call, planner_thinking) = plan_next_tool_call(
            &request_messages,
            &tools,
            sampling,
            &latest_text,
            contextual_route,
            pending_image_proposal.as_ref(),
            has_recent_image_context,
            step,
        )
        .await?;
        append_thinking(&mut accumulated_thinking, &planner_thinking);

        let raw_tool_call = match planned_tool_call {
            Some(raw_tool_call) => raw_tool_call,
            None => {
                let tool_required_this_turn = contextual_route.is_some()
                    || request_effectively_wants_image_generation(
                        &latest_text,
                        pending_image_proposal.as_ref(),
                        has_recent_image_context,
                    );
                if tool_required_this_turn && step < 7 {
                    request_messages.push(json!({
                        "role": "system",
                        "content": "Planner correction: this user turn needs a tool. Produce exactly one valid structured tool call, or output NO_TOOL only when a required argument is missing. Do not answer the user in this planner step."
                    }));
                    continue;
                }
                let final_reply = call_chat(
                    request_messages.clone(),
                    None,
                    sampling,
                    max_tokens,
                    thinking_enabled,
                )
                .await?;
                append_thinking(
                    &mut accumulated_thinking,
                    &extract_chat_reasoning_text(&final_reply),
                );
                let assistant_text = extract_chat_reply_text(&final_reply);
                if let Some((name, arguments, _, _)) =
                    first_model_tool_call(&json!({}), &assistant_text)
                {
                    append_thinking(
                        &mut accumulated_thinking,
                        "Tool protocol repair: the model produced a tool call in assistant text, so the app will treat it as the intended structured tool call instead of showing it to the user.",
                    );
                    ensure_image_tool_call_prompt_english(
                        ToolCall {
                            tool: name,
                            arguments,
                        },
                        &latest_text,
                        sampling,
                    )
                    .await?
                } else if let Some(proposal) = parse_pending_image_proposal_text(&assistant_text) {
                    request_messages.push(json!({
                        "role": "system",
                        "content": format!(
                            "Protocol error: the final answer wrote an image proposal instead of using propose_image_generation in the private planner. Return to planning and produce that tool call there. Proposal mode seen: {}.",
                            proposal.mode
                        )
                    }));
                    continue;
                } else {
                    let leaked_tool_narration =
                        looks_like_unexecuted_tool_narration(&assistant_text);
                    if leaked_tool_narration
                        || (last_observation.is_none()
                            && answer_claims_unverified_tool_result(
                                &assistant_text,
                                &latest_text,
                                contextual_route,
                                pending_image_proposal.as_ref(),
                                has_recent_image_context,
                            ))
                    {
                        if let Some(retry_message) = protocol_retry_for_missing_tool(
                            &latest_text,
                            contextual_route,
                            pending_image_proposal.as_ref(),
                            has_recent_image_context,
                        ) {
                            request_messages.push(json!({
                                "role": "system",
                                "content": retry_message
                            }));
                            continue;
                        }
                        if leaked_tool_narration {
                            request_messages.push(json!({
                                "role": "system",
                                "content": "Protocol error: the final answer exposed tool markup or claimed a tool action without a verified observation. Do not mention tool calls. Either answer directly without tools, or if the user still needs an action, ask for the missing detail plainly."
                            }));
                            continue;
                        }
                        let answer = assistant_text
                            .strip_prefix("RESPONSE:")
                            .unwrap_or(&assistant_text)
                            .trim()
                            .to_string();
                        return Ok(ReactChatResult {
                            answer,
                            thinking: thinking_result(thinking_enabled, &accumulated_thinking),
                            tool_used: last_tool,
                            observation: last_observation,
                            cards: last_cards,
                            image_proposal: None,
                            file_preview: None,
                            action_proposal: None,
                            tool_trace,
                        });
                    } else {
                        let answer = assistant_text
                            .strip_prefix("RESPONSE:")
                            .unwrap_or(&assistant_text)
                            .trim()
                            .to_string();
                        return Ok(ReactChatResult {
                            answer,
                            thinking: thinking_result(thinking_enabled, &accumulated_thinking),
                            tool_used: last_tool,
                            observation: last_observation,
                            cards: last_cards,
                            image_proposal: None,
                            file_preview: None,
                            action_proposal: None,
                            tool_trace,
                        });
                    }
                }
            }
        };

        let tool_call = enrich_contextual_tool_call(raw_tool_call, &messages, &latest_text);
        if let Err(error) = validate_tool_call(&tool_call) {
            push_tool_validation_error(&mut request_messages, "planner_tool_call", false, error);
            continue;
        }
        if let Err(error) = tool_allowed_for_context(&tool_call, &messages) {
            push_tool_validation_error(&mut request_messages, "planner_tool_call", false, error);
            continue;
        }

        let outcome = execute_tool(
            &tool_call,
            &folders,
            &google_client_id,
            &google_client_secret,
        )
        .await;
        let summary = clean_summary(&outcome.observation);
        tool_trace.push(ToolTrace {
            tool: tool_call.tool.clone(),
            success: outcome.success,
            summary: summary.clone(),
        });
        last_tool = Some(tool_call.tool.clone());
        last_observation = Some(outcome.observation.clone());
        last_cards = outcome.cards.clone();

        if let Some(proposal) = outcome.image_proposal {
            return Ok(ReactChatResult {
                answer: image_approval_answer(vi),
                thinking: thinking_result(thinking_enabled, &accumulated_thinking),
                tool_used: last_tool,
                observation: last_observation,
                cards: last_cards,
                image_proposal: Some(proposal),
                file_preview: None,
                action_proposal: None,
                tool_trace,
            });
        }

        if let Some(action) = outcome.action_proposal {
            return Ok(ReactChatResult {
                answer: action_approval_answer(vi),
                thinking: thinking_result(thinking_enabled, &accumulated_thinking),
                tool_used: last_tool,
                observation: last_observation,
                cards: last_cards,
                image_proposal: None,
                file_preview: None,
                action_proposal: Some(action),
                tool_trace,
            });
        }

        if let Some(preview) = outcome.file_preview {
            return Ok(ReactChatResult {
                answer: preview_final_answer(&preview, &latest_text),
                thinking: thinking_result(thinking_enabled, &accumulated_thinking),
                tool_used: last_tool,
                observation: last_observation,
                cards: last_cards,
                image_proposal: None,
                file_preview: Some(preview),
                action_proposal: None,
                tool_trace,
            });
        }

        request_messages.push(json!({
            "role": "user",
            "content": format!(
                "Verified tool result for {}:\n{}\n\nUse this observation to answer naturally. Do not invent facts beyond this observation.",
                tool_call.tool,
                outcome.observation
            ),
        }));

        if step == 7 {
            break;
        }
    }

    request_messages.push(json!({
        "role": "system",
        "content": "Tool loop limit reached. Give the final answer from the verified tool observations already available."
    }));
    let final_reply = call_chat(
        request_messages,
        None,
        sampling,
        max_tokens,
        thinking_enabled,
    )
    .await?;
    append_thinking(
        &mut accumulated_thinking,
        &extract_chat_reasoning_text(&final_reply),
    );
    let answer = extract_chat_reply_text(&final_reply);
    if let Some((name, arguments, _, _)) = first_model_tool_call(&json!({}), &answer) {
        append_thinking(
            &mut accumulated_thinking,
            "Tool protocol repair: the final answer contained a raw tool call, so the app executed it instead of showing the markup.",
        );
        let tool_call = ensure_image_tool_call_prompt_english(
            ToolCall {
                tool: name,
                arguments,
            },
            &latest_text,
            sampling,
        )
        .await?;
        if let Err(error) = validate_tool_call(&tool_call) {
            return Ok(empty_react_result(
                format!("The planned tool call was invalid: {}", error),
                thinking_result(thinking_enabled, &accumulated_thinking),
            ));
        }
        if let Err(error) = tool_allowed_for_context(&tool_call, &messages) {
            return Ok(empty_react_result(
                format!(
                    "The planned tool call did not match this request: {}",
                    error
                ),
                thinking_result(thinking_enabled, &accumulated_thinking),
            ));
        }
        let outcome = execute_tool(
            &tool_call,
            &folders,
            &google_client_id,
            &google_client_secret,
        )
        .await;
        let summary = clean_summary(&outcome.observation);
        tool_trace.push(ToolTrace {
            tool: tool_call.tool.clone(),
            success: outcome.success,
            summary,
        });
        last_tool = Some(tool_call.tool);
        last_observation = Some(outcome.observation.clone());
        last_cards = outcome.cards.clone();

        if let Some(proposal) = outcome.image_proposal {
            return Ok(ReactChatResult {
                answer: image_approval_answer(vi),
                thinking: thinking_result(thinking_enabled, &accumulated_thinking),
                tool_used: last_tool,
                observation: last_observation,
                cards: last_cards,
                image_proposal: Some(proposal),
                file_preview: None,
                action_proposal: None,
                tool_trace,
            });
        }
        if let Some(action) = outcome.action_proposal {
            return Ok(ReactChatResult {
                answer: action_approval_answer(vi),
                thinking: thinking_result(thinking_enabled, &accumulated_thinking),
                tool_used: last_tool,
                observation: last_observation,
                cards: last_cards,
                image_proposal: None,
                file_preview: None,
                action_proposal: Some(action),
                tool_trace,
            });
        }
        if let Some(preview) = outcome.file_preview {
            return Ok(ReactChatResult {
                answer: preview_final_answer(&preview, &latest_text),
                thinking: thinking_result(thinking_enabled, &accumulated_thinking),
                tool_used: last_tool,
                observation: last_observation,
                cards: last_cards,
                image_proposal: None,
                file_preview: Some(preview),
                action_proposal: None,
                tool_trace,
            });
        }

        return Ok(ReactChatResult {
            answer: verified_answer_from_cards(&last_cards, &outcome.observation, &latest_text),
            thinking: thinking_result(thinking_enabled, &accumulated_thinking),
            tool_used: last_tool,
            observation: last_observation,
            cards: last_cards,
            image_proposal: None,
            file_preview: None,
            action_proposal: None,
            tool_trace,
        });
    }
    if answer.trim().is_empty() && last_observation.is_none() {
        return Ok(empty_react_result(
            "I could not produce a final answer.".to_string(),
            thinking_result(thinking_enabled, &accumulated_thinking),
        ));
    }

    Ok(ReactChatResult {
        answer: if answer.trim().is_empty() {
            last_observation.clone().unwrap_or_default()
        } else {
            answer
        },
        thinking: thinking_result(thinking_enabled, &accumulated_thinking),
        tool_used: last_tool,
        observation: last_observation,
        cards: last_cards,
        image_proposal: None,
        file_preview: None,
        action_proposal: None,
        tool_trace,
    })
}

pub async fn agent_jan_chat_no_tools_core(
    runtime_prompt: String,
    context_block: String,
    messages: Vec<ReactChatMessage>,
    sampling: SamplingConfig,
    max_tokens: u32,
    thinking_enabled: bool,
) -> Result<ReactChatResult, String> {
    let system_prompt = [
        read_master_system_prompt(),
        reasoning_style_prompt(thinking_enabled).to_string(),
        runtime_prompt.trim().to_string(),
        (!context_block.trim().is_empty())
            .then(|| format!("Runtime context:\n{}", context_block.trim()))
            .unwrap_or_default(),
        "This Telegram guest turn is chat-only. Do not use tools, do not claim external access, and answer only from the conversation and general knowledge.".to_string(),
    ]
    .into_iter()
    .filter(|part| !part.trim().is_empty())
    .collect::<Vec<_>>()
    .join("\n\n");

    let mut request_messages = Vec::new();
    if !system_prompt.trim().is_empty() {
        request_messages.push(json!({ "role": "system", "content": system_prompt }));
    }
    for message in messages
        .iter()
        .rev()
        .take(24)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
    {
        if !content_text(&message.content).trim().is_empty() {
            request_messages
                .push(json!({ "role": message.role, "content": chat_content_for_model(message) }));
        }
    }

    let assistant_reply = call_chat(
        request_messages,
        None,
        sampling,
        max_tokens,
        thinking_enabled,
    )
    .await?;
    let thinking = extract_chat_reasoning_text(&assistant_reply);
    let choice = assistant_reply
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first());
    let message = choice
        .and_then(|choice| choice.get("message"))
        .cloned()
        .unwrap_or_default();
    let assistant_text = message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    Ok(ReactChatResult {
        answer: assistant_text
            .strip_prefix("RESPONSE:")
            .unwrap_or(&assistant_text)
            .trim()
            .to_string(),
        thinking: thinking_result(thinking_enabled, &thinking),
        tool_used: None,
        observation: None,
        cards: Vec::new(),
        image_proposal: None,
        file_preview: None,
        action_proposal: None,
        tool_trace: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_test_dir(label: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("galaxy_agent_{label}_{unique}"))
    }

    #[test]
    fn rejects_unknown_tool_names() {
        let call = ToolCall {
            tool: "gmail_search_web".to_string(),
            arguments: json!({}),
        };
        assert!(validate_tool_call(&call).is_err());
    }

    #[test]
    fn thinking_result_respects_toggle() {
        assert_eq!(thinking_result(false, "hidden reasoning"), None);
        assert_eq!(
            thinking_result(true, "hidden reasoning"),
            Some("hidden reasoning".to_string())
        );
        assert_eq!(thinking_result(true, "   "), None);
    }

    #[test]
    fn tool_schema_and_validator_names_stay_in_sync() {
        let schema = tool_schema();
        let mut schema_names = schema
            .as_array()
            .expect("tool schema array")
            .iter()
            .filter_map(|tool| {
                tool.get("function")
                    .and_then(|function| function.get("name"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect::<Vec<_>>();
        let mut available = AVAILABLE_TOOL_NAMES
            .iter()
            .map(|name| name.to_string())
            .collect::<Vec<_>>();
        schema_names.sort_unstable();
        available.sort_unstable();
        assert_eq!(schema_names, available);
    }

    #[test]
    fn planner_instruction_for_avatar_requests_forces_avatar_tool_mode() {
        let instruction =
            tool_planner_instruction("gửi ảnh của em cho anh xem", None, None, false, 0);
        assert!(instruction.contains("PRIVATE TOOL PLANNER"));
        assert!(instruction.contains("mode avatar_image"));
        assert!(instruction.contains("one structured tool call"));
    }

    #[test]
    fn planner_instruction_allows_no_tool_for_normal_conversation() {
        let instruction = tool_planner_instruction("hôm nay em thế nào", None, None, false, 0);
        assert!(instruction.contains("NO_TOOL for normal conversation"));
        assert!(instruction.contains("Never write a user-facing answer"));
        assert!(instruction.contains("not isolated words"));
        assert!(instruction.contains("ask a short clarification"));
    }

    #[test]
    fn reasoning_style_asks_for_brief_uncertainty_handling() {
        let instruction = reasoning_style_prompt(true);
        assert!(instruction.contains("think briefly"));
        assert!(instruction.contains("ask one short clarifying question"));
    }

    #[test]
    fn vietnamese_image_generation_intent_uses_unicode_terms() {
        assert!(request_effectively_wants_image_generation(
            "em vẽ cho anh hình ảnh một cái lắc tay thật đẹp làm quà xem nào",
            None,
            false
        ));
        assert!(request_wants_avatar_image_generation(
            "em gửi ảnh của em đang ngồi trong ô tô cho anh xem"
        ));
    }

    #[test]
    fn media_preview_followup_keeps_previous_media_route() {
        let messages = vec![
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("tìm cho anh 1 ảnh nào đó trong workspace cho anh xem"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Em đã tìm thấy và mở 20230904_112601.jpg cho anh.\nPath: D:\\Pics\\20230904_112601.jpg"),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("ảnh khác đi"),
            },
        ];
        assert_eq!(
            contextual_route_for_messages(&messages),
            Some(ToolRoute::MediaPreview)
        );
    }

    #[test]
    fn thai_song_correction_keeps_media_route() {
        let messages = vec![
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("mở bài hát nào đó có tiếng Thái Lan đi"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!(
                    "Em đã tìm thấy và mở 09 Retro.m4a cho anh.\nPath: D:\\Music\\09 Retro.m4a"
                ),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("bài hát tiếng Thái Lan cơ mà"),
            },
        ];
        assert_eq!(
            contextual_route_for_messages(&messages),
            Some(ToolRoute::MediaPreview)
        );
    }

    #[test]
    fn thai_media_request_builds_language_constraints() {
        let terms = media_constraint_terms("mở bài hát tiếng Thái Lan khác đi", None);
        assert!(terms.iter().any(|term| term == "thai"));
        assert!(terms.iter().any(|term| term == "thais"));
        let thai_file = file_tools::FileSearchResult {
            path: "D:\\Music\\Thais\\001.ลมหนาว.mp3".to_string(),
            name: "001.ลมหนาว.mp3".to_string(),
            folder: "D:\\Music\\Thais".to_string(),
            extension: "mp3".to_string(),
            size_bytes: 100,
        };
        let other_file = file_tools::FileSearchResult {
            path: "D:\\Music\\Pop\\song.mp3".to_string(),
            name: "song.mp3".to_string(),
            folder: "D:\\Music\\Pop".to_string(),
            extension: "mp3".to_string(),
            size_bytes: 100,
        };
        assert!(media_matches_constraints(&thai_file, &terms));
        assert!(!media_matches_constraints(&other_file, &terms));
    }

    #[test]
    fn vietnamese_media_request_builds_language_constraints() {
        let terms = media_constraint_terms("mở cho anh một bài hát tiếng Việt khác đi", None);
        assert!(terms.iter().any(|term| term == "viet"));
        assert!(terms.iter().any(|term| term == "vietnam"));
        let vietnamese_file = file_tools::FileSearchResult {
            path: "D:\\Music\\My Viet fav\\Em ke anh nghe - Linh Phi.mp3".to_string(),
            name: "Em ke anh nghe - Linh Phi.mp3".to_string(),
            folder: "D:\\Music\\My Viet fav".to_string(),
            extension: "mp3".to_string(),
            size_bytes: 100,
        };
        let other_file = file_tools::FileSearchResult {
            path: "D:\\Music\\Pop\\song.mp3".to_string(),
            name: "song.mp3".to_string(),
            folder: "D:\\Music\\Pop".to_string(),
            extension: "mp3".to_string(),
            size_bytes: 100,
        };
        assert!(media_matches_constraints(&vietnamese_file, &terms));
        assert!(!media_matches_constraints(&other_file, &terms));
    }

    #[test]
    fn english_media_request_accepts_latin_media_without_language_label() {
        let terms = media_constraint_terms("play an English song for me", None);
        assert!(terms.iter().any(|term| term == "__latin_english_media__"));
        let english_file = file_tools::FileSearchResult {
            path: "D:\\Music\\Rock\\05 - My Way.MP3".to_string(),
            name: "05 - My Way.MP3".to_string(),
            folder: "D:\\Music\\Rock".to_string(),
            extension: "mp3".to_string(),
            size_bytes: 100,
        };
        let thai_file = file_tools::FileSearchResult {
            path: "D:\\Music\\Thais\\001.ลมหนาว.mp3".to_string(),
            name: "001.ลมหนาว.mp3".to_string(),
            folder: "D:\\Music\\Thais".to_string(),
            extension: "mp3".to_string(),
            size_bytes: 100,
        };
        let vietnamese_file = file_tools::FileSearchResult {
            path: "D:\\Music\\Nhạc Việt\\Bài hát.mp3".to_string(),
            name: "Bài hát.mp3".to_string(),
            folder: "D:\\Music\\Nhạc Việt".to_string(),
            extension: "mp3".to_string(),
            size_bytes: 100,
        };
        assert!(media_matches_constraints(&english_file, &terms));
        assert!(!media_matches_constraints(&thai_file, &terms));
        assert!(!media_matches_constraints(&vietnamese_file, &terms));
    }

    #[test]
    fn generic_song_query_does_not_filter_random_audio() {
        let terms =
            media_constraint_terms("mở cho anh một bài hát nào đó nghe đi", Some("bài hát"));
        assert!(
            terms.is_empty(),
            "generic media labels should not become filename constraints: {:?}",
            terms
        );
    }

    #[test]
    fn search_result_can_be_promoted_to_audio_preview() {
        let root = temp_test_dir("audio_preview");
        std::fs::create_dir_all(&root).expect("create temp dir");
        let path = root.join("Get Down.mp3");
        std::fs::write(&path, b"not a real mp3 but previewable bytes").expect("write temp mp3");

        let result = file_tools::FileSearchResult {
            path: path.to_string_lossy().to_string(),
            name: "Get Down.mp3".to_string(),
            folder: root.to_string_lossy().to_string(),
            extension: "mp3".to_string(),
            size_bytes: 32,
        };
        let preview = first_previewable_search_result(
            &[result],
            &[root.to_string_lossy().to_string()],
            "find get down and play it",
        )
        .expect("audio preview");

        assert_eq!(preview.name, "Get Down.mp3");
        assert_eq!(preview.mime_type, "audio/mpeg");
        assert!(preview
            .data_url
            .unwrap_or_default()
            .starts_with("data:audio/mpeg;base64,"));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn image_prompt_validator_requires_mainly_english_prompt() {
        let call = ToolCall {
            tool: "propose_image_generation".to_string(),
            arguments: json!({
                "prompt": "Jasmine đang ngồi tắm suối nước nóng, phong cách ảnh chân thực",
                "mode": "avatar_image"
            }),
        };
        assert!(validate_tool_call(&call).is_err());

        let call = ToolCall {
            tool: "propose_image_generation".to_string(),
            arguments: json!({
                "prompt": "A photorealistic image of Jasmine sitting in a hot spring with natural lighting.",
                "mode": "avatar_image"
            }),
        };
        assert!(validate_tool_call(&call).is_ok());

        let call = ToolCall {
            tool: "propose_image_generation".to_string(),
            arguments: json!({
                "prompt": "A cinematic portrait of Tiến sitting inside a futuristic supercar in Hà Nội at night, dramatic neon reflections, confident mood.",
                "mode": "user_avatar_image"
            }),
        };
        assert!(validate_tool_call(&call).is_ok());

        let call = ToolCall {
            tool: "propose_image_generation".to_string(),
            arguments: json!({
                "prompt": "A cyberpunk poster for nhân vật Linsey, with the Vietnamese title text 'Đêm tốc độ' glowing on the wall.",
                "mode": "text_to_image"
            }),
        };
        assert!(validate_tool_call(&call).is_ok());
    }

    #[test]
    fn user_avatar_image_requests_select_user_avatar_modes() {
        assert!(request_wants_user_avatar_image_generation(
            "tạo ảnh từ avatar anh đang ngồi trong quán cà phê"
        ));
        assert!(request_targets_user_and_character_images(
            "tạo ảnh anh và em đang đi dạo ngoài phố"
        ));
    }

    #[test]
    fn image_request_requires_planner_tool_call() {
        assert!(request_effectively_wants_image_generation(
            "em vẽ cho anh hình ảnh một cái lắc tay thật đẹp làm quà xem nào",
            None,
            false,
        ));
        assert!(!request_effectively_wants_image_generation(
            "anh cần ảnh đường phố nhà cửa hiện đại đổ nát",
            None,
            false,
        ));
    }

    #[test]
    fn image_generation_request_is_not_misrouted_as_media_preview() {
        let text = "hay bây giờ em tạo ảnh khác ở khu vực hồ gươm, nhìn thấy hồ gươm anh xem";
        assert!(request_effectively_wants_image_generation(text, None, true));
        assert_eq!(route_for_request(text), None);
    }

    #[test]
    fn leaked_tool_markup_is_parseable_for_protocol_repair() {
        let text = r#"<|tool_call>call:propose_image_generation{"prompt":"A view of Hoan Kiem Lake in Hanoi.","mode":"text_to_image"}<tool_call|>"#;
        let parsed = first_model_tool_call(&json!({}), text).expect("tool call");
        assert_eq!(parsed.0, "propose_image_generation");
        assert_eq!(
            parsed.1.get("prompt").and_then(Value::as_str),
            Some("A view of Hoan Kiem Lake in Hanoi.")
        );
    }

    #[test]
    fn thinking_append_deduplicates_repeated_blocks() {
        let mut thinking = String::new();
        append_thinking(&mut thinking, "Plan image tool.\n\nPlan image tool.");
        append_thinking(&mut thinking, "Plan image tool.");
        assert_eq!(thinking.matches("Plan image tool.").count(), 1);
    }

    #[test]
    fn planner_sampling_is_deterministic_without_changing_repeat_controls() {
        let sampling = SamplingConfig {
            temperature: 0.8,
            top_k: 40,
            top_p: 0.9,
            min_p: 0.1,
            repeat_last_n: 128,
            repeat_penalty: 1.15,
        };
        let planned = planner_sampling(sampling);
        assert_eq!(planned.temperature, 0.0);
        assert_eq!(planned.top_k, 1);
        assert_eq!(planned.repeat_last_n, 128);
        assert_eq!(planned.repeat_penalty, 1.15);
    }

    #[test]
    fn route_guard_allows_future_tools_by_category() {
        let gmail = ToolCall {
            tool: "gmail_search".to_string(),
            arguments: json!({}),
        };
        let calendar = ToolCall {
            tool: "propose_calendar_update".to_string(),
            arguments: json!({}),
        };
        let google = ToolCall {
            tool: "google_drive_read".to_string(),
            arguments: json!({}),
        };
        let media = ToolCall {
            tool: "preview_workspace_media".to_string(),
            arguments: json!({}),
        };
        assert!(tool_allowed_for_route_kind(&gmail, Some(ToolRoute::Gmail)).is_ok());
        assert!(tool_allowed_for_route_kind(&calendar, Some(ToolRoute::Calendar)).is_ok());
        assert!(tool_allowed_for_route_kind(&google, Some(ToolRoute::GoogleWorkspace)).is_ok());
        assert!(tool_allowed_for_route_kind(&media, Some(ToolRoute::MediaPreview)).is_ok());
    }

    #[test]
    fn attaches_user_text_to_tool_arguments() {
        let call = ToolCall {
            tool: "gmail_recent".to_string(),
            arguments: json!({ "count": 3 }),
        };
        let call = with_user_text(call, "kiem tra mail");
        assert_eq!(
            call.arguments.get("_user_text").and_then(Value::as_str),
            Some("kiem tra mail")
        );
    }

    #[test]
    fn gmail_card_preserves_verified_message_ids_and_links() {
        let messages = vec![google_calendar::GoogleMailMessage {
            id: "msg-1".to_string(),
            thread_id: "thread-1".to_string(),
            subject: "Subject".to_string(),
            from: "sender@example.com".to_string(),
            date: "Today".to_string(),
            internal_date: Some(123),
            snippet: "Preview".to_string(),
            web_link: "https://mail.google.com/mail/u/0/#inbox/msg-1".to_string(),
        }];
        let card = gmail_card(&messages);
        assert_eq!(card.items.len(), 1);
        assert_eq!(
            card.items[0].url.as_deref(),
            Some("https://mail.google.com/mail/u/0/#inbox/msg-1")
        );
        assert!(card.items[0]
            .details
            .iter()
            .any(|field| field.label == "Message ID" && field.value == "msg-1"));
    }

    #[test]
    fn verified_gmail_answer_uses_card_data() {
        let messages = vec![google_calendar::GoogleMailMessage {
            id: "msg-1".to_string(),
            thread_id: "thread-1".to_string(),
            subject: "Real subject".to_string(),
            from: "sender@example.com".to_string(),
            date: "Today".to_string(),
            internal_date: Some(123),
            snippet: "Real preview".to_string(),
            web_link: "https://mail.google.com/mail/u/0/#inbox/msg-1".to_string(),
        }];
        let cards = vec![gmail_card(&messages)];
        let answer = verified_answer_from_cards(&cards, "fallback", "show 1 email");
        assert!(answer.contains("Real subject"));
        assert!(answer.contains("sender@example.com"));
        assert!(!answer.contains("fallback"));
    }

    #[test]
    fn calendar_card_preserves_verified_event_ids() {
        let events = vec![google_calendar::GoogleCalendarEvent {
            id: "event-1".to_string(),
            title: "Meeting".to_string(),
            start: "2026-06-01T09:00:00+07:00".to_string(),
            end: "2026-06-01T10:00:00+07:00".to_string(),
            all_day: false,
            location: Some("Office".to_string()),
            description: None,
            html_link: Some("https://calendar.google.com/event?eid=1".to_string()),
        }];
        let card = calendar_card(&events);
        assert_eq!(card.items.len(), 1);
        assert!(card.items[0]
            .details
            .iter()
            .any(|field| field.label == "Event ID" && field.value == "event-1"));
    }

    #[test]
    fn routes_mailbox_to_gmail_hint() {
        assert_eq!(
            route_for_request("check my mailbox and show 5 newest mails"),
            Some(ToolRoute::Gmail)
        );
    }

    #[test]
    fn routes_workspace_search_to_file_search_hint() {
        assert_eq!(
            route_for_request("find file report in workspace"),
            Some(ToolRoute::FileSearch)
        );
    }

    #[test]
    fn routes_external_info_lookup_to_web_search_hint() {
        assert_eq!(
            route_for_request("search web for apartment prices in hanoi 2026"),
            Some(ToolRoute::WebSearch)
        );
    }

    #[test]
    fn routes_google_workspace_requests_to_google_workspace_hint() {
        assert_eq!(
            route_for_request("find the Google Sheet budget 2026 in Drive"),
            Some(ToolRoute::GoogleWorkspace)
        );
    }

    #[test]
    fn routes_google_contacts_requests_to_google_workspace_hint() {
        assert_eq!(
            route_for_request("show my Google contacts list"),
            Some(ToolRoute::GoogleWorkspace)
        );
    }

    #[test]
    fn routes_audio_request_to_media_preview_hint() {
        assert_eq!(
            route_for_request("mở một file âm thanh bất kỳ"),
            Some(ToolRoute::MediaPreview)
        );
    }

    #[test]
    fn conversational_vietnamese_nghe_particle_does_not_route_to_audio() {
        let text = "chị Linh cần gì thì nhớ hỗ trợ nghe chưa em";
        assert_eq!(inferred_media_kind(text), None);
        assert_eq!(route_for_request(text), None);
        assert!(!random_media_preview_allowed(text, false));
    }

    #[test]
    fn conversational_vietnamese_nghe_particle_blocks_media_tool_call() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("chị Linh cần gì thì nhớ hỗ trợ nghe chưa em"),
        }];
        let call = ToolCall {
            tool: "preview_random_media".to_string(),
            arguments: json!({ "kind": "audio" }),
        };
        assert!(tool_allowed_for_context(&call, &messages).is_err());
    }

    #[test]
    fn explicit_vietnamese_music_request_still_routes_to_audio() {
        assert_eq!(
            route_for_request("mở bài hát cho anh nghe"),
            Some(ToolRoute::MediaPreview)
        );
        assert_eq!(
            route_for_request("cho anh nghe một bài nhạc bất kỳ"),
            Some(ToolRoute::MediaPreview)
        );
    }

    #[test]
    fn deterministic_preview_routes_broad_audio_without_model_text() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("em mở một bài hát bất kỳ trong workspace đi"),
        }];
        let call = deterministic_preview_call(&messages).expect("deterministic preview call");
        assert_eq!(call.tool, "preview_random_media");
        assert_eq!(
            call.arguments.get("kind").and_then(Value::as_str),
            Some("audio")
        );
    }

    #[test]
    fn detects_unexecuted_tool_narration_as_not_verified_answer() {
        assert!(looks_like_unexecuted_tool_narration(
            "*Calling preview_random_media for audio...*\n[Bai hat will be displayed here]"
        ));
        assert!(looks_like_unexecuted_tool_narration(
            "Em sẽ gọi hàm preview_random_media rồi hiển thị kết quả tool."
        ));
        assert!(!looks_like_unexecuted_tool_narration(
            "Dạ, em đã mở bài hát này cho anh."
        ));
    }

    #[test]
    fn deterministic_preview_uses_previous_kind_for_another_request() {
        let messages = vec![
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("em mở một bài hát bất kỳ"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!(
                    r"File preview shown in this conversation:
Title: song.mp3
Type: audio/mpeg
Path: D:\Music\song.mp3"
                ),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("mở bài khác đi"),
            },
        ];
        let call = deterministic_preview_call(&messages).expect("deterministic preview call");
        assert_eq!(
            call.arguments.get("kind").and_then(Value::as_str),
            Some("audio")
        );
        let excludes = call
            .arguments
            .get("exclude_paths")
            .and_then(Value::as_array)
            .expect("exclude paths");
        assert_eq!(
            excludes.first().and_then(Value::as_str),
            Some(r"D:\Music\song.mp3")
        );
    }

    #[test]
    fn model_chosen_media_followup_is_enriched_from_preview_context() {
        let messages = vec![
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("mở một bài hát ngẫu nhiên trong workspace đi"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!(
                    r"File preview shown in this conversation:
Title: song.mp3
Type: audio/mpeg
Path: D:\Music\song.mp3"
                ),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("bài khác đi"),
            },
        ];
        assert!(deterministic_preview_call(&messages).is_none());
        let call = enrich_contextual_tool_call(
            ToolCall {
                tool: "preview_random_media".to_string(),
                arguments: json!({ "kind": "any" }),
            },
            &messages,
            "bài khác đi",
        );
        assert_eq!(call.tool, "preview_random_media");
        assert_eq!(
            call.arguments.get("kind").and_then(Value::as_str),
            Some("audio")
        );
        assert_eq!(
            call.arguments
                .get("_preview_context")
                .and_then(Value::as_str),
            Some("follow_up")
        );
        assert_eq!(
            call.arguments
                .get("exclude_paths")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(Value::as_str),
            Some(r"D:\Music\song.mp3")
        );
    }

    #[test]
    fn accented_image_request_overrides_previous_audio_context() {
        let messages = vec![
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("mở một bài hát bất kỳ"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!(
                    r"File preview shown in this conversation:
Title: song.mp3
Type: audio/mpeg
Path: D:\Music\song.mp3"
                ),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("mở ảnh khác"),
            },
        ];
        let call = deterministic_preview_call(&messages).expect("deterministic preview call");
        assert_eq!(call.tool, "preview_random_media");
        assert_eq!(
            call.arguments.get("kind").and_then(Value::as_str),
            Some("image")
        );
    }

    #[test]
    fn assistant_self_image_request_is_avatar_generation_not_media_preview() {
        let text = "send me your picture in a bathtub";
        assert!(request_wants_avatar_image_generation(text));
        assert_eq!(route_for_request(text), None);
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!(text),
        }];
        assert!(deterministic_preview_call(&messages).is_none());
        let media_call = with_user_text(
            ToolCall {
                tool: "preview_random_media".to_string(),
                arguments: json!({ "kind": "image" }),
            },
            text,
        );
        assert!(tool_allowed_for_context(&media_call, &messages).is_err());
    }

    #[test]
    fn assistant_self_image_request_forces_avatar_mode() {
        let call = with_user_text(
            ToolCall {
                tool: "propose_image_generation".to_string(),
                arguments: json!({
                    "mode": "text_to_image",
                    "prompt": "Jasmine in a cinematic bathtub portrait"
                }),
            },
            "send me your picture in a bathtub",
        );
        let proposal = parse_image_proposal(&call).expect("image proposal");
        assert_eq!(proposal.mode, "avatar_image");
    }

    #[test]
    fn correction_with_bao_and_anh_stays_media_not_weather() {
        let text = "anh bảo mở ảnh cơ mà";
        assert_eq!(inferred_media_kind(text), Some("image"));
        assert_eq!(route_for_request(text), Some(ToolRoute::MediaPreview));
        assert!(!request_mentions_weather(text));
    }

    #[test]
    fn accented_vietnamese_weather_keeps_tone_distinctions() {
        assert!(request_mentions_weather("ngoài đó có bão không?"));
        assert_eq!(
            route_for_request("dự báo thời tiết Hà Nội hôm nay"),
            Some(ToolRoute::Weather)
        );
        assert!(!request_mentions_weather("anh bảo em mở ảnh cơ mà"));
    }

    #[test]
    fn deterministic_preview_does_not_randomize_named_file_open() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("open the file named report.pdf"),
        }];
        assert!(deterministic_preview_call(&messages).is_none());
    }

    #[test]
    fn deterministic_preview_does_not_treat_article_summary_as_media() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("tong hop thong tin cac bai tren lai cho anh mot cach ngan gon"),
        }];
        assert!(deterministic_preview_call(&messages).is_none());
        assert!(!random_media_preview_allowed(
            "tong hop thong tin cac bai tren lai cho anh mot cach ngan gon",
            false
        ));
    }

    #[test]
    fn random_media_preview_follow_up_requires_explicit_context() {
        assert!(!random_media_preview_allowed("ok", false));
        assert!(random_media_preview_allowed("ok", true));
    }

    #[test]
    fn deterministic_gmail_routes_recent_mail_requests() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("5 mail gần nhất là được rồi"),
        }];
        let call = deterministic_gmail_call(&messages).expect("deterministic gmail call");
        assert_eq!(call.tool, "gmail_recent");
        assert_eq!(call.arguments.get("count").and_then(Value::as_u64), Some(5));
    }

    #[test]
    fn deterministic_calendar_routes_read_requests() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("check my schedule today"),
        }];
        let call = deterministic_calendar_call(&messages).expect("deterministic calendar call");
        assert_eq!(call.tool, "google_calendar_check");
        let expected = Local::now().date_naive().format("%Y-%m-%d").to_string();
        assert_eq!(
            call.arguments.get("date").and_then(Value::as_str),
            Some(expected.as_str())
        );
    }

    #[test]
    fn deterministic_calendar_routes_month_requests() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("kiểm tra lịch trình tháng 6"),
        }];
        let call = deterministic_calendar_call(&messages).expect("deterministic calendar call");
        assert_eq!(call.tool, "google_calendar_check");
        let expected = format!("{}-06", Local::now().year());
        assert_eq!(
            call.arguments.get("date").and_then(Value::as_str),
            Some(expected.as_str())
        );
    }

    #[test]
    fn deterministic_calendar_leaves_write_requests_for_approval_path() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("add a calendar event tomorrow at 9"),
        }];
        assert!(deterministic_calendar_call(&messages).is_none());
    }

    #[test]
    fn deterministic_web_search_routes_external_lookup_requests() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("search web for apartment prices in hanoi 2026"),
        }];
        let call = deterministic_web_search_call(&messages).expect("deterministic web search call");
        assert_eq!(call.tool, "web_search");
        assert_eq!(
            call.arguments.get("query").and_then(Value::as_str),
            Some("search web for apartment prices in hanoi 2026")
        );
    }

    #[test]
    fn contextual_route_keeps_weather_location_followup_in_weather_lane() {
        let messages = vec![
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("anh cần thông tin cụ thể thời tiết 7 ngày tới"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Cần khu vực cụ thể."),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("ở Hà Nội em nhé"),
            },
        ];
        assert_eq!(
            contextual_route_for_messages(&messages),
            Some(ToolRoute::Weather)
        );
        let call = deterministic_weather_call(&messages).expect("deterministic weather call");
        assert_eq!(call.tool, "weather_forecast");
        assert_eq!(
            call.arguments.get("location").and_then(Value::as_str),
            Some("Hà Nội")
        );
    }

    #[test]
    fn contextual_route_blocks_media_tool_for_weather_followup() {
        let messages = vec![
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("dự báo thời tiết 7 ngày tới ở Hà Nội"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Co the tim tren web."),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("oke em xem rồi cho anh kết quả, đừng gửi link"),
            },
        ];
        let call = with_user_text(
            ToolCall {
                tool: "preview_random_media".to_string(),
                arguments: json!({ "kind": "image" }),
            },
            "oke em xem rồi cho anh kết quả, đừng gửi link",
        );
        assert_eq!(
            contextual_route_for_messages(&messages),
            Some(ToolRoute::Weather)
        );
        assert!(tool_allowed_for_context(&call, &messages).is_err());
    }

    #[test]
    fn deterministic_preview_does_not_hijack_weather_followup_after_media() {
        let messages = vec![
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("mở một bài hát bất kỳ trong workspace"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Đã mở bài hát cho anh."),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("anh muốn biết thời tiết cuối tuần này thế nào?"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Đã tìm thấy 5 nguồn web mới."),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("có mưa ko?"),
            },
        ];
        assert_eq!(
            contextual_route_for_messages(&messages),
            Some(ToolRoute::Weather)
        );
        assert!(deterministic_preview_call(&messages).is_none());
    }

    #[test]
    fn deterministic_weather_uses_previous_location_for_rain_followup() {
        let messages = vec![
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("anh muốn biết thời tiết cuối tuần này ở Hà Nội"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Đã có dữ liệu."),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("có mưa không?"),
            },
        ];
        let call = deterministic_weather_call(&messages).expect("deterministic weather call");
        assert_eq!(call.tool, "weather_forecast");
        assert_eq!(
            call.arguments.get("location").and_then(Value::as_str),
            Some("Hà Nội")
        );
        assert_eq!(call.arguments.get("days").and_then(Value::as_u64), Some(4));
    }

    #[test]
    fn deterministic_weather_strips_vietnamese_question_tail_from_location() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("cũng được, em xem thời tiết cuối tuần này ở Hà Nội thế nào?"),
        }];
        let call = deterministic_weather_call(&messages).expect("deterministic weather call");
        assert_eq!(call.tool, "weather_forecast");
        assert_eq!(
            call.arguments.get("location").and_then(Value::as_str),
            Some("Hà Nội")
        );
        assert_eq!(call.arguments.get("days").and_then(Value::as_u64), Some(4));
    }

    #[test]
    fn deterministic_weather_extracts_location_without_preposition() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("thời tiết Hà Nội ngày mai thế nào?"),
        }];
        let call = deterministic_weather_call(&messages).expect("deterministic weather call");
        assert_eq!(call.tool, "weather_forecast");
        assert_eq!(
            call.arguments.get("location").and_then(Value::as_str),
            Some("Hà Nội")
        );
        assert!(weather_missing_location_reply(&messages).is_none());
    }

    #[test]
    fn weather_focus_date_detects_tomorrow_request() {
        let expected = Local::now().date_naive() + Duration::days(1);
        assert_eq!(
            weather_requested_focus_date(
                "Check th\u{1edd}i ti\u{1ebf}t H\u{00e0} N\u{1ed9}i ng\u{00e0}y mai."
            )
            .map(|item| item.0),
            Some(expected)
        );
        assert_eq!(
            weather_requested_focus_date("Check Hanoi weather tomorrow.").map(|item| item.0),
            Some(expected)
        );
    }

    #[test]
    fn weather_request_without_location_does_not_guess_fake_location() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("em xem tuần sau thời tiết như thế nào?"),
        }];
        assert_eq!(
            contextual_route_for_messages(&messages),
            Some(ToolRoute::Weather)
        );
        assert!(deterministic_weather_call(&messages).is_none());
        assert!(weather_missing_location_reply(&messages).is_some());
    }

    #[test]
    fn casual_weather_observation_stays_in_chat() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("hôm nay trời mưa xầm xì quá"),
        }];
        assert_eq!(route_for_request("hôm nay trời mưa xầm xì quá"), None);
        assert!(request_is_conversational_turn(
            "hôm nay trời mưa xầm xì quá"
        ));
        assert_eq!(
            weather_location_from_text("hôm nay trời mưa xầm xì quá"),
            None
        );
        assert_eq!(contextual_route_for_messages(&messages), None);
        assert!(deterministic_weather_call(&messages).is_none());
    }

    #[test]
    fn bare_location_followup_after_weather_request_routes_weather() {
        let messages = vec![
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("em xem tuần sau thời tiết như thế nào?"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Anh muốn xem thời tiết ở khu vực nào?"),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("Hà Nội nhé"),
            },
        ];
        assert_eq!(
            contextual_route_for_messages(&messages),
            Some(ToolRoute::Weather)
        );
        let call = deterministic_weather_call(&messages).expect("deterministic weather call");
        assert_eq!(
            call.arguments.get("location").and_then(Value::as_str),
            Some("Hà Nội")
        );
    }

    #[test]
    fn short_emotional_reply_does_not_inherit_weather_route() {
        let messages = vec![
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("anh muốn biết thời tiết cuối tuần này ở Hà Nội"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Đã có dữ liệu."),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("chán chết"),
            },
        ];
        assert_eq!(contextual_route_for_messages(&messages), None);
        assert!(deterministic_weather_call(&messages).is_none());
    }

    #[test]
    fn explanation_followup_blocks_web_search_tool_call() {
        let messages = vec![
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Thời tiết cuối tuần này ở Hà Nội sẽ có mưa nhiều."),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("thế lần sau em giải thích luôn cho anh dễ hiểu nhé"),
            },
        ];
        let call = with_user_text(
            ToolCall {
                tool: "web_search".to_string(),
                arguments: json!({ "query": "thế lần sau em giải thích luôn cho anh dễ hiểu nhé" }),
            },
            "thế lần sau em giải thích luôn cho anh dễ hiểu nhé",
        );
        assert!(tool_allowed_for_context(&call, &messages).is_err());
    }

    #[test]
    fn conversational_turn_does_not_route_to_web_search() {
        assert_eq!(route_for_request("em có vui khi gặp anh ko"), None);
        assert!(request_is_conversational_turn("em có vui khi gặp anh ko"));
        assert!(!request_wants_web_search("em có vui khi gặp anh ko"));
    }

    #[test]
    fn conversational_turn_blocks_web_search_tool_call() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("em có vui khi gặp anh ko"),
        }];
        let call = with_user_text(
            ToolCall {
                tool: "web_search".to_string(),
                arguments: json!({ "query": "em có vui khi gặp anh ko" }),
            },
            "em có vui khi gặp anh ko",
        );
        assert!(tool_allowed_for_context(&call, &messages).is_err());
    }

    #[test]
    fn parses_inline_tool_markup_for_web_search() {
        let parsed = parse_inline_tool_markup(
            r#"<tool_call>{"name":"web_search","arguments":{"query":"thời tiết Hà Nội tuần sau"}}</tool_call>"#,
        )
        .expect("parsed inline tool markup");
        assert_eq!(parsed.0, "web_search");
        assert_eq!(
            parsed.1.get("query").and_then(Value::as_str),
            Some("thời tiết Hà Nội tuần sau")
        );
    }

    #[test]
    fn inline_tool_markup_recovers_prose_wrapped_calls() {
        let parsed = parse_inline_tool_markup(
            r#"I will call this now: <tool_call>{"name":"web_search","arguments":{"query":"x"}}</tool_call>"#,
        )
        .expect("parsed prose-wrapped tool markup");
        assert_eq!(parsed.0, "web_search");
        assert_eq!(parsed.1.get("query").and_then(Value::as_str), Some("x"));
    }

    #[test]
    fn native_model_tool_call_is_parsed_without_assistant_text() {
        let message = json!({
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "call_1",
                "type": "function",
                "function": {
                    "name": "weather_forecast",
                    "arguments": "{\"location\":\"Ha Noi\",\"days\":2}"
                }
            }]
        });
        let parsed = first_model_tool_call(&message, "").expect("native tool call");
        assert_eq!(parsed.0, "weather_forecast");
        assert_eq!(parsed.2, "call_1");
        assert!(parsed.3);
        assert_eq!(
            parsed.1.get("location").and_then(Value::as_str),
            Some("Ha Noi")
        );
        assert_eq!(parsed.1.get("days").and_then(Value::as_u64), Some(2));
    }

    #[test]
    fn exact_fallback_tool_markup_is_parsed_without_prose() {
        let parsed = first_model_tool_call(
            &json!({ "role": "assistant", "content": null }),
            r#"<tool_call>{"name":"gmail_recent","arguments":{"count":3}}</tool_call>"#,
        )
        .expect("fallback tool call");
        assert_eq!(parsed.0, "gmail_recent");
        assert_eq!(parsed.1.get("count").and_then(Value::as_u64), Some(3));
        assert!(!parsed.3);
    }

    #[test]
    fn prose_wrapped_tool_markup_is_recovered() {
        let text = r#"I will call this now: <tool_call>{"name":"web_search","arguments":{"query":"x"}}</tool_call>"#;
        let parsed = first_model_tool_call(&json!({}), text).expect("fallback tool call");
        assert_eq!(parsed.0, "web_search");
        assert_eq!(parsed.1.get("query").and_then(Value::as_str), Some("x"));
        assert!(!parsed.3);
    }

    #[test]
    fn function_style_tool_code_is_recovered() {
        let text = r#"
Em gọi tool đây:
<tool_code>
propose_image_generation(mask_prompt="sky and clouds", mode="image_to_image", prompt="blue sky with white clouds")
</tool_code>
"#;
        let parsed = first_model_tool_call(&json!({}), text).expect("function style call");
        assert_eq!(parsed.0, "propose_image_generation");
        assert_eq!(
            parsed.1.get("mode").and_then(Value::as_str),
            Some("image_to_image")
        );
        assert_eq!(
            parsed.1.get("mask_prompt").and_then(Value::as_str),
            Some("sky and clouds")
        );
        assert!(!parsed.3);
    }

    #[test]
    fn tagged_json_tool_call_with_description_is_recovered() {
        let text = r#"<tool_call>{"name":"propose_image_generation","arguments":{"description":"A neon supercar racing through rain at night."}}</tool_call>"#;
        let parsed = first_model_tool_call(&json!({}), text).expect("fallback tool call");
        assert_eq!(parsed.0, "propose_image_generation");
        let proposal = parse_image_proposal(&ToolCall {
            tool: parsed.0,
            arguments: parsed.1,
        })
        .expect("image proposal");
        assert_eq!(
            proposal.prompt,
            "A neon supercar racing through rain at night."
        );
        assert_eq!(proposal.mode, "text_to_image");
    }

    #[test]
    fn malformed_reasoning_tool_call_is_recovered() {
        let message = json!({
            "role": "assistant",
            "content": "I can do that.",
            "reasoning_content": r#"<tool_call>call:propose_image_generation(mode:<"avatar_image<", prompt:<"full body character portrait">"#,
        });
        let parsed =
            first_model_tool_call(&message, "I can do that.").expect("reasoning tool call");
        assert_eq!(parsed.0, "propose_image_generation");
        assert_eq!(
            parsed.1.get("mode").and_then(Value::as_str),
            Some("avatar_image")
        );
        assert_eq!(
            parsed.1.get("prompt").and_then(Value::as_str),
            Some("full body character portrait")
        );
    }

    #[test]
    fn malformed_angle_pipe_tool_call_is_recovered() {
        let text = r#"<|tool_call>call:propose_image_generation{"visual_prompt":"A portrait of Jasmine on a beach. Mode: avatar_image"}"#;
        let parsed = first_model_tool_call(&json!({}), text).expect("fallback tool call");
        assert_eq!(parsed.0, "propose_image_generation");
        assert_eq!(
            parsed.1.get("visual_prompt").and_then(Value::as_str),
            Some("A portrait of Jasmine on a beach. Mode: avatar_image")
        );
        let proposal = parse_image_proposal(&ToolCall {
            tool: parsed.0,
            arguments: parsed.1,
        })
        .expect("image proposal");
        assert_eq!(proposal.mode, "avatar_image");
        assert!(proposal.prompt.contains("Preserve the source image"));
        assert!(proposal
            .prompt
            .contains("A portrait of Jasmine on a beach. Mode: avatar_image"));
    }

    #[test]
    fn gemma_pipe_call_tool_call_with_prompt_wrapper_is_recovered() {
        let text = r#"<|tool_call>call:propose_image_generation{prompt:<|"|>A neon supercar racing through rain at night.<|"|>}<tool_call|>"#;
        let parsed = first_model_tool_call(&json!({}), text).expect("fallback tool call");
        assert_eq!(parsed.0, "propose_image_generation");
        assert_eq!(
            parsed.1.get("prompt").and_then(Value::as_str),
            Some("A neon supercar racing through rain at night.")
        );
        let proposal = parse_image_proposal(&ToolCall {
            tool: parsed.0,
            arguments: parsed.1,
        })
        .expect("image proposal");
        assert_eq!(
            proposal.prompt,
            "A neon supercar racing through rain at night."
        );
    }

    #[test]
    fn gemma_toolcall_without_underscore_and_compact_tool_name_is_recovered() {
        let text = r#"<|toolcall>call:proposeimagegeneration{prompt:<|"|>A romantic rainy night scene.<|"|>}<toolcall|>"#;
        let parsed = first_model_tool_call(&json!({}), text).expect("fallback tool call");
        assert_eq!(parsed.0, "propose_image_generation");
        assert_eq!(
            parsed.1.get("prompt").and_then(Value::as_str),
            Some("A romantic rainy night scene.")
        );
    }

    #[test]
    fn malformed_prompt_wrappers_are_removed_from_image_prompt() {
        let proposal = parse_image_proposal(&ToolCall {
            tool: "propose_image_generation".to_string(),
            arguments: json!({
                "mode": "|\"|>avatar_image<|\"|",
                "prompt": "|\"|>A candid portrait of Jasmine reading a book.<|\"|>}<tool_call|"
            }),
        })
        .expect("image proposal");
        assert_eq!(proposal.mode, "avatar_image");
        assert!(proposal.prompt.contains("Preserve the source image"));
        assert!(proposal
            .prompt
            .contains("A candid portrait of Jasmine reading a book."));
    }

    #[test]
    fn pending_image_proposal_is_parsed_from_serialized_context() {
        let parsed = parse_pending_image_proposal_text(
            "Pending image proposal awaiting approval:\nPrompt: Doraemon walking on the beach\nMode: avatar_image\nMask prompt: sky",
        )
        .expect("pending proposal");
        assert_eq!(parsed.prompt, "Doraemon walking on the beach");
        assert_eq!(parsed.mode, "avatar_image");
        assert_eq!(parsed.mask_prompt.as_deref(), Some("sky"));
    }

    #[test]
    fn fake_tool_result_image_proposal_is_parsed_from_final_text() {
        let parsed = parse_pending_image_proposal_text(
            "Anh xem lại mô tả này nhé:\nTool result: Image creation request\nA supercar speeding along a beach at night.\nMode: text_to_image",
        )
        .expect("image proposal");
        assert_eq!(parsed.prompt, "A supercar speeding along a beach at night.");
        assert_eq!(parsed.mode, "text_to_image");
        assert_eq!(parsed.mask_prompt, None);
    }

    #[test]
    fn image_to_image_prompt_preserves_source_context() {
        let call = ToolCall {
            tool: "propose_image_generation".to_string(),
            arguments: json!({
                "prompt": "add a realistic cowboy hat to the man",
                "mode": "image_to_image",
                "mask_prompt": "head and hair"
            }),
        };
        let proposal = parse_image_proposal(&call).expect("image proposal");
        assert!(proposal.prompt.contains("Preserve the source image"));
        assert!(proposal.prompt.contains("add a realistic cowboy hat"));
    }

    #[test]
    fn recent_pending_image_proposal_is_reused_for_confirmation() {
        let messages = vec![
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!(
                    "I can create this image. Review the prompt below and approve it before I start.\nPending image proposal awaiting approval:\nPrompt: Doraemon climbing a mountain\nMode: text_to_image"
                ),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("ok"),
            },
        ];
        let proposal = recent_pending_image_proposal(&messages).expect("recent proposal");
        assert_eq!(proposal.prompt, "Doraemon climbing a mountain");
        assert!(request_effectively_wants_image_generation(
            "ok",
            Some(&proposal),
            false
        ));
    }

    #[test]
    fn older_image_proposal_is_not_pending_after_normal_assistant_reply() {
        let messages = vec![
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!(
                    "Pending image proposal awaiting approval:\nPrompt: A rainy tea table beside a stream\nMode: text_to_image"
                ),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("ý tưởng khác đi"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Em có vài ý tưởng khác: cà phê, phố đêm, hoặc khu vườn nhỏ."),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("cà phê đi"),
            },
        ];
        assert!(recent_pending_image_proposal(&messages).is_none());
    }

    #[test]
    fn old_calendar_context_does_not_leak_into_image_feedback() {
        let messages = vec![
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("check lịch tháng này cho anh"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Tháng này có vài sự kiện trong lịch của anh."),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("tạo ảnh một bát phở thật đẹp"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Ảnh đã xong đây.\n[image attached]"),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("đây là bát bún đấy chứ có phải phở đâu"),
            },
        ];
        assert_eq!(contextual_route_for_messages(&messages), None);
        let call = ToolCall {
            tool: "google_calendar_check".to_string(),
            arguments: json!({ "date": "today" }),
        };
        assert!(tool_allowed_for_context(&call, &messages).is_err());
    }

    #[test]
    fn image_edit_followup_requires_image_tool_when_recent_image_exists() {
        let messages = vec![
            ReactChatMessage {
                role: "user".to_string(),
                content: json!([
                    { "type": "text", "text": "edit this image" },
                    { "type": "image_url", "image_url": { "url": "data:image/png;base64,abc" } }
                ]),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("oke em sửa đi"),
            },
        ];
        assert!(recent_image_context(&messages));
        assert!(request_effectively_wants_image_generation(
            "oke em sửa đi",
            None,
            recent_image_context(&messages)
        ));
        let call = ToolCall {
            tool: "propose_image_generation".to_string(),
            arguments: json!({
                "prompt": "add a cowboy hat to the person",
                "mode": "image_to_image",
                "mask_prompt": "head and hair"
            }),
        };
        assert!(tool_allowed_for_context(&call, &messages).is_ok());
    }

    #[test]
    fn image_generation_tool_call_is_allowed_for_visual_request() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("vẽ cho anh bức ảnh trời mưa ngồi uống trà thật thư thái đi"),
        }];
        let call = ToolCall {
            tool: "propose_image_generation".to_string(),
            arguments: json!({
                "prompt": "A peaceful rainy day scene with a person sitting calmly and drinking tea by a window.",
                "mode": "text_to_image"
            }),
        };
        assert!(tool_allowed_for_context(&call, &messages).is_ok());
    }

    #[test]
    fn serialized_image_message_preserves_recent_image_context() {
        let serialized = r#"[{"type":"text","text":"Ảnh đã xong rồi đây."},{"type":"image_url","image_url":{"url":"","local_path":"D:\\AI\\Galaxy_Bot\\assistant-runtime\\sdcpp\\output\\galaxy-qwen.jpg"}}]"#;
        let messages = vec![ReactChatMessage {
            role: "assistant".to_string(),
            content: json!(serialized),
        }];
        assert!(content_text(&messages[0].content).contains("Ảnh đã xong"));
        assert!(content_text(&messages[0].content).contains("[image attached]"));
        assert!(recent_image_context(&messages));
        assert_eq!(
            chat_content_for_model(&messages[0]).as_str(),
            Some("Ảnh đã xong rồi đây.\n[image attached]")
        );
    }

    #[test]
    fn invalid_native_tool_call_feedback_stays_internal_to_tool_loop() {
        let mut messages = Vec::new();
        push_tool_validation_error(
            &mut messages,
            "call_bad",
            true,
            "weather_forecast requires a non-empty location.".to_string(),
        );
        assert_eq!(messages.len(), 1);
        assert_eq!(
            messages[0].get("role").and_then(Value::as_str),
            Some("tool")
        );
        assert_eq!(
            messages[0].get("tool_call_id").and_then(Value::as_str),
            Some("call_bad")
        );
        assert!(messages[0]
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("INVALID TOOL CALL"));
    }

    #[test]
    fn pronoun_anh_is_not_treated_as_image_intent() {
        assert_eq!(inferred_media_kind("cho anh kết quả"), None);
        assert_eq!(
            route_for_request("oke em xem rồi cho anh kết quả, đừng gửi link"),
            None
        );
    }

    #[test]
    fn deterministic_google_workspace_routes_drive_lookup_requests() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("find the Google Doc meeting notes in Drive"),
        }];
        let call = deterministic_google_workspace_call(&messages)
            .expect("deterministic google workspace call");
        assert_eq!(call.tool, "google_drive_search");
        assert_eq!(
            call.arguments.get("query").and_then(Value::as_str),
            Some("meeting notes")
        );
    }

    #[test]
    fn deterministic_google_workspace_routes_recent_sheets_list_requests() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("check danh sach cac file google sheet gan nhat"),
        }];
        let call = deterministic_google_workspace_call(&messages)
            .expect("deterministic google workspace call");
        assert_eq!(call.tool, "google_drive_search");
        assert_eq!(
            call.arguments.get("mime_type").and_then(Value::as_str),
            Some("application/vnd.google-apps.spreadsheet")
        );
        assert_eq!(
            call.arguments.get("recent").and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn deterministic_google_workspace_reads_doc_url_directly() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!(
                "read this Google Doc https://docs.google.com/document/d/abc123_DEF456/edit"
            ),
        }];
        let call = deterministic_google_workspace_call(&messages)
            .expect("deterministic google workspace call");
        assert_eq!(call.tool, "google_docs_read");
        assert_eq!(
            call.arguments.get("document_id").and_then(Value::as_str),
            Some("abc123_DEF456")
        );
    }

    #[test]
    fn deterministic_google_workspace_routes_contacts_lookup_requests() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("find Linsey in my Google contacts"),
        }];
        let call = deterministic_google_workspace_call(&messages)
            .expect("deterministic google workspace call");
        assert_eq!(call.tool, "google_contacts_search");
        assert_eq!(
            call.arguments.get("query").and_then(Value::as_str),
            Some("Linsey")
        );
    }

    #[test]
    fn deterministic_google_contact_delete_uses_verified_people_resource() {
        let messages = vec![
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Contact found. Resource Name: people/c6384821865405024792"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Em xin phép xóa contact này nếu anh xác nhận."),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("oke làm đi em"),
            },
        ];
        let call = deterministic_google_contact_delete_call(&messages)
            .expect("deterministic contact delete call");
        assert_eq!(call.tool, "propose_google_contact_delete");
        assert_eq!(
            call.arguments.get("resource_name").and_then(Value::as_str),
            Some("people/c6384821865405024792")
        );
    }

    #[test]
    fn malformed_google_action_markup_is_rejected() {
        let call = ToolCall {
            tool: "propose_google_action".to_string(),
            arguments: json!({
                "action_summary": ">Xóa contact<tool_call>",
                "method": ">DELETE<",
                "url": "https://people.googleapis.com/v1/people/c1 <tool_call>"
            }),
        };
        assert!(validate_tool_call(&call).is_err());
    }

    #[test]
    fn deterministic_google_workspace_lists_contacts_without_name_query() {
        let messages = vec![ReactChatMessage {
            role: "user".to_string(),
            content: json!("show my contact list"),
        }];
        let call = deterministic_google_workspace_call(&messages)
            .expect("deterministic google workspace call");
        assert_eq!(call.tool, "google_contacts_search");
        assert_eq!(
            call.arguments.get("page_size").and_then(Value::as_u64),
            Some(20)
        );
        assert!(call.arguments.get("query").is_none());
    }

    #[test]
    fn verified_answer_from_google_contacts_card_is_human_readable() {
        let cards = vec![ToolResultCard {
            kind: "google_contacts".to_string(),
            title: "1 Google contacts".to_string(),
            summary: Some("Verified from Google Contacts".to_string()),
            fields: Vec::new(),
            items: vec![ToolResultItem {
                title: "Honey".to_string(),
                subtitle: Some("honey@example.com".to_string()),
                details: vec![
                    ToolResultField {
                        label: "Email".to_string(),
                        value: "honey@example.com".to_string(),
                    },
                    ToolResultField {
                        label: "Phone".to_string(),
                        value: "0123456789".to_string(),
                    },
                ],
                url: None,
            }],
            text: None,
        }];
        let answer = verified_answer_from_cards(&cards, "fallback", "tim Honey trong danh ba");
        assert!(answer.contains("Honey"));
        assert!(answer.contains("0123456789"));
        assert!(!answer.contains("fallback"));
    }

    #[test]
    fn gmail_route_blocks_unrelated_media_tool_calls() {
        let call = with_user_text(
            ToolCall {
                tool: "preview_random_media".to_string(),
                arguments: json!({ "kind": "image" }),
            },
            "5 mail gần nhất là được rồi",
        );
        assert!(tool_allowed_for_route(&call, "5 mail gần nhất là được rồi").is_err());
    }

    #[test]
    fn web_search_route_blocks_unrelated_media_tool_calls() {
        let call = with_user_text(
            ToolCall {
                tool: "preview_random_media".to_string(),
                arguments: json!({ "kind": "image" }),
            },
            "search web for apartment prices in hanoi 2026",
        );
        assert!(
            tool_allowed_for_route(&call, "search web for apartment prices in hanoi 2026").is_err()
        );
    }

    #[test]
    fn google_workspace_route_blocks_unrelated_mail_tool_calls() {
        let call = with_user_text(
            ToolCall {
                tool: "gmail_recent".to_string(),
                arguments: json!({ "count": 5 }),
            },
            "find the Google Sheet budget 2026 in Drive",
        );
        assert!(
            tool_allowed_for_route(&call, "find the Google Sheet budget 2026 in Drive").is_err()
        );
    }

    #[test]
    fn file_search_route_blocks_unrelated_web_tool_calls() {
        let call = with_user_text(
            ToolCall {
                tool: "web_search".to_string(),
                arguments: json!({ "query": "report" }),
            },
            "find file report in workspace",
        );
        assert!(tool_allowed_for_route(&call, "find file report in workspace").is_err());
    }

    #[test]
    fn routes_month_schedule_to_calendar_hint() {
        assert_eq!(
            route_for_request("kiểm tra lịch trình tháng 6"),
            Some(ToolRoute::Calendar)
        );
    }

    #[test]
    fn language_detection_does_not_treat_bangkok_as_vietnamese() {
        assert!(!user_wants_vietnamese("weather in Bangkok this weekend"));
        assert!(user_wants_vietnamese("thời tiết cuối tuần này ở Hà Nội"));
        assert!(user_wants_vietnamese("mở một file âm thanh bất kỳ"));
    }

    #[test]
    fn approval_reply_uses_recent_conversation_language() {
        let messages = vec![
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("tạo ảnh một con mèo đang ngồi bên cửa sổ"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Em có thể tạo ảnh này. Anh duyệt để em bắt đầu nhé."),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("ok"),
            },
        ];
        assert!(conversation_wants_vietnamese(&messages));
        assert_eq!(
            image_approval_answer(conversation_wants_vietnamese(&messages)),
            "Em có thể tạo ảnh này. Anh duyệt để em bắt đầu nhé."
        );
    }

    #[test]
    fn random_index_stays_in_bounds() {
        for len in [1, 2, 10, 10_000] {
            for _ in 0..32 {
                assert!(random_index(len) < len);
            }
        }
    }

    #[test]
    fn multiple_file_matches_ask_user_to_choose_in_same_language() {
        let cards = vec![files_card(
            "file_search",
            "2 matching files",
            Some("song".to_string()),
            &[
                file_tools::FileSearchResult {
                    path: "D:\\Music\\a.mp3".to_string(),
                    name: "a.mp3".to_string(),
                    folder: "D:\\Music".to_string(),
                    extension: "mp3".to_string(),
                    size_bytes: 123,
                },
                file_tools::FileSearchResult {
                    path: "D:\\Music\\b.mp3".to_string(),
                    name: "b.mp3".to_string(),
                    folder: "D:\\Music".to_string(),
                    extension: "mp3".to_string(),
                    size_bytes: 456,
                },
            ],
        )];
        let answer = verified_answer_from_cards(&cards, "fallback", "mở một file âm thanh");
        assert_ne!(answer, "fallback");
        assert!(answer.contains("D:\\Music\\a.mp3"));
        assert!(answer.contains("D:\\Music\\b.mp3"));
    }

    #[test]
    fn infers_audio_kind_from_vietnamese_request() {
        assert_eq!(
            inferred_media_kind("mở một file âm thanh bất kỳ"),
            Some("audio")
        );
        assert_eq!(inferred_media_kind("play a random song"), Some("audio"));
    }

    #[test]
    fn infers_calendar_month_from_vietnamese_request() {
        let current_year = Local::now().year();
        assert_eq!(
            infer_calendar_date("toàn bộ tháng 5 có sự kiện gì"),
            Some(format!("{current_year}-05"))
        );
    }

    #[test]
    fn infers_requested_count_from_user_text() {
        assert_eq!(requested_item_count("show 10 newest mails", 5, 25), 10);
        assert_eq!(requested_item_count("show newest mails", 5, 25), 5);
    }

    #[test]
    fn continues_file_search_when_user_wants_preview() {
        assert!(should_continue_after_observation(
            "search_directory",
            "open the file named report"
        ));
        assert!(should_continue_after_observation(
            "list_media_files",
            "play a song from workspace"
        ));
        assert!(should_continue_after_observation(
            "search_directory",
            "mở một file âm thanh"
        ));
        assert!(!should_continue_after_observation(
            "search_directory",
            "find files named report"
        ));
        assert!(!should_continue_after_observation(
            "gmail_recent",
            "show latest mail"
        ));
    }

    #[test]
    fn preview_kind_guard_blocks_wrong_media_type() {
        let image_preview = file_tools::FilePreviewResult {
            path: "C:\\Workspace\\cover.png".to_string(),
            name: "cover.png".to_string(),
            extension: "png".to_string(),
            mime_type: "image/png".to_string(),
            size_bytes: 100,
            data_url: None,
            text: None,
            truncated: false,
        };
        let audio_preview = file_tools::FilePreviewResult {
            path: "C:\\Workspace\\song.mp3".to_string(),
            name: "song.mp3".to_string(),
            extension: "mp3".to_string(),
            mime_type: "audio/mpeg".to_string(),
            size_bytes: 100,
            data_url: None,
            text: None,
            truncated: false,
        };

        assert!(!preview_kind_matches_request(
            &image_preview,
            "mở một file âm thanh bất kỳ"
        ));
        assert!(preview_kind_matches_request(
            &audio_preview,
            "mở một file âm thanh bất kỳ"
        ));
    }

    #[test]
    fn verified_file_answer_uses_path_fields() {
        let cards = vec![files_card(
            "file_search",
            "1 matching files",
            Some("song".to_string()),
            &[file_tools::FileSearchResult {
                path: "D:\\Music\\song.mp3".to_string(),
                name: "song.mp3".to_string(),
                folder: "D:\\Music".to_string(),
                extension: "mp3".to_string(),
                size_bytes: 1234,
            }],
        )];
        let answer = verified_answer_from_cards(&cards, "fallback", "play a song");
        assert!(answer.contains("song.mp3"));
        assert!(answer.contains("D:\\Music\\song.mp3"));
        assert!(!answer.contains("fallback"));
    }
}
