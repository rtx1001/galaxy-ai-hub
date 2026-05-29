use super::*;

pub(super) fn append_thinking(accumulated: &mut String, next: &str) {
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

pub(super) fn normalize_thinking_block(text: &str) -> String {
    normalize_text(text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn sanitize_thinking_for_display(next: &str) -> String {
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

pub(super) fn thinking_result(thinking_enabled: bool, thinking: &str) -> Option<String> {
    (thinking_enabled && !thinking.trim().is_empty()).then(|| thinking.to_string())
}
