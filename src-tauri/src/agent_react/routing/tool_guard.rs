use super::*;

pub(in crate::agent_react) fn tool_allowed_for_context(
    call: &ToolCall,
    messages: &[ReactChatMessage],
    context_block: &str,
) -> Result<(), String> {
    if call.tool == "propose_image_generation" {
        let mode = call
            .arguments
            .get("mode")
            .and_then(Value::as_str)
            .map(normalize_image_mode)
            .unwrap_or_else(|| "text_image".to_string());
        let refs = normalize_image_reference_sources(call.arguments.get("reference_sources"));
        let has_chat_image =
            recent_image_context(messages) || context_block_has_chat_image_reference(context_block);
        if mode == "image_image" && !has_chat_image {
            return Err(
                "image_image cannot be used because no attached, pasted, generated, found, or prior chat image is available. Use a profile image mode or text_image if appropriate."
                    .to_string(),
            );
        }
        if refs.iter().any(|source| source == "chat_image") && !has_chat_image {
            return Err(
                "chat_image was requested as a reference, but no chat image is available in the current conversation."
                    .to_string(),
            );
        }
    }
    Ok(())
}
