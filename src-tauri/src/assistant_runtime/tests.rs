use super::*;
use crate::agent_react::{ToolResultField, ToolResultItem};
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
