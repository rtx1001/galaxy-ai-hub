use super::*;
use crate::agent_react::{ImageProposal, ToolResultField, ToolResultItem};
#[test]
fn telegram_formats_gmail_cards_as_rows() {
    let cards = vec![ToolResultCard {
        kind: "gmail".to_string(),
        title: "1 Gmail messages".to_string(),
        summary: Some("Verified from Gmail API".to_string()),
        fields: Vec::new(),
        items: vec![ToolResultItem {
            title: "1. Real subject".to_string(),
            subtitle: Some("sender@example.com".to_string()),
            details: vec![
                ToolResultField {
                    label: "From".to_string(),
                    value: "sender@example.com".to_string(),
                },
                ToolResultField {
                    label: "Date".to_string(),
                    value: "Today".to_string(),
                },
                ToolResultField {
                    label: "Preview".to_string(),
                    value: "Real preview".to_string(),
                },
            ],
            url: None,
        }],
        text: None,
    }];
    let text = format_telegram_cards(&cards);
    assert!(text.contains("Real subject"));
    assert!(text.contains("From: sender@example.com"));
    assert!(text.contains("Preview: Real preview"));
}

#[test]
fn telegram_reply_prefers_natural_answer_over_tool_cards() {
    let result = ReactChatResult {
        answer: "Your calendar today has one meeting at 9.".to_string(),
        thinking: Some("hidden thinking".to_string()),
        tool_used: Some("google_calendar_check".to_string()),
        observation: Some("raw observation".to_string()),
        cards: vec![ToolResultCard {
            kind: "calendar".to_string(),
            title: "1 calendar events".to_string(),
            summary: Some("Verified from Google Calendar API".to_string()),
            fields: Vec::new(),
            items: Vec::new(),
            text: None,
        }],
        image_proposal: None,
        file_preview: None,
        action_proposal: None,
        tool_trace: Vec::new(),
    };
    let parts = build_telegram_reply_parts(result);
    assert!(parts.text.contains("calendar today"));
    assert!(!parts.text.contains("Verified from Google Calendar API"));
    assert!(!parts.text.contains("hidden thinking"));
}

#[test]
fn telegram_reply_keeps_image_proposal_out_of_visible_prompt_text() {
    let result = ReactChatResult {
        answer: "I can make that for you.".to_string(),
        thinking: Some("hidden thinking".to_string()),
        tool_used: Some("propose_image_generation".to_string()),
        observation: Some("pending approval".to_string()),
        cards: Vec::new(),
        image_proposal: Some(ImageProposal {
            prompt: "A cinematic beach portrait.".to_string(),
            mode: "bot_image".to_string(),
            mask_prompt: None,
            reference_sources: vec!["bot_avatar".to_string()],
        }),
        file_preview: None,
        action_proposal: None,
        tool_trace: Vec::new(),
    };
    let parts = build_telegram_reply_parts(result);
    assert!(parts.text.contains("I can make that for you."));
    assert!(!parts.text.contains("cinematic beach portrait"));
    assert_eq!(
        parts
            .image_proposal
            .as_ref()
            .map(|proposal| proposal.mode.as_str()),
        Some("bot_image")
    );
}

#[test]
fn telegram_image_attachment_becomes_llm_image_content() {
    let content = build_telegram_user_content(
        "what do you see?",
        &[TelegramIncomingFile {
            local_path: "D:\\AI\\Galaxy_Bot\\assistant-runtime\\telegram-input\\photo.jpg"
                .to_string(),
            display_name: "photo.jpg".to_string(),
            mime_type: "image/jpeg".to_string(),
            size_bytes: 1234,
            is_image: true,
        }],
    );
    let parts = content.as_array().expect("telegram content parts");
    assert!(parts
        .iter()
        .any(|part| part.get("type").and_then(serde_json::Value::as_str) == Some("text")));
    let image = parts
        .iter()
        .find(|part| part.get("type").and_then(serde_json::Value::as_str) == Some("image_url"))
        .expect("image part");
    assert_eq!(
        image
            .get("image_url")
            .and_then(|value| value.get("local_path"))
            .and_then(serde_json::Value::as_str),
        Some("D:\\AI\\Galaxy_Bot\\assistant-runtime\\telegram-input\\photo.jpg")
    );
}

#[test]
fn telegram_image_modes_have_expected_default_reference_sources() {
    assert_eq!(
        default_image_reference_sources_for_mode("text_image"),
        Vec::<String>::new()
    );
    assert_eq!(
        default_image_reference_sources_for_mode("image_image"),
        vec!["chat_image".to_string()]
    );
    assert_eq!(
        default_image_reference_sources_for_mode("bot_image"),
        vec!["bot_avatar".to_string()]
    );
    assert_eq!(
        default_image_reference_sources_for_mode("user_image"),
        vec!["user_avatar".to_string()]
    );
    assert_eq!(
        default_image_reference_sources_for_mode("user_bot_image"),
        vec!["user_avatar".to_string(), "bot_avatar".to_string()]
    );
}

#[test]
fn personality_memory_skips_internal_failure_artifacts() {
    let memory = compact_personality_memory(
        "",
        "please try again",
        "Validation error: decision action was not a tool \\ud83d",
    );
    assert!(!memory.contains("Validation error"));
    assert!(!memory.contains("\\ud83d"));
}

#[test]
fn telegram_message_chunks_are_unicode_safe() {
    let text = format!(
        "{}\n\n{}",
        "\u{00e1}".repeat(3600),
        "\u{0110}\u{00e2}y l\u{00e0} \u{0111}o\u{1ea1}n sau."
    );
    let chunks = telegram_message_chunks(&text);
    assert!(chunks.len() >= 2);
    assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 3500));
    assert!(chunks[0].chars().all(|ch| ch == '\u{00e1}'));
    assert_eq!(
        chunks.last().map(String::as_str),
        Some("\u{0110}\u{00e2}y l\u{00e0} \u{0111}o\u{1ea1}n sau.")
    );
    assert_eq!(
        chunks
            .iter()
            .take(chunks.len() - 1)
            .map(|chunk| chunk.chars().count())
            .sum::<usize>(),
        3600
    );
}

#[test]
fn telegram_speech_text_reads_lines_dates_and_units_naturally() {
    let text = "H\u{00f4}m nay 18/05/2026\nNhi\u{1ec7}t \u{0111}\u{1ed9} 30\u{00b0}C, gi\u{00f3} 12km/h, m\u{01b0}a 81%";
    let speech = sanitize_telegram_speech_text(text);
    assert!(speech.contains("H\u{00f4}m nay 18 th\u{00e1}ng 5 n\u{0103}m 2026."));
    assert!(speech.contains("30 \u{0111}\u{1ed9} C\u{00ea}"));
    assert!(speech.contains("12 ki l\u{00f4} m\u{00e9}t tr\u{00ea}n gi\u{1edd}"));
    assert!(speech.contains("81 ph\u{1ea7}n tr\u{0103}m"));
    let spaced_decimal = sanitize_telegram_speech_text("M\u{01b0}a 0. 7 mm, gi\u{00f3} 12. 5km/h.");
    assert!(spaced_decimal.contains("0.7 mi li m\u{00e9}t"));
    assert!(spaced_decimal.contains("12.5 ki l\u{00f4} m\u{00e9}t tr\u{00ea}n gi\u{1edd}"));
    let short_date =
        sanitize_telegram_speech_text("H\u{1eb9}n ng\u{00e0}y 08/05 (th\u{1ee9} s\u{00e1}u)");
    assert!(short_date.contains("8 th\u{00e1}ng 5"));
    assert!(short_date.contains(", th\u{1ee9} s\u{00e1}u,"));
    let ranges = sanitize_telegram_speech_text(
        "T\u{00ed}nh 1+2: xong. The Gloam-Eyed Queen. Ng\u{00e0}y 5-6-2026 l\u{00e0} th\u{1ee9} 6. t\u{1eeb} 1-10, kho\u{1ea3}ng 1~2",
    );
    assert!(ranges.contains("1 c\u{1ed9}ng 2. xong."));
    assert!(ranges.contains("The Gloam Eyed Queen"));
    assert!(ranges.contains("Ng\u{00e0}y 5 th\u{00e1}ng 6 n\u{0103}m 2026"));
    assert!(ranges.contains("1 \u{0111}\u{1ebf}n 10"));
    assert!(ranges.contains("1 \u{0111}\u{1ebf}n 2"));
    let acronyms = sanitize_telegram_speech_text(
        "AI d\u{00f9}ng GPU RTX v\u{00e0} LLM. API JSON PNG MP3. hqua hnay b\u{00e2}y h ko \u{0111}c dc \u{0111}t vs ntn uhm bb cty r j 35C.",
    );
    assert!(acronyms.contains("\u{00e2}y ai"));
    assert!(acronyms.contains("GPU RTX"));
    assert!(acronyms.contains("LLM"));
    assert!(acronyms.contains("h\u{00f4}m qua"));
    assert!(acronyms.contains("h\u{00f4}m nay"));
    assert!(acronyms.contains("b\u{00e2}y gi\u{1edd}"));
    assert!(acronyms.contains("kh\u{00f4}ng \u{0111}\u{01b0}\u{1ee3}c"));
    assert!(acronyms.contains("\u{0111}i\u{1ec7}n tho\u{1ea1}i"));
    assert!(acronyms.contains("v\u{1edb}i"));
    assert!(acronyms.contains("nh\u{01b0} th\u{1ebf} n\u{00e0}o"));
    assert!(acronyms.contains("\u{1eeb}m"));
    assert!(acronyms.contains("bai bai"));
    assert!(acronyms.contains("c\u{00f4}ng ty"));
    assert!(acronyms.contains("r\u{1ed3}i"));
    assert!(acronyms.contains("g\u{00ec}"));
    assert!(acronyms.contains("35 \u{0111}\u{1ed9} C\u{00ea}"));
    let english_acronyms = sanitize_telegram_speech_text("AI uses GPU RTX and LLM at 35C.");
    assert!(english_acronyms.contains("A I"));
    assert!(english_acronyms.contains("GPU RTX"));
    assert!(english_acronyms.contains("LLM"));
    assert!(english_acronyms.contains("35 degrees Celsius"));
}

#[test]
fn telegram_detects_natural_voice_requests() {
    assert!(telegram_user_wants_voice("tra loi bang giong cho anh nghe"));
    assert!(telegram_user_wants_voice("send a voice note please"));
    assert!(!telegram_user_wants_voice("tra loi bang chu thoi"));
    assert_eq!(
        telegram_voice_intent("turn on auto voice please"),
        TelegramVoiceIntent::AutoOn
    );
    assert_eq!(
        telegram_voice_intent("chi tra loi bang chu thoi"),
        TelegramVoiceIntent::AutoOff
    );
}

#[test]
fn pause_detection_finds_last_sentence_break() {
    let mut peaks = vec![0.2; 100];
    for peak in peaks.iter_mut().take(40).skip(32) {
        *peak = 0.0;
    }
    for peak in peaks.iter_mut().take(78).skip(70) {
        *peak = 0.0;
    }

    let pause = find_last_pause_start(&peaks, 10, 90, 0.01, 4);
    assert_eq!(pause, Some(70));
}

#[test]
fn voice_sample_trim_keeps_short_samples_intact() {
    let mut peaks = vec![0.2; 700];
    for peak in peaks.iter_mut().take(300).skip(200) {
        *peak = 0.0;
    }

    let end = choose_prepared_voice_sample_end(&peaks, 0, peaks.len(), 100, 0.01);
    assert_eq!(end, peaks.len());
}

#[test]
fn voice_sample_trim_uses_pause_between_six_and_twelve_seconds() {
    let mut peaks = vec![0.2; 1_400];
    for peak in peaks.iter_mut().take(760).skip(730) {
        *peak = 0.0;
    }
    for peak in peaks.iter_mut().take(1_080).skip(1_040) {
        *peak = 0.0;
    }

    let end = choose_prepared_voice_sample_end(&peaks, 0, peaks.len(), 100, 0.01);
    assert_eq!(end, 1_045);
}

#[test]
fn voice_sample_trim_falls_back_to_eight_seconds_without_pause() {
    let peaks = vec![0.2; 1_400];

    let end = choose_prepared_voice_sample_end(&peaks, 0, peaks.len(), 100, 0.01);
    assert_eq!(end, 800);
}

#[test]
fn fade_softens_edges() {
    let mut samples = vec![1.0; 8];
    apply_fade(&mut samples, 2, 3);
    assert!(samples[0] < 1.0);
    assert!(samples[7] < 1.0);
    assert!(samples[3] > 0.9);
}

#[test]
fn normalize_pushes_peak_to_full_scale() {
    let mut samples = vec![0.25, -0.5, 0.2];
    normalize_samples(&mut samples);
    let peak = samples
        .iter()
        .fold(0.0f32, |current, sample| current.max(sample.abs()));
    assert!(peak > 0.99);
}

#[test]
fn resample_changes_length_for_target_rate() {
    let source = vec![0.0, 0.5, -0.5, 0.25];
    let resampled = resample_linear(&source, 44_100, 22_050);
    assert_eq!(resampled.len(), 2);
}
