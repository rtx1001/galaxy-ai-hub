use super::*;

pub(super) fn clean_summary(text: &str) -> String {
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() > 240 {
        format!("{}...", one_line.chars().take(237).collect::<String>())
    } else {
        one_line
    }
}

pub(super) fn action_risk(action_type: &str, arguments: &Value) -> String {
    let text = format!("{} {}", action_type, arguments).to_ascii_lowercase();
    if [
        "delete",
        "trash",
        "remove-item",
        "del ",
        "format ",
        "shutdown",
        "restart-computer",
        "reg delete",
        "diskpart",
    ]
    .iter()
    .any(|term| text.contains(term))
    {
        "high".to_string()
    } else if [
        "write",
        "move",
        "rename",
        "copy",
        "start-process",
        "invoke-webrequest",
    ]
    .iter()
    .any(|term| text.contains(term))
    {
        "medium".to_string()
    } else {
        "low".to_string()
    }
}

pub(super) fn proposed_action(
    action_type: &str,
    title: &str,
    details: String,
    arguments: Value,
) -> ToolOutcome {
    let risk_level = action_risk(action_type, &arguments);
    ToolOutcome {
        observation: format!(
            "Approval required. Proposed action: {}. Risk: {}. Details: {}",
            title, risk_level, details
        ),
        cards: Vec::new(),
        file_preview: None,
        image_proposal: None,
        action_proposal: Some(ActionProposal {
            action_type: action_type.to_string(),
            title: title.to_string(),
            details,
            risk_level,
            arguments,
        }),
        success: true,
    }
}

pub(super) fn text_outcome(observation: String) -> ToolOutcome {
    ToolOutcome {
        observation,
        cards: Vec::new(),
        file_preview: None,
        image_proposal: None,
        action_proposal: None,
        success: true,
    }
}

pub(super) fn image_proposal_outcome(proposal: ImageProposal, _vi: bool) -> ToolOutcome {
    ToolOutcome {
        observation: format!(
            "Image generation proposal prepared. Mode: {}. Prompt: {}",
            proposal.mode, proposal.prompt
        ),
        cards: Vec::new(),
        file_preview: None,
        image_proposal: Some(proposal),
        action_proposal: None,
        success: true,
    }
}
pub(super) fn error_outcome(error: String) -> ToolOutcome {
    ToolOutcome {
        observation: format!("ERROR: {}", error),
        cards: vec![ToolResultCard {
            kind: "error".to_string(),
            title: "Tool error".to_string(),
            summary: Some(error),
            fields: Vec::new(),
            items: Vec::new(),
            text: None,
        }],
        file_preview: None,
        image_proposal: None,
        action_proposal: None,
        success: false,
    }
}

pub(super) fn log_tool_run(tool: &ToolCall, outcome: &ToolOutcome, duration_ms: i64) {
    let _ = agent_store::record_agent_tool_run(agent_store::AgentToolRun {
        tool_name: tool.tool.clone(),
        input_json: tool.arguments.to_string(),
        output_text: clean_summary(&outcome.observation),
        success: outcome.success,
        duration_ms,
    });
}
