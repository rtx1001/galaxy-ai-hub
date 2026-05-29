use super::*;

pub(super) fn app_root() -> PathBuf {
    crate::app_paths::app_root_dir()
}

pub(super) fn read_master_system_prompt() -> String {
    let path = app_root().join("config").join("system_prompt.md");
    std::fs::read_to_string(path).unwrap_or_else(|_| {
        "You are Galaxy AI Hub, an Autonomous Operating Agent. Use tools for real data. Keep final answers concise.".to_string()
    })
}

pub(super) fn tool_protocol_prompt() -> String {
    [
        "Tool protocol:",
        "- Use tools when the user asks for current data, files, media, Google/Gmail/Calendar/Contacts, web lookup, image generation, file changes, or local actions.",
        "- If a tool is needed, emit exactly one structured tool call and stop. Do not describe or narrate the call.",
        "- Preferred format is native OpenAI-compatible tool_calls. If native tool_calls are unavailable, output exactly: <tool_call>{\"name\":\"tool_name\",\"arguments\":{...}}</tool_call>",
        "- Never invent tool results. Final answers must be based only on the returned tool observation.",
        "- Destructive or write actions must use propose_* tools and wait for approval.",
        "- If no tool is needed, answer normally without mentioning tools.",
    ]
    .join("\n")
}
