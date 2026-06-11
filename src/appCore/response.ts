import { VoiceSample } from './models';

export const extractTextValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractTextValue).filter(Boolean).join("");
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return extractTextValue(
      record.text ??
        record.content ??
        record.value ??
        record.response ??
        record.generated_text,
    );
  }

  return "";
};

export const extractChoiceText = (choice: unknown) => {
  if (!choice || typeof choice !== "object") {
    return { visible: "", fallback: "" };
  }

  const record = choice as Record<string, unknown>;
  const delta = (record.delta ?? {}) as Record<string, unknown>;
  const message = (record.message ?? {}) as Record<string, unknown>;
  const visible = [
    delta.content,
    message.content,
    record.content,
    record.text,
  ]
    .map(extractTextValue)
    .filter(Boolean)
    .join("");
  const fallback = [
    delta.reasoning_content,
    delta.reasoning,
    message.reasoning_content,
    message.reasoning,
    record.reasoning_content,
    record.reasoning,
  ]
    .map(extractTextValue)
    .filter(Boolean)
    .join("");

  return { visible, fallback };
};

export const extractChatResponseText = (data: unknown) => {
  if (!data || typeof data !== "object") {
    return "";
  }

  const record = data as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const choiceText = choices
    .map((choice) => {
      const extracted = extractChoiceText(choice);
      return extracted.visible || extracted.fallback;
    })
    .filter(Boolean)
    .join("");

  return (
    choiceText ||
    extractTextValue(record.content) ||
    extractTextValue(record.response) ||
    extractTextValue(record.generated_text)
  ).trim();
};

export const stripThinkBlocks = (text: string) =>
  text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();

export const cleanAssistantDisplayText = (text: string) =>
  removeStrayHanGlyphs(text)
    .replace(/[\uFFFD\u25A1\u25A0\u{1F972}]/gu, "")
    // Some Windows/WebView setups render emoji/pictographs as square boxes. Keep text natural by dropping them.
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, "")
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\uFE0F]/gu, "")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

export const removeStrayHanGlyphs = (text: string) => {
  const hanMatches = text.match(/\p{Script=Han}/gu) ?? [];
  if (!hanMatches.length || hanMatches.length > 2) return text;
  const hasLatin = /\p{Script=Latin}/u.test(text);
  const hasKanaOrHangul = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
  if (!hasLatin || hasKanaOrHangul) return text;
  return text.replace(/\p{Script=Han}/gu, "");
};

export const detectVoicePreviewText = (sample?: VoiceSample) => {
  const voiceName = `${sample?.name ?? ""} ${sample?.label ?? ""} ${sample?.path ?? ""}`.toLowerCase();

  if (/(^|[^a-z])(vi|vn|vie)([^a-z]|$)|vietnam|vietnamese|tieng viet|ti\u1ebfng vi\u1ec7t/.test(voiceName)) {
    return "\u0110\u00e2y l\u00e0 m\u1eabu nghe th\u1eed gi\u1ecdng n\u00f3i.";
  }
  if (/(^|[^a-z])(en|eng)([^a-z]|$)|english/.test(voiceName)) {
    return "This is a preview of the voice.";
  }
  if (/(^|[^a-z])th([^a-z]|$)|thai/.test(voiceName)) {
    return "\u0e19\u0e35\u0e48\u0e04\u0e37\u0e2d\u0e15\u0e31\u0e27\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e40\u0e2a\u0e35\u0e22\u0e07\u0e1e\u0e39\u0e14";
  }
  if (/(^|[^a-z])(ja|jp)([^a-z]|$)|japanese/.test(voiceName)) {
    return "\u3053\u308c\u306f\u97f3\u58f0\u30b5\u30f3\u30d7\u30eb\u3067\u3059\u3002";
  }
  if (/(^|[^a-z])(ko|kr)([^a-z]|$)|korean/.test(voiceName)) {
    return "\uc774\uac83\uc740 \uc74c\uc131 \uc0d8\ud50c\uc785\ub2c8\ub2e4.";
  }
  if (/(^|[^a-z])(zh|cn)([^a-z]|$)|chinese|mandarin/.test(voiceName)) {
    return "\u8fd9\u662f\u8bed\u97f3\u793a\u4f8b\u3002";
  }

  const browserLanguage = navigator.language.toLowerCase();
  return previewTextForDetectedLanguage(browserLanguage);
};

export const previewTextForDetectedLanguage = (language?: string | null) => {
  const normalized = (language || "").trim().toLowerCase();
  if (normalized.startsWith("vi")) return "\u0110\u00e2y l\u00e0 m\u1eabu nghe th\u1eed gi\u1ecdng n\u00f3i.";
  if (normalized.startsWith("th")) return "\u0e19\u0e35\u0e48\u0e04\u0e37\u0e2d\u0e15\u0e31\u0e27\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e40\u0e2a\u0e35\u0e22\u0e07\u0e1e\u0e39\u0e14";
  if (normalized.startsWith("ja")) return "\u3053\u308c\u306f\u97f3\u58f0\u30b5\u30f3\u30d7\u30eb\u3067\u3059\u3002";
  if (normalized.startsWith("ko")) return "\uc774\uac83\uc740 \uc74c\uc131 \uc0d8\ud50c\uc785\ub2c8\ub2e4.";
  if (normalized.startsWith("zh")) return "\u8fd9\u662f\u8bed\u97f3\u793a\u4f8b\u3002";
  if (normalized.startsWith("es")) return "Esta es una muestra de voz.";
  if (normalized.startsWith("fr")) return "Voici un \u00e9chantillon de voix.";
  if (normalized.startsWith("de")) return "Das ist eine Stimmprobe.";
  return "This is a preview of the voice.";
};
