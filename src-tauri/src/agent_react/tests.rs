use super::*;
use serde_json::json;

#[test]
fn fixed_tool_registry_uses_exact_public_tool_names() {
    let names = available_tool_names();
    assert!(names.contains(&"weather_forecast"));
    assert!(names.contains(&"preview_random_media"));
    assert!(names.contains(&"propose_image_generation"));
    assert!(names.contains(&"google_calendar_check"));
    assert!(!names.contains(&"weather_lookup"));
    assert!(!names.contains(&"avatar_to_image"));
}

#[test]
fn invalid_tool_alias_is_not_repaired() {
    let error = validate_tool_call(&ToolCall {
        tool: "avatar_to_image".to_string(),
        arguments: json!({
            "prompt": "A portrait of the current assistant.",
            "mode": "bot_image"
        }),
    })
    .expect_err("unknown tool names must stay invalid");
    assert!(error.contains("Unknown tool"));
}

#[test]
fn image_generation_modes_are_current_ui_names() {
    for mode in [
        "text_image",
        "image_image",
        "bot_image",
        "user_image",
        "user_bot_image",
    ] {
        let proposal = parse_image_proposal(&ToolCall {
            tool: "propose_image_generation".to_string(),
            arguments: json!({
                "prompt": "A cinematic portrait with soft natural light.",
                "mode": mode
            }),
        })
        .expect("valid image proposal");
        assert_eq!(proposal.mode, mode);
    }
}

#[test]
fn image_generation_rejects_unknown_modes() {
    let error = validate_tool_call(&ToolCall {
        tool: "propose_image_generation".to_string(),
        arguments: json!({
            "mode": "character_avatar",
            "prompt": "A cinematic portrait using the selected profile reference."
        }),
    })
    .expect_err("unknown image mode must be rejected");
    assert!(error.contains("Image generation mode must be one of"));
}

#[test]
fn image_reference_sources_are_deduped_and_normalized() {
    let proposal = parse_image_proposal(&ToolCall {
        tool: "propose_image_generation".to_string(),
        arguments: json!({
            "mode": "image_image",
            "prompt": "A warm street scene with the selected user and the person from the prior chat image.",
            "reference_sources": ["chat_image", "user_avatar", "chat_image"]
        }),
    })
    .expect("image proposal");

    assert_eq!(proposal.mode, "image_image");
    assert_eq!(
        proposal.reference_sources,
        vec!["chat_image".to_string(), "user_avatar".to_string()]
    );
}

#[test]
fn chat_attachment_is_not_allowed_as_workspace_file_path() {
    let call = ToolCall {
        tool: "preview_file".to_string(),
        arguments: json!({ "path": "[image attached]" }),
    };
    let error = validate_tool_call(&call).expect_err("chat attachment is not a file path");
    assert!(error.contains("Attached chat images"));
}

#[test]
fn image_image_requires_available_chat_image_context() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("Create a new image from this reference."),
    }];
    let call = ToolCall {
        tool: "propose_image_generation".to_string(),
        arguments: json!({
            "mode": "image_image",
            "prompt": "A clean edit of the provided visual reference.",
            "reference_sources": ["chat_image"]
        }),
    };
    let error = tool_allowed_for_context(&call, &messages, "").expect_err("missing chat image");
    assert!(error.contains("chat image") || error.contains("image_image"));
}

#[test]
fn image_image_accepts_durable_runtime_chat_image_context() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("Use the last picture as reference and put me beside her."),
    }];
    let call = ToolCall {
        tool: "propose_image_generation".to_string(),
        arguments: json!({
            "mode": "image_image",
            "prompt": "A realistic scene using the latest chat image as the visual reference.",
            "reference_sources": ["chat_image", "user_avatar"]
        }),
    };
    tool_allowed_for_context(
        &call,
        &messages,
        "Recent chat image reference: yes. Latest prior image path: D:\\AI\\Galaxy_Bot\\chat-inputs\\last.jpg.",
    )
    .expect("runtime context should preserve long-chat image availability");
}

#[test]
fn clean_tool_instruction_prevents_proactive_image_offers() {
    let instruction = super::clean_agent::clean_tool_instruction();
    assert!(instruction.contains("Do not offer or propose image generation proactively"));
    assert!(instruction.contains("only chatting"));
    assert!(instruction.contains("evidence must be an exact short quote"));
}

#[test]
fn companion_reply_boundary_prevents_unsolicited_capability_offers() {
    let instruction = super::clean_agent::companion_reply_boundary_prompt();
    assert!(instruction.contains("ordinary chat or roleplay"));
    assert!(instruction.contains("Do not end with unsolicited offers"));
    assert!(instruction.contains("create/edit images"));
    assert!(instruction.contains("Use capabilities only when the latest user directly asks"));
}

#[test]
fn model_text_sanitizer_removes_escaped_surrogates_and_box_glyphs() {
    let text = "Xin chào \\ud83d\\ude0a □ keep accents: Tiến";
    let clean = sanitize_model_text(text);
    assert!(!clean.contains("\\ud83d"));
    assert!(!clean.contains('□'));
    assert!(clean.contains("Tiến"));
}

#[test]
fn reasoning_style_is_compact_and_clarifies_uncertainty() {
    let instruction = reasoning_style_prompt(true);
    assert!(instruction.contains("think briefly"));
    assert!(instruction.contains("do not repeat"));
}

#[test]
fn exact_tool_call_markup_can_still_be_parsed_for_validation_tests() {
    let text =
        r#"<tool_call>{"name":"weather_forecast","arguments":{"location":"Hanoi"}}</tool_call>"#;
    let parsed = first_model_tool_call(&json!({}), text).expect("tool call");
    assert_eq!(parsed.0, "weather_forecast");
    assert_eq!(
        parsed.1.get("location").and_then(Value::as_str),
        Some("Hanoi")
    );
}
