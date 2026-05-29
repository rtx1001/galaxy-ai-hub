use super::*;

pub(super) fn normalize_image_mode(raw_mode: &str) -> String {
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
    let mode = normalize_image_mode(raw_mode);

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

pub(super) fn parse_pending_image_proposal_text(text: &str) -> Option<ImageProposal> {
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

pub(super) fn recent_pending_image_proposal(
    messages: &[ReactChatMessage],
) -> Option<ImageProposal> {
    messages
        .iter()
        .rev()
        .find(|message| message.role == "assistant")
        .and_then(|message| parse_pending_image_proposal_text(&content_text(&message.content)))
}

pub(super) fn recent_unresolved_image_creation_context(messages: &[ReactChatMessage]) -> bool {
    let latest_user_index = messages.iter().rposition(|message| message.role == "user");
    messages
        .iter()
        .enumerate()
        .rev()
        .filter(|(index, _)| Some(*index) != latest_user_index)
        .take(6)
        .any(|(_, message)| {
            let text = content_text(&message.content);
            if text.trim().is_empty() {
                return false;
            }
            parse_pending_image_proposal_text(&text).is_some()
                || request_wants_image_generation(&text)
                || broad_image_generation_signal(&text)
                || request_wants_avatar_image_generation(&text)
                || request_wants_user_avatar_image_generation(&text)
                || request_targets_user_and_character_images(&text)
        })
}
