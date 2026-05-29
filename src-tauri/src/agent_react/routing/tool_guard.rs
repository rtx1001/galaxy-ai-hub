use super::*;

#[cfg(test)]
pub(in crate::agent_react) fn is_gmail_tool(tool: &str) -> bool {
    tool == "gmail_recent" || tool.starts_with("gmail_") || tool.starts_with("propose_gmail_")
}

#[cfg(test)]
pub(in crate::agent_react) fn is_calendar_tool(tool: &str) -> bool {
    tool == "google_calendar_check" || tool.contains("calendar")
}

#[cfg(test)]
pub(in crate::agent_react) fn is_google_workspace_tool(tool: &str) -> bool {
    tool.starts_with("google_") || tool.starts_with("propose_google_")
}

#[cfg(test)]
pub(in crate::agent_react) fn is_workspace_file_tool(tool: &str) -> bool {
    matches!(
        tool,
        "list_files_in_directory" | "search_directory" | "read_file" | "preview_file"
    ) || tool.contains("file")
        || tool.contains("directory")
}

#[cfg(test)]
pub(in crate::agent_react) fn is_web_tool(tool: &str) -> bool {
    tool == "web_search" || tool.starts_with("web_")
}

#[cfg(test)]
pub(in crate::agent_react) fn is_media_preview_tool(tool: &str) -> bool {
    matches!(
        tool,
        "preview_random_media" | "preview_file" | "list_media_files"
    ) || tool.contains("media")
        || tool.starts_with("preview_")
}

#[cfg(test)]
#[cfg(test)]
pub(in crate::agent_react) fn tool_allowed_for_route_kind(
    call: &ToolCall,
    route: Option<ToolRoute>,
) -> Result<(), String> {
    match route {
        Some(ToolRoute::Gmail) => {
            if is_gmail_tool(&call.tool) {
                Ok(())
            } else {
                Err(format!(
                    "{} is not relevant to a mail request. Use Gmail tools for mailbox tasks.",
                    call.tool
                ))
            }
        }
        Some(ToolRoute::Calendar) => {
            if is_calendar_tool(&call.tool) {
                Ok(())
            } else {
                Err(format!(
                    "{} is not relevant to a calendar request. Use calendar tools for schedule tasks.",
                    call.tool
                ))
            }
        }
        Some(ToolRoute::Weather) => {
            if call.tool == "weather_forecast" {
                Ok(())
            } else {
                Err(format!(
                    "{} is not relevant to a weather request. Use weather_forecast for forecast and rain questions.",
                    call.tool
                ))
            }
        }
        Some(ToolRoute::GoogleWorkspace) => {
            if is_google_workspace_tool(&call.tool) {
                Ok(())
            } else {
                Err(format!(
                    "{} is not relevant to a Google Workspace request. Use Drive, Docs, Sheets, or Google Workspace tools.",
                    call.tool
                ))
            }
        }
        Some(ToolRoute::FileSearch) => {
            if is_workspace_file_tool(&call.tool) {
                Ok(())
            } else {
                Err(format!(
                    "{} is not relevant to a workspace file search request. Use file tools for workspace searches.",
                    call.tool
                ))
            }
        }
        Some(ToolRoute::WebSearch) => {
            if is_web_tool(&call.tool) {
                Ok(())
            } else {
                Err(format!(
                    "{} is not relevant to a web search request. Use web_search for external information lookups.",
                    call.tool
                ))
            }
        }
        Some(ToolRoute::MediaPreview) => {
            if is_media_preview_tool(&call.tool) {
                Ok(())
            } else {
                Err(format!(
                    "{} is not relevant to a media preview request.",
                    call.tool
                ))
            }
        }
        None => {
            if is_gmail_tool(&call.tool)
                || is_calendar_tool(&call.tool)
                || call.tool == "weather_forecast"
                || is_google_workspace_tool(&call.tool)
                || is_workspace_file_tool(&call.tool)
                || is_web_tool(&call.tool)
                || is_media_preview_tool(&call.tool)
            {
                Err(format!(
                    "{} is not relevant to this request. No matching tool route was detected.",
                    call.tool
                ))
            } else {
                Ok(())
            }
        }
    }
}

#[cfg(test)]
pub(in crate::agent_react) fn tool_allowed_for_route(
    call: &ToolCall,
    user_text: &str,
) -> Result<(), String> {
    tool_allowed_for_route_kind(call, route_for_request(user_text))
}

pub(in crate::agent_react) fn tool_allowed_for_context(
    call: &ToolCall,
    messages: &[ReactChatMessage],
) -> Result<(), String> {
    let latest_text = latest_user_text(messages);
    if request_wants_explanation_only(&latest_text) {
        return Err(format!(
            "{} is not relevant here. The user is asking for an explanation of the current conversation, not a new lookup.",
            call.tool
        ));
    }
    if call.tool == "propose_image_generation"
        && recent_image_context(messages)
        && request_looks_like_image_edit_follow_up(&latest_text)
    {
        return Ok(());
    }
    if call.tool == "propose_image_generation" {
        return Ok(());
    }
    Ok(())
}
