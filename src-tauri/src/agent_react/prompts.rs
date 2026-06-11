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

pub(super) fn reasoning_style_prompt(thinking_enabled: bool) -> &'static str {
    if thinking_enabled {
        "Reasoning style: think briefly before choosing an action. Keep private reasoning compact and useful; do not repeat the same plan."
    } else {
        "Do not expose chain-of-thought. Decide internally, then answer naturally."
    }
}
