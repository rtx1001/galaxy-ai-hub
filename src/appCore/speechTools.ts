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

export const normalizeTextForSpeechReading = (text: string) => {
  const vi = textLooksVietnamese(text);
  return text
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g, (_, day, month, year) =>
      vi ? `${stripSpeechLeadingZero(day)} tháng ${stripSpeechLeadingZero(month)} năm ${year}` : `${stripSpeechLeadingZero(month)}/${stripSpeechLeadingZero(day)}/${year}`,
    )
    .replace(/\b(\d{1,2})\/(\d{1,2})\b/g, (_, day, month) =>
      vi ? `${stripSpeechLeadingZero(day)} tháng ${stripSpeechLeadingZero(month)}` : `${stripSpeechLeadingZero(month)}/${stripSpeechLeadingZero(day)}`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*°\s*C\b/gi, (_, value) =>
      vi ? `${value} độ Cê` : `${value} degrees Celsius`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*°\s*F\b/gi, (_, value) =>
      vi ? `${value} độ F` : `${value} degrees Fahrenheit`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*km\/h\b/gi, (_, value) =>
      vi ? `${value} ki lô mét trên giờ` : `${value} kilometers per hour`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*km\b/gi, (_, value) =>
      vi ? `${value} ki lô mét` : `${value} kilometers`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*mm\b/gi, (_, value) =>
      vi ? `${value} mi li mét` : `${value} millimeters`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*cm\b/gi, (_, value) =>
      vi ? `${value} xen ti mét` : `${value} centimeters`,
    )
    .replace(/(-?\d+(?:[.,]\d+)?)\s*%/g, (_, value) =>
      vi ? `${value} phần trăm` : `${value} percent`,
    )
    .replace(/\$\s*([\d.,]+)/g, (_, value) => vi ? `${value} đô la` : `${value} dollars`)
    .replace(/([\d.,]+)\s*(?:USD|usd)\b/g, (_, value) => vi ? `${value} đô la` : `${value} dollars`)
    .replace(/([\d.,]+)\s*(?:VND|vnd|VNĐ|vnđ|₫)\b/g, (_, value) => vi ? `${value} đồng` : `${value} Vietnamese dong`)
    .replace(/€\s*([\d.,]+)/g, (_, value) => vi ? `${value} euro` : `${value} euros`)
    .replace(/£\s*([\d.,]+)/g, (_, value) => vi ? `${value} bảng Anh` : `${value} pounds`);
};

export const sanitizeTextForSpeech = (text: string) => {
  const speechReadyText = normalizeTextForSpeechReading(withSpeechSentenceBreaks(text));
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
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/\s*[-\u2013\u2014]\s*/g, ", ")
    .replace(/\s*[\\/]\s*/g, ", ")
    .replace(/[;,]{2,}/g, ", ")
    .replace(/[.]{4,}/g, "...")
    .replace(/\s+/g, " ")
    .trim();

  const withoutSymbolRuns = collapsed
    .replace(/(^|[\s,.:;!?])[@#$%^&=+~]+(?=$|[\s,.:;!?])/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (withoutSymbolRuns || speechReadyText.trim()).replace(/\s+/g, " ").trim();
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
  if (run.tool_name === "propose_image_generation" || run.tool_name === "generate_image") {
    const mode = readToolString(input, "mode");
    if (mode === "image_to_image") return "img_to_image";
    if (mode === "avatar_image") return "avatar_to_image";
    if (mode === "user_avatar_image" || mode === "avatar_user_image") return "user_avatar_to_image";
    if (mode === "user_character_image" || mode === "user_and_character_image" || mode === "both_avatars_image") return "user_character_to_image";
    return "txt_to_image";
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
