use super::*;

pub(super) fn normalize_image_mode(raw_mode: &str) -> String {
    let cleaned = clean_tool_markup_fragments(raw_mode)
        .trim()
        .to_ascii_lowercase();
    canonical_image_mode(&cleaned)
        .unwrap_or("text_image")
        .to_string()
}

pub(super) fn canonical_image_mode(raw_mode: &str) -> Option<&'static str> {
    let cleaned = clean_tool_markup_fragments(raw_mode)
        .trim()
        .to_ascii_lowercase();
    let mode = match cleaned.as_str() {
        "txt2img" | "text2img" | "text-to-image" | "text_to_image" | "text_image" => "text_image",
        "img2img" | "image2image" | "image-to-image" | "image_to_image" | "image_image"
        | "edit_image" => "image_image",
        "user_avatar"
        | "user-avatar"
        | "user_avatar_image"
        | "avatar_user_image"
        | "user_avatar_to_image"
        | "avatar_user_to_image"
        | "user_to_image"
        | "user-image"
        | "user_image" => "user_image",
        "user_character"
        | "user-character"
        | "user_bot_image"
        | "user_character_image"
        | "user_character_to_image"
        | "user_and_character_image"
        | "user_and_character_to_image"
        | "both_avatars"
        | "both_avatars_image"
        | "both_avatars_to_image"
        | "couple_avatar_image" => "user_bot_image",
        "avatar" | "bot_image" | "assistant_image" | "assistant_to_image" | "bot_avatar_image"
        | "bot_to_image" | "character_image" | "character_to_image" | "avatar-image"
        | "avatar_image" | "avatar_to_image" => "bot_image",
        _ => return None,
    };
    Some(mode)
}

pub(super) fn clean_tool_markup_fragments(value: &str) -> String {
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

pub(super) fn normalize_image_prompt_for_mode(prompt: String, mode: &str) -> String {
    let prompt = clean_tool_markup_fragments(&prompt);
    let _ = mode;
    prompt
}

pub(super) fn normalize_image_reference_source(raw_source: &str) -> Option<&'static str> {
    let cleaned = clean_tool_markup_fragments(raw_source)
        .trim()
        .to_ascii_lowercase()
        .replace('-', "_")
        .replace(' ', "_");
    match cleaned.as_str() {
        "chat" | "chat_image" | "current_image" | "attached_image" | "pasted_image"
        | "prior_image" | "previous_image" | "source_image" | "input_image" => Some("chat_image"),
        "user"
        | "user_avatar"
        | "selected_user"
        | "selected_user_avatar"
        | "profile_user"
        | "user_profile"
        | "user_profile_avatar" => Some("user_avatar"),
        "bot" | "assistant" | "assistant_avatar" | "bot_avatar" | "character"
        | "character_avatar" | "profile_character" => Some("bot_avatar"),
        _ => None,
    }
}

pub(super) fn normalize_image_reference_sources(value: Option<&Value>) -> Vec<String> {
    let mut sources = Vec::new();
    let mut push_source = |raw: &str| {
        if let Some(source) = normalize_image_reference_source(raw) {
            if !sources.iter().any(|existing| existing == source) {
                sources.push(source.to_string());
            }
        }
    };

    match value {
        Some(Value::Array(items)) => {
            for item in items {
                if let Some(raw) = item.as_str() {
                    push_source(raw);
                }
            }
        }
        Some(Value::String(raw)) => {
            for part in raw.split([',', ';', '|', '\n']) {
                push_source(part);
            }
        }
        _ => {}
    }
    sources
}

pub(super) fn parse_image_proposal(call: &ToolCall) -> Result<ImageProposal, String> {
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
            if contains_any(&normalized_prompt, &["mode: bot_image", "mode bot_image"]) {
                Some("bot_image")
            } else if contains_any(
                &normalized_prompt,
                &[
                    "mode: image_image",
                    "mode image_image",
                    "mode: image_to_image",
                    "mode image_to_image",
                ],
            ) {
                Some("image_image")
            } else {
                None
            }
        })
        .unwrap_or("text_image")
        .trim();
    let mode = normalize_image_mode(raw_mode);

    let mask_prompt = call
        .arguments
        .get("mask_prompt")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let prompt = normalize_image_prompt_for_mode(prompt, &mode);
    let reference_sources =
        normalize_image_reference_sources(call.arguments.get("reference_sources"));

    Ok(ImageProposal {
        prompt,
        mode,
        mask_prompt,
        reference_sources,
    })
}

pub(super) fn parse_pending_image_proposal_text(text: &str) -> Option<ImageProposal> {
    let mut inside_block = false;
    let mut prompt: Option<String> = None;
    let mut mode = "text_image".to_string();
    let mut mask_prompt: Option<String> = None;
    let mut reference_sources: Vec<String> = Vec::new();

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
                "reference sources" | "references" | "reference_sources" => {
                    reference_sources =
                        normalize_image_reference_sources(Some(&Value::String(value.to_string())));
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
        reference_sources,
    })
}

pub(super) fn recent_pending_image_proposal(
    messages: &[ReactChatMessage],
) -> Option<ImageProposal> {
    messages
        .iter()
        .rev()
        .find(|message| message.role == "assistant")
        .and_then(|message| parse_pending_image_proposal_text(&content_text(&message.content)))
}
