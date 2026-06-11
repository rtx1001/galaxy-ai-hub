use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, TimeZone};
use getrandom::getrandom;
use serde_json::{json, Value};

use crate::{agent_store, agent_web, file_tools, google_calendar, weather};

mod cards;
mod chat_client;
mod chat_media;
mod clean_agent;
mod executor;
mod image_proposal;
mod outcomes;
mod prompts;
mod routing;
#[cfg(test)]
mod tests;
mod text_utils;
mod thinking;
mod tool_contract;
mod tool_parse;
mod types;
mod workspace_paths;
use cards::*;
pub use chat_client::generate_plain_text_reply;
pub(crate) use chat_client::*;
use chat_media::*;
use executor::*;
use image_proposal::*;
use outcomes::*;
use prompts::*;
use routing::*;
use text_utils::*;
use thinking::*;
use tool_contract::*;
use tool_parse::*;
pub use types::{
    ActionProposal, ImageProposal, ReactChatMessage, ReactChatResult, SamplingConfig,
    ToolResultCard, ToolResultField, ToolResultItem, ToolTrace,
};
use types::{ToolCall, ToolOutcome};
use workspace_paths::*;

fn empty_react_result(answer: String, thinking: Option<String>) -> ReactChatResult {
    ReactChatResult {
        answer,
        thinking,
        tool_used: None,
        observation: None,
        cards: Vec::new(),
        image_proposal: None,
        file_preview: None,
        action_proposal: None,
        tool_trace: Vec::new(),
    }
}

#[tauri::command]
pub async fn agent_jan_chat(
    runtime_prompt: String,
    context_block: String,
    messages: Vec<ReactChatMessage>,
    folders: Vec<String>,
    google_client_id: String,
    google_client_secret: String,
    temperature: f32,
    top_k: u32,
    top_p: f32,
    min_p: f32,
    repeat_last_n: i32,
    repeat_penalty: f32,
    max_tokens: u32,
    thinking_enabled: bool,
    request_elapsed_ms: Option<i64>,
) -> Result<ReactChatResult, String> {
    agent_jan_chat_core(
        runtime_prompt,
        context_block,
        messages,
        folders,
        google_client_id,
        google_client_secret,
        SamplingConfig {
            temperature,
            top_k,
            top_p,
            min_p,
            repeat_last_n,
            repeat_penalty,
        },
        max_tokens,
        thinking_enabled,
        request_elapsed_ms.unwrap_or(0),
    )
    .await
}

pub async fn agent_jan_chat_core(
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
    clean_agent::agent_clean_chat_core(
        runtime_prompt,
        context_block,
        messages,
        folders,
        google_client_id,
        google_client_secret,
        sampling,
        max_tokens,
        thinking_enabled,
        request_elapsed_ms,
    )
    .await
}

pub async fn agent_jan_chat_no_tools_core(
    runtime_prompt: String,
    context_block: String,
    messages: Vec<ReactChatMessage>,
    sampling: SamplingConfig,
    max_tokens: u32,
    thinking_enabled: bool,
) -> Result<ReactChatResult, String> {
    let system_prompt = [
        read_master_system_prompt(),
        reasoning_style_prompt(thinking_enabled).to_string(),
        runtime_prompt.trim().to_string(),
        (!context_block.trim().is_empty())
            .then(|| format!("Runtime context:\n{}", context_block.trim()))
            .unwrap_or_default(),
        "This Telegram guest turn is chat-only. Do not use tools, do not claim external access, and answer only from the conversation and general knowledge.".to_string(),
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
        .take(24)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
    {
        if !content_text(&message.content).trim().is_empty() {
            request_messages
                .push(json!({ "role": message.role, "content": chat_content_for_model(message) }));
        }
    }

    let (assistant_text, thinking) =
        call_chat_text_with_continuation(request_messages, sampling, max_tokens, thinking_enabled)
            .await?;
    Ok(ReactChatResult {
        answer: assistant_text
            .strip_prefix("RESPONSE:")
            .unwrap_or(&assistant_text)
            .trim()
            .to_string(),
        thinking: thinking_result(thinking_enabled, &thinking),
        tool_used: None,
        observation: None,
        cards: Vec::new(),
        image_proposal: None,
        file_preview: None,
        action_proposal: None,
        tool_trace: Vec::new(),
    })
}
