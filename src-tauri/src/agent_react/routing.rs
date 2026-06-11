use super::*;

mod calendar;
mod media;
mod tool_guard;

pub(super) use calendar::*;
pub(super) use media::*;
pub(super) use tool_guard::*;

pub(super) fn is_confirmation(text: &str) -> bool {
    let normalized = normalize_text(text);
    let words = normalized
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    matches!(words.as_slice(), ["ok"] | ["yes"] | ["yeah"] | ["yep"])
}
