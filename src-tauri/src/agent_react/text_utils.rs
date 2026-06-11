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
