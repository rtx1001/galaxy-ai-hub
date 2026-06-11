use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct StoredChatSessionMessage {
    id: String,
    role: String,
    content: Value,
    #[serde(default)]
    thinking: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct TelegramIncomingFile {
    pub(super) local_path: String,
    pub(super) display_name: String,
    pub(super) mime_type: String,
    pub(super) size_bytes: u64,
    pub(super) is_image: bool,
}

#[derive(Debug, Clone)]
pub(super) struct TelegramAssistantProfile {
    pub(super) personality_id: String,
    pub(super) personality_name: String,
    pub(super) user_name: String,
    pub(super) system_prompt: String,
    pub(super) greeting: String,
    pub(super) avatar_path: Option<String>,
    pub(super) voice_sample_path: Option<String>,
    pub(super) folders: Vec<String>,
    pub(super) google_client_id: String,
    pub(super) google_client_secret: String,
    pub(super) personality_memory: String,
    pub(super) thinking_enabled: bool,
    pub(super) sampling: agent_react::SamplingConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TelegramGreetingLanguage {
    Vietnamese,
    Thai,
    English,
}

pub(super) fn infer_telegram_greeting_language(
    history: &[ReactChatMessage],
) -> TelegramGreetingLanguage {
    for message in history.iter().rev() {
        let text = extract_message_text(&message.content);
        if text.trim().is_empty() {
            continue;
        }
        if text
            .chars()
            .any(|ch| ('\u{0E00}'..='\u{0E7F}').contains(&ch))
        {
            return TelegramGreetingLanguage::Thai;
        }
        if telegram_speech_looks_vietnamese(&text) {
            return TelegramGreetingLanguage::Vietnamese;
        }
        if message.role == "assistant" {
            return TelegramGreetingLanguage::English;
        }
    }
    TelegramGreetingLanguage::English
}

pub(super) fn greeting_style_hint(prompt: &str) -> &'static str {
    let lower = prompt.to_ascii_lowercase();
    if lower.contains("cute") || lower.contains("cheerful") || lower.contains("lively") {
        "bright"
    } else if lower.contains("calm") || lower.contains("gentle") || lower.contains("soft") {
        "soft"
    } else if lower.contains("professional") || lower.contains("assistant") {
        "ready"
    } else {
        "natural"
    }
}

pub(super) fn build_personality_greeting(
    name: &str,
    prompt: &str,
    history: &[ReactChatMessage],
) -> String {
    let speaker = if name.trim().is_empty() {
        "Assistant"
    } else {
        name.trim()
    };
    match (
        infer_telegram_greeting_language(history),
        greeting_style_hint(prompt),
    ) {
        (TelegramGreetingLanguage::Vietnamese, "bright") => {
            format!(
                "D\u{1ea1}, {} \u{0111}\u{00e2}y \u{1ea1}. Em v\u{1eeba} \u{0111}\u{1ed5}i qua r\u{1ed3}i n\u{00e8}, m\u{00ec}nh n\u{00f3}i ti\u{1ebf}p nha.",
                speaker
            )
        }
        (TelegramGreetingLanguage::Vietnamese, "soft") => {
            format!(
                "D\u{1ea1}, {} \u{0111}\u{00e2}y. Em \u{1edf} \u{0111}\u{00e2}y r\u{1ed3}i, anh c\u{1ee9} n\u{00f3}i ti\u{1ebf}p v\u{1edb}i em nha.",
                speaker
            )
        }
        (TelegramGreetingLanguage::Vietnamese, _) => {
            format!(
                "D\u{1ea1}, {} \u{0111}\u{00e3} v\u{00e0}o cu\u{1ed9}c tr\u{00f2} chuy\u{1ec7}n r\u{1ed3}i \u{1ea1}. M\u{00ec}nh ti\u{1ebf}p t\u{1ee5}c nh\u{00e9}.",
                speaker
            )
        }
        (TelegramGreetingLanguage::Thai, "bright") => {
            format!("{} is here now. We can keep going.", speaker)
        }
        (TelegramGreetingLanguage::Thai, _) => {
            format!("{} is ready. Send the next message anytime.", speaker)
        }
        (TelegramGreetingLanguage::English, "bright") => {
            format!("{} is here now. I'm ready, let's keep going.", speaker)
        }
        (TelegramGreetingLanguage::English, "soft") => {
            format!("{} is here. I'm with you, we can continue.", speaker)
        }
        (TelegramGreetingLanguage::English, _) => {
            format!("{} is active now. Send me what you need next.", speaker)
        }
    }
}

pub(super) fn greeting_mentions_speaker(text: &str, speaker: &str) -> bool {
    if speaker.trim().is_empty() {
        return true;
    }
    let normalized_text = normalize_text(text);
    let normalized_speaker = normalize_text(speaker);
    !normalized_speaker.is_empty() && normalized_text.contains(&normalized_speaker)
}

pub(super) fn ensure_greeting_mentions_speaker(
    text: String,
    speaker: &str,
    language: TelegramGreetingLanguage,
) -> String {
    if greeting_mentions_speaker(&text, speaker) {
        return text.trim().to_string();
    }

    let speaker = speaker.trim();
    if speaker.is_empty() {
        return text.trim().to_string();
    }

    let prefix = match language {
        TelegramGreetingLanguage::Vietnamese => {
            format!("D\u{1ea1}, {} \u{0111}\u{00e2}y. ", speaker)
        }
        TelegramGreetingLanguage::Thai => format!("{} here. ", speaker),
        TelegramGreetingLanguage::English => format!("{} here. ", speaker),
    };
    format!("{}{}", prefix, text.trim())
}

pub(super) async fn build_telegram_switch_greeting(profile: &TelegramAssistantProfile) -> String {
    let history = load_personality_chat_history(&profile.personality_id);
    let language = infer_telegram_greeting_language(&history);
    let language_hint = match language {
        TelegramGreetingLanguage::Vietnamese => {
            "Reply in Vietnamese with full accents. Start by naturally identifying yourself by name."
        }
        TelegramGreetingLanguage::Thai => "Reply in Thai. Start by naturally identifying yourself by name.",
        TelegramGreetingLanguage::English => "Reply in English. Start by naturally identifying yourself by name.",
    };
    let recent_context = history
        .iter()
        .rev()
        .take(8)
        .rev()
        .map(|message| {
            format!(
                "{}: {}",
                message.role,
                extract_message_text(&message.content)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        "Write one short, natural greeting as {name} for Telegram right after this character is switched on. Match the character personality, sound human, be a little creative, and do not mention system status or profile fields. Keep it to one short message.\n\n{language_hint}\n\nRecent conversation context:\n{recent_context}",
        name = profile.personality_name,
        language_hint = language_hint,
        recent_context = if recent_context.trim().is_empty() {
            "(no prior conversation)".to_string()
        } else {
            recent_context
        }
    );

    let messages = vec![
        json!({
            "role": "system",
            "content": profile.system_prompt.clone(),
        }),
        json!({
            "role": "user",
            "content": prompt,
        }),
    ];

    match agent_react::generate_plain_text_reply(messages, profile.sampling, 64).await {
        Ok(text) if !text.trim().is_empty() => {
            ensure_greeting_mentions_speaker(text, &profile.personality_name, language)
        }
        _ => profile.greeting.clone(),
    }
}

pub(super) fn personality_memory_kind(personality_id: &str) -> String {
    format!("personality:{}", personality_id)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(super) struct StructuredMemoryDocument {
    #[serde(default)]
    profile_facts: Vec<String>,
    #[serde(default)]
    preferences: Vec<String>,
    #[serde(default)]
    relationship: Vec<String>,
    #[serde(default)]
    projects: Vec<String>,
    #[serde(default)]
    open_threads: Vec<String>,
    #[serde(default)]
    recent_turns: Vec<String>,
}

fn compact_memory_line(text: &str, limit: usize) -> String {
    let clean = crate::agent_react::sanitize_model_text(text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if clean.chars().count() <= limit {
        return clean;
    }
    format!(
        "{}...",
        clean.chars().take(limit).collect::<String>().trim_end()
    )
}

fn memory_line_is_internal_artifact(text: &str) -> bool {
    let lowered = text.to_lowercase();
    [
        "validation error",
        "tool error",
        "decision action",
        "image studio returned",
        "chat brain returned",
        "connection to the brain failed",
        "system status",
        "model error",
        "error:",
        "traceback",
        "json.exception",
        "parse error",
        "tool_call",
        "<tool",
        "approval card",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
}

fn normalize_memory_items(items: Vec<String>, limit: usize) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    items
        .into_iter()
        .map(|item| compact_memory_line(item.trim_start_matches(['-', '*', ' ']), 420))
        .filter(|item| !item.is_empty())
        .filter(|item| !memory_line_is_internal_artifact(item))
        .filter(|item| seen.insert(item.to_lowercase()))
        .rev()
        .take(limit)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

fn normalize_structured_memory(mut memory: StructuredMemoryDocument) -> StructuredMemoryDocument {
    memory.profile_facts = normalize_memory_items(memory.profile_facts, 24);
    memory.preferences = normalize_memory_items(memory.preferences, 24);
    memory.relationship = normalize_memory_items(memory.relationship, 18);
    memory.projects = normalize_memory_items(memory.projects, 24);
    memory.open_threads = normalize_memory_items(memory.open_threads, 18);
    memory.recent_turns = normalize_memory_items(memory.recent_turns, 18);
    memory
}

fn parse_structured_memory(raw: &str) -> StructuredMemoryDocument {
    let clean = raw.trim();
    if clean.is_empty() {
        return StructuredMemoryDocument::default();
    }
    if let Ok(memory) = serde_json::from_str::<StructuredMemoryDocument>(clean) {
        return normalize_structured_memory(memory);
    }
    normalize_structured_memory(StructuredMemoryDocument {
        recent_turns: clean
            .lines()
            .map(|line| line.trim().trim_start_matches(['-', '*', ' ']).to_string())
            .filter(|line| !line.is_empty())
            .collect(),
        ..StructuredMemoryDocument::default()
    })
}

fn serialize_structured_memory(memory: StructuredMemoryDocument) -> String {
    serde_json::to_string(&normalize_structured_memory(memory)).unwrap_or_default()
}

fn format_memory_section(title: &str, items: &[String]) -> Option<String> {
    (!items.is_empty()).then(|| {
        format!(
            "{}\n{}",
            title,
            items
                .iter()
                .map(|item| format!("- {}", item))
                .collect::<Vec<_>>()
                .join("\n")
        )
    })
}

pub(super) fn format_personality_memory_for_prompt(raw: &str) -> String {
    let memory = parse_structured_memory(raw);
    [
        format_memory_section("Stable user facts", &memory.profile_facts),
        format_memory_section("User preferences", &memory.preferences),
        format_memory_section("Relationship and communication style", &memory.relationship),
        format_memory_section("Projects and recurring topics", &memory.projects),
        format_memory_section("Open threads to remember", &memory.open_threads),
        format_memory_section("Recent useful context", &memory.recent_turns),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("\n\n")
}

pub(super) fn compact_personality_memory(
    memory: &str,
    user_text: &str,
    answer_text: &str,
) -> String {
    let mut structured = parse_structured_memory(memory);
    let turn = [
        (!user_text.trim().is_empty())
            .then(|| format!("User: {}", compact_memory_line(user_text, 260))),
        (!answer_text.trim().is_empty())
            .then(|| format!("Assistant: {}", compact_memory_line(answer_text, 260))),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" | ");
    if turn.is_empty() {
        return serialize_structured_memory(structured);
    }
    structured.recent_turns.retain(|item| item != &turn);
    structured.recent_turns.push(turn);
    serialize_structured_memory(structured)
}

pub(super) fn extract_message_text(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    content
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| {
                    let is_text = part.get("type").and_then(Value::as_str) == Some("text");
                    if !is_text {
                        return None;
                    }
                    part.get("text").and_then(Value::as_str).map(str::to_string)
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_else(|| content.to_string())
        .trim()
        .to_string()
}

pub(super) fn content_has_non_text_part(content: &Value) -> bool {
    content.as_array().is_some_and(|parts| {
        parts.iter().any(|part| {
            !matches!(
                part.get("type").and_then(Value::as_str),
                Some("text") | None
            )
        })
    })
}

pub(super) fn compact_react_content_for_storage(content: &Value) -> Value {
    if let Some(text) = content.as_str() {
        return json!(text.chars().take(12_000).collect::<String>());
    }
    if let Some(parts) = content.as_array() {
        let compact = parts
            .iter()
            .filter_map(|part| {
                let part_type = part.get("type").and_then(Value::as_str)?;
                match part_type {
                    "text" => {
                        let text = part
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .chars()
                            .take(12_000)
                            .collect::<String>();
                        (!text.trim().is_empty()).then(|| json!({ "type": "text", "text": text }))
                    }
                    "image_url" => part.get("image_url").map(|image| {
                        json!({
                            "type": "image_url",
                            "image_url": {
                                "url": image.get("url").and_then(Value::as_str).unwrap_or_default(),
                                "local_path": image.get("local_path").and_then(Value::as_str).unwrap_or_default()
                            }
                        })
                    }),
                    "image_proposal" => part.get("image_proposal").map(|proposal| {
                        json!({ "type": "image_proposal", "image_proposal": proposal })
                    }),
                    "action_proposal" => part.get("action_proposal").map(|proposal| {
                        json!({ "type": "action_proposal", "action_proposal": proposal })
                    }),
                    "file_preview" => part
                        .get("file_preview")
                        .map(|preview| json!({ "type": "file_preview", "file_preview": preview })),
                    _ => None,
                }
            })
            .collect::<Vec<_>>();
        if !compact.is_empty() {
            return Value::Array(compact);
        }
    }
    json!(extract_message_text(content)
        .chars()
        .take(12_000)
        .collect::<String>())
}

pub(super) fn build_telegram_user_content(text: &str, files: &[TelegramIncomingFile]) -> Value {
    let mut parts = Vec::new();
    let text = text.trim();
    if !text.is_empty() {
        parts.push(json!({ "type": "text", "text": text }));
    } else if files.iter().any(|file| file.is_image) {
        parts.push(json!({ "type": "text", "text": "Sent an image from Telegram." }));
    } else if !files.is_empty() {
        parts.push(json!({ "type": "text", "text": "Sent a file from Telegram." }));
    }
    for file in files {
        if file.is_image {
            parts.push(json!({
                "type": "image_url",
                "image_url": {
                    "url": "",
                    "local_path": file.local_path
                }
            }));
        } else {
            parts.push(json!({
                "type": "file_preview",
                "file_preview": {
                    "path": file.local_path,
                    "name": file.display_name,
                    "extension": extension_from_mime_or_name(&file.mime_type, &file.display_name),
                    "mime_type": file.mime_type,
                    "size_bytes": file.size_bytes,
                    "data_url": null,
                    "text": null,
                    "perception": null,
                    "truncated": false
                }
            }));
        }
    }
    if parts.len() == 1 && text.len() > 0 && files.is_empty() {
        json!(text)
    } else {
        Value::Array(parts)
    }
}

pub(super) fn load_personality_memory(personality_id: &str) -> String {
    let items = list_local_memory(Some(personality_memory_kind(personality_id)), Some(500))
        .unwrap_or_default();
    let summary = items
        .iter()
        .find(|item| item.key == "compact_style_memory")
        .map(|item| item.value.clone())
        .unwrap_or_default();
    let mut structured = parse_structured_memory(&summary);
    let mut event_turns = items
        .iter()
        .filter(|item| item.key.starts_with("event:"))
        .filter_map(|item| {
            let value = serde_json::from_str::<serde_json::Value>(&item.value).ok()?;
            let user = value
                .get("user")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let assistant = value
                .get("assistant")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            if memory_line_is_internal_artifact(user) || memory_line_is_internal_artifact(assistant)
            {
                return None;
            }
            let turn = [
                (!user.trim().is_empty())
                    .then(|| format!("User: {}", compact_memory_line(user, 260))),
                (!assistant.trim().is_empty())
                    .then(|| format!("Assistant: {}", compact_memory_line(assistant, 260))),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" | ");
            (!turn.is_empty()).then_some((item.created_at, turn))
        })
        .collect::<Vec<_>>();
    event_turns.sort_by_key(|(created_at, _)| *created_at);
    for (_, turn) in event_turns
        .into_iter()
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
    {
        structured.recent_turns.retain(|item| item != &turn);
        structured.recent_turns.push(turn);
    }
    serialize_structured_memory(structured)
}

pub(super) fn update_personality_memory_after_turn(
    personality_id: &str,
    current_memory: &str,
    user_text: &str,
    answer_text: &str,
) -> String {
    let clean_user = compact_memory_line(user_text, 1200);
    let clean_answer = compact_memory_line(answer_text, 1200);
    if clean_user.is_empty() && clean_answer.is_empty() {
        return current_memory.to_string();
    }
    if memory_line_is_internal_artifact(&clean_user)
        || memory_line_is_internal_artifact(&clean_answer)
    {
        return serialize_structured_memory(parse_structured_memory(current_memory));
    }
    let now_ms = chrono::Local::now().timestamp_millis();
    let event_value = serde_json::json!({
        "user": clean_user,
        "assistant": clean_answer,
        "created_at": now_ms
    })
    .to_string();
    let event_key = format!("event:{}:telegram", now_ms);
    let _ = remember_local_memory(
        personality_memory_kind(personality_id),
        event_key,
        event_value,
        Some("memory_event_telegram".to_string()),
        Some(0.86),
    );
    compact_personality_memory(current_memory, user_text, answer_text)
}

pub(super) fn build_personality_runtime_prompt(
    settings: &AppSettings,
    preset: &PersonalityPreset,
    personality_memory: &str,
    fallback_system_prompt: &str,
) -> String {
    let personality_prompt = if preset.prompt.trim().is_empty() {
        settings.personality.trim()
    } else {
        preset.prompt.trim()
    };
    let character_files = character_store::load_character_files(
        preset.id.clone(),
        preset.name.clone(),
        personality_prompt.to_string(),
        preset.avatar.clone(),
        preset.voice_path.clone(),
    )
    .ok();
    let character_soul = character_files
        .as_ref()
        .map(|files| files.soul.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    let mut sections = vec![format!(
        "Assistant profile:\nName: {}\nInstructions:\n{}",
        if preset.name.trim().is_empty() {
            "Assistant"
        } else {
            preset.name.trim()
        },
        personality_prompt
    )];
    if !character_soul.trim().is_empty() {
        sections.push(format!(
            "\nAdditional character context:\n{}",
            character_soul.trim()
        ));
    }

    if !personality_memory.trim().is_empty() {
        let formatted_memory = format_personality_memory_for_prompt(personality_memory);
        sections.push(format!(
            "\nConversation memory:\n{}",
            formatted_memory.trim()
        ));
    }

    let active_user = settings
        .user_profiles
        .iter()
        .find(|profile| profile.id == settings.selected_user_profile_id);
    let user_name = active_user
        .map(|profile| profile.name.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| settings.user_name.trim());
    let user_description = active_user
        .map(|profile| profile.description.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| settings.user_description.trim());

    if !user_name.is_empty() || !user_description.is_empty() {
        sections.push(format!(
            "\nUser profile:\nName: {}\nAbout user: {}",
            if user_name.is_empty() {
                "User"
            } else {
                user_name
            },
            if user_description.is_empty() {
                "No extra details."
            } else {
                user_description
            }
        ));
    }

    sections.push(format!(
        "\nCurrent date: {}\nConnected utilities: Google Calendar {}, Gmail {}, Telegram online, Voice {}, Image generation {}, User location {}",
        chrono::Local::now().format("%Y-%m-%d"),
        if settings.google_client_id.trim().is_empty() || settings.google_client_secret.trim().is_empty() {
            "offline".to_string()
        } else {
            "online".to_string()
        },
        if settings.google_client_id.trim().is_empty() || settings.google_client_secret.trim().is_empty() {
            "offline".to_string()
        } else {
            "online".to_string()
        },
        if preset.voice_path.trim().is_empty() && settings.selected_voice_path.trim().is_empty() {
            "not ready".to_string()
        } else {
            "ready".to_string()
        },
        "local Image Studio model".to_string(),
        if settings.user_location_label.trim().is_empty() {
            "unknown".to_string()
        } else {
            settings.user_location_label.trim().to_string()
        }
    ));

    let _ = fallback_system_prompt;

    sections.join("")
}

pub(super) fn load_telegram_assistant_profile(
    fallback_system_prompt: &str,
    fallback_folders: &[String],
    fallback_google_client_id: &str,
    fallback_google_client_secret: &str,
) -> TelegramAssistantProfile {
    let settings = load_app_settings().unwrap_or_else(|_| AppSettings::default());
    let preset = settings
        .personality_presets
        .iter()
        .find(|preset| preset.id == settings.selected_personality_id)
        .cloned()
        .or_else(|| settings.personality_presets.first().cloned())
        .unwrap_or(PersonalityPreset {
            id: "default".to_string(),
            name: "Assistant".to_string(),
            prompt: settings.personality.clone(),
            avatar: String::new(),
            voice_path: String::new(),
        });
    let personality_memory = load_personality_memory(&preset.id);
    let personality_history = load_personality_chat_history(&preset.id);
    let character_files = character_store::load_character_files(
        preset.id.clone(),
        preset.name.clone(),
        if preset.prompt.trim().is_empty() {
            settings.personality.clone()
        } else {
            preset.prompt.clone()
        },
        preset.avatar.clone(),
        preset.voice_path.clone(),
    )
    .ok();
    let avatar_source = if !preset.avatar.trim().is_empty() {
        preset.avatar.trim().to_string()
    } else {
        character_files
            .as_ref()
            .map(|files| files.settings.avatar.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_default()
    };
    let active_user = settings
        .user_profiles
        .iter()
        .find(|profile| profile.id == settings.selected_user_profile_id);
    let user_name = active_user
        .map(|profile| profile.name.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| settings.user_name.trim())
        .to_string();

    TelegramAssistantProfile {
        personality_id: preset.id.clone(),
        personality_name: if preset.name.trim().is_empty() {
            "Assistant".to_string()
        } else {
            preset.name.trim().to_string()
        },
        user_name,
        greeting: build_personality_greeting(&preset.name, &preset.prompt, &personality_history),
        avatar_path: if !avatar_source.trim().is_empty() {
            Some(avatar_source)
        } else {
            None
        },
        voice_sample_path: if !preset.voice_path.trim().is_empty() {
            Some(preset.voice_path.trim().to_string())
        } else if !settings.selected_voice_path.trim().is_empty() {
            Some(settings.selected_voice_path.trim().to_string())
        } else {
            None
        },
        system_prompt: build_personality_runtime_prompt(
            &settings,
            &preset,
            &personality_memory,
            fallback_system_prompt,
        ),
        folders: if settings.linked_folders.is_empty() {
            fallback_folders.to_vec()
        } else {
            settings.linked_folders.clone()
        },
        google_client_id: if settings.google_client_id.trim().is_empty() {
            fallback_google_client_id.trim().to_string()
        } else {
            settings.google_client_id.trim().to_string()
        },
        google_client_secret: if settings.google_client_secret.trim().is_empty() {
            fallback_google_client_secret.trim().to_string()
        } else {
            settings.google_client_secret.trim().to_string()
        },
        personality_memory,
        thinking_enabled: settings.thinking_enabled,
        sampling: agent_react::SamplingConfig {
            temperature: settings.sampling_temperature,
            top_k: settings.top_k,
            top_p: settings.top_p,
            min_p: settings.min_p,
            repeat_last_n: settings.repeat_last_n,
            repeat_penalty: settings.repeat_penalty,
        },
    }
}

pub(super) fn load_personality_chat_history(personality_id: &str) -> Vec<ReactChatMessage> {
    load_personality_chat_session(personality_id.to_string())
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<StoredChatSessionMessage>>(&raw).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|message| {
            (message.role == "user" || message.role == "assistant")
                && (!extract_message_text(&message.content).trim().is_empty()
                    || content_has_non_text_part(&message.content))
        })
        .map(|message| ReactChatMessage {
            role: message.role,
            content: message.content,
        })
        .collect()
}

pub(super) fn persist_personality_chat_history(personality_id: &str, history: &[ReactChatMessage]) {
    let compact = history
        .iter()
        .rev()
        .take(80)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .enumerate()
        .map(|(index, message)| StoredChatSessionMessage {
            id: format!("telegram-{}-{}", now_unix(), index),
            role: message.role,
            content: compact_react_content_for_storage(&message.content),
            thinking: None,
        })
        .filter(|message| {
            !extract_message_text(&message.content).trim().is_empty()
                || content_has_non_text_part(&message.content)
        })
        .collect::<Vec<_>>();

    if let Ok(raw) = serde_json::to_string(&compact) {
        let _ = save_personality_chat_session(personality_id.to_string(), raw);
    }
}

pub(super) fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

pub(super) fn ensure_personality_greeting(history: &mut Vec<ReactChatMessage>, greeting: &str) {
    if history.is_empty() {
        history.push(ReactChatMessage {
            role: "assistant".to_string(),
            content: json!(greeting),
        });
    }
}

pub(super) fn telegram_context_block(profile: &TelegramAssistantProfile) -> String {
    let now = chrono::Local::now();
    format!(
        "Time: {}\nInterface: Telegram remote control\nActive character: {}\nConversation sync: Use the active character session and memory shared with Galaxy AI Hub.\nSafety: Read-only tools may run automatically. Write, delete, image, and system actions require approval in Galaxy AI Hub.",
        now.format("%A, %B %-d, %Y at %-I:%M:%S %p %Z"),
        profile.personality_name
    )
}

pub(super) fn telegram_guest_context_block(
    profile: &TelegramAssistantProfile,
    guest_name: &str,
) -> String {
    let now = chrono::Local::now();
    format!(
        "Time: {}\nInterface: Telegram guest chat\nActive character: {}\nTelegram guest: {}\nAccess: chat-only. No tools, no private data, no file access, no Google access, no image generation, and no approvals.",
        now.format("%A, %B %-d, %Y at %-I:%M:%S %p %Z"),
        profile.personality_name,
        guest_name
    )
}

pub(super) fn telegram_display_name(from: &Value) -> String {
    let first = from
        .get("first_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let last = from
        .get("last_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let joined = [first, last]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if !joined.trim().is_empty() {
        return joined;
    }
    from.get("username")
        .and_then(Value::as_str)
        .map(|value| format!("@{}", value.trim_start_matches('@')))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Telegram guest".to_string())
}

pub(super) fn telegram_message_mentions_bot(message: &Value, bot_username: Option<&str>) -> bool {
    let Some(username) = bot_username
        .map(|value| value.trim_start_matches('@'))
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    let mention = format!("@{}", username).to_lowercase();
    let text = message
        .get("text")
        .or_else(|| message.get("caption"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    if text.contains(&mention) {
        return true;
    }
    message
        .get("reply_to_message")
        .and_then(|reply| reply.get("from"))
        .and_then(|from| from.get("username"))
        .and_then(Value::as_str)
        .map(|reply_username| reply_username.eq_ignore_ascii_case(username))
        .unwrap_or(false)
}

pub(super) fn append_telegram_chat_log(
    user_id: i64,
    user_name: &str,
    user_text: &str,
    assistant_text: &str,
) {
    let log_dir = app_root_dir().join("logs").join("telegram-chats");
    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }
    let safe_name = user_name
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(40)
        .collect::<String>();
    let path = log_dir.join(format!(
        "{}-{}.jsonl",
        if safe_name.is_empty() {
            "guest"
        } else {
            &safe_name
        },
        user_id
    ));
    let line = json!({
        "timestamp": chrono::Local::now().to_rfc3339(),
        "user_id": user_id,
        "user_name": user_name,
        "user": user_text,
        "assistant": assistant_text,
    })
    .to_string();
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{}", line);
    }
}
