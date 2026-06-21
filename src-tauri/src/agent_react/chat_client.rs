use super::*;

pub(super) fn extract_chat_reply_text(body: &Value) -> String {
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

pub(super) fn chat_finish_reason(body: &Value) -> String {
    body.get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("finish_reason"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase()
}

pub(super) fn chat_hit_token_limit(body: &Value) -> bool {
    matches!(
        chat_finish_reason(body).as_str(),
        "length" | "max_tokens" | "token_limit" | "max_output_tokens"
    )
}

pub(super) fn append_reply_part(accumulated: &mut String, next: &str) {
    let next = next.trim();
    if next.is_empty() {
        return;
    }
    if accumulated.trim().is_empty() {
        accumulated.push_str(next);
        return;
    }
    let overlap = accumulated
        .chars()
        .rev()
        .take(240)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    let next_prefix = next.chars().take(240).collect::<String>();
    if !overlap.is_empty() && next_prefix.starts_with(overlap.trim()) {
        let skip = overlap.trim().chars().count();
        accumulated.push_str(next.chars().skip(skip).collect::<String>().as_str());
        return;
    }
    accumulated.push_str("\n\n");
    accumulated.push_str(next);
}

pub(super) async fn call_chat_text_with_continuation(
    request_messages: Vec<Value>,
    sampling: SamplingConfig,
    max_tokens: u32,
    thinking_enabled: bool,
) -> Result<(String, String), String> {
    let mut messages = request_messages;
    let mut answer = String::new();
    let mut thinking = String::new();

    for continuation_index in 0..3 {
        let reply = call_chat(
            messages.clone(),
            None,
            sampling,
            max_tokens,
            thinking_enabled,
        )
        .await?;
        append_thinking(&mut thinking, &extract_chat_reasoning_text(&reply));
        let part = extract_chat_reply_text(&reply);
        append_reply_part(&mut answer, &part);

        if !chat_hit_token_limit(&reply) || part.trim().is_empty() {
            break;
        }

        append_thinking(
            &mut thinking,
            "Reply continuation: the model reached its token limit, so the app asked it to continue from the same answer.",
        );
        messages.push(json!({
            "role": "assistant",
            "content": answer
        }));
        messages.push(json!({
            "role": "user",
            "content": if continuation_index >= 1 {
                "Finish the previous answer from where it stopped. Keep it concise. Do not restart, summarize, or repeat earlier text."
            } else {
                "Continue the previous answer exactly from where it stopped. Do not restart, summarize, or repeat earlier text."
            }
        }));
    }

    Ok((answer.trim().to_string(), thinking))
}

pub async fn generate_plain_text_reply(
    messages: Vec<Value>,
    sampling: SamplingConfig,
    max_tokens: u32,
) -> Result<String, String> {
    let reply = call_chat(messages, None, sampling, max_tokens, false).await?;
    Ok(extract_chat_reply_text(&reply))
}

pub(super) fn extract_value_text(value: &Value) -> String {
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

pub(super) fn extract_chat_reasoning_text(body: &Value) -> String {
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

pub(super) fn normalize_chat_messages_for_templates(messages: Vec<Value>) -> Vec<Value> {
    let mut leading_system_parts = Vec::new();
    let mut normalized = Vec::new();

    for message in messages {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if matches!(role, "system" | "developer") {
            let text = extract_value_text(message.get("content").unwrap_or(&Value::Null));
            if !text.trim().is_empty() {
                leading_system_parts.push(text.trim().to_string());
            }
            continue;
        }
        normalized.push(message);
    }

    if !leading_system_parts.is_empty() {
        normalized.insert(
            0,
            json!({
                "role": "system",
                "content": leading_system_parts.join("\n\n")
            }),
        );
    }

    normalized
}

fn hex_digit_value(byte: u8) -> Option<u32> {
    match byte {
        b'0'..=b'9' => Some((byte - b'0') as u32),
        b'a'..=b'f' => Some((byte - b'a' + 10) as u32),
        b'A'..=b'F' => Some((byte - b'A' + 10) as u32),
        _ => None,
    }
}

fn escaped_unicode_at(bytes: &[u8], index: usize) -> Option<u32> {
    if index + 6 > bytes.len()
        || bytes.get(index) != Some(&b'\\')
        || bytes.get(index + 1) != Some(&b'u')
    {
        return None;
    }
    let mut value = 0;
    for offset in 2..6 {
        value = (value << 4) | hex_digit_value(bytes[index + offset])?;
    }
    Some(value)
}

pub(crate) fn sanitize_model_text(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut index = 0;
    let mut without_escaped_surrogates = String::with_capacity(text.len());
    while index < bytes.len() {
        if let Some(code) = escaped_unicode_at(bytes, index) {
            if (0xD800..=0xDFFF).contains(&code) {
                index += 6;
                if (0xD800..=0xDBFF).contains(&code) {
                    if let Some(low) = escaped_unicode_at(bytes, index) {
                        if (0xDC00..=0xDFFF).contains(&low) {
                            index += 6;
                        }
                    }
                }
                continue;
            }
        }

        let Some(ch) = text[index..].chars().next() else {
            break;
        };
        let code = ch as u32;
        if matches!(ch, '\n' | '\r' | '\t')
            || (!ch.is_control()
                && ch != '\u{FFFD}'
                && ch != '\u{25A1}'
                && ch != '\u{25A0}'
                && !(0x1F000..=0x1FAFF).contains(&code))
        {
            without_escaped_surrogates.push(ch);
        }
        index += ch.len_utf8();
    }
    crate::text_encoding::repair_mojibake_text(&without_escaped_surrogates)
}

fn sanitize_model_value(value: Value) -> Value {
    match value {
        Value::String(text) => Value::String(sanitize_model_text(&text)),
        Value::Array(items) => Value::Array(items.into_iter().map(sanitize_model_value).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, sanitize_model_value(value)))
                .collect(),
        ),
        other => other,
    }
}

pub(super) async fn call_chat(
    messages: Vec<Value>,
    tools: Option<Value>,
    sampling: SamplingConfig,
    max_tokens: u32,
    thinking_enabled: bool,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("Could not prepare chat request: {}", e))?;

    let mut payload = json!({
        "messages": sanitize_model_value(Value::Array(normalize_chat_messages_for_templates(messages))),
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
                "Connection to the brain failed while sending chat request to http://127.0.0.1:8080/v1/chat/completions: {} ({:?})",
                e, e
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

pub(super) async fn call_chat_json(
    messages: Vec<Value>,
    sampling: SamplingConfig,
    max_tokens: u32,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("Could not prepare JSON chat request: {}", e))?;

    let payload = json!({
        "messages": sanitize_model_value(Value::Array(normalize_chat_messages_for_templates(messages))),
        "temperature": sampling.temperature.clamp(0.0, 2.0),
        "top_k": sampling.top_k.min(200),
        "top_p": sampling.top_p.clamp(0.0, 1.0),
        "min_p": sampling.min_p.clamp(0.0, 1.0),
        "repeat_last_n": sampling.repeat_last_n.clamp(-1, 4096),
        "repeat_penalty": sampling.repeat_penalty.clamp(0.8, 2.0),
        "max_tokens": max_tokens.clamp(64, 4096),
        "stream": false,
        "response_format": { "type": "json_object" },
        "chat_template_kwargs": {
            "enable_thinking": false,
            "thinking": false
        }
    });

    let response = client
        .post("http://127.0.0.1:8080/v1/chat/completions")
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            format!(
                "Connection to the brain failed while sending JSON decision request to http://127.0.0.1:8080/v1/chat/completions: {} ({:?})",
                e, e
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
        .map_err(|e| format!("Could not read JSON chat response: {}", e))
}
