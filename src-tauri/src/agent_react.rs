use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, TimeZone};
use getrandom::getrandom;
use serde_json::{json, Value};

use crate::{agent_store, agent_web, file_tools, google_calendar, weather};

mod cards;
mod chat_client;
mod chat_media;
mod executor;
#[cfg(test)]
mod google_infer;
mod image_intent;
mod image_proposal;
mod outcomes;
mod planner;
mod prompts;
mod routing;
mod task_state;
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
use image_intent::*;
use image_proposal::*;
use outcomes::*;
use planner::*;
use prompts::*;
use routing::*;
use task_state::*;
use text_utils::*;
use thinking::*;
use tool_contract::*;
use tool_parse::*;
pub use types::{
    ActionProposal, ImageProposal, ReactChatMessage, ReactChatResult, SamplingConfig,
    ToolResultCard, ToolResultField, ToolResultItem, ToolTrace,
};
use types::{ToolCall, ToolOutcome, ToolRoute};
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

fn tool_protocol_failure_answer(vietnamese: bool) -> String {
    if vietnamese {
        "Em chưa thực hiện được thao tác đó. Anh thử gửi lại yêu cầu một lần nữa giúp em nhé."
            .to_string()
    } else {
        "I could not complete that action. Please try the request once more.".to_string()
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
    let agent_started_at = Instant::now();
    let request_elapsed_ms = request_elapsed_ms.max(0);
    let mut request_messages = Vec::new();
    let system_prompt = [
        read_master_system_prompt(),
        tool_protocol_prompt(),
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

    let latest_text = latest_user_text(&messages);
    let vi = user_wants_vietnamese(&latest_text);
    // Do not pre-route live requests with language-specific keyword rules.
    // The model planner receives the full tool schema and decides from meaning + context.
    let contextual_route: Option<ToolRoute> = None;
    let pending_image_proposal = recent_pending_image_proposal(&messages);
    let has_recent_image_context = recent_image_context(&messages);
    let has_recent_image_creation_context = recent_unresolved_image_creation_context(&messages);
    let task_state = derive_conversation_task_state(
        &latest_text,
        contextual_route,
        pending_image_proposal.as_ref(),
        has_recent_image_context,
        has_recent_image_creation_context,
    );
    crate::assistant_runtime::append_runtime_log(
        "agent",
        &format!(
            "{} latest=\"{}\"",
            task_state.planner_summary(),
            crate::assistant_runtime::compact_trace_text(&latest_text, 180)
        ),
    );
    let tools = tool_schema();
    let mut accumulated_thinking = String::new();
    let mut tool_trace = Vec::new();
    let mut last_tool: Option<String> = None;
    let mut last_observation: Option<String> = None;
    let mut last_cards: Vec<ToolResultCard> = Vec::new();
    let mut planner_task_state = task_state.clone();
    let mut tool_repair_used = false;
    if is_confirmation(&latest_text) {
        if let Some(proposal) = pending_image_proposal.clone() {
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

    let max_tool_steps = if task_state.image_required {
        2
    } else if task_state.requires_tool() {
        4
    } else {
        2
    };

    for step in 0..max_tool_steps {
        let (planned_tool_call, planner_thinking) = plan_next_tool_call(
            &request_messages,
            &tools,
            sampling,
            &latest_text,
            &planner_task_state,
            step,
        )
        .await?;
        append_thinking(&mut accumulated_thinking, &planner_thinking);

        let raw_tool_call = match planned_tool_call {
            Some(raw_tool_call) => raw_tool_call,
            None => {
                let tool_required_this_turn = task_state.requires_tool();
                if tool_required_this_turn && step + 1 < max_tool_steps {
                    request_messages.push(json!({
                        "role": "system",
                        "content": "Planner correction: this user turn needs a tool. Produce exactly one valid structured tool call, or output NO_TOOL only when a required argument is missing. Do not answer the user in this planner step."
                    }));
                    continue;
                }
                let (assistant_text, final_thinking) = call_chat_text_with_continuation(
                    request_messages.clone(),
                    sampling,
                    max_tokens,
                    thinking_enabled,
                )
                .await?;
                append_thinking(&mut accumulated_thinking, &final_thinking);
                if let Some((name, arguments, _, _)) =
                    first_model_tool_call(&json!({}), &assistant_text)
                {
                    let candidate = ToolCall {
                        tool: name.clone(),
                        arguments: arguments.clone(),
                    };
                    if validate_tool_call(&candidate).is_ok() {
                        append_thinking(
                            &mut accumulated_thinking,
                            &format!(
                                "Tool protocol repair: converted an exact known tool name from hidden model text into a structured candidate for validation. Tool: {}.",
                                candidate.tool
                            ),
                        );
                        candidate
                    } else {
                        let invalid_detail = validate_tool_call(&candidate).err().unwrap_or_else(|| {
                            format!(
                                "Tool call '{}' appeared in final answer text instead of the private planner.",
                                name
                            )
                        });
                        append_thinking(
                            &mut accumulated_thinking,
                            &format!(
                                "Tool protocol violation: final answer contained a tool call. {}",
                                invalid_detail
                            ),
                        );
                        if !tool_repair_used {
                            tool_repair_used = true;
                            planner_task_state = ConversationTaskState::tool_repair(
                                "the previous draft emitted raw or invalid tool markup instead of using the private planner",
                            );
                            request_messages.push(json!({
                                "role": "system",
                                "content": format!(
                                    "Protocol error: final answer text contained a raw or invalid tool call. {} Return to the private planner for one retry. Use exactly one real tool from the fixed tool list when a tool is needed. Otherwise output NO_TOOL.",
                                    invalid_detail
                                )
                            }));
                            continue;
                        }
                        append_thinking(
                            &mut accumulated_thinking,
                            "Tool protocol repair was already attempted once; stopping instead of looping.",
                        );
                        return Ok(empty_react_result(
                            tool_protocol_failure_answer(vi),
                            thinking_result(thinking_enabled, &accumulated_thinking),
                        ));
                    }
                } else if let Some(proposal) = parse_pending_image_proposal_text(&assistant_text) {
                    request_messages.push(json!({
                        "role": "system",
                        "content": format!(
                            "Protocol error: the final answer wrote an image proposal instead of using propose_image_generation in the private planner. Return to planning and produce that tool call there. Proposal mode seen: {}.",
                            proposal.mode
                        )
                    }));
                    continue;
                } else {
                    let leaked_tool_narration =
                        looks_like_unexecuted_tool_narration(&assistant_text);
                    let unverified_workspace_claim =
                        last_observation.is_none()
                            && answer_claims_verified_workspace_result(&assistant_text);
                    let failed_tool_claim =
                        last_observation
                            .as_deref()
                            .map(|observation| observation.trim_start().starts_with("ERROR:"))
                            .unwrap_or(false)
                            && answer_claims_verified_workspace_result(&assistant_text);
                    if leaked_tool_narration
                        || unverified_workspace_claim
                        || failed_tool_claim
                        || (last_observation.is_none()
                            && answer_claims_unverified_tool_result(&assistant_text, &task_state))
                    {
                        if let Some(retry_message) = protocol_retry_for_missing_tool(&task_state) {
                            request_messages.push(json!({
                                "role": "system",
                                "content": retry_message
                            }));
                            continue;
                        }
                        if !tool_repair_used {
                            tool_repair_used = true;
                            planner_task_state = ConversationTaskState::tool_repair(
                                "the previous draft claimed a tool result without a verified observation",
                            );
                            request_messages.push(json!({
                                "role": "system",
                                "content": "Protocol repair: the previous draft claimed a tool result without a verified tool observation. Return to the private planner for one retry. Use exactly one real tool from the fixed tool list when a tool is needed. If the action is unclear, output NO_TOOL so the final answer can ask one short clarification."
                            }));
                            continue;
                        }
                        append_thinking(
                            &mut accumulated_thinking,
                            "Tool protocol repair was already attempted once; stopping instead of looping.",
                        );
                        return Ok(empty_react_result(
                            tool_protocol_failure_answer(vi),
                            thinking_result(thinking_enabled, &accumulated_thinking),
                        ));
                    } else {
                        let answer = assistant_text
                            .strip_prefix("RESPONSE:")
                            .unwrap_or(&assistant_text)
                            .trim()
                            .to_string();
                        return Ok(ReactChatResult {
                            answer,
                            thinking: thinking_result(thinking_enabled, &accumulated_thinking),
                            tool_used: last_tool,
                            observation: last_observation,
                            cards: last_cards,
                            image_proposal: None,
                            file_preview: None,
                            action_proposal: None,
                            tool_trace,
                        });
                    }
                }
            }
        };

        let tool_call = promote_media_list_to_preview_in_preview_flow(
            enrich_contextual_tool_call(raw_tool_call, &messages, &latest_text),
            &messages,
            &latest_text,
        );
        if let Err(error) = validate_tool_call(&tool_call) {
            push_tool_validation_error(&mut request_messages, "planner_tool_call", false, error);
            continue;
        }
        if let Err(error) = tool_allowed_for_context(&tool_call, &messages) {
            push_tool_validation_error(&mut request_messages, "planner_tool_call", false, error);
            continue;
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
            summary: summary.clone(),
        });
        last_tool = Some(tool_call.tool.clone());
        last_observation = Some(outcome.observation.clone());
        last_cards = outcome.cards.clone();

        if let Some(proposal) = outcome.image_proposal {
            return Ok(ReactChatResult {
                answer: image_approval_answer(vi),
                thinking: thinking_result(thinking_enabled, &accumulated_thinking),
                tool_used: last_tool,
                observation: last_observation,
                cards: last_cards,
                image_proposal: Some(proposal),
                file_preview: None,
                action_proposal: None,
                tool_trace,
            });
        }

        if let Some(action) = outcome.action_proposal {
            return Ok(ReactChatResult {
                answer: action_approval_answer(vi),
                thinking: thinking_result(thinking_enabled, &accumulated_thinking),
                tool_used: last_tool,
                observation: last_observation,
                cards: last_cards,
                image_proposal: None,
                file_preview: None,
                action_proposal: Some(action),
                tool_trace,
            });
        }

        if let Some(preview) = outcome.file_preview {
            return Ok(ReactChatResult {
                answer: preview_final_answer(&preview, &latest_text),
                thinking: thinking_result(thinking_enabled, &accumulated_thinking),
                tool_used: last_tool,
                observation: last_observation,
                cards: last_cards,
                image_proposal: None,
                file_preview: Some(preview),
                action_proposal: None,
                tool_trace,
            });
        }

        request_messages.push(json!({
            "role": "user",
            "content": format!(
                "Verified tool result for {}:\n{}\n\nUse this observation to answer naturally. Do not invent facts beyond this observation.",
                tool_call.tool,
                outcome.observation
            ),
        }));

        if tool_call.tool == "weather_forecast" {
            let (answer, final_thinking) = call_chat_text_with_continuation(
                request_messages.clone(),
                sampling,
                max_tokens,
                thinking_enabled,
            )
            .await?;
            append_thinking(&mut accumulated_thinking, &final_thinking);
            return Ok(ReactChatResult {
                answer: answer
                    .strip_prefix("RESPONSE:")
                    .unwrap_or(&answer)
                    .trim()
                    .to_string(),
                thinking: thinking_result(thinking_enabled, &accumulated_thinking),
                tool_used: last_tool,
                observation: last_observation,
                cards: last_cards,
                image_proposal: None,
                file_preview: None,
                action_proposal: None,
                tool_trace,
            });
        }

        if step + 1 == max_tool_steps {
            break;
        }
    }

    request_messages.push(json!({
        "role": "system",
        "content": "Tool loop limit reached. Give the final answer from the verified tool observations already available."
    }));
    let (answer, final_thinking) =
        call_chat_text_with_continuation(request_messages, sampling, max_tokens, thinking_enabled)
            .await?;
    append_thinking(&mut accumulated_thinking, &final_thinking);
    if let Some((name, arguments, _, _)) = first_model_tool_call(&json!({}), &answer) {
        let invalid_detail = validate_tool_call(&ToolCall {
            tool: name.clone(),
            arguments,
        })
        .err()
        .unwrap_or_else(|| {
            format!(
                "Tool call '{}' appeared after the tool loop ended instead of in the private planner.",
                name
            )
        });
        append_thinking(
            &mut accumulated_thinking,
            &format!(
                "Tool protocol violation: final answer contained a tool call after the tool loop ended. {}",
                invalid_detail
            ),
        );
        return Ok(empty_react_result(
            "I could not complete that action because the model produced an invalid tool call format. Please try again.".to_string(),
            thinking_result(thinking_enabled, &accumulated_thinking),
        ));
    }
    let unverified_workspace_claim =
        last_observation.is_none() && answer_claims_verified_workspace_result(&answer);
    let failed_tool_claim = last_observation
        .as_deref()
        .map(|observation| observation.trim_start().starts_with("ERROR:"))
        .unwrap_or(false)
        && answer_claims_verified_workspace_result(&answer);
    if looks_like_unexecuted_tool_narration(&answer)
        || unverified_workspace_claim
        || failed_tool_claim
        || (last_observation.is_none() && answer_claims_unverified_tool_result(&answer, &task_state))
    {
        append_thinking(
            &mut accumulated_thinking,
            "Tool protocol violation: final answer claimed a tool/media result without a verified observation.",
        );
        return Ok(empty_react_result(
            tool_protocol_failure_answer(vi),
            thinking_result(thinking_enabled, &accumulated_thinking),
        ));
    }
    if answer.trim().is_empty() && last_observation.is_none() {
        return Ok(empty_react_result(
            "I could not produce a final answer.".to_string(),
            thinking_result(thinking_enabled, &accumulated_thinking),
        ));
    }

    Ok(ReactChatResult {
        answer: if answer.trim().is_empty() {
            last_observation.clone().unwrap_or_default()
        } else {
            answer
        },
        thinking: thinking_result(thinking_enabled, &accumulated_thinking),
        tool_used: last_tool,
        observation: last_observation,
        cards: last_cards,
        image_proposal: None,
        file_preview: None,
        action_proposal: None,
        tool_trace,
    })
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
