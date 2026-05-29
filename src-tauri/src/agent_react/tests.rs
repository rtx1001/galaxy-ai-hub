use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_test_dir(label: &str) -> std::path::PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("galaxy_agent_{label}_{unique}"))
}

#[test]
fn rejects_unknown_tool_names() {
    let call = ToolCall {
        tool: "gmail_search_web".to_string(),
        arguments: json!({}),
    };
    assert!(validate_tool_call(&call).is_err());
}

#[test]
fn thinking_result_respects_toggle() {
    assert_eq!(thinking_result(false, "hidden reasoning"), None);
    assert_eq!(
        thinking_result(true, "hidden reasoning"),
        Some("hidden reasoning".to_string())
    );
    assert_eq!(thinking_result(true, "   "), None);
}

#[test]
fn chat_message_normalization_keeps_system_only_at_beginning() {
    let messages = vec![
        json!({ "role": "system", "content": "base" }),
        json!({ "role": "user", "content": "hello" }),
        json!({ "role": "assistant", "content": "hi" }),
        json!({ "role": "system", "content": "planner correction" }),
        json!({ "role": "developer", "content": "transport hint" }),
        json!({ "role": "user", "content": "continue" }),
    ];
    let normalized = normalize_chat_messages_for_templates(messages);
    assert_eq!(normalized.len(), 4);
    assert_eq!(
        normalized[0].get("role").and_then(Value::as_str),
        Some("system")
    );
    let system_text = normalized[0]
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    assert!(system_text.contains("base"));
    assert!(system_text.contains("planner correction"));
    assert!(system_text.contains("transport hint"));
    assert!(normalized
        .iter()
        .skip(1)
        .all(|message| message.get("role").and_then(Value::as_str) != Some("system")));
}

#[test]
fn tool_schema_and_validator_names_stay_in_sync() {
    let schema = tool_schema();
    let mut schema_names = schema
        .as_array()
        .expect("tool schema array")
        .iter()
        .filter_map(|tool| {
            tool.get("function")
                .and_then(|function| function.get("name"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    let mut available = AVAILABLE_TOOL_NAMES
        .iter()
        .map(|name| name.to_string())
        .collect::<Vec<_>>();
    schema_names.sort_unstable();
    available.sort_unstable();
    assert_eq!(schema_names, available);
}

#[test]
fn media_capability_exposes_only_media_preview_tools() {
    let tools = filtered_tool_schema(Some(ToolRoute::MediaPreview));
    let names = tools
        .as_array()
        .expect("tool schema array")
        .iter()
        .filter_map(|tool| {
            tool.get("function")
                .and_then(|function| function.get("name"))
                .and_then(Value::as_str)
        })
        .collect::<Vec<_>>();
    assert!(names.contains(&"preview_random_media"));
    assert!(names.contains(&"preview_file"));
    assert!(!names.contains(&"weather_forecast"));
    assert!(!names.contains(&"google_calendar_check"));
}

#[test]
fn invalid_music_tool_alias_repairs_to_random_audio_preview() {
    let repaired = repair_tool_call_for_capability(
        ToolCall {
            tool: "play_music".to_string(),
            arguments: json!({ "query": "random song" }),
        },
        Some(ToolRoute::MediaPreview),
        "open a random song",
    );
    assert_eq!(repaired.tool, "preview_random_media");
    assert_eq!(
        repaired.arguments.get("kind").and_then(Value::as_str),
        Some("audio")
    );
}

#[test]
fn qwen_reasoning_music_alias_repairs_without_raw_tool_markup() {
    let repaired = repair_tool_call_from_model_text(
        "I should call play_music for an audio file.",
        Some(ToolRoute::MediaPreview),
        "mở một bài hát ngẫu nhiên",
    )
    .expect("repaired tool call");
    assert_eq!(repaired.tool, "preview_random_media");
    assert_eq!(
        repaired.arguments.get("kind").and_then(Value::as_str),
        Some("audio")
    );
}

#[test]
fn planner_instruction_for_avatar_requests_exposes_image_modes_without_forcing_route() {
    let latest = "gửi ảnh của em cho anh xem";
    let state = derive_conversation_task_state(latest, None, None, false, false);
    let instruction = tool_planner_instruction(latest, &state, 0);
    assert!(instruction.contains("PRIVATE TOOL PLANNER"));
    assert!(instruction.contains("avatar_image"));
    assert!(instruction.contains("one structured tool call"));
}

#[test]
fn planner_instruction_allows_no_tool_for_normal_conversation() {
    let latest = "hôm nay em thế nào";
    let state = derive_conversation_task_state(latest, None, None, false, false);
    let instruction = tool_planner_instruction(latest, &state, 0);
    assert!(instruction.contains("NO_TOOL for normal conversation"));
    assert!(instruction.contains("Never write a user-facing answer"));
    assert!(instruction.contains("not isolated words"));
    assert!(instruction.contains("ask a short clarification"));
}

#[test]
fn reasoning_style_asks_for_brief_uncertainty_handling() {
    let instruction = reasoning_style_prompt(true);
    assert!(instruction.contains("think briefly"));
    assert!(instruction.contains("ask one short clarifying question"));
}

#[test]
fn task_state_centralizes_image_tool_requirement() {
    let latest = "create an image of a tiny glass house under rain";
    let state = derive_conversation_task_state(latest, None, None, false, false);
    assert!(state.requires_tool());
    assert!(state.image_required);
    assert_eq!(state.route_text(), "image generation");
    assert!(state
        .allowed_tool_names()
        .contains("propose_image_generation"));
}

#[test]
fn task_state_leaves_normal_chat_ungated() {
    let state = derive_conversation_task_state(
        "tell me why this plan feels risky",
        None,
        None,
        false,
        false,
    );
    assert!(!state.requires_tool());
    assert_eq!(state.route_text(), "none");
}

#[test]
fn vietnamese_image_generation_intent_uses_unicode_terms() {
    assert!(request_effectively_wants_image_generation(
        "em vẽ cho anh hình ảnh một cái lắc tay thật đẹp làm quà xem nào",
        None,
        false,
        false
    ));
    assert!(request_wants_avatar_image_generation(
        "em gửi ảnh của em đang ngồi trong ô tô cho anh xem"
    ));
}

#[test]
fn media_preview_followup_keeps_previous_media_route() {
    let messages = vec![
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("tìm cho anh 1 ảnh nào đó trong workspace cho anh xem"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Em đã tìm thấy và mở 20230904_112601.jpg cho anh.\nPath: D:\\Pics\\20230904_112601.jpg"),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("ảnh khác đi"),
            },
        ];
    assert_eq!(
        contextual_route_for_messages(&messages),
        Some(ToolRoute::MediaPreview)
    );
}

#[test]
fn thai_song_correction_keeps_media_route() {
    let messages = vec![
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("mở bài hát nào đó có tiếng Thái Lan đi"),
        },
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!(
                "Em đã tìm thấy và mở 09 Retro.m4a cho anh.\nPath: D:\\Music\\09 Retro.m4a"
            ),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("bài hát tiếng Thái Lan cơ mà"),
        },
    ];
    assert_eq!(
        contextual_route_for_messages(&messages),
        Some(ToolRoute::MediaPreview)
    );
}

#[test]
fn user_text_language_terms_do_not_force_media_constraints() {
    let terms = media_constraint_terms("mở bài hát tiếng Thái Lan khác đi", None);
    assert!(
        terms.is_empty(),
        "language phrases in user text should not become hard-coded media filters: {:?}",
        terms
    );
}

#[test]
fn explicit_media_query_builds_simple_filename_constraints() {
    let terms = media_constraint_terms("", Some("Thais"));
    assert!(terms.iter().any(|term| term == "thais"));
    let thai_file = file_tools::FileSearchResult {
        path: "D:\\Music\\Thais\\001.ลมหนาว.mp3".to_string(),
        name: "001.ลมหนาว.mp3".to_string(),
        folder: "D:\\Music\\Thais".to_string(),
        extension: "mp3".to_string(),
        size_bytes: 100,
    };
    let other_file = file_tools::FileSearchResult {
        path: "D:\\Music\\Pop\\song.mp3".to_string(),
        name: "song.mp3".to_string(),
        folder: "D:\\Music\\Pop".to_string(),
        extension: "mp3".to_string(),
        size_bytes: 100,
    };
    assert!(media_matches_constraints(&thai_file, &terms));
    assert!(!media_matches_constraints(&other_file, &terms));
}

#[test]
fn explicit_vietnamese_media_query_builds_simple_filename_constraints() {
    let terms = media_constraint_terms("mở cho anh một bài hát tiếng Việt khác đi", None);
    assert!(terms.is_empty());
    let terms = media_constraint_terms("", Some("Viet"));
    assert!(terms.iter().any(|term| term == "viet"));
    let vietnamese_file = file_tools::FileSearchResult {
        path: "D:\\Music\\My Viet fav\\Em ke anh nghe - Linh Phi.mp3".to_string(),
        name: "Em ke anh nghe - Linh Phi.mp3".to_string(),
        folder: "D:\\Music\\My Viet fav".to_string(),
        extension: "mp3".to_string(),
        size_bytes: 100,
    };
    let other_file = file_tools::FileSearchResult {
        path: "D:\\Music\\Pop\\song.mp3".to_string(),
        name: "song.mp3".to_string(),
        folder: "D:\\Music\\Pop".to_string(),
        extension: "mp3".to_string(),
        size_bytes: 100,
    };
    assert!(media_matches_constraints(&vietnamese_file, &terms));
    assert!(!media_matches_constraints(&other_file, &terms));
}

#[test]
fn english_media_request_does_not_invent_language_filter() {
    let terms = media_constraint_terms("play an English song for me", None);
    assert!(
        terms.is_empty(),
        "English-language phrasing should not become a hidden filename filter: {:?}",
        terms
    );
    let terms = media_constraint_terms("", Some("Rock"));
    let english_file = file_tools::FileSearchResult {
        path: "D:\\Music\\Rock\\05 - My Way.MP3".to_string(),
        name: "05 - My Way.MP3".to_string(),
        folder: "D:\\Music\\Rock".to_string(),
        extension: "mp3".to_string(),
        size_bytes: 100,
    };
    let thai_file = file_tools::FileSearchResult {
        path: "D:\\Music\\Thais\\001.ลมหนาว.mp3".to_string(),
        name: "001.ลมหนาว.mp3".to_string(),
        folder: "D:\\Music\\Thais".to_string(),
        extension: "mp3".to_string(),
        size_bytes: 100,
    };
    let vietnamese_file = file_tools::FileSearchResult {
        path: "D:\\Music\\Nhạc Việt\\Bài hát.mp3".to_string(),
        name: "Bài hát.mp3".to_string(),
        folder: "D:\\Music\\Nhạc Việt".to_string(),
        extension: "mp3".to_string(),
        size_bytes: 100,
    };
    assert!(media_matches_constraints(&english_file, &terms));
    assert!(!media_matches_constraints(&thai_file, &terms));
    assert!(!media_matches_constraints(&vietnamese_file, &terms));
}

#[test]
fn generic_song_query_does_not_filter_random_audio() {
    let terms = media_constraint_terms("mở cho anh một bài hát nào đó nghe đi", Some("bài hát"));
    assert!(
        terms.is_empty(),
        "generic media labels should not become filename constraints: {:?}",
        terms
    );
}

#[test]
fn search_result_can_be_promoted_to_audio_preview() {
    let root = temp_test_dir("audio_preview");
    std::fs::create_dir_all(&root).expect("create temp dir");
    let path = root.join("Get Down.mp3");
    std::fs::write(&path, b"not a real mp3 but previewable bytes").expect("write temp mp3");

    let result = file_tools::FileSearchResult {
        path: path.to_string_lossy().to_string(),
        name: "Get Down.mp3".to_string(),
        folder: root.to_string_lossy().to_string(),
        extension: "mp3".to_string(),
        size_bytes: 32,
    };
    let preview = first_previewable_search_result(
        &[result],
        &[root.to_string_lossy().to_string()],
        "find get down and play it",
    )
    .expect("audio preview");

    assert_eq!(preview.name, "Get Down.mp3");
    assert_eq!(preview.mime_type, "audio/mpeg");
    assert!(preview
        .data_url
        .unwrap_or_default()
        .starts_with("data:audio/mpeg;base64,"));

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn image_prompt_validator_requires_mainly_english_prompt() {
    let call = ToolCall {
        tool: "propose_image_generation".to_string(),
        arguments: json!({
            "prompt": "Jasmine đang ngồi tắm suối nước nóng, phong cách ảnh chân thực",
            "mode": "avatar_image"
        }),
    };
    assert!(validate_tool_call(&call).is_err());

    let call = ToolCall {
        tool: "propose_image_generation".to_string(),
        arguments: json!({
            "prompt": "A photorealistic image of Jasmine sitting in a hot spring with natural lighting.",
            "mode": "avatar_image"
        }),
    };
    assert!(validate_tool_call(&call).is_ok());

    let call = ToolCall {
        tool: "propose_image_generation".to_string(),
        arguments: json!({
            "prompt": "A cinematic portrait of Tiến sitting inside a futuristic supercar in Hà Nội at night, dramatic neon reflections, confident mood.",
            "mode": "user_avatar_image"
        }),
    };
    assert!(validate_tool_call(&call).is_ok());

    let call = ToolCall {
        tool: "propose_image_generation".to_string(),
        arguments: json!({
            "prompt": "A cyberpunk poster for nhân vật Linsey, with the Vietnamese title text 'Đêm tốc độ' glowing on the wall.",
            "mode": "text_to_image"
        }),
    };
    assert!(validate_tool_call(&call).is_ok());
}

#[test]
fn user_avatar_image_requests_select_user_avatar_modes() {
    assert!(request_wants_user_avatar_image_generation(
        "tạo ảnh từ avatar anh đang ngồi trong quán cà phê"
    ));
    assert!(request_targets_user_and_character_images(
        "tạo ảnh anh và em đang đi dạo ngoài phố"
    ));
}

#[test]
fn image_request_requires_planner_tool_call() {
    assert!(request_effectively_wants_image_generation(
        "em vẽ cho anh hình ảnh một cái lắc tay thật đẹp làm quà xem nào",
        None,
        false,
        false,
    ));
    assert!(!request_effectively_wants_image_generation(
        "anh cần ảnh đường phố nhà cửa hiện đại đổ nát",
        None,
        false,
        false,
    ));
}

#[test]
fn image_generation_request_is_not_misrouted_as_media_preview() {
    let text = "hay bây giờ em tạo ảnh khác ở khu vực hồ gươm, nhìn thấy hồ gươm anh xem";
    assert!(request_effectively_wants_image_generation(
        text, None, true, false
    ));
    assert_eq!(route_for_request(text), None);
}

#[test]
fn leaked_tool_markup_is_parseable_for_protocol_repair() {
    let text = r#"<|tool_call>call:propose_image_generation{"prompt":"A view of Hoan Kiem Lake in Hanoi.","mode":"text_to_image"}<tool_call|>"#;
    let parsed = first_model_tool_call(&json!({}), text).expect("tool call");
    assert_eq!(parsed.0, "propose_image_generation");
    assert_eq!(
        parsed.1.get("prompt").and_then(Value::as_str),
        Some("A view of Hoan Kiem Lake in Hanoi.")
    );
}

#[test]
fn thinking_append_deduplicates_repeated_blocks() {
    let mut thinking = String::new();
    append_thinking(&mut thinking, "Plan image tool.\n\nPlan image tool.");
    append_thinking(&mut thinking, "Plan image tool.");
    assert_eq!(thinking.matches("Plan image tool.").count(), 1);
}

#[test]
fn planner_sampling_is_deterministic_without_changing_repeat_controls() {
    let sampling = SamplingConfig {
        temperature: 0.8,
        top_k: 40,
        top_p: 0.9,
        min_p: 0.1,
        repeat_last_n: 128,
        repeat_penalty: 1.15,
    };
    let planned = planner_sampling(sampling);
    assert_eq!(planned.temperature, 0.0);
    assert_eq!(planned.top_k, 1);
    assert_eq!(planned.repeat_last_n, 128);
    assert_eq!(planned.repeat_penalty, 1.15);
}

#[test]
fn route_guard_allows_future_tools_by_category() {
    let gmail = ToolCall {
        tool: "gmail_search".to_string(),
        arguments: json!({}),
    };
    let calendar = ToolCall {
        tool: "propose_calendar_update".to_string(),
        arguments: json!({}),
    };
    let google = ToolCall {
        tool: "google_drive_read".to_string(),
        arguments: json!({}),
    };
    let media = ToolCall {
        tool: "preview_workspace_media".to_string(),
        arguments: json!({}),
    };
    assert!(tool_allowed_for_route_kind(&gmail, Some(ToolRoute::Gmail)).is_ok());
    assert!(tool_allowed_for_route_kind(&calendar, Some(ToolRoute::Calendar)).is_ok());
    assert!(tool_allowed_for_route_kind(&google, Some(ToolRoute::GoogleWorkspace)).is_ok());
    assert!(tool_allowed_for_route_kind(&media, Some(ToolRoute::MediaPreview)).is_ok());
}

#[test]
fn attaches_user_text_to_tool_arguments() {
    let call = ToolCall {
        tool: "gmail_recent".to_string(),
        arguments: json!({ "count": 3 }),
    };
    let call = with_user_text(call, "kiem tra mail");
    assert_eq!(
        call.arguments.get("_user_text").and_then(Value::as_str),
        Some("kiem tra mail")
    );
}

#[test]
fn gmail_card_preserves_verified_message_ids_and_links() {
    let messages = vec![google_calendar::GoogleMailMessage {
        id: "msg-1".to_string(),
        thread_id: "thread-1".to_string(),
        subject: "Subject".to_string(),
        from: "sender@example.com".to_string(),
        date: "Today".to_string(),
        internal_date: Some(123),
        snippet: "Preview".to_string(),
        web_link: "https://mail.google.com/mail/u/0/#inbox/msg-1".to_string(),
    }];
    let card = gmail_card(&messages);
    assert_eq!(card.items.len(), 1);
    assert_eq!(
        card.items[0].url.as_deref(),
        Some("https://mail.google.com/mail/u/0/#inbox/msg-1")
    );
    assert!(card.items[0]
        .details
        .iter()
        .any(|field| field.label == "Message ID" && field.value == "msg-1"));
}

#[test]
fn verified_gmail_answer_uses_card_data() {
    let messages = vec![google_calendar::GoogleMailMessage {
        id: "msg-1".to_string(),
        thread_id: "thread-1".to_string(),
        subject: "Real subject".to_string(),
        from: "sender@example.com".to_string(),
        date: "Today".to_string(),
        internal_date: Some(123),
        snippet: "Real preview".to_string(),
        web_link: "https://mail.google.com/mail/u/0/#inbox/msg-1".to_string(),
    }];
    let cards = vec![gmail_card(&messages)];
    let answer = verified_answer_from_cards(&cards, "fallback", "show 1 email");
    assert!(answer.contains("Real subject"));
    assert!(answer.contains("sender@example.com"));
    assert!(!answer.contains("fallback"));
}

#[test]
fn calendar_card_preserves_verified_event_ids() {
    let events = vec![google_calendar::GoogleCalendarEvent {
        id: "event-1".to_string(),
        title: "Meeting".to_string(),
        start: "2026-06-01T09:00:00+07:00".to_string(),
        end: "2026-06-01T10:00:00+07:00".to_string(),
        all_day: false,
        location: Some("Office".to_string()),
        description: None,
        html_link: Some("https://calendar.google.com/event?eid=1".to_string()),
    }];
    let card = calendar_card(&events);
    assert_eq!(card.items.len(), 1);
    assert!(card.items[0]
        .details
        .iter()
        .any(|field| field.label == "Event ID" && field.value == "event-1"));
}

#[test]
fn routes_mailbox_to_gmail_hint() {
    assert_eq!(
        route_for_request("check my mailbox and show 5 newest mails"),
        Some(ToolRoute::Gmail)
    );
}

#[test]
fn routes_workspace_search_to_file_search_hint() {
    assert_eq!(
        route_for_request("find file report in workspace"),
        Some(ToolRoute::FileSearch)
    );
}

#[test]
fn routes_external_info_lookup_to_web_search_hint() {
    assert_eq!(
        route_for_request("search web for apartment prices in hanoi 2026"),
        Some(ToolRoute::WebSearch)
    );
}

#[test]
fn routes_google_workspace_requests_to_google_workspace_hint() {
    assert_eq!(
        route_for_request("find the Google Sheet budget 2026 in Drive"),
        Some(ToolRoute::GoogleWorkspace)
    );
}

#[test]
fn routes_google_contacts_requests_to_google_workspace_hint() {
    assert_eq!(
        route_for_request("show my Google contacts list"),
        Some(ToolRoute::GoogleWorkspace)
    );
}

#[test]
fn routes_audio_request_to_media_preview_hint() {
    assert_eq!(
        route_for_request("mở một file âm thanh bất kỳ"),
        Some(ToolRoute::MediaPreview)
    );
}

#[test]
fn conversational_vietnamese_nghe_particle_does_not_route_to_audio() {
    let text = "chị Linh cần gì thì nhớ hỗ trợ nghe chưa em";
    assert_eq!(inferred_media_kind(text), None);
    assert_eq!(route_for_request(text), None);
    assert!(!random_media_preview_allowed(text, false));
}

#[test]
fn conversational_vietnamese_nghe_particle_does_not_keyword_block_model_tool_call() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("chị Linh cần gì thì nhớ hỗ trợ nghe chưa em"),
    }];
    let call = ToolCall {
        tool: "preview_random_media".to_string(),
        arguments: json!({ "kind": "audio" }),
    };
    assert!(tool_allowed_for_context(&call, &messages).is_ok());
}

#[test]
fn explicit_vietnamese_music_request_still_routes_to_audio() {
    assert_eq!(
        route_for_request("mở bài hát cho anh nghe"),
        Some(ToolRoute::MediaPreview)
    );
    assert_eq!(
        route_for_request("cho anh nghe một bài nhạc bất kỳ"),
        Some(ToolRoute::MediaPreview)
    );
}

#[test]
fn deterministic_preview_routes_broad_audio_without_model_text() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("em mở một bài hát bất kỳ trong workspace đi"),
    }];
    let call = deterministic_preview_call(&messages).expect("deterministic preview call");
    assert_eq!(call.tool, "preview_random_media");
    assert_eq!(
        call.arguments.get("kind").and_then(Value::as_str),
        Some("audio")
    );
}

#[test]
fn detects_unexecuted_tool_narration_as_not_verified_answer() {
    assert!(looks_like_unexecuted_tool_narration(
        "*Calling preview_random_media for audio...*\n[Bai hat will be displayed here]"
    ));
    assert!(looks_like_unexecuted_tool_narration(
        "Em sẽ gọi hàm preview_random_media rồi hiển thị kết quả tool."
    ));
    assert!(!looks_like_unexecuted_tool_narration(
        "Dạ, em đã mở bài hát này cho anh."
    ));
}

#[test]
fn deterministic_preview_uses_previous_kind_for_another_request() {
    let messages = vec![
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("em mở một bài hát bất kỳ"),
        },
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!(
                r"File preview shown in this conversation:
Title: song.mp3
Type: audio/mpeg
Path: D:\Music\song.mp3"
            ),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("mở bài khác đi"),
        },
    ];
    let call = deterministic_preview_call(&messages).expect("deterministic preview call");
    assert_eq!(
        call.arguments.get("kind").and_then(Value::as_str),
        Some("audio")
    );
    let excludes = call
        .arguments
        .get("exclude_paths")
        .and_then(Value::as_array)
        .expect("exclude paths");
    assert_eq!(
        excludes.first().and_then(Value::as_str),
        Some(r"D:\Music\song.mp3")
    );
}

#[test]
fn model_chosen_media_followup_is_enriched_from_preview_context() {
    let messages = vec![
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("mở một bài hát ngẫu nhiên trong workspace đi"),
        },
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!(
                r"File preview shown in this conversation:
Title: song.mp3
Type: audio/mpeg
Path: D:\Music\song.mp3"
            ),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("bài khác đi"),
        },
    ];
    assert!(deterministic_preview_call(&messages).is_none());
    let call = enrich_contextual_tool_call(
        ToolCall {
            tool: "preview_random_media".to_string(),
            arguments: json!({ "kind": "any" }),
        },
        &messages,
        "bài khác đi",
    );
    assert_eq!(call.tool, "preview_random_media");
    assert_eq!(
        call.arguments.get("kind").and_then(Value::as_str),
        Some("audio")
    );
    assert_eq!(
        call.arguments
            .get("_preview_context")
            .and_then(Value::as_str),
        Some("follow_up")
    );
    assert_eq!(
        call.arguments
            .get("exclude_paths")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(Value::as_str),
        Some(r"D:\Music\song.mp3")
    );
}

#[test]
fn accented_image_request_overrides_previous_audio_context() {
    let messages = vec![
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("mở một bài hát bất kỳ"),
        },
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!(
                r"File preview shown in this conversation:
Title: song.mp3
Type: audio/mpeg
Path: D:\Music\song.mp3"
            ),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("mở ảnh khác"),
        },
    ];
    let call = deterministic_preview_call(&messages).expect("deterministic preview call");
    assert_eq!(call.tool, "preview_random_media");
    assert_eq!(
        call.arguments.get("kind").and_then(Value::as_str),
        Some("image")
    );
}

#[test]
fn assistant_self_image_request_is_avatar_generation_not_media_preview() {
    let text = "send me your picture in a bathtub";
    assert!(request_wants_avatar_image_generation(text));
    assert_eq!(route_for_request(text), None);
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!(text),
    }];
    assert!(deterministic_preview_call(&messages).is_none());
    let media_call = with_user_text(
        ToolCall {
            tool: "preview_random_media".to_string(),
            arguments: json!({ "kind": "image" }),
        },
        text,
    );
    assert!(tool_allowed_for_context(&media_call, &messages).is_ok());
}

#[test]
fn assistant_self_image_request_keeps_model_selected_avatar_mode() {
    let call = with_user_text(
        ToolCall {
            tool: "propose_image_generation".to_string(),
            arguments: json!({
                "mode": "avatar_image",
                "prompt": "Jasmine in a cinematic bathtub portrait"
            }),
        },
        "send me your picture in a bathtub",
    );
    let proposal = parse_image_proposal(&call).expect("image proposal");
    assert_eq!(proposal.mode, "avatar_image");
}

#[test]
fn correction_with_bao_and_anh_stays_media_not_weather() {
    let text = "anh bảo mở ảnh cơ mà";
    assert_eq!(inferred_media_kind(text), Some("image"));
    assert_eq!(route_for_request(text), Some(ToolRoute::MediaPreview));
    assert!(!request_mentions_weather(text));
}

#[test]
fn accented_vietnamese_weather_keeps_tone_distinctions() {
    assert!(request_mentions_weather("ngoài đó có bão không?"));
    assert_eq!(
        route_for_request("dự báo thời tiết Hà Nội hôm nay"),
        Some(ToolRoute::Weather)
    );
    assert!(!request_mentions_weather("anh bảo em mở ảnh cơ mà"));
}

#[test]
fn deterministic_preview_does_not_randomize_named_file_open() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("open the file named report.pdf"),
    }];
    assert!(deterministic_preview_call(&messages).is_none());
}

#[test]
fn deterministic_preview_does_not_treat_article_summary_as_media() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("tong hop thong tin cac bai tren lai cho anh mot cach ngan gon"),
    }];
    assert!(deterministic_preview_call(&messages).is_none());
    assert!(!random_media_preview_allowed(
        "tong hop thong tin cac bai tren lai cho anh mot cach ngan gon",
        false
    ));
}

#[test]
fn random_media_preview_follow_up_requires_explicit_context() {
    assert!(!random_media_preview_allowed("ok", false));
    assert!(random_media_preview_allowed("ok", true));
}

#[test]
fn deterministic_gmail_routes_recent_mail_requests() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("5 mail gần nhất là được rồi"),
    }];
    let call = deterministic_gmail_call(&messages).expect("deterministic gmail call");
    assert_eq!(call.tool, "gmail_recent");
    assert_eq!(call.arguments.get("count").and_then(Value::as_u64), Some(5));
}

#[test]
fn deterministic_calendar_routes_read_requests() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("check my schedule today"),
    }];
    let call = deterministic_calendar_call(&messages).expect("deterministic calendar call");
    assert_eq!(call.tool, "google_calendar_check");
    let expected = Local::now().date_naive().format("%Y-%m-%d").to_string();
    assert_eq!(
        call.arguments.get("date").and_then(Value::as_str),
        Some(expected.as_str())
    );
}

#[test]
fn deterministic_calendar_routes_month_requests() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("kiểm tra lịch trình tháng 6"),
    }];
    let call = deterministic_calendar_call(&messages).expect("deterministic calendar call");
    assert_eq!(call.tool, "google_calendar_check");
    let expected = format!("{}-06", Local::now().year());
    assert_eq!(
        call.arguments.get("date").and_then(Value::as_str),
        Some(expected.as_str())
    );
}

#[test]
fn deterministic_calendar_leaves_write_requests_for_approval_path() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("add a calendar event tomorrow at 9"),
    }];
    assert!(deterministic_calendar_call(&messages).is_none());
}

#[test]
fn deterministic_web_search_routes_external_lookup_requests() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("search web for apartment prices in hanoi 2026"),
    }];
    let call = deterministic_web_search_call(&messages).expect("deterministic web search call");
    assert_eq!(call.tool, "web_search");
    assert_eq!(
        call.arguments.get("query").and_then(Value::as_str),
        Some("search web for apartment prices in hanoi 2026")
    );
}

#[test]
fn contextual_route_keeps_weather_location_followup_in_weather_lane() {
    let messages = vec![
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("anh cần thông tin cụ thể thời tiết 7 ngày tới"),
        },
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!("Cần khu vực cụ thể."),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("ở Hà Nội em nhé"),
        },
    ];
    assert_eq!(
        contextual_route_for_messages(&messages),
        Some(ToolRoute::Weather)
    );
    let call = deterministic_weather_call(&messages).expect("deterministic weather call");
    assert_eq!(call.tool, "weather_forecast");
    assert_eq!(
        call.arguments.get("location").and_then(Value::as_str),
        Some("Hà Nội")
    );
}

#[test]
fn contextual_route_blocks_media_tool_for_weather_followup() {
    let messages = vec![
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("dự báo thời tiết 7 ngày tới ở Hà Nội"),
        },
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!("Co the tim tren web."),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("oke em xem rồi cho anh kết quả, đừng gửi link"),
        },
    ];
    let call = with_user_text(
        ToolCall {
            tool: "preview_random_media".to_string(),
            arguments: json!({ "kind": "image" }),
        },
        "oke em xem rồi cho anh kết quả, đừng gửi link",
    );
    assert_eq!(
        contextual_route_for_messages(&messages),
        Some(ToolRoute::Weather)
    );
    assert!(tool_allowed_for_context(&call, &messages).is_ok());
}

#[test]
fn deterministic_preview_does_not_hijack_weather_followup_after_media() {
    let messages = vec![
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("mở một bài hát bất kỳ trong workspace"),
        },
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!("Đã mở bài hát cho anh."),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("anh muốn biết thời tiết cuối tuần này thế nào?"),
        },
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!("Đã tìm thấy 5 nguồn web mới."),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("có mưa ko?"),
        },
    ];
    assert_eq!(
        contextual_route_for_messages(&messages),
        Some(ToolRoute::Weather)
    );
    assert!(deterministic_preview_call(&messages).is_none());
}

#[test]
fn deterministic_weather_uses_previous_location_for_rain_followup() {
    let messages = vec![
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("anh muốn biết thời tiết cuối tuần này ở Hà Nội"),
        },
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!("Đã có dữ liệu."),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("có mưa không?"),
        },
    ];
    let call = deterministic_weather_call(&messages).expect("deterministic weather call");
    assert_eq!(call.tool, "weather_forecast");
    assert_eq!(
        call.arguments.get("location").and_then(Value::as_str),
        Some("Hà Nội")
    );
    assert_eq!(call.arguments.get("days").and_then(Value::as_u64), Some(4));
}

#[test]
fn deterministic_weather_strips_vietnamese_question_tail_from_location() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("cũng được, em xem thời tiết cuối tuần này ở Hà Nội thế nào?"),
    }];
    let call = deterministic_weather_call(&messages).expect("deterministic weather call");
    assert_eq!(call.tool, "weather_forecast");
    assert_eq!(
        call.arguments.get("location").and_then(Value::as_str),
        Some("Hà Nội")
    );
    assert_eq!(call.arguments.get("days").and_then(Value::as_u64), Some(4));
}

#[test]
fn deterministic_weather_extracts_location_without_preposition() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("thời tiết Hà Nội ngày mai thế nào?"),
    }];
    let call = deterministic_weather_call(&messages).expect("deterministic weather call");
    assert_eq!(call.tool, "weather_forecast");
    assert_eq!(
        call.arguments.get("location").and_then(Value::as_str),
        Some("Hà Nội")
    );
    assert!(weather_missing_location_reply(&messages).is_none());
}

#[test]
fn weather_location_ignores_command_prefixes() {
    assert_eq!(
        weather_location_from_text("Check thời tiết Hà Nội hôm nay"),
        Some("Hà Nội".to_string())
    );
}

#[test]
fn weather_focus_date_detects_tomorrow_request() {
    let expected = Local::now().date_naive() + Duration::days(1);
    assert_eq!(
        weather_requested_focus_date(
            "Check th\u{1edd}i ti\u{1ebf}t H\u{00e0} N\u{1ed9}i ng\u{00e0}y mai."
        )
        .map(|item| item.0),
        Some(expected)
    );
    assert_eq!(
        weather_requested_focus_date("Check Hanoi weather tomorrow.").map(|item| item.0),
        Some(expected)
    );
}

#[test]
fn weather_request_without_location_does_not_guess_fake_location() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("em xem tuần sau thời tiết như thế nào?"),
    }];
    assert_eq!(
        contextual_route_for_messages(&messages),
        Some(ToolRoute::Weather)
    );
    assert!(deterministic_weather_call(&messages).is_none());
    assert!(weather_missing_location_reply(&messages).is_some());
}

#[test]
fn casual_weather_observation_stays_in_chat() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("hôm nay trời mưa xầm xì quá"),
    }];
    assert_eq!(route_for_request("hôm nay trời mưa xầm xì quá"), None);
    assert!(request_is_conversational_turn(
        "hôm nay trời mưa xầm xì quá"
    ));
    assert_eq!(
        weather_location_from_text("hôm nay trời mưa xầm xì quá"),
        None
    );
    assert_eq!(contextual_route_for_messages(&messages), None);
    assert!(deterministic_weather_call(&messages).is_none());
}

#[test]
fn bare_location_followup_after_weather_request_routes_weather() {
    let messages = vec![
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("em xem tuần sau thời tiết như thế nào?"),
        },
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!("Anh muốn xem thời tiết ở khu vực nào?"),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("Hà Nội nhé"),
        },
    ];
    assert_eq!(
        contextual_route_for_messages(&messages),
        Some(ToolRoute::Weather)
    );
    let call = deterministic_weather_call(&messages).expect("deterministic weather call");
    assert_eq!(
        call.arguments.get("location").and_then(Value::as_str),
        Some("Hà Nội")
    );
}

#[test]
fn short_emotional_reply_does_not_inherit_weather_route() {
    let messages = vec![
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("anh muốn biết thời tiết cuối tuần này ở Hà Nội"),
        },
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!("Đã có dữ liệu."),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("chán chết"),
        },
    ];
    assert_eq!(contextual_route_for_messages(&messages), None);
    assert!(deterministic_weather_call(&messages).is_none());
}

#[test]
fn greeting_does_not_become_weather_location_followup() {
    let messages = vec![
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("thời tiết ngày mai thế nào?"),
        },
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!("Anh muốn xem thời tiết ở khu vực nào?"),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("chào Jas"),
        },
    ];
    assert_eq!(contextual_route_for_messages(&messages), None);
    assert!(deterministic_weather_call(&messages).is_none());
}

#[test]
fn explanation_followup_blocks_web_search_tool_call() {
    let messages = vec![
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!("Thời tiết cuối tuần này ở Hà Nội sẽ có mưa nhiều."),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("thế lần sau em giải thích luôn cho anh dễ hiểu nhé"),
        },
    ];
    let call = with_user_text(
        ToolCall {
            tool: "web_search".to_string(),
            arguments: json!({ "query": "thế lần sau em giải thích luôn cho anh dễ hiểu nhé" }),
        },
        "thế lần sau em giải thích luôn cho anh dễ hiểu nhé",
    );
    assert!(tool_allowed_for_context(&call, &messages).is_err());
}

#[test]
fn conversational_turn_does_not_route_to_web_search() {
    assert_eq!(route_for_request("em có vui khi gặp anh ko"), None);
    assert!(request_is_conversational_turn("em có vui khi gặp anh ko"));
    assert!(!request_wants_web_search("em có vui khi gặp anh ko"));
}

#[test]
fn conversational_turn_does_not_keyword_block_model_tool_call() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("em có vui khi gặp anh ko"),
    }];
    let call = with_user_text(
        ToolCall {
            tool: "web_search".to_string(),
            arguments: json!({ "query": "em có vui khi gặp anh ko" }),
        },
        "em có vui khi gặp anh ko",
    );
    assert!(tool_allowed_for_context(&call, &messages).is_ok());
}

#[test]
fn parses_inline_tool_markup_for_web_search() {
    let parsed = parse_inline_tool_markup(
            r#"<tool_call>{"name":"web_search","arguments":{"query":"thời tiết Hà Nội tuần sau"}}</tool_call>"#,
        )
        .expect("parsed inline tool markup");
    assert_eq!(parsed.0, "web_search");
    assert_eq!(
        parsed.1.get("query").and_then(Value::as_str),
        Some("thời tiết Hà Nội tuần sau")
    );
}

#[test]
fn inline_tool_markup_recovers_prose_wrapped_calls() {
    let parsed = parse_inline_tool_markup(
            r#"I will call this now: <tool_call>{"name":"web_search","arguments":{"query":"x"}}</tool_call>"#,
        )
        .expect("parsed prose-wrapped tool markup");
    assert_eq!(parsed.0, "web_search");
    assert_eq!(parsed.1.get("query").and_then(Value::as_str), Some("x"));
}

#[test]
fn native_model_tool_call_is_parsed_without_assistant_text() {
    let message = json!({
        "role": "assistant",
        "content": null,
        "tool_calls": [{
            "id": "call_1",
            "type": "function",
            "function": {
                "name": "weather_forecast",
                "arguments": "{\"location\":\"Ha Noi\",\"days\":2}"
            }
        }]
    });
    let parsed = first_model_tool_call(&message, "").expect("native tool call");
    assert_eq!(parsed.0, "weather_forecast");
    assert_eq!(parsed.2, "call_1");
    assert!(parsed.3);
    assert_eq!(
        parsed.1.get("location").and_then(Value::as_str),
        Some("Ha Noi")
    );
    assert_eq!(parsed.1.get("days").and_then(Value::as_u64), Some(2));
}

#[test]
fn exact_fallback_tool_markup_is_parsed_without_prose() {
    let parsed = first_model_tool_call(
        &json!({ "role": "assistant", "content": null }),
        r#"<tool_call>{"name":"gmail_recent","arguments":{"count":3}}</tool_call>"#,
    )
    .expect("fallback tool call");
    assert_eq!(parsed.0, "gmail_recent");
    assert_eq!(parsed.1.get("count").and_then(Value::as_u64), Some(3));
    assert!(!parsed.3);
}

#[test]
fn prose_wrapped_tool_markup_is_recovered() {
    let text = r#"I will call this now: <tool_call>{"name":"web_search","arguments":{"query":"x"}}</tool_call>"#;
    let parsed = first_model_tool_call(&json!({}), text).expect("fallback tool call");
    assert_eq!(parsed.0, "web_search");
    assert_eq!(parsed.1.get("query").and_then(Value::as_str), Some("x"));
    assert!(!parsed.3);
}

#[test]
fn function_style_tool_code_is_recovered() {
    let text = r#"
Em gọi tool đây:
<tool_code>
propose_image_generation(mask_prompt="sky and clouds", mode="image_to_image", prompt="blue sky with white clouds")
</tool_code>
"#;
    let parsed = first_model_tool_call(&json!({}), text).expect("function style call");
    assert_eq!(parsed.0, "propose_image_generation");
    assert_eq!(
        parsed.1.get("mode").and_then(Value::as_str),
        Some("image_to_image")
    );
    assert_eq!(
        parsed.1.get("mask_prompt").and_then(Value::as_str),
        Some("sky and clouds")
    );
    assert!(!parsed.3);
}

#[test]
fn tagged_json_tool_call_with_description_is_recovered() {
    let text = r#"<tool_call>{"name":"propose_image_generation","arguments":{"description":"A neon supercar racing through rain at night."}}</tool_call>"#;
    let parsed = first_model_tool_call(&json!({}), text).expect("fallback tool call");
    assert_eq!(parsed.0, "propose_image_generation");
    let proposal = parse_image_proposal(&ToolCall {
        tool: parsed.0,
        arguments: parsed.1,
    })
    .expect("image proposal");
    assert_eq!(
        proposal.prompt,
        "A neon supercar racing through rain at night."
    );
    assert_eq!(proposal.mode, "text_to_image");
}

#[test]
fn malformed_reasoning_tool_call_is_recovered() {
    let message = json!({
        "role": "assistant",
        "content": "I can do that.",
        "reasoning_content": r#"<tool_call>call:propose_image_generation(mode:<"avatar_image<", prompt:<"full body character portrait">"#,
    });
    let parsed = first_model_tool_call(&message, "I can do that.").expect("reasoning tool call");
    assert_eq!(parsed.0, "propose_image_generation");
    assert_eq!(
        parsed.1.get("mode").and_then(Value::as_str),
        Some("avatar_image")
    );
    assert_eq!(
        parsed.1.get("prompt").and_then(Value::as_str),
        Some("full body character portrait")
    );
}

#[test]
fn malformed_angle_pipe_tool_call_is_recovered() {
    let text = r#"<|tool_call>call:propose_image_generation{"visual_prompt":"A portrait of Jasmine on a beach. Mode: avatar_image"}"#;
    let parsed = first_model_tool_call(&json!({}), text).expect("fallback tool call");
    assert_eq!(parsed.0, "propose_image_generation");
    assert_eq!(
        parsed.1.get("visual_prompt").and_then(Value::as_str),
        Some("A portrait of Jasmine on a beach. Mode: avatar_image")
    );
    let proposal = parse_image_proposal(&ToolCall {
        tool: parsed.0,
        arguments: parsed.1,
    })
    .expect("image proposal");
    assert_eq!(proposal.mode, "avatar_image");
    assert!(proposal.prompt.contains("Preserve the source image"));
    assert!(proposal
        .prompt
        .contains("A portrait of Jasmine on a beach. Mode: avatar_image"));
}

#[test]
fn gemma_pipe_call_tool_call_with_prompt_wrapper_is_recovered() {
    let text = r#"<|tool_call>call:propose_image_generation{prompt:<|"|>A neon supercar racing through rain at night.<|"|>}<tool_call|>"#;
    let parsed = first_model_tool_call(&json!({}), text).expect("fallback tool call");
    assert_eq!(parsed.0, "propose_image_generation");
    assert_eq!(
        parsed.1.get("prompt").and_then(Value::as_str),
        Some("A neon supercar racing through rain at night.")
    );
    let proposal = parse_image_proposal(&ToolCall {
        tool: parsed.0,
        arguments: parsed.1,
    })
    .expect("image proposal");
    assert_eq!(
        proposal.prompt,
        "A neon supercar racing through rain at night."
    );
}

#[test]
fn gemma_toolcall_without_underscore_and_compact_tool_name_is_recovered() {
    let text = r#"<|toolcall>call:proposeimagegeneration{prompt:<|"|>A romantic rainy night scene.<|"|>}<toolcall|>"#;
    let parsed = first_model_tool_call(&json!({}), text).expect("fallback tool call");
    assert_eq!(parsed.0, "propose_image_generation");
    assert_eq!(
        parsed.1.get("prompt").and_then(Value::as_str),
        Some("A romantic rainy night scene.")
    );
}

#[test]
fn malformed_prompt_wrappers_are_removed_from_image_prompt() {
    let proposal = parse_image_proposal(&ToolCall {
        tool: "propose_image_generation".to_string(),
        arguments: json!({
            "mode": "|\"|>avatar_image<|\"|",
            "prompt": "|\"|>A candid portrait of Jasmine reading a book.<|\"|>}<tool_call|"
        }),
    })
    .expect("image proposal");
    assert_eq!(proposal.mode, "avatar_image");
    assert!(proposal.prompt.contains("Preserve the source image"));
    assert!(proposal
        .prompt
        .contains("A candid portrait of Jasmine reading a book."));
}

#[test]
fn pending_image_proposal_is_parsed_from_serialized_context() {
    let parsed = parse_pending_image_proposal_text(
            "Pending image proposal awaiting approval:\nPrompt: Doraemon walking on the beach\nMode: avatar_image\nMask prompt: sky",
        )
        .expect("pending proposal");
    assert_eq!(parsed.prompt, "Doraemon walking on the beach");
    assert_eq!(parsed.mode, "avatar_image");
    assert_eq!(parsed.mask_prompt.as_deref(), Some("sky"));
}

#[test]
fn fake_tool_result_image_proposal_is_parsed_from_final_text() {
    let parsed = parse_pending_image_proposal_text(
            "Anh xem lại mô tả này nhé:\nTool result: Image creation request\nA supercar speeding along a beach at night.\nMode: text_to_image",
        )
        .expect("image proposal");
    assert_eq!(parsed.prompt, "A supercar speeding along a beach at night.");
    assert_eq!(parsed.mode, "text_to_image");
    assert_eq!(parsed.mask_prompt, None);
}

#[test]
fn image_to_image_prompt_preserves_source_context() {
    let call = ToolCall {
        tool: "propose_image_generation".to_string(),
        arguments: json!({
            "prompt": "add a realistic cowboy hat to the man",
            "mode": "image_to_image",
            "mask_prompt": "head and hair"
        }),
    };
    let proposal = parse_image_proposal(&call).expect("image proposal");
    assert!(proposal.prompt.contains("Preserve the source image"));
    assert!(proposal.prompt.contains("add a realistic cowboy hat"));
}

#[test]
fn recent_pending_image_proposal_is_reused_for_confirmation() {
    let messages = vec![
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!(
                    "I can create this image. Review the prompt below and approve it before I start.\nPending image proposal awaiting approval:\nPrompt: Doraemon climbing a mountain\nMode: text_to_image"
                ),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("ok"),
            },
        ];
    let proposal = recent_pending_image_proposal(&messages).expect("recent proposal");
    assert_eq!(proposal.prompt, "Doraemon climbing a mountain");
    assert!(request_effectively_wants_image_generation(
        "ok",
        Some(&proposal),
        false,
        false
    ));
}

#[test]
fn short_confirmation_reuses_recent_image_creation_context() {
    let messages = vec![
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("I can create a surreal image of a glowing dragon over a lake. Approve it when you are ready."),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("ok"),
            },
        ];
    assert!(recent_unresolved_image_creation_context(&messages));
    assert!(request_effectively_wants_image_generation(
        "ok",
        None,
        false,
        recent_unresolved_image_creation_context(&messages)
    ));
}

#[test]
fn older_image_proposal_is_not_pending_after_normal_assistant_reply() {
    let messages = vec![
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!(
                    "Pending image proposal awaiting approval:\nPrompt: A rainy tea table beside a stream\nMode: text_to_image"
                ),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("ý tưởng khác đi"),
            },
            ReactChatMessage {
                role: "assistant".to_string(),
                content: json!("Em có vài ý tưởng khác: cà phê, phố đêm, hoặc khu vườn nhỏ."),
            },
            ReactChatMessage {
                role: "user".to_string(),
                content: json!("cà phê đi"),
            },
        ];
    assert!(recent_pending_image_proposal(&messages).is_none());
}

#[test]
fn old_calendar_context_does_not_leak_into_image_feedback() {
    let messages = vec![
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("check lịch tháng này cho anh"),
        },
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!("Tháng này có vài sự kiện trong lịch của anh."),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("tạo ảnh một bát phở thật đẹp"),
        },
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!("Ảnh đã xong đây.\n[image attached]"),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("đây là bát bún đấy chứ có phải phở đâu"),
        },
    ];
    assert_eq!(contextual_route_for_messages(&messages), None);
    let call = ToolCall {
        tool: "google_calendar_check".to_string(),
        arguments: json!({ "date": "today" }),
    };
    assert!(tool_allowed_for_context(&call, &messages).is_ok());
}

#[test]
fn image_edit_followup_requires_image_tool_when_recent_image_exists() {
    let messages = vec![
        ReactChatMessage {
            role: "user".to_string(),
            content: json!([
                { "type": "text", "text": "edit this image" },
                { "type": "image_url", "image_url": { "url": "data:image/png;base64,abc" } }
            ]),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("oke em sửa đi"),
        },
    ];
    assert!(recent_image_context(&messages));
    assert!(request_effectively_wants_image_generation(
        "oke em sửa đi",
        None,
        recent_image_context(&messages),
        false
    ));
    let call = ToolCall {
        tool: "propose_image_generation".to_string(),
        arguments: json!({
            "prompt": "add a cowboy hat to the person",
            "mode": "image_to_image",
            "mask_prompt": "head and hair"
        }),
    };
    assert!(tool_allowed_for_context(&call, &messages).is_ok());
}

#[test]
fn image_generation_tool_call_is_allowed_for_visual_request() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("vẽ cho anh bức ảnh trời mưa ngồi uống trà thật thư thái đi"),
    }];
    let call = ToolCall {
        tool: "propose_image_generation".to_string(),
        arguments: json!({
            "prompt": "A peaceful rainy day scene with a person sitting calmly and drinking tea by a window.",
            "mode": "text_to_image"
        }),
    };
    assert!(tool_allowed_for_context(&call, &messages).is_ok());
}

#[test]
fn serialized_image_message_preserves_recent_image_context() {
    let serialized = r#"[{"type":"text","text":"Ảnh đã xong rồi đây."},{"type":"image_url","image_url":{"url":"","local_path":"D:\\AI\\Galaxy_Bot\\assistant-runtime\\sdcpp\\output\\galaxy-qwen.jpg"}}]"#;
    let messages = vec![ReactChatMessage {
        role: "assistant".to_string(),
        content: json!(serialized),
    }];
    assert!(content_text(&messages[0].content).contains("Ảnh đã xong"));
    assert!(content_text(&messages[0].content).contains("[image attached]"));
    assert!(recent_image_context(&messages));
    assert_eq!(
        chat_content_for_model(&messages[0]).as_str(),
        Some("Ảnh đã xong rồi đây.\n[image attached]")
    );
}

#[test]
fn invalid_native_tool_call_feedback_stays_internal_to_tool_loop() {
    let mut messages = Vec::new();
    push_tool_validation_error(
        &mut messages,
        "call_bad",
        true,
        "weather_forecast requires a non-empty location.".to_string(),
    );
    assert_eq!(messages.len(), 1);
    assert_eq!(
        messages[0].get("role").and_then(Value::as_str),
        Some("tool")
    );
    assert_eq!(
        messages[0].get("tool_call_id").and_then(Value::as_str),
        Some("call_bad")
    );
    assert!(messages[0]
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .contains("INVALID TOOL CALL"));
}

#[test]
fn pronoun_anh_is_not_treated_as_image_intent() {
    assert_eq!(inferred_media_kind("cho anh kết quả"), None);
    assert_eq!(
        route_for_request("oke em xem rồi cho anh kết quả, đừng gửi link"),
        None
    );
}

#[test]
fn deterministic_google_workspace_routes_drive_lookup_requests() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("find the Google Doc meeting notes in Drive"),
    }];
    let call = deterministic_google_workspace_call(&messages)
        .expect("deterministic google workspace call");
    assert_eq!(call.tool, "google_drive_search");
    assert_eq!(
        call.arguments.get("query").and_then(Value::as_str),
        Some("meeting notes")
    );
}

#[test]
fn deterministic_google_workspace_routes_recent_sheets_list_requests() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("check danh sach cac file google sheet gan nhat"),
    }];
    let call = deterministic_google_workspace_call(&messages)
        .expect("deterministic google workspace call");
    assert_eq!(call.tool, "google_drive_search");
    assert_eq!(
        call.arguments.get("mime_type").and_then(Value::as_str),
        Some("application/vnd.google-apps.spreadsheet")
    );
    assert_eq!(
        call.arguments.get("recent").and_then(Value::as_bool),
        Some(true)
    );
}

#[test]
fn deterministic_google_workspace_reads_doc_url_directly() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!(
            "read this Google Doc https://docs.google.com/document/d/abc123_DEF456/edit"
        ),
    }];
    let call = deterministic_google_workspace_call(&messages)
        .expect("deterministic google workspace call");
    assert_eq!(call.tool, "google_docs_read");
    assert_eq!(
        call.arguments.get("document_id").and_then(Value::as_str),
        Some("abc123_DEF456")
    );
}

#[test]
fn deterministic_google_workspace_routes_contacts_lookup_requests() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("find Linsey in my Google contacts"),
    }];
    let call = deterministic_google_workspace_call(&messages)
        .expect("deterministic google workspace call");
    assert_eq!(call.tool, "google_contacts_search");
    assert_eq!(
        call.arguments.get("query").and_then(Value::as_str),
        Some("Linsey")
    );
}

#[test]
fn deterministic_google_contact_delete_uses_verified_people_resource() {
    let messages = vec![
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!("Contact found. Resource Name: people/c6384821865405024792"),
        },
        ReactChatMessage {
            role: "assistant".to_string(),
            content: json!("Em xin phép xóa contact này nếu anh xác nhận."),
        },
        ReactChatMessage {
            role: "user".to_string(),
            content: json!("oke làm đi em"),
        },
    ];
    let call = deterministic_google_contact_delete_call(&messages)
        .expect("deterministic contact delete call");
    assert_eq!(call.tool, "propose_google_contact_delete");
    assert_eq!(
        call.arguments.get("resource_name").and_then(Value::as_str),
        Some("people/c6384821865405024792")
    );
}

#[test]
fn malformed_google_action_markup_is_rejected() {
    let call = ToolCall {
        tool: "propose_google_action".to_string(),
        arguments: json!({
            "action_summary": ">Xóa contact<tool_call>",
            "method": ">DELETE<",
            "url": "https://people.googleapis.com/v1/people/c1 <tool_call>"
        }),
    };
    assert!(validate_tool_call(&call).is_err());
}

#[test]
fn deterministic_google_workspace_lists_contacts_without_name_query() {
    let messages = vec![ReactChatMessage {
        role: "user".to_string(),
        content: json!("show my contact list"),
    }];
    let call = deterministic_google_workspace_call(&messages)
        .expect("deterministic google workspace call");
    assert_eq!(call.tool, "google_contacts_search");
    assert_eq!(
        call.arguments.get("page_size").and_then(Value::as_u64),
        Some(20)
    );
    assert!(call.arguments.get("query").is_none());
}

#[test]
fn verified_answer_from_google_contacts_card_is_human_readable() {
    let cards = vec![ToolResultCard {
        kind: "google_contacts".to_string(),
        title: "1 Google contacts".to_string(),
        summary: Some("Verified from Google Contacts".to_string()),
        fields: Vec::new(),
        items: vec![ToolResultItem {
            title: "Honey".to_string(),
            subtitle: Some("honey@example.com".to_string()),
            details: vec![
                ToolResultField {
                    label: "Email".to_string(),
                    value: "honey@example.com".to_string(),
                },
                ToolResultField {
                    label: "Phone".to_string(),
                    value: "0123456789".to_string(),
                },
            ],
            url: None,
        }],
        text: None,
    }];
    let answer = verified_answer_from_cards(&cards, "fallback", "tim Honey trong danh ba");
    assert!(answer.contains("Honey"));
    assert!(answer.contains("0123456789"));
    assert!(!answer.contains("fallback"));
}

#[test]
fn gmail_route_blocks_unrelated_media_tool_calls() {
    let call = with_user_text(
        ToolCall {
            tool: "preview_random_media".to_string(),
            arguments: json!({ "kind": "image" }),
        },
        "5 mail gần nhất là được rồi",
    );
    assert!(tool_allowed_for_route(&call, "5 mail gần nhất là được rồi").is_err());
}

#[test]
fn web_search_route_blocks_unrelated_media_tool_calls() {
    let call = with_user_text(
        ToolCall {
            tool: "preview_random_media".to_string(),
            arguments: json!({ "kind": "image" }),
        },
        "search web for apartment prices in hanoi 2026",
    );
    assert!(
        tool_allowed_for_route(&call, "search web for apartment prices in hanoi 2026").is_err()
    );
}

#[test]
fn google_workspace_route_blocks_unrelated_mail_tool_calls() {
    let call = with_user_text(
        ToolCall {
            tool: "gmail_recent".to_string(),
            arguments: json!({ "count": 5 }),
        },
        "find the Google Sheet budget 2026 in Drive",
    );
    assert!(tool_allowed_for_route(&call, "find the Google Sheet budget 2026 in Drive").is_err());
}

#[test]
fn file_search_route_blocks_unrelated_web_tool_calls() {
    let call = with_user_text(
        ToolCall {
            tool: "web_search".to_string(),
            arguments: json!({ "query": "report" }),
        },
        "find file report in workspace",
    );
    assert!(tool_allowed_for_route(&call, "find file report in workspace").is_err());
}

#[test]
fn routes_month_schedule_to_calendar_hint() {
    assert_eq!(
        route_for_request("kiểm tra lịch trình tháng 6"),
        Some(ToolRoute::Calendar)
    );
}

#[test]
fn language_detection_does_not_treat_bangkok_as_vietnamese() {
    assert!(!user_wants_vietnamese("weather in Bangkok this weekend"));
    assert!(user_wants_vietnamese("thời tiết cuối tuần này ở Hà Nội"));
    assert!(user_wants_vietnamese("mở một file âm thanh bất kỳ"));
}

#[test]
fn approval_reply_uses_latest_user_language_only() {
    let latest_user_text = "send me another pic of you, but full body shot";
    assert_eq!(
        image_approval_answer(user_wants_vietnamese(latest_user_text)),
        "I can create this image. Approve it when you're ready."
    );
}

#[test]
fn random_index_stays_in_bounds() {
    for len in [1, 2, 10, 10_000] {
        for _ in 0..32 {
            assert!(random_index(len) < len);
        }
    }
}

#[test]
fn multiple_file_matches_ask_user_to_choose_in_same_language() {
    let cards = vec![files_card(
        "file_search",
        "2 matching files",
        Some("song".to_string()),
        &[
            file_tools::FileSearchResult {
                path: "D:\\Music\\a.mp3".to_string(),
                name: "a.mp3".to_string(),
                folder: "D:\\Music".to_string(),
                extension: "mp3".to_string(),
                size_bytes: 123,
            },
            file_tools::FileSearchResult {
                path: "D:\\Music\\b.mp3".to_string(),
                name: "b.mp3".to_string(),
                folder: "D:\\Music".to_string(),
                extension: "mp3".to_string(),
                size_bytes: 456,
            },
        ],
    )];
    let answer = verified_answer_from_cards(&cards, "fallback", "mở một file âm thanh");
    assert_ne!(answer, "fallback");
    assert!(answer.contains("D:\\Music\\a.mp3"));
    assert!(answer.contains("D:\\Music\\b.mp3"));
}

#[test]
fn infers_audio_kind_from_vietnamese_request() {
    assert_eq!(
        inferred_media_kind("mở một file âm thanh bất kỳ"),
        Some("audio")
    );
    assert_eq!(inferred_media_kind("play a random song"), Some("audio"));
}

#[test]
fn infers_calendar_month_from_vietnamese_request() {
    let current_year = Local::now().year();
    assert_eq!(
        infer_calendar_date("toàn bộ tháng 5 có sự kiện gì"),
        Some(format!("{current_year}-05"))
    );
}

#[test]
fn infers_requested_count_from_user_text() {
    assert_eq!(requested_item_count("show 10 newest mails", 5, 25), 10);
    assert_eq!(requested_item_count("show newest mails", 5, 25), 5);
}

#[test]
fn continues_file_search_when_user_wants_preview() {
    assert!(should_continue_after_observation(
        "search_directory",
        "open the file named report"
    ));
    assert!(should_continue_after_observation(
        "list_media_files",
        "play a song from workspace"
    ));
    assert!(should_continue_after_observation(
        "search_directory",
        "mở một file âm thanh"
    ));
    assert!(!should_continue_after_observation(
        "search_directory",
        "find files named report"
    ));
    assert!(!should_continue_after_observation(
        "gmail_recent",
        "show latest mail"
    ));
}

#[test]
fn preview_kind_guard_blocks_wrong_media_type() {
    let image_preview = file_tools::FilePreviewResult {
        path: "C:\\Workspace\\cover.png".to_string(),
        name: "cover.png".to_string(),
        extension: "png".to_string(),
        mime_type: "image/png".to_string(),
        size_bytes: 100,
        data_url: None,
        text: None,
        truncated: false,
    };
    let audio_preview = file_tools::FilePreviewResult {
        path: "C:\\Workspace\\song.mp3".to_string(),
        name: "song.mp3".to_string(),
        extension: "mp3".to_string(),
        mime_type: "audio/mpeg".to_string(),
        size_bytes: 100,
        data_url: None,
        text: None,
        truncated: false,
    };

    assert!(!preview_kind_matches_request(
        &image_preview,
        "mở một file âm thanh bất kỳ"
    ));
    assert!(preview_kind_matches_request(
        &audio_preview,
        "mở một file âm thanh bất kỳ"
    ));
}

#[test]
fn verified_file_answer_uses_path_fields() {
    let cards = vec![files_card(
        "file_search",
        "1 matching files",
        Some("song".to_string()),
        &[file_tools::FileSearchResult {
            path: "D:\\Music\\song.mp3".to_string(),
            name: "song.mp3".to_string(),
            folder: "D:\\Music".to_string(),
            extension: "mp3".to_string(),
            size_bytes: 1234,
        }],
    )];
    let answer = verified_answer_from_cards(&cards, "fallback", "play a song");
    assert!(answer.contains("song.mp3"));
    assert!(answer.contains("D:\\Music\\song.mp3"));
    assert!(!answer.contains("fallback"));
}
