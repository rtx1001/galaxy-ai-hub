use super::*;

pub(super) fn telegram_detail_value(item: &ToolResultItem, label: &str) -> String {
    item.details
        .iter()
        .find(|field| field.label.eq_ignore_ascii_case(label))
        .map(|field| field.value.clone())
        .unwrap_or_default()
}

pub(super) fn format_telegram_cards(cards: &[ToolResultCard]) -> String {
    let mut sections = Vec::new();
    for card in cards {
        let title = if card.summary.as_deref().unwrap_or_default().is_empty() {
            card.title.clone()
        } else {
            format!(
                "{}\n{}",
                card.title,
                card.summary.as_deref().unwrap_or_default()
            )
        };

        let items = card
            .items
            .iter()
            .take(10)
            .enumerate()
            .map(|(index, item)| match card.kind.as_str() {
                "gmail" => format!(
                    "{}. {}\nFrom: {}\nDate: {}\nPreview: {}",
                    index + 1,
                    item.title,
                    telegram_detail_value(item, "From"),
                    telegram_detail_value(item, "Date"),
                    telegram_detail_value(item, "Preview")
                ),
                "calendar" => {
                    let location = telegram_detail_value(item, "Location");
                    [
                        format!("{}. {}", index + 1, item.title),
                        format!("Start: {}", telegram_detail_value(item, "Start")),
                        format!("End: {}", telegram_detail_value(item, "End")),
                        if location.is_empty() {
                            String::new()
                        } else {
                            format!("Location: {}", location)
                        },
                    ]
                    .into_iter()
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
                }
                "file_search" | "folder" | "media" => {
                    let path = telegram_detail_value(item, "Path");
                    [
                        format!("{}. {}", index + 1, item.title),
                        format!("Type: {}", telegram_detail_value(item, "Type")),
                        format!("Size: {}", telegram_detail_value(item, "Size")),
                        if path.is_empty() {
                            item.subtitle.clone().unwrap_or_default()
                        } else {
                            format!("Path: {}", path)
                        },
                    ]
                    .into_iter()
                    .filter(|line| !line.trim().is_empty() && !line.ends_with(": "))
                    .collect::<Vec<_>>()
                    .join("\n")
                }
                "web_search" => format!(
                    "{}. {}\nSource: {}\nDetails: {}",
                    index + 1,
                    item.title,
                    item.subtitle.clone().unwrap_or_default(),
                    telegram_detail_value(item, "Details")
                ),
                _ => {
                    let details = item
                        .details
                        .iter()
                        .take(4)
                        .map(|field| format!("{}: {}", field.label, field.value))
                        .collect::<Vec<_>>()
                        .join("\n");
                    if details.is_empty() {
                        format!("{}. {}", index + 1, item.title)
                    } else {
                        format!("{}. {}\n{}", index + 1, item.title, details)
                    }
                }
            })
            .collect::<Vec<_>>();

        if items.is_empty() {
            sections.push(title);
        } else {
            sections.push(format!("{}\n\n{}", title, items.join("\n\n")));
        }
    }
    sections.join("\n\n")
}

pub(super) fn telegram_user_wants_voice(text: &str) -> bool {
    let lower = normalize_text(text);
    [
        "voice",
        "voice note",
        "audio reply",
        "speak",
        "say it",
        "read it aloud",
        "noi bang giong",
        "gui giong",
        "tra loi bang giong",
        "tin nhan thoai",
        "doc bang giong",
        "doc len",
        "noi cho anh nghe",
        "noi cho em nghe",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TelegramVoiceIntent {
    None,
    Once,
    AutoOn,
    AutoOff,
}

pub(super) fn text_contains_any(text: &str, phrases: &[&str]) -> bool {
    let lower = text.to_lowercase();
    let normalized = normalize_text(text);
    phrases
        .iter()
        .any(|phrase| lower.contains(phrase) || normalized.contains(phrase))
}

pub(super) fn telegram_voice_intent(text: &str) -> TelegramVoiceIntent {
    if text_contains_any(
        text,
        &[
            "turn off voice",
            "voice mode off",
            "auto voice off",
            "stop voice",
            "text only",
            "reply with text",
            "don't send voice",
            "dont send voice",
            "tat giong",
            "tat che do giong",
            "tat tu dong giong",
            "dung gui giong",
            "khong gui giong",
            "chi tra loi bang chu",
            "tra loi bang chu thoi",
        ],
    ) {
        return TelegramVoiceIntent::AutoOff;
    }

    if text_contains_any(
        text,
        &[
            "turn on voice",
            "turn on auto voice",
            "voice mode on",
            "auto voice on",
            "always send voice",
            "always reply with voice",
            "send voice automatically",
            "reply by voice from now",
            "bat giong",
            "bat che do giong",
            "bat tu dong giong",
            "luon gui giong",
            "luon tra loi bang giong",
            "tu dong gui giong",
            "noi bang giong tu gio",
        ],
    ) {
        return TelegramVoiceIntent::AutoOn;
    }

    if telegram_user_wants_voice(text) {
        TelegramVoiceIntent::Once
    } else {
        TelegramVoiceIntent::None
    }
}

pub(super) struct TelegramReplyParts {
    pub(super) text: String,
    pub(super) send_file_path: Option<String>,
    pub(super) file_is_image: bool,
    pub(super) file_caption: Option<String>,
    pub(super) image_proposal: Option<ImageProposal>,
    pub(super) action_proposal: Option<ActionProposal>,
}

pub(super) fn telegram_prefers_vietnamese(text: &str) -> bool {
    telegram_speech_looks_vietnamese(text)
}

pub(super) fn new_telegram_approval_id() -> String {
    format!("{:x}", now_millis())
}

pub(super) fn telegram_approval_keyboard(approval_id: &str, vi: bool) -> Value {
    json!({
        "inline_keyboard": [[
            {
                "text": if vi { "\u{0110}\u{1ed3}ng \u{00fd}" } else { "Approve" },
                "callback_data": format!("gax:ok:{}", approval_id)
            },
            {
                "text": if vi { "Hu\u{1ef7}" } else { "Cancel" },
                "callback_data": format!("gax:no:{}", approval_id)
            }
        ]]
    })
}

pub(super) fn telegram_image_approval_text(vi: bool) -> &'static str {
    if vi {
        "Em \u{0111}\u{00e3} chu\u{1ea9}n b\u{1ecb} y\u{00ea}u c\u{1ea7}u t\u{1ea1}o \u{1ea3}nh. Anh b\u{1ea5}m \u{0110}\u{1ed3}ng \u{00fd} \u{0111}\u{1ec3} em b\u{1eaf}t \u{0111}\u{1ea7}u nh\u{00e9}."
    } else {
        "I prepared the image request. Tap Approve when you're ready."
    }
}

pub(super) fn proposal_string(proposal: &ActionProposal, key: &str) -> String {
    proposal
        .arguments
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub(super) fn proposal_json_payload(proposal: &ActionProposal, key: &str) -> Option<String> {
    let value = proposal.arguments.get(key)?;
    if value.is_null() {
        None
    } else if let Some(text) = value.as_str() {
        (!text.trim().is_empty()).then(|| text.to_string())
    } else {
        Some(value.to_string())
    }
}

pub(super) fn build_telegram_reply_parts(result: ReactChatResult) -> TelegramReplyParts {
    let mut text_lines: Vec<String> = Vec::new();
    let mut send_file_path: Option<String> = None;
    let mut file_is_image = false;
    let mut file_caption: Option<String> = None;
    let image_proposal = result.image_proposal.clone();
    let action_proposal = result.action_proposal.clone();

    if !result.answer.trim().is_empty() {
        text_lines.push(result.answer.trim().to_string());
    } else if !result.cards.is_empty() {
        let card_text = format_telegram_cards(&result.cards);
        if !card_text.is_empty() {
            text_lines.push(card_text);
        }
    }

    // File preview - send actual file when possible
    if let Some(preview) = result.file_preview {
        let path = preview.path.clone();
        let exists = std::path::Path::new(&path).exists();
        if exists {
            file_is_image = preview.mime_type.starts_with("image/");
            file_caption = Some(format!("*{}*", preview.name));
            send_file_path = Some(path);
        } else {
            text_lines.push(format!(
                "*{}*\n`{}`\nType: {}",
                preview.name, preview.path, preview.mime_type
            ));
        }
    }

    // Image proposal
    if let Some(proposal) = image_proposal.as_ref().filter(|_| false) {
        text_lines.push(format!(
            "*Image request queued for approval in Galaxy AI Hub*\nPrompt: _{}_",
            proposal.prompt
        ));
    }

    // Action proposal
    if let Some(action) = action_proposal.as_ref().filter(|_| false) {
        text_lines.push(format!(
            "*Action needs approval in Galaxy AI Hub*\nAction: {}\nRisk: {}\n{}",
            action.title, action.risk_level, action.details
        ));
    }

    TelegramReplyParts {
        text: text_lines
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n"),
        send_file_path,
        file_is_image,
        file_caption,
        image_proposal,
        action_proposal,
    }
}

pub(super) async fn execute_telegram_action_proposal(
    profile: &TelegramAssistantProfile,
    proposal: &ActionProposal,
) -> Result<String, String> {
    match proposal.action_type.as_str() {
        "write_file" => {
            let root = proposal_string(proposal, "root_folder").trim().to_string();
            let root_folder = if root.is_empty() {
                profile.folders.first().cloned()
            } else {
                Some(root)
            };
            let result = file_tools::write_linked_text_file(
                proposal_string(proposal, "relative_path"),
                proposal_string(proposal, "content"),
                root_folder,
                profile.folders.clone(),
            )?;
            Ok(result.message)
        }
        "move_file" => {
            let root = proposal_string(proposal, "root_folder").trim().to_string();
            let root_folder = if root.is_empty() {
                profile.folders.first().cloned()
            } else {
                Some(root)
            };
            let result = file_tools::move_linked_file(
                proposal_string(proposal, "source"),
                proposal_string(proposal, "destination_relative_path"),
                root_folder,
                profile.folders.clone(),
            )?;
            Ok(result.message)
        }
        "delete_file" => {
            let result = file_tools::trash_linked_file(
                proposal_string(proposal, "source"),
                profile.folders.clone(),
            )?;
            Ok(result.message)
        }
        "gmail_send" => {
            google_calendar::send_google_gmail_message(
                profile.google_client_id.clone(),
                profile.google_client_secret.clone(),
                proposal_string(proposal, "to"),
                proposal_string(proposal, "subject"),
                proposal_string(proposal, "body"),
                Some(profile.user_name.clone()),
            )
            .await
        }
        "gmail_trash" => {
            google_calendar::trash_google_gmail_message(
                profile.google_client_id.clone(),
                profile.google_client_secret.clone(),
                proposal_string(proposal, "id"),
            )
            .await
        }
        "calendar_create" => {
            let result = google_calendar::create_google_calendar_event(
                profile.google_client_id.clone(),
                profile.google_client_secret.clone(),
                proposal_string(proposal, "title"),
                proposal_string(proposal, "start"),
                proposal_string(proposal, "end"),
                Some(proposal_string(proposal, "description")).filter(|v| !v.trim().is_empty()),
                Some(proposal_string(proposal, "location")).filter(|v| !v.trim().is_empty()),
            )
            .await?;
            Ok(format!(
                "Event created: {}{}",
                result.title,
                result
                    .html_link
                    .map(|link| format!(" ({})", link))
                    .unwrap_or_default()
            ))
        }
        "calendar_delete" => {
            google_calendar::delete_google_calendar_event(
                profile.google_client_id.clone(),
                profile.google_client_secret.clone(),
                proposal_string(proposal, "id"),
            )
            .await
        }
        "google_contact_delete" => {
            google_calendar::delete_google_contact(
                profile.google_client_id.clone(),
                profile.google_client_secret.clone(),
                proposal_string(proposal, "resource_name"),
            )
            .await
        }
        "google_action" => {
            google_calendar::execute_google_api(
                profile.google_client_id.clone(),
                profile.google_client_secret.clone(),
                proposal_string(proposal, "method"),
                proposal_string(proposal, "url"),
                proposal_json_payload(proposal, "payload"),
            )
            .await
        }
        "run_powershell" => Err(
            "System commands still need approval inside the app because they can affect the PC."
                .to_string(),
        ),
        other => Err(format!(
            "Telegram approval does not support this action yet: {}",
            other
        )),
    }
}

pub(super) async fn execute_telegram_pending_approval(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    pending: TelegramPendingApproval,
    profile: TelegramAssistantProfile,
    llama_state: Arc<LlamaState>,
    session: Arc<Mutex<TelegramSessionState>>,
) -> Result<String, String> {
    match pending.payload {
        TelegramPendingApprovalPayload::Image(proposal) => {
            let status_loop = start_telegram_action_loop(
                client.clone(),
                token.to_string(),
                chat_id,
                "upload_photo",
            );
            let result = async {
                let state_for_stop = llama_state.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    llama_manager::stop_model_state(&state_for_stop)
                })
                .await;
                let settings = load_app_settings().unwrap_or_else(|_| AppSettings::default());
                let assistant_avatar_ref = profile
                    .avatar_path
                    .as_ref()
                    .and_then(|value| image_reference_data_url(value));
                let user_avatar_ref = image_reference_data_url(&settings.user_avatar);
                let recent_image_ref = pending
                    .reference_image_path
                    .as_deref()
                    .and_then(image_reference_data_url)
                    .or_else(|| {
                        session
                            .lock()
                            .ok()
                            .and_then(|guard| guard.last_image_by_chat.get(&chat_id).cloned())
                            .and_then(|path| image_reference_data_url(&path))
                    });
                let mut reference_sources = proposal.reference_sources.clone();
                if reference_sources.is_empty() {
                    reference_sources = match proposal.mode.as_str() {
                        "image_image" | "image_to_image" => vec!["chat_image".to_string()],
                        "avatar_image" | "bot_image" => vec!["bot_avatar".to_string()],
                        "user_avatar_image" | "avatar_user_image" | "user_image" => {
                            vec!["user_avatar".to_string()]
                        }
                        "user_character_image" | "user_and_character_image" | "both_avatars_image"
                        | "user_bot_image" => vec!["user_avatar".to_string(), "bot_avatar".to_string()],
                        _ => Vec::new(),
                    };
                }
                let mut init_images = Vec::new();
                for source in reference_sources {
                    match source.as_str() {
                        "chat_image" => {
                            if let Some(value) = recent_image_ref.clone() {
                                init_images.push(value);
                            }
                        }
                        "user_avatar" => {
                            if let Some(value) = user_avatar_ref.clone() {
                                init_images.push(value);
                            }
                        }
                        "bot_avatar" => {
                            if let Some(value) = assistant_avatar_ref.clone() {
                                init_images.push(value);
                            }
                        }
                        _ => {}
                    }
                }
                append_runtime_log(
                    "telegram",
                    &format!(
                        "image approval mode={} refs={} user_avatar={} character_avatar={}",
                        proposal.mode,
                        init_images.len(),
                        user_avatar_ref.is_some(),
                        assistant_avatar_ref.is_some()
                    ),
                );
                if matches!(proposal.mode.as_str(), "image_image" | "image_to_image") && init_images.is_empty() {
                    return Err(
                        "I need an input image before I can edit one from Telegram.".to_string()
                    );
                }
                if matches!(
                    proposal.mode.as_str(),
                    "user_character_image" | "user_and_character_image" | "both_avatars_image" | "user_bot_image"
                ) && init_images.len() < 2
                {
                    return Err(
                        "I need both the selected user avatar and assistant avatar before I can use them as image references."
                            .to_string(),
                    );
                }
                if matches!(
                    proposal.mode.as_str(),
                    "avatar_image"
                        | "bot_image"
                        | "user_avatar_image"
                        | "avatar_user_image"
                        | "user_image"
                        | "user_character_image"
                        | "user_and_character_image"
                        | "both_avatars_image"
                        | "user_bot_image"
                ) && init_images.is_empty()
                {
                    return Err(match proposal.mode.as_str() {
                        "avatar_image" | "bot_image" => {
                            "I need the selected assistant avatar before I can send that image."
                        }
                        "user_avatar_image" | "avatar_user_image" | "user_image" => {
                            "I need the selected user avatar before I can use it as an image reference."
                        }
                        _ => "I need the selected profile avatars before I can use them as image references.",
                    }
                    .to_string());
                }
                let image = crate::image_runtime::generate_image(
                    proposal.prompt,
                    None,
                    Some(init_images),
                    proposal.mask_prompt,
                    Some(settings.image_width),
                    Some(settings.image_height),
                )
                .await?;
                send_telegram_photo(client, token, chat_id, &image.file_path, None).await?;
                if let Ok(mut guard) = session.lock() {
                    guard.last_image_by_chat.insert(chat_id, image.file_path.clone());
                }
                Ok(if pending.prefers_vietnamese {
                    "\u{1ea2}nh \u{0111}\u{00e3} xong r\u{1ed3}i \u{0111}\u{00e2}y."
                } else {
                    "The image is ready."
                }
                .to_string())
            }
            .await;
            status_loop.store(false, Ordering::Relaxed);
            result
        }
        TelegramPendingApprovalPayload::Action(proposal) => {
            execute_telegram_action_proposal(&profile, &proposal).await
        }
    }
}
