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
        "Image modes: text_to_image uses no reference; image_to_image uses the current attached/chat image; avatar_image uses the character avatar; user_avatar_image uses the selected user profile avatar; user_character_image uses both selected user and character avatars.",
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

pub(super) async fn ensure_image_tool_call_prompt_english(
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
            let call =
                ensure_image_tool_call_prompt_english(raw_call, latest_user_text, sampling).await?;
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

    crate::assistant_runtime::append_runtime_log(
        "agent",
        &format!(
            "planner_result step={} no_valid_tool state={}",
            step + 1,
            task_state.label
        ),
    );
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
