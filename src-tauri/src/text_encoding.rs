fn cp1252_byte(ch: char) -> Option<u8> {
    match ch {
        '\u{20AC}' => Some(0x80),
        '\u{201A}' => Some(0x82),
        '\u{0192}' => Some(0x83),
        '\u{201E}' => Some(0x84),
        '\u{2026}' => Some(0x85),
        '\u{2020}' => Some(0x86),
        '\u{2021}' => Some(0x87),
        '\u{02C6}' => Some(0x88),
        '\u{2030}' => Some(0x89),
        '\u{0160}' => Some(0x8A),
        '\u{2039}' => Some(0x8B),
        '\u{0152}' => Some(0x8C),
        '\u{017D}' => Some(0x8E),
        '\u{2018}' => Some(0x91),
        '\u{2019}' => Some(0x92),
        '\u{201C}' => Some(0x93),
        '\u{201D}' => Some(0x94),
        '\u{2022}' => Some(0x95),
        '\u{2013}' => Some(0x96),
        '\u{2014}' => Some(0x97),
        '\u{02DC}' => Some(0x98),
        '\u{2122}' => Some(0x99),
        '\u{0161}' => Some(0x9A),
        '\u{203A}' => Some(0x9B),
        '\u{0153}' => Some(0x9C),
        '\u{017E}' => Some(0x9E),
        '\u{0178}' => Some(0x9F),
        _ if (ch as u32) <= 0xFF => Some(ch as u8),
        _ => None,
    }
}

fn is_mojibake_marker(ch: char) -> bool {
    matches!(
        ch,
        '\u{00C3}'
            | '\u{00C2}'
            | '\u{00E2}'
            | '\u{00E3}'
            | '\u{00EF}'
            | '\u{00E1}'
            | '\u{00C4}'
            | '\u{00C5}'
            | '\u{00D0}'
            | '\u{00D1}'
            | '\u{FFFD}'
    )
}

fn has_mojibake_marker(input: &str) -> bool {
    input.chars().any(is_mojibake_marker)
}

fn mojibake_score(input: &str) -> usize {
    input.chars().filter(|ch| is_mojibake_marker(*ch)).count()
}

fn decode_cp1252_utf8(input: &str) -> Option<String> {
    let bytes = input.chars().map(cp1252_byte).collect::<Option<Vec<_>>>()?;
    String::from_utf8(bytes).ok()
}

fn repair_token(token: &str) -> String {
    if !has_mojibake_marker(token) {
        return token.to_string();
    }
    let Some(decoded) = decode_cp1252_utf8(token) else {
        return token.to_string();
    };
    if decoded != token && mojibake_score(&decoded) < mojibake_score(token) {
        decoded
    } else {
        token.to_string()
    }
}

pub(crate) fn repair_mojibake_text(input: &str) -> String {
    if input.trim().is_empty() || !has_mojibake_marker(input) {
        return input.to_string();
    }

    let mut repaired = String::with_capacity(input.len());
    let mut token = String::new();
    for ch in input.chars() {
        if ch.is_whitespace() {
            if !token.is_empty() {
                repaired.push_str(&repair_token(&token));
                token.clear();
            }
            repaired.push(ch);
        } else {
            token.push(ch);
        }
    }
    if !token.is_empty() {
        repaired.push_str(&repair_token(&token));
    }
    repaired
}

#[cfg(test)]
mod tests {
    use super::repair_mojibake_text;

    #[test]
    fn repairs_vietnamese_cp1252_mojibake() {
        let input = concat!(
            "Jasmine, 25 tu",
            "\u{00E1}\u{00BB}\u{2022}",
            "i, tr",
            "\u{00E1}\u{00BB}\u{00A3}",
            " l",
            "\u{00C3}\u{00BD}",
            " ",
            "\u{00C4}\u{2018}\u{00E1}\u{00BA}\u{00AF}",
            "c l",
            "\u{00E1}\u{00BB}\u{00B1}",
            "c"
        );
        assert_eq!(
            repair_mojibake_text(input),
            concat!(
                "Jasmine, 25 tu",
                "\u{1ED5}",
                "i, tr",
                "\u{1EE3}",
                " l",
                "\u{00FD}",
                " ",
                "\u{0111}",
                "\u{1EAF}",
                "c l",
                "\u{1EF1}",
                "c"
            )
        );
    }

    #[test]
    fn repairs_punctuation_mojibake() {
        let quotes = concat!(
            "\u{00E2}\u{20AC}\u{0153}hello\u{00E2}\u{20AC}\u{009D}",
            " ",
            "\u{00E2}\u{20AC}\u{00A6}"
        );
        assert_eq!(
            repair_mojibake_text(quotes),
            concat!("\u{201C}hello\u{201D}", " ", "\u{2026}")
        );
    }

    #[test]
    fn leaves_clean_text_unchanged() {
        let clean = concat!(
            "Jasmine, 25 tu",
            "\u{1ED5}",
            "i, tr",
            "\u{1EE3}",
            " l",
            "\u{00FD}",
            " ",
            "\u{0111}",
            "\u{1EAF}",
            "c l",
            "\u{1EF1}",
            "c."
        );
        assert_eq!(repair_mojibake_text(clean), clean);
    }
}
