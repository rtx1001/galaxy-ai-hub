use super::*;

pub(super) fn normalize_telegram_token(input: &str) -> String {
    let mut token = input.trim().to_string();
    if let Some((_, rest)) = token.rsplit_once("/bot") {
        token = rest.to_string();
    }
    if token.len() >= 3 && token[..3].eq_ignore_ascii_case("bot") {
        token = token[3..].to_string();
    }

    token = token
        .split_whitespace()
        .find(|part| part.contains(':'))
        .unwrap_or(token.as_str())
        .to_string();

    token
        .split('/')
        .next()
        .unwrap_or_default()
        .trim()
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '`' | ',' | ';'))
        .trim_end_matches('/')
        .to_string()
}

pub(super) fn parse_telegram_owner_id(input: &str) -> Result<Option<i64>, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    trimmed
        .parse::<i64>()
        .map(Some)
        .map_err(|_| "Telegram owner ID must be a number.".to_string())
}

pub(super) async fn telegram_get_me(
    client: &reqwest::Client,
    token: &str,
) -> Result<TelegramBotStatus, String> {
    let response = client
        .get(format!("https://api.telegram.org/bot{}/getMe", token))
        .send()
        .await
        .map_err(|e| format!("Could not reach Telegram: {}", e))?;

    let status = response.status();
    let body_text = response
        .text()
        .await
        .map_err(|e| format!("Could not read Telegram response: {}", e))?;
    let body: Value = serde_json::from_str(&body_text)
        .map_err(|_| format!("Telegram returned an unreadable response: {}", body_text))?;

    if !status.is_success() || !body.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        let description = body
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("Telegram did not accept this bot token.");
        return Ok(TelegramBotStatus {
            success: false,
            message: description.to_string(),
            username: None,
        });
    }

    let username = body
        .get("result")
        .and_then(|result| result.get("username"))
        .and_then(Value::as_str)
        .map(|value| value.to_string());

    Ok(TelegramBotStatus {
        success: true,
        message: username
            .as_ref()
            .map(|name| format!("Connected to @{}.", name))
            .unwrap_or_else(|| "Connected to Telegram bot.".to_string()),
        username,
    })
}

pub(super) async fn send_telegram_message(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    text: &str,
) -> Result<(), String> {
    // Try with Markdown first, fall back to plain text if Markdown parse fails
    let response = client
        .post(format!("https://api.telegram.org/bot{}/sendMessage", token))
        .json(&json!({
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown",
            "disable_web_page_preview": true
        }))
        .send()
        .await
        .map_err(|e| format!("Could not send Telegram message: {}", e))?;

    if response.status().is_success() {
        return Ok(());
    }

    // Fallback: send as plain text (avoids Markdown parse errors on raw text)
    let fallback = client
        .post(format!("https://api.telegram.org/bot{}/sendMessage", token))
        .json(&json!({
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": true
        }))
        .send()
        .await
        .map_err(|e| format!("Could not send Telegram message: {}", e))?;

    if fallback.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "Telegram sendMessage failed with {}.",
            fallback.status()
        ))
    }
}

pub(super) fn telegram_message_chunks(text: &str) -> Vec<String> {
    const LIMIT: usize = 3500;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    for paragraph in trimmed.split_inclusive('\n') {
        let paragraph_chars = paragraph.chars().count();
        if !current.is_empty() && current.chars().count() + paragraph_chars > LIMIT {
            chunks.push(current.trim().to_string());
            current.clear();
        }

        if paragraph_chars <= LIMIT {
            current.push_str(paragraph);
            continue;
        }

        if !current.trim().is_empty() {
            chunks.push(current.trim().to_string());
            current.clear();
        }
        chunks.extend(split_telegram_long_segment(paragraph, LIMIT));
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }
    chunks
}

pub(super) fn split_telegram_long_segment(segment: &str, limit: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut last_break: Option<usize> = None;

    for ch in segment.chars() {
        current.push(ch);
        if matches!(
            ch,
            '.' | '!' | '?' | '\u{3002}' | '\u{ff01}' | '\u{ff1f}' | '\n'
        ) {
            last_break = Some(current.len());
        } else if ch.is_whitespace() && last_break.is_none() {
            last_break = Some(current.len());
        }

        if current.chars().count() >= limit {
            let split_at = last_break
                .filter(|index| *index > 0 && *index < current.len())
                .unwrap_or(current.len());
            let head = current[..split_at].trim().to_string();
            let tail = current[split_at..].trim_start().to_string();
            if !head.is_empty() {
                chunks.push(head);
            }
            current = tail;
            last_break = None;
        }
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }
    chunks
}

pub(super) async fn send_telegram_message_chunked(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    text: &str,
) {
    let chunks = telegram_message_chunks(text);
    for (index, chunk) in chunks.iter().enumerate() {
        let mut send_result = send_telegram_message(client, token, chat_id, chunk).await;
        if let Err(error) = send_result {
            append_runtime_log(
                "telegram",
                &format!(
                    "chunk send failed, retrying chunk {}/{}: {}",
                    index + 1,
                    chunks.len(),
                    error
                ),
            );
            tokio::time::sleep(Duration::from_millis(650)).await;
            send_result = send_telegram_message(client, token, chat_id, chunk).await;
        }
        if let Err(error) = send_result {
            append_runtime_log(
                "telegram",
                &format!(
                    "chunk send failed permanently chunk {}/{}: {}",
                    index + 1,
                    chunks.len(),
                    error
                ),
            );
        }
        if index + 1 < chunks.len() {
            tokio::time::sleep(Duration::from_millis(120)).await;
        }
    }
}

pub(super) fn telegram_photo_file_id(message: &Value) -> Option<String> {
    message
        .get("photo")
        .and_then(Value::as_array)
        .and_then(|photos| {
            photos
                .iter()
                .max_by_key(|photo| photo.get("file_size").and_then(Value::as_u64).unwrap_or(0))
        })
        .and_then(|photo| photo.get("file_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub(super) fn telegram_document_file(message: &Value) -> Option<(String, String, String, u64)> {
    let document = message.get("document")?;
    let file_id = document.get("file_id").and_then(Value::as_str)?.to_string();
    let name = document
        .get("file_name")
        .and_then(Value::as_str)
        .unwrap_or("telegram-file")
        .to_string();
    let mime = document
        .get("mime_type")
        .and_then(Value::as_str)
        .unwrap_or("application/octet-stream")
        .to_string();
    let size = document
        .get("file_size")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    Some((file_id, name, mime, size))
}

pub(super) async fn download_telegram_file(
    client: &reqwest::Client,
    token: &str,
    file_id: &str,
    display_name: &str,
    mime_type: &str,
) -> Result<TelegramIncomingFile, String> {
    let file_meta = client
        .get(format!("https://api.telegram.org/bot{}/getFile", token))
        .query(&[("file_id", file_id)])
        .send()
        .await
        .map_err(|error| format!("Could not ask Telegram for file info: {}", error))?;
    let file_meta_text = file_meta
        .text()
        .await
        .map_err(|error| format!("Could not read Telegram file info: {}", error))?;
    let file_meta_json = serde_json::from_str::<Value>(&file_meta_text)
        .map_err(|_| format!("Telegram returned unreadable file info: {}", file_meta_text))?;
    if !file_meta_json
        .get("ok")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(format!("Telegram getFile failed: {}", file_meta_text));
    }
    let file_path = file_meta_json
        .get("result")
        .and_then(|result| result.get("file_path"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            format!(
                "Telegram getFile did not return a file path: {}",
                file_meta_text
            )
        })?;
    let bytes = client
        .get(format!(
            "https://api.telegram.org/file/bot{}/{}",
            token, file_path
        ))
        .send()
        .await
        .map_err(|error| format!("Could not download Telegram file: {}", error))?
        .bytes()
        .await
        .map_err(|error| format!("Could not read Telegram file bytes: {}", error))?;
    let size_bytes = bytes.len() as u64;
    let local_path = save_telegram_downloaded_file(&bytes, display_name, mime_type)?;
    let is_image = mime_type.to_ascii_lowercase().starts_with("image/");
    Ok(TelegramIncomingFile {
        local_path: local_path.to_string_lossy().to_string(),
        display_name: display_name.to_string(),
        mime_type: mime_type.to_string(),
        size_bytes,
        is_image,
    })
}

pub(super) async fn download_telegram_message_files(
    client: &reqwest::Client,
    token: &str,
    message: &Value,
) -> Vec<TelegramIncomingFile> {
    let mut files = Vec::new();

    if let Some(file_id) = telegram_photo_file_id(message) {
        match download_telegram_file(client, token, &file_id, "telegram-photo.jpg", "image/jpeg")
            .await
        {
            Ok(file) => files.push(file),
            Err(error) => {
                append_runtime_log("telegram", &format!("photo download failed: {}", error))
            }
        }
    }

    if let Some((file_id, name, mime, size)) = telegram_document_file(message) {
        if size > 50 * 1024 * 1024 {
            append_runtime_log(
                "telegram",
                &format!("ignored oversized document {} bytes name={}", size, name),
            );
        } else {
            match download_telegram_file(client, token, &file_id, &name, &mime).await {
                Ok(file) => files.push(file),
                Err(error) => {
                    append_runtime_log("telegram", &format!("document download failed: {}", error))
                }
            }
        }
    }

    files
}

pub(super) async fn send_telegram_message_with_keyboard(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    text: &str,
    reply_markup: Value,
) -> Result<(), String> {
    let response = client
        .post(format!("https://api.telegram.org/bot{}/sendMessage", token))
        .json(&json!({
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": true,
            "reply_markup": reply_markup
        }))
        .send()
        .await
        .map_err(|e| format!("Could not send Telegram message: {}", e))?;

    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(format!(
            "Telegram sendMessage failed with {}: {}",
            status, body
        ))
    }
}

pub(super) async fn clear_telegram_message_keyboard(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    message_id: i64,
) {
    let _ = client
        .post(format!(
            "https://api.telegram.org/bot{}/editMessageReplyMarkup",
            token
        ))
        .json(&json!({
            "chat_id": chat_id,
            "message_id": message_id,
            "reply_markup": { "inline_keyboard": [] }
        }))
        .send()
        .await;
}

pub(super) async fn answer_telegram_callback(
    client: &reqwest::Client,
    token: &str,
    callback_id: &str,
    text: &str,
) {
    let _ = client
        .post(format!(
            "https://api.telegram.org/bot{}/answerCallbackQuery",
            token
        ))
        .json(&json!({ "callback_query_id": callback_id, "text": text }))
        .send()
        .await;
}

pub(super) async fn send_telegram_document(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    path: &str,
    caption: Option<&str>,
) -> Result<(), String> {
    let file_bytes =
        std::fs::read(path).map_err(|e| format!("Could not read file for Telegram: {}", e))?;
    let filename = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(filename)
        .mime_str("application/octet-stream")
        .map_err(|e| format!("Could not prepare file for Telegram: {}", e))?;

    let mut form = reqwest::multipart::Form::new()
        .text("chat_id", chat_id.to_string())
        .part("document", part);

    if let Some(cap) = caption {
        form = form.text("caption", cap.to_string());
    }

    let response = client
        .post(format!(
            "https://api.telegram.org/bot{}/sendDocument",
            token
        ))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Could not send document to Telegram: {}", e))?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "Telegram sendDocument failed with {}.",
            response.status()
        ))
    }
}

pub(super) async fn send_telegram_photo(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    path: &str,
    caption: Option<&str>,
) -> Result<(), String> {
    let file_bytes =
        std::fs::read(path).map_err(|e| format!("Could not read image for Telegram: {}", e))?;
    let filename = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image.png")
        .to_string();

    let mime = if filename.to_lowercase().ends_with(".jpg")
        || filename.to_lowercase().ends_with(".jpeg")
    {
        "image/jpeg"
    } else if filename.to_lowercase().ends_with(".webp") {
        "image/webp"
    } else {
        "image/png"
    };

    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(filename)
        .mime_str(mime)
        .map_err(|e| format!("Could not prepare image for Telegram: {}", e))?;

    let mut form = reqwest::multipart::Form::new()
        .text("chat_id", chat_id.to_string())
        .part("photo", part);

    if let Some(cap) = caption {
        form = form.text("caption", cap.to_string());
    }

    let response = client
        .post(format!("https://api.telegram.org/bot{}/sendPhoto", token))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Could not send photo to Telegram: {}", e))?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "Telegram sendPhoto failed with {}.",
            response.status()
        ))
    }
}

pub(super) async fn send_telegram_voice(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    audio_bytes: Vec<u8>,
    caption: Option<&str>,
) -> Result<(), String> {
    let voice_part = reqwest::multipart::Part::bytes(audio_bytes.clone())
        .file_name("reply.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("Could not prepare voice for Telegram: {}", e))?;

    let mut form = reqwest::multipart::Form::new()
        .text("chat_id", chat_id.to_string())
        .part("voice", voice_part);

    if let Some(cap) = caption.filter(|value| !value.trim().is_empty()) {
        form = form.text("caption", cap.to_string());
    }

    let response = client
        .post(format!("https://api.telegram.org/bot{}/sendVoice", token))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Could not send voice to Telegram: {}", e))?;

    if response.status().is_success() {
        Ok(())
    } else {
        let voice_status = response.status();
        let audio_part = reqwest::multipart::Part::bytes(audio_bytes)
            .file_name("reply.wav")
            .mime_str("audio/wav")
            .map_err(|e| format!("Could not prepare audio for Telegram: {}", e))?;
        let mut audio_form = reqwest::multipart::Form::new()
            .text("chat_id", chat_id.to_string())
            .part("audio", audio_part);
        if let Some(cap) = caption.filter(|value| !value.trim().is_empty()) {
            audio_form = audio_form.text("caption", cap.to_string());
        }
        let audio_response = client
            .post(format!("https://api.telegram.org/bot{}/sendAudio", token))
            .multipart(audio_form)
            .send()
            .await
            .map_err(|e| format!("Could not send audio to Telegram: {}", e))?;
        if audio_response.status().is_success() {
            Ok(())
        } else {
            Err(format!(
                "Telegram sendVoice failed with {}; sendAudio failed with {}.",
                voice_status,
                audio_response.status()
            ))
        }
    }
}

pub(super) async fn synthesize_and_send_telegram_voice(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    omnivoice_state: OmniVoiceRuntimeState,
    llama_state: Arc<LlamaState>,
    text: &str,
    voice_sample_path: Option<String>,
    caption: Option<&str>,
) {
    let speech_text = sanitize_telegram_speech_text(text);
    if speech_text.trim().is_empty() {
        return;
    }
    let speech_text_for_log = speech_text.clone();
    let started_at = Instant::now();
    let voice_sample_label = voice_sample_path
        .as_deref()
        .and_then(|path| Path::new(path).file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("default")
        .to_string();
    let record_telegram_voice = |success: bool, output_text: String| {
        let _ = agent_store::record_agent_tool_run(agent_store::AgentToolRun {
            tool_name: "voice_speech".to_string(),
            input_json: json!({
                "interface": "telegram",
                "chat_id": chat_id,
                "voice_sample": voice_sample_label,
                "text": speech_text_for_log.chars().take(220).collect::<String>(),
            })
            .to_string(),
            output_text,
            success,
            duration_ms: started_at.elapsed().as_millis().min(i64::MAX as u128) as i64,
        });
    };
    let voice_status_loop =
        start_telegram_action_loop(client.clone(), token.to_string(), chat_id, "record_voice");
    let had_llm_session = llama_state
        .session
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false);

    if had_llm_session {
        let vram = crate::resource_monitor::get_vram_memory_status();
        append_runtime_log(
            "telegram",
            &format!(
                "voice vram check free={}MB used={}MB total={}MB need=3072MB",
                vram.free_mb, vram.used_mb, vram.total_mb
            ),
        );
        if !vram.available || vram.free_mb < 3072 {
            let state_for_stop = llama_state.clone();
            let _ = tokio::task::spawn_blocking(move || {
                llama_manager::stop_model_state(&state_for_stop)
            })
            .await;
        }
    }

    let synth_result = omnivoice_runtime::synthesize_speech_with_state(
        omnivoice_state,
        speech_text,
        voice_sample_path.clone(),
        false,
    )
    .await;

    match synth_result {
        Ok(audio) => match BASE64.decode(audio.audio_base64.as_bytes()) {
            Ok(bytes) => {
                if let Err(error) =
                    send_telegram_voice(client, token, chat_id, bytes, caption).await
                {
                    record_telegram_voice(false, format!("Voice send failed: {}", error));
                    append_runtime_log("telegram", &format!("voice send failed: {}", error));
                } else {
                    record_telegram_voice(true, "Sent Telegram voice message.".to_string());
                }
            }
            Err(error) => {
                record_telegram_voice(false, format!("Voice decode failed: {}", error));
                append_runtime_log("telegram", &format!("voice decode failed: {}", error));
            }
        },
        Err(error) => {
            record_telegram_voice(false, format!("Voice synthesis failed: {}", error));
            append_runtime_log("telegram", &format!("voice synthesis failed: {}", error));
        }
    }
    voice_status_loop.store(false, Ordering::Relaxed);
}

pub(super) fn sanitize_telegram_speech_text(text: &str) -> String {
    let mut output = String::new();
    let mut in_code_block = false;
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("```") {
            in_code_block = !in_code_block;
            output.push(' ');
            continue;
        }
        if in_code_block || line.starts_with("<tool_call") || line.starts_with("<|tool_call") {
            output.push(' ');
            continue;
        }
        let mut chars = line.chars().peekable();
        while let Some(ch) = chars.next() {
            if ch == '`' {
                continue;
            }
            if ch == '[' {
                let mut label = String::new();
                while let Some(next) = chars.next() {
                    if next == ']' {
                        break;
                    }
                    label.push(next);
                }
                if chars.peek() == Some(&'(') {
                    while let Some(next) = chars.next() {
                        if next == ')' {
                            break;
                        }
                    }
                }
                output.push_str(&label);
                output.push(' ');
                continue;
            }
            if ch == 'h' {
                let mut url = String::from(ch);
                while let Some(next) = chars.peek().copied() {
                    if next.is_whitespace() {
                        break;
                    }
                    url.push(next);
                    chars.next();
                }
                if url.starts_with("http://") || url.starts_with("https://") {
                    output.push(' ');
                } else {
                    output.push_str(&url);
                }
                continue;
            }
            if is_speech_symbol_or_emoji(ch) {
                output.push(' ');
            } else if matches!(
                ch,
                '-' | '\u{2013}' | '\u{2014}' | '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>'
            ) {
                output.push_str(", ");
            } else {
                output.push(ch);
            }
        }
        output.push_str(". ");
    }
    let normalized = normalize_telegram_speech_reading(&output);
    normalized.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(super) fn is_speech_symbol_or_emoji(ch: char) -> bool {
    matches!(
        ch,
        '#' | '*'
            | '>'
            | '<'
            | '_'
            | '~'
            | '|'
            | '@'
            | '^'
            | '&'
            | '='
            | '+'
            | '"'
            | '\''
            | '\u{201c}'
            | '\u{201d}'
            | '\u{2018}'
            | '\u{2019}'
            | '\u{2022}'
            | '\u{00b7}'
    ) || ('\u{1F000}'..='\u{1FAFF}').contains(&ch)
        || ('\u{2600}'..='\u{27BF}').contains(&ch)
}

pub(super) fn telegram_speech_looks_vietnamese(text: &str) -> bool {
    text.chars()
        .any(|ch| ('\u{00C0}'..='\u{1EF9}').contains(&ch) || ch == '\u{0111}' || ch == '\u{0110}')
}

pub(super) fn normalize_telegram_speech_reading(text: &str) -> String {
    let vi = telegram_speech_looks_vietnamese(text);
    text.split_whitespace()
        .map(|token| normalize_telegram_speech_token(token, vi))
        .collect::<Vec<_>>()
        .join(" ")
        .replace('/', ", ")
        .replace('\\', ", ")
}

pub(super) fn normalize_telegram_speech_token(token: &str, vi: bool) -> String {
    let without_trailing =
        token.trim_end_matches(|ch: char| matches!(ch, ',' | ';' | ':' | '.' | '!' | '?'));
    let trailing = &token[without_trailing.len()..];
    let core = without_trailing
        .trim_start_matches(|ch: char| matches!(ch, ',' | ';' | ':' | '.' | '!' | '?'));
    let lower = core.to_lowercase();

    if let Some((day, month, year)) = parse_slash_date(core) {
        let spoken = if vi {
            format!(
                "{} th\u{00e1}ng {} n\u{0103}m {}",
                strip_numeric_leading_zero(day),
                strip_numeric_leading_zero(month),
                year
            )
        } else {
            format!(
                "{} {} {}",
                strip_numeric_leading_zero(month),
                strip_numeric_leading_zero(day),
                year
            )
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some((day, month)) = parse_slash_day_month(core) {
        let spoken = if vi {
            format!(
                "{} th\u{00e1}ng {}",
                strip_numeric_leading_zero(day),
                strip_numeric_leading_zero(month)
            )
        } else {
            format!(
                "{} {}",
                strip_numeric_leading_zero(month),
                strip_numeric_leading_zero(day)
            )
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = core
        .strip_suffix("\u{00b0}C")
        .or_else(|| core.strip_suffix("\u{00b0}c"))
    {
        let spoken = if vi {
            format!("{} \u{0111}\u{1ed9} C\u{00ea}", value)
        } else {
            format!("{} degrees Celsius", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = core
        .strip_suffix("\u{00b0}F")
        .or_else(|| core.strip_suffix("\u{00b0}f"))
    {
        let spoken = if vi {
            format!("{} \u{0111}\u{1ed9} F", value)
        } else {
            format!("{} degrees Fahrenheit", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = lower.strip_suffix("km/h") {
        let spoken = if vi {
            format!("{} ki l\u{00f4} m\u{00e9}t tr\u{00ea}n gi\u{1edd}", value)
        } else {
            format!("{} kilometers per hour", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = lower.strip_suffix("km") {
        let spoken = if vi {
            format!("{} ki l\u{00f4} m\u{00e9}t", value)
        } else {
            format!("{} kilometers", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = lower.strip_suffix("mm") {
        let spoken = if vi {
            format!("{} mi li m\u{00e9}t", value)
        } else {
            format!("{} millimeters", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = lower.strip_suffix("cm") {
        let spoken = if vi {
            format!("{} xen ti m\u{00e9}t", value)
        } else {
            format!("{} centimeters", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = core.strip_suffix('%') {
        let spoken = if vi {
            format!("{} ph\u{1ea7}n tr\u{0103}m", value)
        } else {
            format!("{} percent", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = core.strip_prefix('$') {
        let spoken = if vi {
            format!("{} \u{0111}\u{00f4} la", value)
        } else {
            format!("{} dollars", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if lower.ends_with("usd") && core.len() > 3 {
        let value = &core[..core.len() - 3];
        let spoken = if vi {
            format!("{} \u{0111}\u{00f4} la", value)
        } else {
            format!("{} dollars", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if (lower.ends_with("vnd") || lower.ends_with("vn\u{0111}")) && core.len() > 3 {
        let value = &core[..core.len() - 3];
        let spoken = if vi {
            format!("{} \u{0111}\u{1ed3}ng", value)
        } else {
            format!("{} Vietnamese dong", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = core.strip_suffix('\u{20ab}') {
        let spoken = if vi {
            format!("{} \u{0111}\u{1ed3}ng", value)
        } else {
            format!("{} Vietnamese dong", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = core.strip_prefix('\u{20ac}') {
        let spoken = if vi {
            format!("{} euro", value)
        } else {
            format!("{} euros", value)
        };
        return format!("{}{}", spoken, trailing);
    }
    if let Some(value) = core.strip_prefix('\u{00a3}') {
        let spoken = if vi {
            format!("{} b\u{1ea3}ng Anh", value)
        } else {
            format!("{} pounds", value)
        };
        return format!("{}{}", spoken, trailing);
    }

    format!("{}{}", core, trailing)
}

pub(super) fn parse_slash_date(value: &str) -> Option<(&str, &str, &str)> {
    let parts = value.split('/').collect::<Vec<_>>();
    if parts.len() != 3
        || !parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
    {
        return None;
    }
    if !(1..=2).contains(&parts[0].len())
        || !(1..=2).contains(&parts[1].len())
        || !(2..=4).contains(&parts[2].len())
    {
        return None;
    }
    Some((parts[0], parts[1], parts[2]))
}

pub(super) fn parse_slash_day_month(value: &str) -> Option<(&str, &str)> {
    let parts = value.split('/').collect::<Vec<_>>();
    if parts.len() != 2
        || !parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
    {
        return None;
    }
    if !(1..=2).contains(&parts[0].len()) || !(1..=2).contains(&parts[1].len()) {
        return None;
    }
    Some((parts[0], parts[1]))
}

pub(super) fn strip_numeric_leading_zero(value: &str) -> String {
    value
        .parse::<u32>()
        .map(|number| number.to_string())
        .unwrap_or_else(|_| value.to_string())
}

pub(super) async fn send_telegram_chat_action(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    action: &str,
) {
    let _ = client
        .post(format!(
            "https://api.telegram.org/bot{}/sendChatAction",
            token
        ))
        .json(&json!({ "chat_id": chat_id, "action": action }))
        .send()
        .await;
}

pub(super) fn start_telegram_action_loop(
    client: reqwest::Client,
    token: String,
    chat_id: i64,
    action: &'static str,
) -> Arc<AtomicBool> {
    let running = Arc::new(AtomicBool::new(true));
    let running_for_task = running.clone();
    tokio::spawn(async move {
        while running_for_task.load(Ordering::Relaxed) {
            send_telegram_chat_action(&client, &token, chat_id, action).await;
            tokio::time::sleep(Duration::from_secs(4)).await;
        }
    });
    running
}
