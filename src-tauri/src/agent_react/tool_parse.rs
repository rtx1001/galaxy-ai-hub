use super::*;

pub(super) fn parse_inline_tool_markup(text: &str) -> Option<(String, Value)> {
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
        if let Some(parsed) = parse_gemma_call_payload(payload) {
            return Some(parsed);
        }
        if let Some(parsed) = parse_function_style_tool_call(payload) {
            return Some(parsed);
        }
        if let Some(parsed) = parse_tool_name_directive(payload) {
            return Some(parsed);
        }
        if let Some(parsed) = parse_loose_named_tool_call(payload) {
            return Some(parsed);
        }
    }
    None
}

pub(super) fn canonical_tool_name(raw: &str) -> String {
    raw.trim().to_string()
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

fn parse_gemma_call_payload(payload: &str) -> Option<(String, Value)> {
    let trimmed = payload.trim();
    let after_call = trimmed.strip_prefix("call:")?;
    let open = after_call.find('{')?;
    let close = after_call.rfind('}')?;
    if close <= open {
        return None;
    }
    let name = after_call[..open].trim();
    if name.is_empty() {
        return None;
    }
    let args = &after_call[open + 1..close];
    if let Ok(value) = serde_json::from_str::<Value>(&format!("{{{}}}", args)) {
        if value.is_object() {
            return Some((canonical_tool_name(name), value));
        }
    } else if args.trim_start().starts_with('"') {
        return None;
    }
    Some((canonical_tool_name(name), parse_function_arguments(args)))
}

fn parse_function_style_tool_call(text: &str) -> Option<(String, Value)> {
    let mut candidates = available_tool_names()
        .into_iter()
        .filter_map(|tool| find_function_call_span(text, tool).map(|span| (tool, span)))
        .collect::<Vec<_>>();
    candidates.sort_by_key(|(_, (start, _))| *start);
    let (name, (open_index, close_index)) = candidates.first().cloned()?;
    let args = &text[open_index + 1..close_index];
    Some((canonical_tool_name(name), parse_function_arguments(args)))
}

fn parse_tool_name_directive(text: &str) -> Option<(String, Value)> {
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let lowered = line.to_ascii_lowercase();
        let is_tool_directive = lowered.contains("tool call")
            || lowered.contains("call tool")
            || lowered.contains("call:")
            || lowered.contains("use tool")
            || lowered.contains("using tool")
            || lowered.contains("i will use")
            || lowered.contains("i should use")
            || lowered.contains("i'll use");
        if !is_tool_directive {
            continue;
        }
        let mentions = exact_tool_mentions(line);
        if mentions.len() == 1 {
            let name = mentions[0].to_string();
            crate::assistant_runtime::append_runtime_log(
                "agent",
                &format!("normalized_tool_call tool={} source=directive", name),
            );
            return Some((name.clone(), default_tool_arguments(&name)));
        }
    }

    let compact = text
        .trim()
        .trim_matches(|ch: char| matches!(ch, '`' | '\'' | '"' | ':' | ';' | '<' | '>'));
    let mentions = exact_tool_mentions(compact);
    if mentions.len() == 1 && compact == mentions[0] {
        let name = mentions[0].to_string();
        crate::assistant_runtime::append_runtime_log(
            "agent",
            &format!("normalized_tool_call tool={} source=bare_name", name),
        );
        return Some((name.clone(), default_tool_arguments(&name)));
    }

    None
}

fn exact_tool_mentions(text: &str) -> Vec<&'static str> {
    available_tool_names()
        .into_iter()
        .filter(|tool| contains_exact_tool_name(text, tool))
        .collect()
}

fn contains_exact_tool_name(text: &str, tool: &str) -> bool {
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
            return true;
        }
        search_from = after_tool;
    }
    false
}

fn parse_loose_named_tool_call(text: &str) -> Option<(String, Value)> {
    let mut candidates = available_tool_names()
        .into_iter()
        .filter_map(|tool| text.find(tool).map(|start| (tool, start, tool.len())))
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
    if args.starts_with('{') || args.starts_with('"') {
        return None;
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

pub(super) fn parse_json_object_prefix(input: &str) -> Option<Value> {
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

#[cfg(test)]
pub(super) fn first_model_tool_call(
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
