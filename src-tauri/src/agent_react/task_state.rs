use super::*;

#[derive(Debug, Clone)]
pub(super) struct ConversationTaskState {
    pub route: Option<ToolRoute>,
    pub pending_image_proposal: bool,
    pub recent_image_context: bool,
    pub recent_image_creation_context: bool,
    pub image_required: bool,
    pub label: &'static str,
    pub reason: &'static str,
}

impl ConversationTaskState {
    pub(super) fn requires_tool(&self) -> bool {
        self.route.is_some() || self.image_required
    }

    pub(super) fn allowed_tool_names(&self) -> String {
        if self.image_required {
            "propose_image_generation".to_string()
        } else {
            tool_names_for_capability(self.route).join(", ")
        }
    }

    pub(super) fn route_text(&self) -> &'static str {
        self.route
            .map(route_label)
            .unwrap_or(if self.image_required {
                "image generation"
            } else {
                "none"
            })
    }

    pub(super) fn planner_summary(&self) -> String {
        format!(
            "Task state: {}. Required tool: {}. Route: {}. Pending image proposal: {}. Recent image creation context: {}. Reason: {}.",
            self.label,
            if self.requires_tool() { "yes" } else { "no" },
            self.route_text(),
            if self.pending_image_proposal { "yes" } else { "no" },
            if self.recent_image_creation_context { "yes" } else { "no" },
            self.reason
        )
    }
}

pub(super) fn derive_conversation_task_state(
    latest_user_text: &str,
    route: Option<ToolRoute>,
    pending_image_proposal: Option<&ImageProposal>,
    recent_image_context: bool,
    recent_image_creation_context: bool,
) -> ConversationTaskState {
    let image_required = request_effectively_wants_image_generation(
        latest_user_text,
        pending_image_proposal,
        recent_image_context,
        recent_image_creation_context,
    );

    let (label, reason) = if pending_image_proposal.is_some() && image_required {
        (
            "pending_image_approval",
            "there is an unresolved image proposal and the latest turn appears to continue it",
        )
    } else if image_required {
        (
            "image_generation_or_edit",
            "the current turn or recent visual context requires the image proposal tool",
        )
    } else if route.is_some() {
        (
            "external_or_local_tool",
            "the request needs app, local, live, or account data",
        )
    } else if recent_image_context {
        (
            "recent_image_context",
            "an image is nearby in the conversation but this turn is not forced to use a tool",
        )
    } else {
        ("conversation", "no tool is required before answering")
    };

    ConversationTaskState {
        route,
        pending_image_proposal: pending_image_proposal.is_some(),
        recent_image_context,
        recent_image_creation_context,
        image_required,
        label,
        reason,
    }
}
