use super::*;

pub(super) fn tool_planner_instruction(
    _latest_user_text: &str,
    task_state: &ConversationTaskState,
    step: usize,
) -> String {
    let image_required = task_state.image_required;
    let recent_image_hint = if task_state.recent_image_context {
        "Recent context contains an image. A short follow-up may refer to that image; decide from the whole conversation. If unclear, output NO_TOOL so the final answer can ask one short clarification."
    } else {
        "No recent image context was detected."
    };
    let required_hint = if image_required {
        "This turn needs the image tool. Choose the mode from the conversation and tool schema."
    } else if let Some(route) = task_state.route {
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
    } else if task_state.tool_repair_required {
        "The previous draft claimed a tool result without a verified tool observation. Choose the real app tool that matches the requested action, or output NO_TOOL only if the action is genuinely unclear."
    } else {
        "Decide from the full meaning of the latest user message, not isolated words. Use NO_TOOL for normal conversation, opinion, writing, explanation, or anything that can be answered without external/live/local data. If the intent is unclear, output NO_TOOL so the final answer can ask a short clarification."
    };

    let route_text = task_state.route_text();
    let allowed_tools = task_state.allowed_tool_names();
    let tool_knowledge = tool_knowledge_prompt(task_state.route);
    [
        "PRIVATE TOOL PLANNER. This message is not visible to the user.",
        "Your entire output must be either exactly NO_TOOL or exactly one structured tool call.",
        "Never write a user-facing answer in this planner step.",
        tool_knowledge.as_str(),
        "Use only the exact tool names shown to you. Never invent friendly action names such as play_music, open_song, create_image, search_music, or open_file.",
        &format!("Allowed tool names for this turn: {allowed_tools}."),
        "Do not overthink. Make the smallest defensible decision from the current turn and recent context.",
        "Do not infer a tool from one keyword. Use a tool only when the full request clearly asks for app data, local files, live/external info, image generation/editing, voice, or a system/account action.",
        "Never say that a tool was called, checked, found, opened, created, or verified. Only the app may execute tools.",
        "If a sufficient verified tool result is already present in the conversation, output NO_TOOL so the final answer can be written.",
        "Use read-only tools directly for harmless lookup/preview tasks. Use propose_* tools for writes, deletes, sending email, calendar changes, contact changes, image generation, or local system actions.",
        "When the user asks you to create, generate, draw, edit, or send an image, do not answer with a promise, idea, or waiting message. Use propose_image_generation so the app can show an approval card.",
        "For propose_image_generation, the prompt and mask_prompt arguments must be written in English even when the user chats in another language.",
        "For propose_image_generation, write a rich, creative, context-aware English-first prompt. Do not merely translate the user's short request. Expand it into 2-4 concise sentences with subject, action, setting, style, composition/framing, lighting, mood, and must-preserve details. Keep names, places, brands, and quoted visible text exactly when useful.",
        "Keep image prompts faithful to the user's intent; do not add unrelated people, objects, nudity, violence, brands, or identity changes unless requested.",
        "Image modes: text_image uses no reference; image_image uses the current attached/prior chat image as a visual reference; bot_image uses the current assistant profile avatar; user_image uses the selected user profile avatar; user_bot_image uses both selected user profile avatar and current assistant profile avatar.",
        "If the requested image includes the selected user and a person/object from a pasted or previous chat image, choose image_image, not user_bot_image. user_bot_image is only for the selected user profile avatar plus the current assistant profile avatar.",
        &task_state.planner_summary(),
        recent_image_hint,
        "If a tool is required but a mandatory argument is missing, output NO_TOOL and the final answer should ask for that missing detail.",
        required_hint,
        &format!("Detected route: {route_text}. Tool planning step: {}.", step + 1),
    ]
    .join("\n")
}

pub(super) fn reasoning_style_prompt(thinking_enabled: bool) -> &'static str {
    if thinking_enabled {
        "Reasoning style: think briefly and only as much as needed. Do not spend long chains on ordinary conversation. If the user's intent is unclear, ask one short clarifying question instead of guessing or calling a tool."
    } else {
        "Reasoning style: answer directly. If the user's intent is unclear, ask one short clarifying question instead of guessing or calling a tool."
    }
}

pub(super) fn planner_sampling(sampling: SamplingConfig) -> SamplingConfig {
    SamplingConfig {
        temperature: 0.0,
        top_k: 1,
        top_p: 1.0,
        min_p: 0.0,
        repeat_last_n: sampling.repeat_last_n,
        repeat_penalty: sampling.repeat_penalty,
    }
}

fn image_mode_context_from_messages(messages: &[Value]) -> String {
    messages
        .iter()
        .rev()
        .filter_map(|message| {
            let role = message.get("role").and_then(Value::as_str)?;
            if role == "system" {
                return None;
            }
            let text = extract_value_text(message.get("content").unwrap_or(&Value::Null));
            let text = text.trim();
            if text.is_empty() {
                return None;
            }
            Some(format!(
                "{}: {}",
                role,
                crate::assistant_runtime::compact_trace_text(text, 260)
            ))
        })
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}

pub(super) async fn classify_image_tool_requirement(
    messages: &[ReactChatMessage],
    latest_user_text: &str,
    sampling: SamplingConfig,
) -> Result<bool, String> {
    if latest_user_text.trim().is_empty() {
        return Ok(false);
    }

    let excerpt = messages
        .iter()
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|message| {
            format!(
                "{}: {}",
                message.role,
                crate::assistant_runtime::compact_trace_text(&content_text(&message.content), 260)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let classifier_instruction = image_tool_classifier_instruction();

    let reply = call_chat(
        vec![
            json!({
                "role": "system",
                "content": classifier_instruction
            }),
            json!({
                "role": "user",
                "content": format!(
                    "Recent conversation:\n{}\n\nLatest user turn:\n{}\n\nAnswer YES or NO only.",
                    excerpt,
                    latest_user_text.trim()
                )
            }),
        ],
        None,
        planner_sampling(sampling),
        24,
        false,
    )
    .await?;

    let answer = normalize_text(&extract_chat_reply_text(&reply));
    Ok(answer
        .split_whitespace()
        .next()
        .is_some_and(|word| word == "yes"))
}

pub(super) fn image_tool_classifier_instruction() -> String {
    [
        "Classify the latest user turn for the local assistant app.",
        "Return exactly YES or NO.",
        "YES means the latest turn now requires the app to produce a new image output: create, generate, edit, redraw, transform, or render an image, including using the assistant avatar, user avatar, both avatars, or a recent/attached image as reference.",
        "YES also applies when the latest turn confirms or continues an unresolved image creation/edit request from recent context.",
        "NO means the user is only asking visual understanding about an attached/prior image: identify who/what it is, inspect it, describe it, compare it, explain it, answer a question about it, or discuss it without asking the app to produce a new image.",
        "NO means normal conversation, text-only discussion, asking for ideas without asking the app to produce an image now, or a request for non-image tools.",
        "An attached image by itself is not a request for the image generation tool. Treat it as vision chat unless the latest turn asks the app to create or modify an image output.",
        "If the latest turn is a question about the attached image, return NO even when recent context includes image generation.",
        "Do not use keyword matching. Decide from meaning and recent context only.",
    ]
    .join("\n")
}

pub(super) async fn rewrite_image_prompt_to_english(
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

fn clean_mode_choice(text: &str) -> Option<String> {
    let cleaned = clean_tool_markup_fragments(text)
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string();
    canonical_image_mode(&cleaned).map(str::to_string)
}

fn clean_reference_source_choices(text: &str) -> Vec<String> {
    let cleaned = clean_tool_markup_fragments(text);
    let mut sources = Vec::new();
    for part in cleaned.split([',', ';', '|', '\n', ' ']) {
        if let Some(source) = normalize_image_reference_source(part) {
            if !sources.iter().any(|existing| existing == source) {
                sources.push(source.to_string());
            }
        }
    }
    sources
}

pub(super) async fn choose_image_reference_sources_for_request(
    latest_user_text: &str,
    proposed_prompt: &str,
    mode: &str,
    conversation_context: &str,
    recent_image_context: bool,
    current_sources: &[String],
    sampling: SamplingConfig,
) -> Result<Vec<String>, String> {
    let normalized_mode = normalize_image_mode(mode);
    let mut fallback = current_sources.to_vec();
    if fallback.is_empty() {
        match normalized_mode.as_str() {
            "image_image" => fallback.push("chat_image".to_string()),
            "bot_image" => fallback.push("bot_avatar".to_string()),
            "user_image" => fallback.push("user_avatar".to_string()),
            "user_bot_image" => {
                fallback.push("user_avatar".to_string());
                fallback.push("bot_avatar".to_string());
            }
            _ => {}
        }
    }
    if latest_user_text.trim().is_empty() || proposed_prompt.trim().is_empty() {
        return Ok(fallback);
    }

    let source_instruction = [
        "Choose which visual reference sources the image generator must receive.",
        "Return only a comma-separated list using these tokens: chat_image, user_avatar, bot_avatar.",
        "Return an empty response if no reference source is needed.",
        "Definitions:",
        "- chat_image: attached, pasted, found, generated, or prior image in the chat.",
        "- user_avatar: selected user profile avatar; use when the requested generated image includes the user as a person/subject.",
        "- bot_avatar: current assistant profile avatar; use when the requested generated image includes the assistant/character as a person/subject.",
        "For image_image, include chat_image whenever a prior/current chat image is required. If the scene should also include the selected user, include user_avatar too. If it should also include the assistant profile, include bot_avatar too.",
        "Do not infer bot_avatar for a public figure, celebrity, friend, or person from a pasted image. Those are chat_image context, not the assistant profile.",
        "Do not explain.",
    ]
    .join("\n");

    let reply = call_chat(
        vec![
            json!({
                "role": "system",
                "content": source_instruction
            }),
            json!({
                "role": "user",
                "content": format!(
                    "Recent conversation:\n{}\n\nLatest user request:\n{}\n\nProposed image prompt:\n{}\n\nImage mode: {}\nRecent chat image available: {}\nCurrent reference sources: {}\n\nReturn source tokens only.",
                    conversation_context.trim(),
                    latest_user_text.trim(),
                    proposed_prompt.trim(),
                    normalized_mode,
                    if recent_image_context { "yes" } else { "no" },
                    if current_sources.is_empty() { "none".to_string() } else { current_sources.join(",") }
                )
            }),
        ],
        None,
        planner_sampling(sampling),
        32,
        false,
    )
    .await?;
    let selected = clean_reference_source_choices(&extract_chat_reply_text(&reply));
    if selected.is_empty() {
        return Ok(fallback);
    }
    Ok(selected)
}

pub(super) async fn choose_image_mode_for_request(
    latest_user_text: &str,
    proposed_prompt: &str,
    current_mode: &str,
    conversation_context: &str,
    recent_image_context: bool,
    sampling: SamplingConfig,
) -> Result<Option<String>, String> {
    if latest_user_text.trim().is_empty() || proposed_prompt.trim().is_empty() {
        return Ok(None);
    }

    let mode_instruction = [
        "Choose the exact image generation mode for the app.",
        "Return only one token from this set: text_image, image_image, bot_image, user_image, user_bot_image.",
        "Definitions:",
        "- text_image: no reference image is needed.",
        "- image_image: use an attached/current/prior chat image as visual reference. Choose this when the request involves a pasted/sent image, even if the selected user also appears in the requested generated scene.",
        "- bot_image: use the current assistant profile avatar as the reference image.",
        "- user_image: use the selected user profile avatar as the reference image.",
        "- user_bot_image: use both selected user profile avatar and current assistant profile avatar. Do not use it for a celebrity, a person in a pasted image, or any third-party person.",
        "When Recent chat image available is yes, read the recent conversation carefully. If the latest request depends on a person/object/place from that prior image, choose image_image. This remains true when the user also asks to include themselves from the selected user profile.",
        "Do not choose user_bot_image unless the request clearly involves the selected user profile and the current assistant profile together. A public figure, friend, uploaded person, pasted image subject, or named third-party is not the assistant profile.",
        "The conversation is between a user and an assistant profile. If the user asks for the assistant's own image, photo, picture, avatar, body, look, or says the image should be of 'you' from the assistant's perspective, choose bot_image.",
        "If the user asks for the user's own profile/avatar/image, choose user_image.",
        "If the user asks for both the user and assistant profile together, choose user_bot_image.",
        "Prefer a profile/reference mode whenever a profile identity is requested. Keep text_image only when no profile/reference identity is requested.",
        "Do not explain.",
    ]
    .join("\n");

    let reply = call_chat(
        vec![
            json!({
                "role": "system",
                "content": mode_instruction
            }),
            json!({
                "role": "user",
                "content": format!(
                    "Recent conversation:\n{}\n\nLatest user request:\n{}\n\nProposed image prompt:\n{}\n\nCurrent proposed mode: {}\nRecent chat image available: {}",
                    conversation_context.trim(),
                    latest_user_text.trim(),
                    proposed_prompt.trim(),
                    current_mode,
                    if recent_image_context { "yes" } else { "no" }
                )
            }),
        ],
        None,
        planner_sampling(sampling),
        24,
        false,
    )
    .await?;
    Ok(clean_mode_choice(&extract_chat_reply_text(&reply)))
}

pub(super) async fn ensure_image_proposal_mode(
    mut proposal: ImageProposal,
    latest_user_text: &str,
    task_state: &ConversationTaskState,
    conversation_context: &str,
    sampling: SamplingConfig,
) -> Result<ImageProposal, String> {
    if let Some(mode) = choose_image_mode_for_request(
        latest_user_text,
        &proposal.prompt,
        &proposal.mode,
        conversation_context,
        task_state.recent_image_context,
        sampling,
    )
    .await?
    {
        if mode != proposal.mode {
            crate::assistant_runtime::append_runtime_log(
                "agent",
                &format!(
                    "image_mode_refined from={} to={} latest=\"{}\"",
                    proposal.mode,
                    mode,
                    crate::assistant_runtime::compact_trace_text(latest_user_text, 140)
                ),
            );
            proposal.mode = mode;
            proposal.prompt = normalize_image_prompt_for_mode(proposal.prompt, &proposal.mode);
        }
    }
    proposal.reference_sources = choose_image_reference_sources_for_request(
        latest_user_text,
        &proposal.prompt,
        &proposal.mode,
        conversation_context,
        task_state.recent_image_context,
        &proposal.reference_sources,
        sampling,
    )
    .await?;
    Ok(proposal)
}

pub(super) async fn ensure_image_tool_call_contract(
    mut call: ToolCall,
    latest_user_text: &str,
    task_state: &ConversationTaskState,
    conversation_context: &str,
    sampling: SamplingConfig,
) -> Result<ToolCall, String> {
    if call.tool != "propose_image_generation" {
        return Ok(call);
    }
    let mut prompt = image_prompt_argument(&call);
    if prompt.trim().is_empty() {
        prompt = latest_user_text.trim().to_string();
        let mut object = call.arguments.as_object().cloned().unwrap_or_default();
        object.insert("prompt".to_string(), Value::String(prompt.clone()));
        object.remove("description");
        object.remove("visual_prompt");
        object.remove("image_prompt");
        call.arguments = Value::Object(object);
    }
    let raw_mode = call
        .arguments
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("text_image")
        .to_string();
    let mut mode = normalize_image_mode(&raw_mode);
    if let Some(selected_mode) = choose_image_mode_for_request(
        latest_user_text,
        &prompt,
        &mode,
        conversation_context,
        task_state.recent_image_context,
        sampling,
    )
    .await?
    {
        mode = selected_mode;
        let mut object = call.arguments.as_object().cloned().unwrap_or_default();
        object.insert("mode".to_string(), Value::String(mode.clone()));
        call.arguments = Value::Object(object);
    }
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
    let mut object = call.arguments.as_object().cloned().unwrap_or_default();
    object.insert("mode".to_string(), Value::String(mode));
    let reference_sources = choose_image_reference_sources_for_request(
        latest_user_text,
        object
            .get("prompt")
            .and_then(Value::as_str)
            .unwrap_or(&prompt),
        object
            .get("mode")
            .and_then(Value::as_str)
            .unwrap_or("text_image"),
        conversation_context,
        task_state.recent_image_context,
        &normalize_image_reference_sources(object.get("reference_sources")),
        sampling,
    )
    .await?;
    if !reference_sources.is_empty() {
        object.insert("reference_sources".to_string(), json!(reference_sources));
    }
    call.arguments = Value::Object(object);
    crate::assistant_runtime::append_runtime_log(
        "agent",
        &format!(
            "image_tool_contract mode={} refs={} prompt=\"{}\" latest=\"{}\"",
            call.arguments
                .get("mode")
                .and_then(Value::as_str)
                .unwrap_or(""),
            call.arguments
                .get("reference_sources")
                .map(|value| value.to_string())
                .unwrap_or_else(|| "[]".to_string()),
            crate::assistant_runtime::compact_trace_text(&image_prompt_argument(&call), 160),
            crate::assistant_runtime::compact_trace_text(latest_user_text, 140)
        ),
    );
    Ok(call)
}

pub(super) async fn plan_next_tool_call(
    base_messages: &[Value],
    _tools: &Value,
    sampling: SamplingConfig,
    latest_user_text: &str,
    task_state: &ConversationTaskState,
    step: usize,
) -> Result<(Option<ToolCall>, String), String> {
    let mut accumulated_thinking = String::new();
    let tool_required = task_state.requires_tool();
    if tool_required {
        append_thinking(
            &mut accumulated_thinking,
            &format!(
                "Tool planning: checked this turn before running tools. {}.",
                task_state.planner_summary()
            ),
        );
    }

    let mut planner_messages = base_messages.to_vec();
    planner_messages.push(json!({
        "role": "system",
        "content": tool_planner_instruction(
            latest_user_text,
            task_state,
            step,
        )
    }));

    for attempt in 0..2 {
        let scoped_tools = filtered_tool_schema(task_state.route);
        let reply = call_chat(
            planner_messages.clone(),
            Some(scoped_tools),
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
            crate::assistant_runtime::append_runtime_log(
                "agent",
                &format!(
                    "planner_result step={} tool={} state={}",
                    step + 1,
                    name,
                    task_state.label
                ),
            );
            let raw_call = ToolCall {
                tool: name,
                arguments,
            };
            let call = ensure_image_tool_call_contract(
                raw_call,
                latest_user_text,
                task_state,
                &image_mode_context_from_messages(base_messages),
                sampling,
            )
            .await?;
            return Ok((Some(call), accumulated_thinking));
        }

        let normalized = normalize_text(&assistant_text);
        if normalized.trim() == "no_tool" || normalized.contains("no_tool") {
            crate::assistant_runtime::append_runtime_log(
                "agent",
                &format!(
                    "planner_result step={} no_tool state={}",
                    step + 1,
                    task_state.label
                ),
            );
            return Ok((None, accumulated_thinking));
        }

        if attempt == 0 {
            planner_messages.push(json!({
                "role": "system",
                "content": if tool_required {
                    "Planner correction: this turn appears to need a tool. Output exactly one valid tool call, or NO_TOOL only if a required argument is missing. Do not answer the user."
                } else {
                    "Planner correction: your previous planner output was not valid. Output exactly NO_TOOL for normal conversation, or exactly one valid tool call if the latest user turn clearly needs an app tool. Do not answer the user."
                }
            }));
        }
    }

    crate::assistant_runtime::append_runtime_log(
        "agent",
        &format!(
            "planner_result step={} no_valid_tool state={}",
            step + 1,
            task_state.label
        ),
    );
    if !tool_required {
        return Ok((None, accumulated_thinking));
    }
    Ok((None, accumulated_thinking))
}

pub(super) fn push_tool_validation_error(
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
