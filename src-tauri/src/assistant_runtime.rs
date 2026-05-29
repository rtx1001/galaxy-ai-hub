use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::{collections::HashMap, io::Write};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::agent_react::{
    self, ActionProposal, ImageProposal, ReactChatMessage, ReactChatResult, ToolResultCard,
    ToolResultItem,
};
use crate::agent_store::{
    self, list_local_memory, load_personality_chat_session, remember_local_memory,
    save_personality_chat_session,
};
use crate::character_store;
use crate::config_store::{load_app_settings, AppSettings, PersonalityPreset};
use crate::file_tools::{self, normalize_text};
use crate::google_calendar;
use crate::llama_manager::{self, LlamaState};
use crate::omnivoice_runtime::{self, OmniVoiceRuntimeState};

mod logging;
mod resource_status;
mod telegram_api;
mod telegram_files;
mod telegram_profile;
mod telegram_reply;
#[cfg(test)]
mod tests;
mod voice_commands;
mod voice_samples;
mod voice_setup;
pub(crate) use logging::*;
pub use resource_status::*;
use telegram_api::*;
pub(crate) use telegram_files::*;
use telegram_profile::*;
use telegram_reply::*;
pub(crate) use voice_commands::WhisperStdout;
pub use voice_commands::*;
use voice_samples::*;
pub(crate) use voice_samples::{
    prepare_voice_sample_for_omnivoice_path, transcribe_prepared_voice_sample_path,
};
use voice_setup::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceSetupStatus {
    pub state: String,
    pub message: String,
    pub progress: u8,
    pub ready: bool,
}

#[derive(Clone)]
pub struct VoiceRuntimeState {
    pub status: Arc<Mutex<VoiceSetupStatus>>,
    pub installing: Arc<AtomicBool>,
    pub detected_languages: Arc<Mutex<HashMap<String, DetectedVoiceLanguage>>>,
}

impl Default for VoiceRuntimeState {
    fn default() -> Self {
        Self {
            status: Arc::new(Mutex::new(VoiceSetupStatus {
                state: "idle".to_string(),
                message: "Voice helper is waiting.".to_string(),
                progress: 0,
                ready: false,
            })),
            installing: Arc::new(AtomicBool::new(false)),
            detected_languages: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct GraphicsPowerStatus {
    pub available: bool,
    pub used_mb: u32,
    pub total_mb: u32,
    pub percent: u8,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub language: String,
    pub language_probability: f32,
}

#[derive(Debug, Serialize)]
pub struct AudioSynthesisResult {
    pub audio_base64: String,
    pub mime_type: String,
}

#[derive(Debug, Serialize)]
pub struct VoiceSample {
    pub name: String,
    pub label: String,
    pub path: String,
    pub language: Option<String>,
    pub language_probability: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectedVoiceLanguage {
    pub language: String,
    pub language_probability: f32,
}

#[derive(Debug, Serialize)]
pub struct ImageGenerationResult {
    pub image_base64: String,
    pub mime_type: String,
    pub file_path: String,
}

#[derive(Debug, Serialize)]
pub struct TelegramBotStatus {
    pub success: bool,
    pub message: String,
    pub username: Option<String>,
}

#[derive(Clone)]
pub struct TelegramRuntimeState {
    worker: Arc<Mutex<Option<TelegramWorker>>>,
    session: Arc<Mutex<TelegramSessionState>>,
}

impl Default for TelegramRuntimeState {
    fn default() -> Self {
        Self {
            worker: Arc::new(Mutex::new(None)),
            session: Arc::new(Mutex::new(TelegramSessionState::default())),
        }
    }
}

struct TelegramWorker {
    stop: Arc<AtomicBool>,
    username: Option<String>,
    token: String,
    owner_id: Option<i64>,
}

#[derive(Debug, Default)]
struct TelegramSessionState {
    last_chat_id: Option<i64>,
    last_personality_id: Option<String>,
    auto_voice: bool,
    last_image_by_chat: HashMap<i64, String>,
    pending_approvals: HashMap<String, TelegramPendingApproval>,
}

#[derive(Debug, Clone)]
struct TelegramPendingApproval {
    chat_id: i64,
    personality_id: String,
    prefers_vietnamese: bool,
    reference_image_path: Option<String>,
    payload: TelegramPendingApprovalPayload,
}

#[derive(Debug, Clone)]
enum TelegramPendingApprovalPayload {
    Image(ImageProposal),
    Action(ActionProposal),
}

fn is_supported_voice_file(path: &PathBuf) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "wav" | "mp3" | "ogg" | "flac" | "m4a"
            )
        })
        .unwrap_or(false)
}

fn collect_voice_samples(
    dir: &Path,
    seen_names: &mut std::collections::HashSet<String>,
    samples: &mut Vec<VoiceSample>,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_voice_samples(&path, seen_names, samples);
            continue;
        }
        if !path.is_file() || !is_supported_voice_file(&path) {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        if !seen_names.insert(name.to_ascii_lowercase()) {
            continue;
        }
        let label = path
            .file_stem()
            .and_then(|value| value.to_str())
            .map(prettify_voice_name)
            .unwrap_or_else(|| name.clone());
        samples.push(VoiceSample {
            name,
            label,
            path: path.to_string_lossy().to_string(),
            language: None,
            language_probability: None,
        });
    }
}

fn prettify_voice_name(name: &str) -> String {
    name.replace('_', " ")
        .replace('-', " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

async fn wait_for_llm_server_ready(timeout: Duration) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if client
            .get("http://127.0.0.1:8080/health")
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false)
        {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(750)).await;
    }
    false
}

async fn ensure_telegram_llm_ready(llama_state: Arc<LlamaState>) -> Result<(), String> {
    if llama_manager::active_model_path_if_running(&llama_state).is_some()
        && wait_for_llm_server_ready(Duration::from_secs(2)).await
    {
        return Ok(());
    }

    let settings = load_app_settings().unwrap_or_else(|_| AppSettings::default());
    let model_path = settings.selected_model_path.trim().to_string();
    if model_path.is_empty() {
        return Err(
            "Load a chat brain in Galaxy AI Hub first, or choose a GGUF model in the app settings."
                .to_string(),
        );
    }

    let system = crate::system_detect::check_system();
    let threads = system.cpu_threads.clamp(2, 8);
    let gpu_layers = if system.has_nvidia_gpu { 999 } else { 0 };
    let reduced_gpu_layers = if system.has_nvidia_gpu {
        system.recommended_task_gpu_layers.max(4)
    } else {
        0
    };

    let state_for_load = llama_state.clone();
    let status = tokio::task::spawn_blocking(move || {
        llama_manager::start_model_state(
            &state_for_load,
            model_path,
            settings.memory_size,
            threads,
            gpu_layers,
            reduced_gpu_layers,
        )
    })
    .await
    .map_err(|e| format!("Could not load the Telegram chat brain: {}", e))?;

    if status.status != "success" {
        return Err(status.message);
    }

    if wait_for_llm_server_ready(Duration::from_secs(180)).await {
        Ok(())
    } else {
        Err("The Telegram chat brain was launched but did not become ready in time.".to_string())
    }
}

async fn telegram_poll_loop(
    token: String,
    owner_id: Option<i64>,
    bot_username: Option<String>,
    omnivoice_state: OmniVoiceRuntimeState,
    llama_state: Arc<LlamaState>,
    session: Arc<Mutex<TelegramSessionState>>,
    fallback_system_prompt: String,
    temperature: f32,
    max_tokens: u32,
    fallback_thinking_enabled: bool,
    fallback_google_client_id: String,
    fallback_google_client_secret: String,
    fallback_folders: Vec<String>,
    stop: Arc<AtomicBool>,
) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(35))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            append_runtime_log(
                "telegram",
                &format!("could not create HTTP client: {}", error),
            );
            return;
        }
    };
    let mut offset: i64 = 0;

    append_runtime_log("telegram", "polling started");

    while !stop.load(Ordering::SeqCst) {
        let active_profile = load_telegram_assistant_profile(
            &fallback_system_prompt,
            &fallback_folders,
            &fallback_google_client_id,
            &fallback_google_client_secret,
        );
        let greeting_chat_id = {
            let mut guard = session.lock().unwrap();
            if guard
                .last_personality_id
                .as_deref()
                .is_some_and(|id| id != active_profile.personality_id)
            {
                guard.last_personality_id = Some(active_profile.personality_id.clone());
                guard.last_chat_id
            } else if guard.last_personality_id.is_none() {
                guard.last_personality_id = Some(active_profile.personality_id.clone());
                None
            } else {
                None
            }
        };
        if let Some(chat_id) = greeting_chat_id {
            let greeting = build_telegram_switch_greeting(&active_profile).await;
            let _ = send_telegram_message(&client, &token, chat_id, &greeting).await;
        }

        let response = client
            .get(format!("https://api.telegram.org/bot{}/getUpdates", token))
            .query(&[
                ("timeout", "1".to_string()),
                ("offset", offset.to_string()),
                (
                    "allowed_updates",
                    r#"["message","callback_query"]"#.to_string(),
                ),
            ])
            .send()
            .await;

        let Ok(response) = response else {
            append_runtime_log("telegram", "getUpdates request failed");
            tokio::time::sleep(Duration::from_secs(3)).await;
            continue;
        };

        let Ok(body) = response.json::<Value>().await else {
            append_runtime_log("telegram", "getUpdates returned unreadable JSON");
            tokio::time::sleep(Duration::from_secs(3)).await;
            continue;
        };

        if !body.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            append_runtime_log("telegram", &format!("getUpdates returned error: {}", body));
            tokio::time::sleep(Duration::from_secs(5)).await;
            continue;
        }

        let updates = body
            .get("result")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        for update in updates {
            if let Some(update_id) = update.get("update_id").and_then(Value::as_i64) {
                offset = offset.max(update_id + 1);
            }

            if let Some(callback) = update.get("callback_query") {
                let callback_id = callback
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let from_id = callback
                    .get("from")
                    .and_then(|from| from.get("id"))
                    .and_then(Value::as_i64);
                if owner_id.is_none() || from_id != owner_id {
                    append_runtime_log(
                        "telegram",
                        &format!("ignored callback from unauthorized user {:?}", from_id),
                    );
                    answer_telegram_callback(&client, &token, callback_id, "Not allowed.").await;
                    continue;
                }
                let Some(data) = callback.get("data").and_then(Value::as_str) else {
                    continue;
                };
                let Some((action, approval_id)) = data
                    .strip_prefix("gax:")
                    .and_then(|rest| rest.split_once(':'))
                else {
                    continue;
                };
                let callback_chat_id = callback
                    .get("message")
                    .and_then(|message| message.get("chat"))
                    .and_then(|chat| chat.get("id"))
                    .and_then(Value::as_i64);
                let callback_message_id = callback
                    .get("message")
                    .and_then(|message| message.get("message_id"))
                    .and_then(Value::as_i64);
                if let (Some(chat_id), Some(message_id)) = (callback_chat_id, callback_message_id) {
                    clear_telegram_message_keyboard(&client, &token, chat_id, message_id).await;
                }
                let pending = {
                    let mut guard = session.lock().unwrap();
                    if action == "ok" {
                        guard.pending_approvals.remove(approval_id)
                    } else {
                        guard.pending_approvals.remove(approval_id)
                    }
                };
                let Some(pending) = pending else {
                    answer_telegram_callback(&client, &token, callback_id, "This request expired.")
                        .await;
                    continue;
                };
                let chat_id = callback_chat_id.unwrap_or(pending.chat_id);
                if action != "ok" {
                    let text = if pending.prefers_vietnamese {
                        "\u{0110}\u{00e3} hu\u{1ef7}."
                    } else {
                        "Cancelled."
                    };
                    answer_telegram_callback(&client, &token, callback_id, text).await;
                    continue;
                }

                let approved_text = if pending.prefers_vietnamese {
                    "\u{0110}\u{00e3} \u{0111}\u{1ed3}ng \u{00fd}."
                } else {
                    "Approved."
                };
                answer_telegram_callback(&client, &token, callback_id, approved_text).await;
                let profile = load_telegram_assistant_profile(
                    &fallback_system_prompt,
                    &fallback_folders,
                    &fallback_google_client_id,
                    &fallback_google_client_secret,
                );
                let result = execute_telegram_pending_approval(
                    &client,
                    &token,
                    chat_id,
                    pending.clone(),
                    profile.clone(),
                    llama_state.clone(),
                    session.clone(),
                )
                .await;
                let reply = match result {
                    Ok(text) => text,
                    Err(error) => error,
                };
                send_telegram_message_chunked(&client, &token, chat_id, &reply).await;
                let mut history = load_personality_chat_history(&pending.personality_id);
                history.push(ReactChatMessage {
                    role: "assistant".to_string(),
                    content: json!(reply),
                });
                if history.len() > 80 {
                    let remove_count = history.len() - 80;
                    history.drain(0..remove_count);
                }
                persist_personality_chat_history(&pending.personality_id, &history);
                continue;
            }

            let Some(message) = update.get("message") else {
                continue;
            };
            let Some(chat_id) = message
                .get("chat")
                .and_then(|chat| chat.get("id"))
                .and_then(Value::as_i64)
            else {
                continue;
            };
            let from_id = message
                .get("from")
                .and_then(|from| from.get("id"))
                .and_then(Value::as_i64);
            let chat_type = message
                .get("chat")
                .and_then(|chat| chat.get("type"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            let from_value = message.get("from").cloned().unwrap_or_default();
            let from_name = telegram_display_name(&from_value);
            let is_owner = owner_id.is_some() && from_id == owner_id;
            let is_group_chat = matches!(chat_type, "group" | "supergroup");
            let mentioned_bot = telegram_message_mentions_bot(message, bot_username.as_deref());
            let settings_for_access =
                load_app_settings().unwrap_or_else(|_| AppSettings::default());
            let guest = from_id.and_then(|id| {
                settings_for_access
                    .telegram_guests
                    .iter()
                    .find(|guest| guest.id == id.to_string())
                    .cloned()
            });
            let mut guest_name = guest.as_ref().map(|guest| guest.name.clone());
            if !is_owner && guest.is_none() && is_group_chat && mentioned_bot {
                if let Some(id) = from_id {
                    match crate::config_store::add_telegram_guest_if_missing(
                        id.to_string(),
                        from_name.clone(),
                    ) {
                        Ok(Some(guest)) => {
                            append_runtime_log(
                                "telegram",
                                &format!("auto-added telegram guest {} ({})", guest.name, guest.id),
                            );
                            guest_name = Some(guest.name);
                        }
                        Ok(None) => {
                            guest_name = Some(from_name.clone());
                        }
                        Err(error) => {
                            append_runtime_log(
                                "telegram",
                                &format!("could not auto-add telegram guest: {}", error),
                            );
                        }
                    }
                }
            }

            if !is_owner && guest_name.is_none() {
                append_runtime_log(
                    "telegram",
                    &format!("ignored message from unauthorized user {:?}", from_id),
                );
                continue;
            }
            let is_guest = !is_owner;
            if is_group_chat && !mentioned_bot {
                continue;
            }

            {
                let mut guard = session.lock().unwrap();
                guard.last_chat_id = Some(chat_id);
            }

            let text = message
                .get("text")
                .or_else(|| message.get("caption"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let incoming_files = download_telegram_message_files(&client, &token, message).await;
            if !incoming_files.is_empty() {
                append_runtime_log(
                    "telegram",
                    &format!(
                        "received {} file(s): {}",
                        incoming_files.len(),
                        incoming_files
                            .iter()
                            .map(|file| format!(
                                "{} {} {}",
                                file.display_name, file.mime_type, file.local_path
                            ))
                            .collect::<Vec<_>>()
                            .join(" | ")
                    ),
                );
                if let Some(image) = incoming_files.iter().rev().find(|file| file.is_image) {
                    if let Ok(mut guard) = session.lock() {
                        guard
                            .last_image_by_chat
                            .insert(chat_id, image.local_path.clone());
                    }
                }
            }
            let voice_intent = telegram_voice_intent(text);
            let auto_voice = session.lock().unwrap().auto_voice;
            let wants_voice_reply =
                !is_guest && (auto_voice || voice_intent == TelegramVoiceIntent::Once);

            if text.is_empty() && incoming_files.is_empty() {
                let _ = send_telegram_message(
                    &client,
                    &token,
                    chat_id,
                    "Send me a text message and I'll answer properly.",
                )
                .await;
                continue;
            }

            let profile = load_telegram_assistant_profile(
                &fallback_system_prompt,
                &fallback_folders,
                &fallback_google_client_id,
                &fallback_google_client_secret,
            );
            let turn_thinking_enabled = load_app_settings()
                .map(|settings| settings.thinking_enabled)
                .unwrap_or(profile.thinking_enabled || fallback_thinking_enabled);

            let command_text = text.to_ascii_lowercase();
            let command_text = command_text.trim();
            if incoming_files.is_empty() && command_text == "/help" {
                let _ = send_telegram_message(
                    &client,
                    &token,
                    chat_id,
                    "Just talk to me naturally here. If you want voice, say something like \"send this as a voice message\" or \"turn on auto voice\".",
                )
                .await;
                continue;
            }
            if incoming_files.is_empty() && (command_text == "/status" || command_text == "status")
            {
                let _ = send_telegram_message(
                    &client,
                    &token,
                    chat_id,
                    "I'm here. Send me what you need.",
                )
                .await;
                continue;
            }

            if !is_guest {
                match voice_intent {
                    TelegramVoiceIntent::AutoOn => {
                        {
                            let mut guard = session.lock().unwrap();
                            guard.auto_voice = true;
                        }
                        let reply = "Okay, I'll send my replies with voice from now on.";
                        let _ = send_telegram_message(&client, &token, chat_id, reply).await;
                        synthesize_and_send_telegram_voice(
                            &client,
                            &token,
                            chat_id,
                            omnivoice_state.clone(),
                            llama_state.clone(),
                            reply,
                            profile.voice_sample_path.clone(),
                            Some(&profile.personality_name),
                        )
                        .await;
                        continue;
                    }
                    TelegramVoiceIntent::AutoOff => {
                        {
                            let mut guard = session.lock().unwrap();
                            guard.auto_voice = false;
                        }
                        let _ = send_telegram_message(
                            &client,
                            &token,
                            chat_id,
                            "Okay, I'll reply by text only.",
                        )
                        .await;
                        continue;
                    }
                    TelegramVoiceIntent::None | TelegramVoiceIntent::Once => {}
                }
            }

            // Built-in commands
            match if incoming_files.is_empty() {
                text.to_ascii_lowercase()
            } else {
                String::new()
            }
            .trim()
            {
                "/start" => {
                    let mut history = load_personality_chat_history(&profile.personality_id);
                    ensure_personality_greeting(&mut history, &profile.greeting);
                    persist_personality_chat_history(&profile.personality_id, &history);
                    let _ =
                        send_telegram_message(&client, &token, chat_id, &profile.greeting).await;
                    continue;
                }
                "/help" => {
                    let _ = send_telegram_message(
                        &client,
                        &token,
                        chat_id,
                        "Just talk to me naturally here. If you want voice, say something like \"send this as a voice message\" or \"turn on auto voice\".",
                    )
                    .await;
                    continue;
                }
                "/status" | "status" => {
                    let _ = send_telegram_message(
                        &client,
                        &token,
                        chat_id,
                        "I'm here. Send me what you need.",
                    )
                    .await;
                    continue;
                }
                _ => {}
            }

            if let Err(error) = ensure_telegram_llm_ready(llama_state.clone()).await {
                append_runtime_log("telegram", &format!("LLM auto-load failed: {}", error));
                let _ = send_telegram_message(&client, &token, chat_id, &error).await;
                continue;
            }
            let started = Instant::now();
            let mut history = if is_guest {
                Vec::new()
            } else {
                load_personality_chat_history(&profile.personality_id)
            };
            if !is_guest {
                ensure_personality_greeting(&mut history, &profile.greeting);
            }
            let user_content = build_telegram_user_content(text, &incoming_files);
            let user_log_text = if incoming_files.is_empty() {
                text.to_string()
            } else {
                let file_summary = incoming_files
                    .iter()
                    .map(|file| {
                        format!(
                            "{} ({}) {}",
                            file.display_name, file.mime_type, file.local_path
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("; ");
                if text.trim().is_empty() {
                    format!("[Telegram attachment] {}", file_summary)
                } else {
                    format!("{}\n[Telegram attachment] {}", text, file_summary)
                }
            };
            history.push(ReactChatMessage {
                role: "user".to_string(),
                content: user_content,
            });
            if !is_guest {
                persist_personality_chat_history(&profile.personality_id, &history);
            }
            let react_messages: Vec<ReactChatMessage> = history
                .iter()
                .rev()
                .take(16)
                .map(|m| ReactChatMessage {
                    role: m.role.clone(),
                    content: m.content.clone(),
                })
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();

            let sampling = agent_react::SamplingConfig {
                temperature,
                ..profile.sampling
            };
            let thinking_loop =
                start_telegram_action_loop(client.clone(), token.clone(), chat_id, "typing");
            let react_result = if is_guest {
                agent_react::agent_jan_chat_no_tools_core(
                    profile.system_prompt.clone(),
                    telegram_guest_context_block(
                        &profile,
                        guest_name.as_deref().unwrap_or(&from_name),
                    ),
                    react_messages,
                    sampling,
                    max_tokens,
                    turn_thinking_enabled,
                )
                .await
            } else {
                agent_react::agent_jan_chat_core(
                    profile.system_prompt.clone(),
                    telegram_context_block(&profile),
                    react_messages,
                    profile.folders.clone(),
                    profile.google_client_id.clone(),
                    profile.google_client_secret.clone(),
                    sampling,
                    max_tokens,
                    turn_thinking_enabled,
                    0,
                )
                .await
            };
            thinking_loop.store(false, Ordering::Relaxed);

            let reply_text = match react_result {
                Err(e) => e,
                Ok(result) => {
                    let parts = build_telegram_reply_parts(result);
                    // Send file if one was flagged
                    if let Some(ref file_path) = parts.send_file_path {
                        let send_result = if parts.file_is_image {
                            send_telegram_photo(
                                &client,
                                &token,
                                chat_id,
                                file_path,
                                parts.file_caption.as_deref(),
                            )
                            .await
                        } else {
                            send_telegram_document(
                                &client,
                                &token,
                                chat_id,
                                file_path,
                                parts.file_caption.as_deref(),
                            )
                            .await
                        };
                        if let Err(e) = send_result {
                            append_runtime_log("telegram", &format!("file send failed: {}", e));
                        } else if parts.file_is_image {
                            if let Ok(mut guard) = session.lock() {
                                guard.last_image_by_chat.insert(chat_id, file_path.clone());
                            }
                        }
                    }
                    if let Some(proposal) = parts.image_proposal.clone() {
                        let vi = telegram_prefers_vietnamese(text);
                        let approval_id = new_telegram_approval_id();
                        {
                            let mut guard = session.lock().unwrap();
                            let reference_image_path =
                                guard.last_image_by_chat.get(&chat_id).cloned();
                            guard.pending_approvals.insert(
                                approval_id.clone(),
                                TelegramPendingApproval {
                                    chat_id,
                                    personality_id: profile.personality_id.clone(),
                                    prefers_vietnamese: vi,
                                    reference_image_path,
                                    payload: TelegramPendingApprovalPayload::Image(
                                        proposal.clone(),
                                    ),
                                },
                            );
                        }
                        let _ = send_telegram_message_with_keyboard(
                            &client,
                            &token,
                            chat_id,
                            telegram_image_approval_text(vi),
                            telegram_approval_keyboard(&approval_id, vi),
                        )
                        .await;
                    }
                    if let Some(proposal) = parts.action_proposal.clone() {
                        let vi = telegram_prefers_vietnamese(text);
                        let approval_id = new_telegram_approval_id();
                        {
                            let mut guard = session.lock().unwrap();
                            guard.pending_approvals.insert(
                                approval_id.clone(),
                                TelegramPendingApproval {
                                    chat_id,
                                    personality_id: profile.personality_id.clone(),
                                    prefers_vietnamese: vi,
                                    reference_image_path: None,
                                    payload: TelegramPendingApprovalPayload::Action(
                                        proposal.clone(),
                                    ),
                                },
                            );
                        }
                        let card = if vi {
                            format!(
                                "Y\u{00ea}u c\u{1ea7}u c\u{1ea7}n duy\u{1ec7}t\n\n{}\nM\u{1ee9}c r\u{1ee7}i ro: {}\n{}",
                                proposal.title, proposal.risk_level, proposal.details
                            )
                        } else {
                            format!(
                                "Approval required\n\n{}\nRisk: {}\n{}",
                                proposal.title, proposal.risk_level, proposal.details
                            )
                        };
                        let _ = send_telegram_message_with_keyboard(
                            &client,
                            &token,
                            chat_id,
                            &card,
                            telegram_approval_keyboard(&approval_id, vi),
                        )
                        .await;
                    }
                    if wants_voice_reply && !parts.text.trim().is_empty() {
                        synthesize_and_send_telegram_voice(
                            &client,
                            &token,
                            chat_id,
                            omnivoice_state.clone(),
                            llama_state.clone(),
                            &parts.text,
                            profile.voice_sample_path.clone(),
                            Some(&profile.personality_name),
                        )
                        .await;
                    }
                    parts.text
                }
            };

            if is_guest {
                if let Some(id) = from_id {
                    append_telegram_chat_log(
                        id,
                        guest_name.as_deref().unwrap_or(&from_name),
                        &user_log_text,
                        &reply_text,
                    );
                }
            } else {
                history.push(ReactChatMessage {
                    role: "assistant".to_string(),
                    content: serde_json::json!(reply_text.clone()),
                });
                if history.len() > 80 {
                    let remove_count = history.len() - 80;
                    history.drain(0..remove_count);
                }
                persist_personality_chat_history(&profile.personality_id, &history);
                let updated_memory = update_personality_memory_after_turn(
                    &profile.personality_id,
                    &profile.personality_memory,
                    &user_log_text,
                    &reply_text,
                );
                if updated_memory != profile.personality_memory {
                    append_runtime_log(
                        "telegram",
                        &format!(
                            "updated memory for active character {}",
                            profile.personality_name
                        ),
                    );
                }
            }
            append_runtime_log(
                "telegram",
                &format!("handled message in {} ms", started.elapsed().as_millis()),
            );

            if !reply_text.is_empty() {
                send_telegram_message_chunked(&client, &token, chat_id, &reply_text).await;
            }
        }
    }

    append_runtime_log("telegram", "polling stopped");
}

#[tauri::command]
pub fn default_voice_samples_folder() -> String {
    voices_dir(None).to_string_lossy().to_string()
}

#[tauri::command]
pub fn list_voice_samples(folder: Option<String>) -> Result<Vec<VoiceSample>, String> {
    let dir = voices_dir(folder.as_deref());
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut seen_names = std::collections::HashSet::new();
    let mut samples = Vec::new();
    collect_voice_samples(&dir, &mut seen_names, &mut samples);

    samples.sort_by(|left, right| left.label.cmp(&right.label));
    Ok(samples)
}

#[tauri::command]
pub fn start_voice_setup(state: State<'_, VoiceRuntimeState>) -> VoiceSetupStatus {
    let runtime_state = state.inner().clone();

    if current_voice_status(&runtime_state).ready {
        return current_voice_status(&runtime_state);
    }

    if runtime_state.installing.swap(true, Ordering::SeqCst) {
        return current_voice_status(&runtime_state);
    }

    std::thread::spawn(move || install_voice_runtime_blocking(runtime_state.clone()));

    current_voice_status(state.inner())
}

#[tauri::command]
pub fn get_voice_setup_status(state: State<'_, VoiceRuntimeState>) -> VoiceSetupStatus {
    current_voice_status(state.inner())
}

#[tauri::command]
pub async fn generate_image(
    prompt: String,
    init_image_data_url: Option<String>,
    init_image_data_urls: Option<Vec<String>>,
    mask_prompt: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<ImageGenerationResult, String> {
    let image = crate::image_runtime::generate_image(
        prompt,
        init_image_data_url,
        init_image_data_urls,
        mask_prompt,
        width,
        height,
    )
    .await?;
    Ok(ImageGenerationResult {
        image_base64: image.image_base64,
        mime_type: image.mime_type,
        file_path: image.file_path,
    })
}

#[tauri::command]
pub async fn stop_image_generation() -> Result<(), String> {
    crate::image_runtime::shutdown_image_server();
    Ok(())
}

#[tauri::command]
pub async fn test_telegram_bot(token: String) -> Result<TelegramBotStatus, String> {
    let token = normalize_telegram_token(&token);
    if token.is_empty() {
        return Ok(TelegramBotStatus {
            success: false,
            message: "Add a Telegram bot token first.".to_string(),
            username: None,
        });
    }

    telegram_get_me(&reqwest::Client::new(), &token).await
}

#[tauri::command]
pub async fn start_telegram_bot(
    state: State<'_, TelegramRuntimeState>,
    omnivoice_state: State<'_, OmniVoiceRuntimeState>,
    llama_state: State<'_, LlamaState>,
    token: String,
    owner_user_id: String,
    system_prompt: String,
    temperature: f32,
    max_tokens: u32,
    thinking_enabled: bool,
    google_client_id: String,
    google_client_secret: String,
    folders: Vec<String>,
) -> Result<TelegramBotStatus, String> {
    let token = normalize_telegram_token(&token);
    if token.is_empty() {
        return Ok(TelegramBotStatus {
            success: false,
            message: "Add a Telegram bot token first.".to_string(),
            username: None,
        });
    }
    let owner_id = parse_telegram_owner_id(&owner_user_id)?;
    let client = reqwest::Client::new();
    let status = telegram_get_me(&client, &token).await?;
    if !status.success {
        return Ok(status);
    }

    {
        let mut guard = state.worker.lock().unwrap();
        if let Some(worker) = guard.as_ref() {
            if !worker.stop.load(Ordering::SeqCst)
                && worker.token == token
                && worker.owner_id == owner_id
            {
                return Ok(TelegramBotStatus {
                    success: true,
                    message: worker
                        .username
                        .as_ref()
                        .map(|name| format!("Telegram control is already running with @{}.", name))
                        .unwrap_or_else(|| "Telegram control is already running.".to_string()),
                    username: worker.username.clone(),
                });
            }
        }
        if let Some(worker) = guard.take() {
            worker.stop.store(true, Ordering::SeqCst);
        }

        {
            let profile = load_telegram_assistant_profile(
                &system_prompt,
                &folders,
                &google_client_id,
                &google_client_secret,
            );
            let mut session_guard = state.session.lock().unwrap();
            session_guard.last_personality_id = Some(profile.personality_id);
            session_guard.last_chat_id = None;
            session_guard.auto_voice = false;
        }

        let stop = Arc::new(AtomicBool::new(false));
        let worker = TelegramWorker {
            stop: stop.clone(),
            username: status.username.clone(),
            token: token.clone(),
            owner_id,
        };
        *guard = Some(worker);

        tauri::async_runtime::spawn(telegram_poll_loop(
            token,
            owner_id,
            status.username.clone(),
            omnivoice_state.inner().clone(),
            Arc::new(llama_state.inner().clone()),
            state.session.clone(),
            system_prompt,
            temperature,
            max_tokens,
            thinking_enabled,
            google_client_id,
            google_client_secret,
            folders,
            stop,
        ));
    }

    Ok(TelegramBotStatus {
        success: true,
        message: status
            .username
            .as_ref()
            .map(|name| format!("Telegram control is running with @{}.", name))
            .unwrap_or_else(|| "Telegram control is running.".to_string()),
        username: status.username,
    })
}

#[tauri::command]
pub fn stop_telegram_bot(state: State<'_, TelegramRuntimeState>) -> TelegramBotStatus {
    let mut guard = state.worker.lock().unwrap();
    if let Some(worker) = guard.take() {
        worker.stop.store(true, Ordering::SeqCst);
        TelegramBotStatus {
            success: true,
            message: "Telegram control stopped.".to_string(),
            username: worker.username,
        }
    } else {
        TelegramBotStatus {
            success: true,
            message: "Telegram control is already stopped.".to_string(),
            username: None,
        }
    }
}

#[tauri::command]
pub fn get_telegram_bot_status(state: State<'_, TelegramRuntimeState>) -> TelegramBotStatus {
    let guard = state.worker.lock().unwrap();
    if let Some(worker) = guard.as_ref() {
        TelegramBotStatus {
            success: true,
            message: worker
                .username
                .as_ref()
                .map(|name| format!("Telegram control is running with @{}.", name))
                .unwrap_or_else(|| "Telegram control is running.".to_string()),
            username: worker.username.clone(),
        }
    } else {
        TelegramBotStatus {
            success: false,
            message: "Telegram control is stopped.".to_string(),
            username: None,
        }
    }
}
