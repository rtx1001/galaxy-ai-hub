use serde::Deserialize;
use serde_json::{json, Map, Value};

use super::*;

#[derive(Debug, Deserialize)]
struct CleanDecision {
    #[serde(default)]
    action: String,
    #[serde(default)]
    tool: Option<String>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    refs: Vec<String>,
    #[serde(default)]
    arguments: Value,
    #[serde(default)]
    reply: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

fn clean_decision_sampling(sampling: SamplingConfig) -> SamplingConfig {
    SamplingConfig {
        temperature: 0.0,
        top_k: 1,
        top_p: 1.0,
        min_p: 0.0,
        repeat_last_n: sampling.repeat_last_n,
        repeat_penalty: sampling.repeat_penalty,
    }
}

fn clean_base_messages(
    runtime_prompt: &str,
    context_block: &str,
    messages: &[ReactChatMessage],
    thinking_enabled: bool,
) -> Vec<Value> {
    let system_prompt = [
        read_master_system_prompt(),
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

    let mut request_messages = Vec::new();
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
    request_messages
}

fn clean_decision_history(messages: &[ReactChatMessage]) -> Vec<Value> {
    let latest_user_index = messages.iter().rposition(|message| message.role == "user");
    messages
        .iter()
        .enumerate()
        .filter(|(index, message)| Some(*index) != latest_user_index && message.role != "system")
        .rev()
        .take(12)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .filter_map(|(_, message)| {
            let text = content_text(&message.content).trim().to_string();
            (!text.is_empty()).then(|| json!({ "role": message.role, "content": text }))
        })
        .collect()
}

fn clean_tools_text() -> String {
    let mut lines = vec!["TOOLS:".to_string()];
    for descriptor in TOOL_REGISTRY {
        let kind = if descriptor.name.starts_with("propose_") || descriptor.name == "run_powershell"
        {
            "approval"
        } else {
            "tool"
        };
        lines.push(format!(
            "- {} ({}): {}",
            descriptor.name, kind, descriptor.purpose
        ));
    }
    lines.push("IMAGE_MODES:".to_string());
    lines.push("- text_image refs=none: Create a new image without visual references.".to_string());
    lines.push("- image_image refs=chat_image plus optional user_avatar/bot_avatar: Create/edit using an attached, pasted, or earlier chat image. Add user_avatar and/or bot_avatar when the requested scene also includes the selected user and/or current assistant.".to_string());
    lines.push(
        "- bot_image refs=bot_avatar: Create using current assistant/bot profile avatar."
            .to_string(),
    );
    lines.push(
        "- user_image refs=user_avatar: Create using selected user profile avatar.".to_string(),
    );
    lines.push("- user_bot_image refs=user_avatar,bot_avatar: Create using both user and assistant profile avatars.".to_string());
    lines.push("ARGUMENT NOTES:".to_string());
    lines.push("- weather_forecast: arguments {\"location\":\"city or area\",\"date\":\"today|tomorrow|YYYY-MM-DD optional\",\"days\":number optional}".to_string());
    lines.push("- preview_random_media/list_media_files: arguments {\"kind\":\"audio|video|image|document|text|any\",\"query\":\"optional clue\",\"root_folder\":\"optional workspace folder\"}".to_string());
    lines.push(
        "- preview_file/read_file: arguments {\"path\":\"verified path or file name\"}".to_string(),
    );
    lines.push("- search_directory/find_workspace_candidates/web_search: arguments {\"query\":\"search text\",\"kind\":\"optional media kind\",\"root_folder\":\"optional\"}".to_string());
    lines.push(
        "- google_calendar_check: arguments {\"date\":\"today|tomorrow|YYYY-MM-DD|YYYY-MM\"}"
            .to_string(),
    );
    lines.push("- propose_image_generation: arguments {\"prompt\":\"English-first visual prompt\",\"mode\":\"text_image|image_image|bot_image|user_image|user_bot_image\",\"reference_sources\":[\"chat_image|user_avatar|bot_avatar\"],\"mask_prompt\":\"optional\"}".to_string());
    lines.push("- Gmail/Google/write/move/delete/run approval tools: include exact required fields from the user's request or ask if missing.".to_string());
    lines.join("\n")
}

fn clean_decision_messages(
    messages: &[ReactChatMessage],
    context_block: &str,
    validation_error: Option<&str>,
) -> Vec<Value> {
    let latest = latest_user_text(messages);
    let state = [
        context_block_has_chat_image_reference(context_block)
            .then_some("chat_image_available=true"),
        recent_pending_image_proposal(messages)
            .is_some()
            .then_some("pending_image_approval=true"),
        recent_image_context(messages).then_some("recent_image_context=true"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    let state = if state.is_empty() {
        "none".to_string()
    } else {
        state.join(", ")
    };
    let mut user_payload = format!(
        "{}\n\nVerified compact app state: {}\n\nLatest user turn:\n{}\n\nDecide the next app action for the latest user turn from the conversation.",
        clean_tools_text(),
        state,
        latest
    );
    if let Some(error) = validation_error {
        user_payload.push_str(
            "\n\nPrevious decision was invalid. Fix only the JSON decision. Validation error:\n",
        );
        user_payload.push_str(error);
    }

    let mut out = vec![json!({
        "role": "system",
        "content": clean_tool_instruction()
    })];
    out.extend(clean_decision_history(messages));
    out.push(json!({ "role": "user", "content": user_payload }));
    out
}

pub(super) fn clean_tool_instruction() -> String {
    r#"You are the clean tool decision gateway for this local AI companion app.
Classify only the latest user turn from the conversation. Do not answer the user except for a short approval/clarification reply field.
Return one JSON object only, with no markdown and no extra text.

Required JSON schema:
{
  "action": "chat | ask | tool | approval",
  "tool": null,
  "mode": null,
  "refs": [],
  "arguments": {{}},
  "reply": null,
  "reason": "short"
}

Hard rules:
- action must be exactly chat, ask, tool, or approval.
- tool must be null or exactly one tool name from the provided tools list.
- Never invent, translate, abbreviate, or rename tools.
- For normal conversation, use action chat and tool null.
- If a required target or argument is missing, use action ask and put one short natural question in reply.
- If a write/delete/send/run/create action needs user approval, use action approval.
- If a direct read/search/preview/fetch tool is needed, use action tool.
- If the user asks to create/edit/generate/send a new image, use action approval and tool propose_image_generation.
- Do not offer or propose image generation proactively. If the latest user is only chatting, complimenting, roleplaying, describing something, or asking for an opinion, use action chat.
- Only use propose_image_generation when the latest user directly asks to create, edit, draw, render, generate, make, or send a new image, or confirms a pending image request.
- For approval, reply must be one short natural sentence in the user's current language and relationship tone.
- Approval reply must not mention mode, reference source, prompt, tool, card, JSON, engine, or file path.
- Image modes are values, not tools: text_image, image_image, bot_image, user_image, user_bot_image.
- For image generation, put mode in both mode and arguments.mode.
- Image prompts must be English-first, creative, and context-aware, while preserving names, places, brands, and quoted text.
- Visual questions about an attached image are chat, unless the user asks to create or edit an image.
- Use chat_image only if the conversation has a real attached/pasted/prior chat image.
- The user is the person speaking in user messages. The assistant/bot is the current character speaking in assistant messages.
- In the latest user turn, first-person references usually mean the user; second-person references usually mean the assistant.
- If the user asks for the assistant's own picture/selfie/avatar/body/outfit/pose/scene, choose bot_image with refs ["bot_avatar"].
- If the user asks for the user's own/profile/avatar image, choose user_image with refs ["user_avatar"].
- If the user asks for user and assistant together, choose user_bot_image with refs ["user_avatar","bot_avatar"].
- If the user asks for the user plus a third-party person/object from a chat image, choose image_image with refs ["chat_image","user_avatar"].
- If the user asks to use a chat image as reference and include both the user and assistant in the generated scene, choose image_image with refs ["chat_image","user_avatar","bot_avatar"], not user_bot_image.
- If the user asks to use a chat image as reference and include only the assistant profile, choose image_image with refs ["chat_image","bot_avatar"].
- Existing workspace media/file preview uses preview_random_media or preview_file, not image generation.
- After a prior media preview, replacement/another/different item means preview_random_media.
- Do not claim a tool result. The app will execute tools and then ask for the final natural reply.

Use only exact tools/modes from the list provided in the user message."#
        .to_string()
}

fn extract_json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    (end >= start).then_some(&text[start..=end])
}

fn parse_clean_decision(body: &Value) -> Result<CleanDecision, String> {
    let text = extract_chat_reply_text(body);
    let json_text = extract_json_object(&text)
        .ok_or_else(|| format!("Decision was not JSON: {}", compact_for_error(&text)))?;
    serde_json::from_str::<CleanDecision>(json_text)
        .map_err(|error| format!("Could not parse decision JSON: {}", error))
}

fn compact_for_error(text: &str) -> String {
    crate::assistant_runtime::compact_trace_text(text, 260)
}

async fn decide_clean_tool(
    messages: &[ReactChatMessage],
    context_block: &str,
    sampling: SamplingConfig,
    validation_error: Option<&str>,
) -> Result<(CleanDecision, String), String> {
    let reply = call_chat_json(
        clean_decision_messages(messages, context_block, validation_error),
        clean_decision_sampling(sampling),
        900,
    )
    .await?;
    let thinking = extract_chat_reasoning_text(&reply);
    let decision = parse_clean_decision(&reply)?;
    Ok((decision, thinking))
}

fn normalized_action(action: &str) -> &'static str {
    match action.trim().to_ascii_lowercase().as_str() {
        "chat" => "chat",
        "ask" | "clarify" | "clarification" => "ask",
        "tool" => "tool",
        "approval" | "approve" => "approval",
        _ => "",
    }
}

fn inferred_decision_action(decision: &CleanDecision) -> &'static str {
    let normalized = normalized_action(&decision.action);
    if !normalized.is_empty() {
        return normalized;
    }
    if decision
        .tool
        .as_deref()
        .is_some_and(|tool| tool == "propose_image_generation" || tool.starts_with("propose_"))
    {
        return "approval";
    }
    if decision
        .tool
        .as_deref()
        .map(str::trim)
        .is_some_and(|tool| !tool.is_empty())
    {
        return "tool";
    }
    if decision
        .mode
        .as_ref()
        .is_some_and(|mode| !mode.trim().is_empty())
    {
        return "approval";
    }
    ""
}

fn decision_to_tool_call(decision: &CleanDecision, latest_text: &str) -> Result<ToolCall, String> {
    let action = inferred_decision_action(decision);
    if action != "tool" && action != "approval" {
        return Err("Decision action is not a tool action.".to_string());
    }

    let tool = decision
        .tool
        .as_deref()
        .or_else(|| decision.mode.as_ref().map(|_| "propose_image_generation"))
        .map(str::trim)
        .filter(|tool| !tool.is_empty())
        .ok_or_else(|| "Tool action requires a tool name.".to_string())?
        .to_string();

    let mut merged = match default_tool_arguments(&tool) {
        Value::Object(object) => object,
        _ => Map::new(),
    };
    if let Value::Object(object) = decision.arguments.clone() {
        for (key, value) in object {
            merged.insert(key, value);
        }
    }

    if tool == "propose_image_generation" {
        if let Some(mode) = decision
            .mode
            .as_ref()
            .map(|mode| normalize_image_mode(mode))
        {
            merged.insert("mode".to_string(), Value::String(mode));
        }
        if !decision.refs.is_empty() {
            merged.insert("reference_sources".to_string(), json!(decision.refs));
        }
    }

    Ok(with_user_text(
        ToolCall {
            tool,
            arguments: Value::Object(merged),
        },
        latest_text,
    ))
}

fn short_reply_from_decision(decision: &CleanDecision) -> Option<String> {
    decision
        .reply
        .as_deref()
        .map(str::trim)
        .filter(|reply| !reply.is_empty())
        .map(ToString::to_string)
}

fn clean_visible_reply(text: &str) -> String {
    text.chars()
        .filter(|ch| {
            let code = *ch as u32;
            matches!(*ch, '\n' | '\r' | '\t')
                || (!ch.is_control()
                    && *ch != '\u{FFFD}'
                    && *ch != '\u{25A1}'
                    && *ch != '\u{25A0}'
                    && !(0x1F900..=0x1FAFF).contains(&code))
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn approval_reply_mentions_internal_details(text: &str) -> bool {
    let lowered = text.to_lowercase();
    [
        "mode",
        "text_image",
        "image_image",
        "bot_image",
        "user_image",
        "user_bot_image",
        "reference",
        "refs",
        "tool",
        "json",
        "prompt below",
        "review the prompt",
        "approval card",
        "generation engine",
        "file path",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
}

fn natural_approval_reply(decision: &CleanDecision, fallback: String) -> String {
    let Some(reply) = short_reply_from_decision(decision) else {
        return fallback;
    };
    let reply = clean_visible_reply(&reply);
    if reply.is_empty() || approval_reply_mentions_internal_details(&reply) {
        fallback
    } else {
        reply
    }
}

fn sentence_key(text: &str) -> String {
    normalize_text(text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn split_visible_sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '.' | '!' | '?' | '。' | '！' | '？') {
            let sentence = current.trim();
            if !sentence.is_empty() {
                out.push(sentence.to_string());
            }
            current.clear();
        }
    }
    let tail = current.trim();
    if !tail.is_empty() {
        out.push(tail.to_string());
    }
    out
}

fn remove_recent_repeated_sentences(answer: &str, messages: &[ReactChatMessage]) -> String {
    let recent = messages
        .iter()
        .rev()
        .filter(|message| message.role == "assistant")
        .take(10)
        .flat_map(|message| split_visible_sentences(&content_text(&message.content)))
        .map(|sentence| sentence_key(&sentence))
        .filter(|key| key.split_whitespace().count() >= 5)
        .collect::<std::collections::HashSet<_>>();
    if recent.is_empty() {
        return answer.trim().to_string();
    }
    let kept = split_visible_sentences(answer)
        .into_iter()
        .filter(|sentence| {
            let key = sentence_key(sentence);
            key.split_whitespace().count() < 5 || !recent.contains(&key)
        })
        .collect::<Vec<_>>();
    if kept.is_empty() {
        answer.trim().to_string()
    } else {
        kept.join(" ").trim().to_string()
    }
}

async fn final_reply_from_observation(
    mut base_messages: Vec<Value>,
    tool_call: &ToolCall,
    observation: &str,
    sampling: SamplingConfig,
    max_tokens: u32,
) -> Result<(String, String), String> {
    base_messages.push(json!({
        "role": "system",
        "content": "A tool has already been executed. Answer naturally in the current conversation language. Use only the verified result below. Do not mention tool syntax. Do not invent extra facts. Do not cite raw file paths or filenames in the spoken reply unless the user specifically asks for them; preview cards already show file details."
    }));
    base_messages.push(json!({
        "role": "user",
        "content": format!(
            "Verified result from {}:\n{}",
            tool_call.tool,
            observation
        )
    }));
    call_chat_text_with_continuation(base_messages, sampling, max_tokens, false).await
}

fn clean_thinking_line(decision: &CleanDecision) -> String {
    format!(
        "Clean decision: action={} tool={} mode={} reason={}",
        inferred_decision_action(decision),
        decision.tool.as_deref().unwrap_or("none"),
        decision.mode.as_deref().unwrap_or("none"),
        decision.reason.as_deref().unwrap_or("")
    )
}

pub(super) async fn agent_clean_chat_core(
    runtime_prompt: String,
    context_block: String,
    messages: Vec<ReactChatMessage>,
    folders: Vec<String>,
    google_client_id: String,
    google_client_secret: String,
    sampling: SamplingConfig,
    max_tokens: u32,
    thinking_enabled: bool,
    request_elapsed_ms: i64,
) -> Result<ReactChatResult, String> {
    let agent_started_at = Instant::now();
    let request_elapsed_ms = request_elapsed_ms.max(0);
    let latest_text = latest_user_text(&messages);
    let vi = user_wants_vietnamese(&latest_text);
    let base_messages =
        clean_base_messages(&runtime_prompt, &context_block, &messages, thinking_enabled);
    let mut thinking = String::new();
    let mut tool_trace = Vec::new();

    if is_confirmation(&latest_text) {
        if let Some(proposal) = recent_pending_image_proposal(&messages) {
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

    let (mut decision, decision_thinking) =
        decide_clean_tool(&messages, &context_block, sampling, None).await?;
    append_thinking(&mut thinking, &decision_thinking);
    append_thinking(&mut thinking, &clean_thinking_line(&decision));
    crate::assistant_runtime::append_runtime_log(
        "agent",
        &format!(
            "clean_decision action={} tool={} mode={} latest=\"{}\"",
            inferred_decision_action(&decision),
            decision.tool.as_deref().unwrap_or("none"),
            decision.mode.as_deref().unwrap_or("none"),
            crate::assistant_runtime::compact_trace_text(&latest_text, 180)
        ),
    );

    match inferred_decision_action(&decision) {
        "chat" => {
            let (answer, final_thinking) = call_chat_text_with_continuation(
                base_messages,
                sampling,
                max_tokens,
                thinking_enabled,
            )
            .await?;
            append_thinking(&mut thinking, &final_thinking);
            return Ok(ReactChatResult {
                answer: clean_visible_reply(&remove_recent_repeated_sentences(
                    answer.strip_prefix("RESPONSE:").unwrap_or(&answer),
                    &messages,
                )),
                thinking: thinking_result(thinking_enabled, &thinking),
                tool_used: None,
                observation: None,
                cards: Vec::new(),
                image_proposal: None,
                file_preview: None,
                action_proposal: None,
                tool_trace,
            });
        }
        "ask" => {
            let answer = clean_visible_reply(&remove_recent_repeated_sentences(
                &short_reply_from_decision(&decision)
                    .unwrap_or_else(|| "Can you clarify that a little?".to_string()),
                &messages,
            ));
            return Ok(ReactChatResult {
                answer,
                thinking: thinking_result(thinking_enabled, &thinking),
                tool_used: None,
                observation: None,
                cards: Vec::new(),
                image_proposal: None,
                file_preview: None,
                action_proposal: None,
                tool_trace,
            });
        }
        "tool" | "approval" => {}
        _ => {
            let (answer, final_thinking) = call_chat_text_with_continuation(
                base_messages,
                sampling,
                max_tokens,
                thinking_enabled,
            )
            .await?;
            append_thinking(&mut thinking, &final_thinking);
            return Ok(empty_react_result(
                clean_visible_reply(&remove_recent_repeated_sentences(
                    answer.strip_prefix("RESPONSE:").unwrap_or(&answer),
                    &messages,
                )),
                thinking_result(thinking_enabled, &thinking),
            ));
        }
    }

    let mut tool_call = decision_to_tool_call(&decision, &latest_text)?;
    let mut validation_error = validate_tool_call(&tool_call)
        .err()
        .or_else(|| tool_allowed_for_context(&tool_call, &messages, &context_block).err());
    if let Some(error) = validation_error.clone() {
        crate::assistant_runtime::append_runtime_log(
            "agent",
            &format!(
                "clean_decision validation_retry error={}",
                crate::assistant_runtime::compact_trace_text(&error, 240)
            ),
        );
        let (retry_decision, retry_thinking) =
            decide_clean_tool(&messages, &context_block, sampling, Some(&error)).await?;
        append_thinking(&mut thinking, &retry_thinking);
        append_thinking(&mut thinking, &clean_thinking_line(&retry_decision));
        match decision_to_tool_call(&retry_decision, &latest_text) {
            Ok(retry_tool_call) => {
                decision = retry_decision;
                tool_call = retry_tool_call;
                validation_error = validate_tool_call(&tool_call).err().or_else(|| {
                    tool_allowed_for_context(&tool_call, &messages, &context_block).err()
                });
            }
            Err(retry_error) => {
                validation_error = Some(format!("{} Retry also failed: {}", error, retry_error));
            }
        }
    }
    if let Some(error) = validation_error {
        let mut failure_messages = base_messages.clone();
        failure_messages.push(json!({
            "role": "system",
            "content": "The attempted tool decision was invalid. Explain the problem naturally and briefly in the current conversation language. Ask for only the missing detail if needed."
        }));
        failure_messages.push(json!({
            "role": "user",
            "content": format!("Validation error: {}", error)
        }));
        let (answer, final_thinking) = call_chat_text_with_continuation(
            failure_messages,
            sampling,
            max_tokens.min(512),
            false,
        )
        .await?;
        append_thinking(&mut thinking, &final_thinking);
        return Ok(empty_react_result(
            clean_visible_reply(&remove_recent_repeated_sentences(&answer, &messages)),
            thinking_result(thinking_enabled, &thinking),
        ));
    }

    let outcome = execute_tool(
        &tool_call,
        &folders,
        &google_client_id,
        &google_client_secret,
        agent_started_at,
        request_elapsed_ms,
    )
    .await;
    let summary = clean_summary(&outcome.observation);
    tool_trace.push(ToolTrace {
        tool: tool_call.tool.clone(),
        success: outcome.success,
        summary,
    });

    if let Some(proposal) = outcome.image_proposal {
        let answer = natural_approval_reply(&decision, image_approval_answer(vi));
        return Ok(ReactChatResult {
            answer,
            thinking: thinking_result(thinking_enabled, &thinking),
            tool_used: Some(tool_call.tool),
            observation: Some(outcome.observation),
            cards: outcome.cards,
            image_proposal: Some(proposal),
            file_preview: None,
            action_proposal: None,
            tool_trace,
        });
    }

    if let Some(action) = outcome.action_proposal {
        let answer = natural_approval_reply(&decision, action_approval_answer(vi));
        return Ok(ReactChatResult {
            answer,
            thinking: thinking_result(thinking_enabled, &thinking),
            tool_used: Some(tool_call.tool),
            observation: Some(outcome.observation),
            cards: outcome.cards,
            image_proposal: None,
            file_preview: None,
            action_proposal: Some(action),
            tool_trace,
        });
    }

    if let Some(preview) = outcome.file_preview {
        return Ok(ReactChatResult {
            answer: clean_visible_reply(&preview_final_answer(&preview, &latest_text)),
            thinking: thinking_result(thinking_enabled, &thinking),
            tool_used: Some(tool_call.tool),
            observation: Some(outcome.observation),
            cards: outcome.cards,
            image_proposal: None,
            file_preview: Some(preview),
            action_proposal: None,
            tool_trace,
        });
    }

    let (answer, final_thinking) = final_reply_from_observation(
        base_messages,
        &tool_call,
        &outcome.observation,
        sampling,
        max_tokens,
    )
    .await?;
    append_thinking(&mut thinking, &final_thinking);

    Ok(ReactChatResult {
        answer: clean_visible_reply(&remove_recent_repeated_sentences(
            answer.strip_prefix("RESPONSE:").unwrap_or(&answer),
            &messages,
        )),
        thinking: thinking_result(thinking_enabled, &thinking),
        tool_used: Some(tool_call.tool),
        observation: Some(outcome.observation),
        cards: outcome.cards,
        image_proposal: None,
        file_preview: outcome.file_preview,
        action_proposal: None,
        tool_trace,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infers_approval_action_from_image_tool_when_action_is_blank() {
        let decision = CleanDecision {
            action: " ".to_string(),
            tool: Some("propose_image_generation".to_string()),
            mode: Some("bot_image".to_string()),
            refs: vec!["bot_avatar".to_string()],
            arguments: json!({ "prompt": "A warm portrait of the assistant on a snowy street." }),
            reply: None,
            reason: None,
        };
        let call = decision_to_tool_call(&decision, "send me your picture").expect("tool call");
        assert_eq!(call.tool, "propose_image_generation");
        assert_eq!(
            call.arguments.get("mode").and_then(Value::as_str),
            Some("bot_image")
        );
    }

    #[test]
    fn removes_recent_repeated_assistant_sentence_without_language_rules() {
        let messages = vec![ReactChatMessage {
            role: "assistant".to_string(),
            content: json!(
                "Cảm ơn anh nhiều nha, em vui lắm đó! Anh thích phần nào trong ảnh vậy?"
            ),
        }];
        let cleaned = remove_recent_repeated_sentences(
            "Cảm ơn anh nhiều nha, em vui lắm đó! Lời khen này làm em rất vui.",
            &messages,
        );
        assert_eq!(cleaned, "Lời khen này làm em rất vui.");
    }
}
