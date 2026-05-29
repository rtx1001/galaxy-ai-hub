pub(super) fn normalize_text(value: &str) -> String {
    value.to_lowercase()
}

pub(super) fn contains_any(text: &str, terms: &[&str]) -> bool {
    terms.iter().any(|term| text.contains(term))
}

pub(super) fn contains_vietnamese_diacritic(text: &str) -> bool {
    text.chars().any(|ch| {
        let code = ch as u32;
        (0x00C0..=0x1EF9).contains(&code)
    })
}

pub(super) fn has_word_unicode(text: &str, term: &str) -> bool {
    text.split(|ch: char| !ch.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .any(|word| word == term)
}

pub(super) fn contains_any_folded(text: &str, folded: &str, terms: &[&str]) -> bool {
    terms.iter().any(|term| {
        let lower = term.to_lowercase();
        text.contains(&lower) || folded.contains(&normalize_text(&lower))
    })
}

pub(super) fn has_word_folded(text: &str, folded: &str, terms: &[&str]) -> bool {
    terms.iter().any(|term| {
        let lower = term.to_lowercase();
        let folded_term = normalize_text(&lower);
        has_word_unicode(text, &lower) || has_word_unicode(folded, &folded_term)
    })
}

pub(super) fn contains_vietnamese_intent(lowered: &str, exact_terms: &[&str]) -> bool {
    exact_terms.iter().any(|term| lowered.contains(term))
}

pub(super) fn vietnamese_image_term(text: &str) -> bool {
    contains_any(text, &["ảnh", "hình", "hình ảnh", "tấm ảnh", "bức ảnh"])
}

pub(super) fn vietnamese_create_image_term(text: &str) -> bool {
    contains_any(
        text,
        &[
            "tạo",
            "vẽ",
            "làm",
            "dựng",
            "render",
            "gửi ảnh",
            "cho xem ảnh",
            "cho anh xem ảnh",
        ],
    )
}

pub(super) fn vietnamese_audio_term(text: &str) -> bool {
    contains_any(
        text,
        &[
            "nhạc",
            "âm thanh",
            "bài hát",
            "ca khúc",
            "mp3",
            "wav",
            "flac",
            "m4a",
        ],
    )
}

pub(super) fn vietnamese_preview_action_term(text: &str) -> bool {
    contains_any(text, &["mở", "phát", "bật", "xem"])
        || (has_word_unicode(text, "nghe") && vietnamese_audio_term(text))
        || contains_any(
            text,
            &[
                "nghe nhạc",
                "nghe bài hát",
                "nghe ca khúc",
                "cho nghe nhạc",
                "cho nghe bài",
            ],
        )
}

pub(super) fn vietnamese_media_followup_term(text: &str) -> bool {
    contains_any(
        text,
        &[
            "khác đi",
            "cái khác",
            "bài khác",
            "ảnh khác",
            "hình khác",
            "tìm cái khác",
            "mở cái khác",
            "mở bài khác",
            "tìm ảnh khác",
            "bài hát tiếng",
            "tiếng thái",
            "thái lan",
            "đâu thấy",
            "không thấy",
            "chưa thấy",
        ],
    )
}

#[cfg(test)]
pub(super) fn trim_inline_token(token: &str) -> &str {
    token.trim_matches(|ch: char| {
        matches!(
            ch,
            '"' | '\'' | '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>' | ',' | '.' | ';'
        )
    })
}

#[cfg(test)]
pub(super) fn trim_natural_language_token(token: &str) -> &str {
    token.trim_matches(|ch: char| !(ch.is_alphanumeric() || matches!(ch, '-' | '_' | '/' | '.')))
}

#[cfg(test)]
pub(super) fn natural_language_tokens<'a>(text: &'a str) -> Vec<&'a str> {
    text.split_whitespace()
        .map(trim_natural_language_token)
        .filter(|token| !token.is_empty())
        .collect()
}
