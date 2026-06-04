use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::file_tools;

#[derive(Debug, Clone, Copy)]
pub struct SamplingConfig {
    pub temperature: f32,
    pub top_k: u32,
    pub top_p: f32,
    pub min_p: f32,
    pub repeat_last_n: i32,
    pub repeat_penalty: f32,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ReactChatMessage {
    pub role: String,
    pub content: Value,
}

#[derive(Debug, Serialize)]
pub struct ReactChatResult {
    pub answer: String,
    pub thinking: Option<String>,
    pub tool_used: Option<String>,
    pub observation: Option<String>,
    pub cards: Vec<ToolResultCard>,
    pub image_proposal: Option<ImageProposal>,
    pub file_preview: Option<file_tools::FilePreviewResult>,
    pub action_proposal: Option<ActionProposal>,
    pub tool_trace: Vec<ToolTrace>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolResultCard {
    pub kind: String,
    pub title: String,
    pub summary: Option<String>,
    pub fields: Vec<ToolResultField>,
    pub items: Vec<ToolResultItem>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolResultField {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolResultItem {
    pub title: String,
    pub subtitle: Option<String>,
    pub details: Vec<ToolResultField>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImageProposal {
    pub prompt: String,
    pub mode: String,
    pub mask_prompt: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub reference_sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ActionProposal {
    pub action_type: String,
    pub title: String,
    pub details: String,
    pub risk_level: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolTrace {
    pub tool: String,
    pub success: bool,
    pub summary: String,
}

pub(super) struct ToolOutcome {
    pub observation: String,
    pub cards: Vec<ToolResultCard>,
    pub file_preview: Option<file_tools::FilePreviewResult>,
    pub image_proposal: Option<ImageProposal>,
    pub action_proposal: Option<ActionProposal>,
    pub success: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct ToolCall {
    pub tool: String,
    #[serde(default)]
    pub arguments: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ToolRoute {
    MediaPreview,
    Gmail,
    Calendar,
    Weather,
    FileSearch,
    WebSearch,
    GoogleWorkspace,
}
