import { AgentReactResult, FileActionResult, ShellExecutionResult, ShellToolRequest, ToolRunRecord } from './models';
import { textLooksVietnamese } from './chat';

const SHELL_TOOL_PATTERN = /<galaxy_shell>\s*([\s\S]*?)\s*<\/galaxy_shell>/i;

export const isGpuFitError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /free device memory|failed to fit|n_gpu_layers|out of memory|oom/i.test(message);
};

export const estimateTokens = (text: string) => Math.max(0, Math.ceil(text.length / 4));

export const extractShellToolRequest = (text: string): ShellToolRequest | null => {
  const match = text.match(SHELL_TOOL_PATTERN);
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[1]) as ShellToolRequest;
  } catch {
    return null;
  }
};

export const stripShellToolRequest = (text: string) =>
  text.replace(SHELL_TOOL_PATTERN, "").trim();

export const withSpeechSentenceBreaks = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/([.!?\u2026])\s*\n+\s*/g, "$1 ")
    .replace(/([^.!?\u2026\s])\s*\n+\s*/g, "$1. ")
    .replace(/\n+/g, ". ");

export const stripSpeechLeadingZero = (value: string) => {
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) ? String(numeric) : value;
};

export const SPEECH_ACRONYM_MAP = [
  { pattern: /\bAI\b/g, en: "A I", vi: "\u00e2y ai" },
] as const;

export const expandSpeechAcronyms = (text: string, vi: boolean) =>
  SPEECH_ACRONYM_MAP.reduce(
    (current, entry) => current.replace(entry.pattern, vi ? entry.vi : entry.en),
    text,
  );

export const VIETNAMESE_SPEECH_SHORTHAND_MAP = [
  { pattern: /\bb\u00e2y\s+h\b/gi, replacement: "b\u00e2y gi\u1edd" },
  { pattern: /\bhqua\b/gi, replacement: "h\u00f4m qua" },
  { pattern: /\bhnay\b/gi, replacement: "h\u00f4m nay" },
  { pattern: /\bsn\b/gi, replacement: "sinh nh\u1eadt" },
  { pattern: /\bcty\b/gi, replacement: "c\u00f4ng ty" },
  { pattern: /\bko\b/gi, replacement: "kh\u00f4ng" },
  { pattern: /(^|[^\p{L}\p{N}_])r(?=$|[^\p{L}\p{N}_])/giu, replacement: "$1r\u1ed3i" },
  { pattern: /\bj\b/gi, replacement: "g\u00ec" },
  { pattern: /(^|[^\p{L}\p{N}_])\u0111c(?=$|[^\p{L}\p{N}_])/giu, replacement: "$1\u0111\u01b0\u1ee3c" },
  { pattern: /\bdc\b/gi, replacement: "\u0111\u01b0\u1ee3c" },
  { pattern: /(^|[^\p{L}\p{N}_])\u0111t(?=$|[^\p{L}\p{N}_])/giu, replacement: "$1\u0111i\u1ec7n tho\u1ea1i" },
  { pattern: /\bvs\b/gi, replacement: "v\u1edbi" },
  { pattern: /\bntn\b/gi, replacement: "nh\u01b0 th\u1ebf n\u00e0o" },
  { pattern: /\buhm\b/gi, replacement: "\u1eebm" },
  { pattern: /\bbb\b/gi, replacement: "bai bai" },
  { pattern: /\btks\b/gi, replacement: "c\u1ea3m \u01a1n" },
  { pattern: /\bthx\b/gi, replacement: "c\u1ea3m \u01a1n" },
  { pattern: /\bokay\b/gi, replacement: "\u00f4 k\u00ea" },
  { pattern: /\bok\b/gi, replacement: "\u00f4 k\u00ea" },
] as const;

export const expandVietnameseSpeechShorthand = (text: string, vi: boolean) =>
  vi
    ? VIETNAMESE_SPEECH_SHORTHAND_MAP.reduce(
        (current, entry) => current.replace(entry.pattern, entry.replacement),
        text,
      )
    : text;

export const shortenVietnameseSpeechLetterRuns = (text: string, vi: boolean) =>
  vi
    ? [
        [/([áàảãạăắằẳẵặâấầẩẫậ])a{2,}/giu, "$1"],
        [/([éèẻẽẹêếềểễệ])e{2,}/giu, "$1"],
        [/([íìỉĩị])i{2,}/giu, "$1"],
        [/([óòỏõọôốồổỗộơớờởỡợ])o{2,}/giu, "$1"],
        [/([úùủũụưứừửữự])u{2,}/giu, "$1"],
        [/([ýỳỷỹỵ])y{2,}/giu, "$1"],
      ].reduce((current, [pattern, replacement]) => current.replace(pattern, replacement as string), text)
        .replace(/([\p{L}])\1{2,}/giu, "$1")
    : text;

export const repairSpacedSpeechDecimals = (text: string) =>
  text
    .replace(/\b(0)\s*([.,])\s*(\d+)\b/g, "$1$2$3")
    .replace(
      /\b(-?\d+)\s*([.,])\s*(\d+)(?=\s*(?:mm|cm|km\/h|km|kg|g|%|\u00b0?\s*[cf]\b|usd\b|vnd\b|vn\u0111\b|\u20ab|\$|\u20ac|\u00a3))/gi,
      "$1$2$3",
    );

export const normalizeTextForSpeechReading = (text: string) => {
  const vi = textLooksVietnamese(text);
  const rangeWord = vi ? " \u0111\u1ebfn " : " to ";
  return shortenVietnameseSpeechLetterRuns(
    expandVietnameseSpeechShorthand(expandSpeechAcronyms(repairSpacedSpeechDecimals(text), vi), vi),
    vi,
  )
    .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_, hour, minute) =>
      vi
        ? `${stripSpeechLeadingZero(hour)} gi\u1edd ${minute === "00" ? "kh\u00f4ng kh\u00f4ng" : minute}`
        : `${stripSpeechLeadingZero(hour)} ${minute === "00" ? "o clock" : minute}`,
    )
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g, (_, day, month, year) =>
      vi ? `${stripSpeechLeadingZero(day)} th\u00e1ng ${stripSpeechLeadingZero(month)} n\u0103m ${year}` : `${stripSpeechLeadingZero(month)}/${stripSpeechLeadingZero(day)}/${year}`,
    )
    .replace(/\b(\d{1,2})-(\d{1,2})-(\d{2,4})\b/g, (_, day, month, year) =>
      vi ? `${stripSpeechLeadingZero(day)} th\u00e1ng ${stripSpeechLeadingZero(month)} n\u0103m ${year}` : `${stripSpeechLeadingZero(month)}/${stripSpeechLeadingZero(day)}/${year}`,
    )
    .replace(/\b(\d{1,2})\/(\d{1,2})\b/g, (_, day, month) =>
      vi ? `${stripSpeechLeadingZero(day)} th\u00e1ng ${stripSpeechLeadingZero(month)}` : `${stripSpeechLeadingZero(month)}/${stripSpeechLeadingZero(day)}`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*\u00b0\s*C\b/gi, (_, value) =>
      vi ? `${value} \u0111\u1ed9 C\u00ea` : `${value} degrees celsius`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*C\b/gi, (_, value) =>
      vi ? `${value} \u0111\u1ed9 C\u00ea` : `${value} degrees celsius`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*\u00b0\s*F\b/gi, (_, value) =>
      vi ? `${value} \u0111\u1ed9 \u00e9p` : `${value} degrees fahrenheit`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*F\b/g, (_, value) =>
      vi ? `${value} \u0111\u1ed9 F` : `${value} degrees fahrenheit`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*km\/h\b/gi, (_, value) =>
      vi ? `${value} ki l\u00f4 m\u00e9t tr\u00ean gi\u1edd` : `${value} kilometers per hour`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*km\b/gi, (_, value) =>
      vi ? `${value} ki l\u00f4 m\u00e9t` : `${value} kilometers`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*mm\b/gi, (_, value) =>
      vi ? `${value} mi li m\u00e9t` : `${value} millimeters`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*cm\b/gi, (_, value) =>
      vi ? `${value} xen ti m\u00e9t` : `${value} centimeters`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*%/g, (_, value) =>
      vi ? `${value} ph\u1ea7n tr\u0103m` : `${value} percent`,
    )
    .replace(/\$\s*([\d.,]+)/g, (_, value) => vi ? `${value} \u0111\u00f4 la` : `${value} dollars`)
    .replace(/([\d.,]+)\s*(?:USD|usd)\b/g, (_, value) => vi ? `${value} \u0111\u00f4 la` : `${value} dollars`)
    .replace(/([\d.,]+)\s*(?:VND|vnd|VN\u0110|vn\u0111|\u20ab)\b/g, (_, value) => vi ? `${value} \u0111\u1ed3ng` : `${value} vietnamese dong`)
    .replace(/\u20ac\s*([\d.,]+)/g, (_, value) => vi ? `${value} euro` : `${value} euros`)
    .replace(/\u00a3\s*([\d.,]+)/g, (_, value) => vi ? `${value} b\u1ea3ng anh` : `${value} pounds`)
    .replace(/(?<=\d)\s*[~\u223c]\s*(?=\d)/g, rangeWord)
    .replace(/(?<=\d)\s*[-\u2013\u2014]\s*(?=\d)/g, rangeWord)
    .replace(/(?<=\d)\s*\+\s*(?=\d)/g, vi ? " c\u1ed9ng " : " plus ")
    .replace(/(^|[\s,.;!?])\+(?=$|[\s,.;!?])/g, (_, prefix) => `${prefix}${vi ? "c\u1ed9ng" : "plus"}`)
    .replace(/(^|[\s,.;!?])-(?=$|[\s,.;!?])/g, (_, prefix) => `${prefix}${vi ? "tr\u1eeb" : "minus"}`)
    .replace(/:(?=\s*\D|$)/g, ". ");
};
export const sanitizeTextForSpeech = (text: string) => {
  const ellipsisPlaceholder = "GALAXYELLIPSISPAUSE";
  const speechReadyText = normalizeTextForSpeechReading(withSpeechSentenceBreaks(text))
    .replace(/(?:(?:\.\s*){3,}|\u2026)/g, ellipsisPlaceholder);
  const collapsed = speechReadyText
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[#>*_~|]/g, " ")
    .replace(/\[(?: |x|X)\]/g, " ")
    .replace(/[()[\]{}<>]/g, ", ")
    .replace(/["\u201C\u201D'\u2018\u2019]/g, "")
    .replace(/[\u2022\u00B7\u00A6]/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0E\uFE0F\u200D]/gu, " ")
    .replace(/(?<=\p{L})[-\u2013\u2014](?=\p{L})/gu, " ")
    .replace(/\s*[-\u2013\u2014]\s*/g, ", ")
    .replace(/\s*[\\/]\s*/g, ", ")
    .replace(/[;,]{2,}/g, ", ")
    .replace(/[.]{4,}/g, ellipsisPlaceholder)
    .replace(/\s+/g, " ")
    .trim();

  const withoutSymbolRuns = collapsed
    .replace(/(^|[\s,.:;!?])[@#$%^&=+~]+(?=$|[\s,.:;!?])/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (withoutSymbolRuns || speechReadyText.trim())
    .replace(new RegExp(ellipsisPlaceholder, "g"), "...")
    .replace(/([.!?])\s+\./g, "$1")
    .replace(/\.{3}(?=\p{L})/gu, "... ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/^[\s,.;:!?]+/, "")
    .trim()
    .toLocaleLowerCase();
};

const SPEECH_CHUNK_TARGET_CHARS = 520;
const SPEECH_CHUNK_MIN_CHARS = 280;
const SPEECH_CHUNK_HARD_MAX_CHARS = 820;

const isDecimalPoint = (text: string, index: number) =>
  text[index] === "." && /\d/.test(text[index - 1] ?? "") && /\d/.test(text[index + 1] ?? "");

const splitLongSpeechUnit = (unit: string) => {
  const parts: string[] = [];
  let remaining = unit.trim();

  while (remaining.length > SPEECH_CHUNK_HARD_MAX_CHARS) {
    const windowText = remaining.slice(0, SPEECH_CHUNK_TARGET_CHARS);
    const commaIndex = Math.max(windowText.lastIndexOf(","), windowText.lastIndexOf(";"), windowText.lastIndexOf(":"));
    const spaceIndex = windowText.lastIndexOf(" ");
    const splitIndex =
      commaIndex >= SPEECH_CHUNK_MIN_CHARS
        ? commaIndex + 1
        : spaceIndex >= SPEECH_CHUNK_MIN_CHARS
          ? spaceIndex
          : SPEECH_CHUNK_TARGET_CHARS;
    parts.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts;
};

const splitSpeechIntoSentenceUnits = (text: string) => {
  const units: string[] = [];
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!/[.!?]/.test(char) || isDecimalPoint(text, index)) {
      continue;
    }

    let end = index + 1;
    while (text[end] === "." || text[end] === "!" || text[end] === "?") {
      end += 1;
    }

    if (end < text.length && !/\s/.test(text[end])) {
      continue;
    }

    const unit = text.slice(start, end).trim();
    if (unit) {
      units.push(unit);
    }
    start = end;
  }

  const tail = text.slice(start).trim();
  if (tail) {
    units.push(tail);
  }

  return units.flatMap(splitLongSpeechUnit);
};

export const splitTextForSpeechPlayback = (text: string) => {
  const speechText = sanitizeTextForSpeech(text).trim();
  if (!speechText) {
    return [];
  }

  const units = splitSpeechIntoSentenceUnits(speechText);
  const chunks: string[] = [];
  let current = "";

  for (const unit of units) {
    const next = current ? `${current} ${unit}` : unit;
    if (
      current &&
      (
        next.length > SPEECH_CHUNK_TARGET_CHARS ||
        next.length > SPEECH_CHUNK_HARD_MAX_CHARS
      ) &&
      current.length >= SPEECH_CHUNK_MIN_CHARS
    ) {
      chunks.push(current);
      current = unit;
    } else {
      current = next;
    }

    if (current.length >= SPEECH_CHUNK_HARD_MAX_CHARS) {
      chunks.push(current);
      current = "";
    }
  }

  if (current) {
    if (chunks.length && current.length < SPEECH_CHUNK_MIN_CHARS) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${current}`.trim();
    } else {
      chunks.push(current);
    }
  }

  return chunks;
};

export const formatReactThinking = (result: AgentReactResult) => {
  const thinking = result.thinking?.trim();
  if (thinking) {
    return thinking;
  }
  if (result.tool_trace?.length) {
    return [
      "Tool flow",
      ...result.tool_trace.map(
        (trace, index) =>
          `${index + 1}. ${trace.tool} - ${trace.success ? "OK" : "Error"}: ${trace.summary}`,
      ),
    ].join("\n");
  }
  return "";
};

export const includesAnyPhrase = (text: string, phrases: string[]) =>
  phrases.some((phrase) => text.includes(phrase));


export const getDefaultLocalContext = () => "unknown";
export const formatFileActionResult = (result: FileActionResult) =>
  [
    result.success ? "File action completed." : "File action could not be completed.",
    result.message,
    result.path ? `Path: ${result.path}` : "",
  ].filter(Boolean).join("\n");

export const formatShellResult = (result: ShellExecutionResult) => {
  const status = result.timed_out
    ? "Timed out"
    : result.exit_code === 0
      ? "Finished successfully"
      : `Finished with exit code ${result.exit_code ?? "unknown"}`;
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  return [
    `System action ${status}.`,
    `Time: ${Math.round(result.duration_ms)} ms`,
    stdout ? `\nOutput:\n${stdout}` : "",
    stderr ? `\nErrors:\n${stderr}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

export const formatToolRunTime = (createdAt: number) => {
  if (!createdAt) return "";
  return new Date(createdAt * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const formatToolDuration = (durationMs?: number) => {
  if (!durationMs || durationMs < 0) return "0s";
  if (durationMs < 1000) {
    return `${Math.max(0.1, durationMs / 1000).toFixed(1)}s`;
  }
  const seconds = Math.round(durationMs / 1000);
  return `${seconds}s`;
};

export const parseToolJson = (value: string) => {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

export const readToolString = (record: Record<string, unknown>, key: string) => {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
};

export const toolRunDisplayName = (run: ToolRunRecord) => {
  const input = parseToolJson(run.input_json);
  if (
    run.tool_name === "propose_image_generation" ||
    run.tool_name === "generate_image" ||
    run.tool_name === "text_image" ||
    run.tool_name === "image_image" ||
    run.tool_name === "bot_image" ||
    run.tool_name === "user_image" ||
    run.tool_name === "user_bot_image"
  ) {
    const mode = readToolString(input, "mode");
    const source = mode || run.tool_name;
    if (source === "text_to_image" || source === "text_image") return "text_image";
    if (source === "image_to_image" || source === "image_image") return "image_image";
    if (source === "avatar_image" || source === "avatar_to_image" || source === "bot_image") return "bot_image";
    if (source === "user_avatar_image" || source === "avatar_user_image" || source === "user_image") return "user_image";
    if (
      source === "user_character_image" ||
      source === "user_and_character_image" ||
      source === "both_avatars_image" ||
      source === "user_bot_image"
    ) {
      return "user_bot_image";
    }
    return "text_image";
  }
  if (run.tool_name === "voice_speech") return "voice_speech";
  if (run.tool_name === "voice_cached") return "voice_cached";
  return run.tool_name;
};

export const toolRunBrief = (run: ToolRunRecord) => {
  const input = parseToolJson(run.input_json);
  const prompt = readToolString(input, "prompt");
  const query = readToolString(input, "query");
  const location = readToolString(input, "location");
  const path = readToolString(input, "path");
  const purpose = readToolString(input, "purpose");
  const text = readToolString(input, "text");
  const summary = prompt || text || query || location || path || purpose || run.output_text || run.input_json;
  return summary.replace(/\s+/g, " ").slice(0, 140);
};
