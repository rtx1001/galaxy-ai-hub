# Model Reminder

Use this before starting substantial work in this project.

Default:
`GPT-5.4` with `Medium`

Use `GPT-5.4` with `High` for:
- agent loop changes
- Rust/Tauri backend changes
- tool routing
- risky refactors
- debugging with cross-file behavior

Use `GPT-5.5` with `High` only for:
- hard bugs that remain unresolved after normal investigation
- architecture decisions with broad impact
- high-risk changes where a mistake could damage behavior across the app

Avoid unless the task is trivial:
- `Low`

Use `Low` only for:
- UI-only polish
- copy/text changes
- simple styling tweaks
- reading files and summarizing
- straightforward commands
- tiny single-file edits with obvious scope and low risk

Do not use `Low` for:
- Rust/Tauri backend changes
- agent behavior
- tool calling or routing
- state management bugs
- multi-file refactors
- anything that can silently break behavior

Avoid unless we are stuck:
- `Extra High`

Rule:
Before doing substantial work, first state which model/intelligence level fits the task.
