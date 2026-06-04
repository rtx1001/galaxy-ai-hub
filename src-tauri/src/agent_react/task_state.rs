use super::*;

#[derive(Debug, Clone)]
pub(super) struct ConversationTaskState {
    pub route: Option<ToolRoute>,
    pub pending_image_proposal: bool,
    pub recent_image_context: bool,
    pub recent_image_creation_context: bool,
    pub image_required: bool,
    pub tool_repair_required: bool,
    pub label: &'static str,
    pub reason: &'static str,
}

impl ConversationTaskState {
    pub(super) fn requires_tool(&self) -> bool {
        self.route.is_some() || self.image_required || self.tool_repair_required
    }

    pub(super) fn allowed_tool_names(&self) -> String {
        if self.image_required {
            "propose_image_generation".to_string()
        } else if self.tool_repair_required && self.route.is_none() {
            available_tool_names_csv()
        } else {
            tool_names_for_capability(self.route).join(", ")
        }
    }

    pub(super) fn route_text(&self) -> &'static str {
        self.route
            .map(route_label)
            .unwrap_or(if self.image_required {
                "image generation"
            } else if self.tool_repair_required {
                "tool repair"
            } else {
                "none"
            })
    }

    pub(super) fn planner_summary(&self) -> String {
        format!(
            "Task state: {}. Required tool: {}. Route: {}. Pending image proposal: {}. Recent image context: {}. Recent image creation context: {}. Reason: {}.",
            self.label,
            if self.requires_tool() { "yes" } else { "no" },
            self.route_text(),
            if self.pending_image_proposal { "yes" } else { "no" },
            if self.recent_image_context { "yes" } else { "no" },
            if self.recent_image_creation_context { "yes" } else { "no" },
            self.reason
        )
    }

    pub(super) fn tool_repair(reason: &'static str) -> Self {
        Self {
            route: None,
            pending_image_proposal: false,
            recent_image_context: false,
            recent_image_creation_context: false,
            image_required: false,
            tool_repair_required: true,
            label: "tool_protocol_repair",
            reason,
        }
    }

    pub(super) fn with_image_required(mut self, reason: &'static str) -> Self {
        self.route = None;
        self.image_required = true;
        self.tool_repair_required = false;
        self.label = if self.pending_image_proposal {
            "pending_image_approval"
        } else {
            "image_generation_or_edit"
        };
        self.reason = reason;
        self
    }
}

pub(super) fn derive_conversation_task_state(
    latest_user_text: &str,
    route: Option<ToolRoute>,
    pending_image_proposal: Option<&ImageProposal>,
    recent_image_context: bool,
    recent_image_creation_context: bool,
) -> ConversationTaskState {
    let _ = latest_user_text;
    let image_required = false;

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
            "an image is nearby in the conversation; the model must decide whether an image tool is needed",
        )
    } else {
        (
            "conversation",
            "no deterministic tool route was selected; the model must decide whether a tool is needed",
        )
    };

    ConversationTaskState {
        route,
        pending_image_proposal: pending_image_proposal.is_some(),
        recent_image_context,
        recent_image_creation_context,
        image_required,
        tool_repair_required: false,
        label,
        reason,
    }
}
