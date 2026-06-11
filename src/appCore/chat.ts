import { ChatContentPart, ChatMessage, FilePreviewResult } from '../types';
import { formatBytes } from '../utils';
import { BrainMessage, ThemeSwatch } from './models';

export const createMessageId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const SPEECH_CACHE_LIMIT = 12;
const MAX_BRAIN_HISTORY_MESSAGES = 18;

const timestampFromMessageId = (id: string) => {
  const timestamp = Number(id.split("-")[0]);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined;
};
export const extractMessageText = (content: ChatMessage["content"]) => {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

export type RecentChatImageContext = {
  role: ChatMessage["role"];
  path?: string;
  hasPixels: boolean;
  text: string;
};

export const findRecentChatImageContext = (
  chatMessages: ChatMessage[],
  options: { skipLatestUserImage?: boolean } = {},
): RecentChatImageContext | null => {
  const latestIndex = chatMessages.length - 1;
  for (let index = latestIndex; index >= 0; index -= 1) {
    const message = chatMessages[index];
    if (options.skipLatestUserImage && index === latestIndex && message.role === "user") {
      continue;
    }
    if (!Array.isArray(message.content)) continue;

    const imagePart = [...message.content].reverse().find((part) => part.type === "image_url");
    if (imagePart?.type === "image_url") {
      return {
        role: message.role,
        path: imagePart.image_url.local_path,
        hasPixels: Boolean(imagePart.image_url.url || imagePart.image_url.local_path),
        text: extractMessageText(message.content).replace(/\s+/g, " ").trim().slice(0, 320),
      };
    }

    const filePreviewPart = message.content.find(
      (part) =>
        part.type === "file_preview" &&
        part.file_preview.mime_type.toLowerCase().startsWith("image/"),
    );
    if (filePreviewPart?.type === "file_preview") {
      return {
        role: message.role,
        path: filePreviewPart.file_preview.path,
        hasPixels: Boolean(filePreviewPart.file_preview.data_url || filePreviewPart.file_preview.path),
        text: extractMessageText(message.content).replace(/\s+/g, " ").trim().slice(0, 320),
      };
    }
  }
  return null;
};

export const buildRecentImageContextBlock = (context: RecentChatImageContext | null) => {
  if (!context) return "";
  const parts = [
    "Recent chat image reference: yes.",
    `Latest prior image was from: ${context.role}.`,
    context.path ? `Latest prior image path: ${context.path}.` : "",
    context.text ? `Nearby text around that image: ${context.text}.` : "",
    "If the user asks to create/edit an image involving a person, object, or scene from that prior chat image, choose image_image. If the generated scene also includes the selected user, image_image is still the correct mode because the prior chat image is a required reference.",
  ].filter(Boolean);
  return parts.join(" ");
};

export const splitAssistantTextForChat = (text: string) => {
  const clean = text.trim();
  const target = 620;
  const hardLimit = 900;
  if (clean.length <= hardLimit) return clean ? [clean] : [];

  const chunks: string[] = [];
  let current = "";
  const pushCurrent = () => {
    const value = current.trim();
    if (value) chunks.push(value);
    current = "";
  };
  const appendUnit = (unit: string) => {
    const piece = unit.trim();
    if (!piece) return;
    if (current && current.length + piece.length + 2 > target) {
      pushCurrent();
    }
    if (piece.length <= hardLimit) {
      current = current ? `${current}\n\n${piece}` : piece;
      return;
    }
    const sentences = piece.match(/[^.!?\u3002\uFF01\uFF1F\n]+[.!?\u3002\uFF01\uFF1F]?/g) ?? [piece];
    for (const sentence of sentences) {
      const line = sentence.trim();
      if (!line) continue;
      if (current && current.length + line.length + 1 > target) {
        pushCurrent();
      }
      if (line.length <= hardLimit) {
        current = current ? `${current} ${line}` : line;
        continue;
      }
      for (let index = 0; index < line.length; index += hardLimit) {
        if (current) pushCurrent();
        const chunk = line.slice(index, index + hardLimit).trim();
        if (chunk) chunks.push(chunk);
      }
    }
  };

  clean.split(/\n{2,}/).forEach(appendUnit);
  pushCurrent();
  return chunks.length ? chunks : [clean];
};

export const splitAssistantMessageForChat = (message: ChatMessage): ChatMessage[] => {
  if (message.role !== "assistant" || typeof message.content !== "string") return [message];
  const chunks = splitAssistantTextForChat(message.content);
  if (chunks.length <= 1) return [{ ...message, content: chunks[0] ?? message.content }];
  return chunks.map((chunk, index) => ({
    ...message,
    id: index === 0 ? message.id : createMessageId(),
    content: chunk,
    thinking: index === 0 ? message.thinking : undefined,
    created_at: message.created_at,
    completed_at: message.completed_at,
    duration_ms: message.duration_ms,
  }));
};

export type DisplayLanguage = "en" | "vi";

export const detectDisplayLanguage = (text: string): DisplayLanguage => {
  return /[\u0100-\u024f\u1ea0-\u1ef9]/.test(text) ? "vi" : "en";
};

export const THEME_SWATCHS: ThemeSwatch[] = [
  { id: "blue", accent: "#a8c7fa", hover: "#bfd4fb", soft: "rgba(168, 199, 250, 0.18)" },
  { id: "green", accent: "#7bd17a", hover: "#96e093", soft: "rgba(123, 209, 122, 0.18)" },
  { id: "lime", accent: "#d7db63", hover: "#e3e882", soft: "rgba(215, 219, 99, 0.18)" },
  { id: "gold", accent: "#f0c531", hover: "#f4d25c", soft: "rgba(240, 197, 49, 0.18)" },
  { id: "orange", accent: "#f45c3d", hover: "#f77860", soft: "rgba(244, 92, 61, 0.18)" },
  { id: "pink", accent: "#d45aae", hover: "#dd78bf", soft: "rgba(212, 90, 174, 0.18)" },
  { id: "purple", accent: "#a95de6", hover: "#bb7ced", soft: "rgba(169, 93, 230, 0.18)" },
];

export const filePreviewContextText = (preview: FilePreviewResult) => {
  const mime = preview.mime_type.toLowerCase();
  const lines = [
    "Previous file preview context. Do not present this as a new result unless a tool runs again:",
    `Title: ${preview.name}`,
    `Type: ${preview.mime_type || preview.extension || "file"}`,
    `Path: ${preview.path}`,
    `Size: ${formatBytes(preview.size_bytes)}`,
  ];
  if (mime.startsWith("image/")) {
    lines.push(preview.data_url ? "Visual: image pixels are available in the conversation context." : "Visual: image pixels are not available.");
  } else if (mime.startsWith("audio/")) {
    lines.push(preview.perception ? `Audio transcript/perception: ${preview.perception}` : "Audio: playable in chat, but no transcript or audio analysis has been generated yet.");
  } else if (mime.startsWith("video/")) {
    lines.push(preview.perception ? `Video transcript/perception: ${preview.perception}` : "Video: playable in chat, but no transcript or frame analysis has been generated yet.");
  } else if (preview.text) {
    lines.push(`Text preview:\n${preview.text.slice(0, 4000)}`);
  }
  if (preview.truncated) {
    lines.push("Status: preview was truncated.");
  }
  return lines.join("\n");
};

export const buildAgentMessageContent = (content: ChatMessage["content"], includeImages: boolean): BrainMessage["content"] => {
  if (typeof content === "string") {
    return content;
  }

  const parts: ChatContentPart[] = [];
  for (const part of content) {
    if (part.type === "text") {
      parts.push(part);
    } else if (part.type === "image_url") {
      if (includeImages) {
        parts.push(part);
      } else {
        parts.push({ type: "text", text: "[image attached]" });
      }
    } else if (part.type === "file_preview") {
      parts.push({ type: "text", text: filePreviewContextText(part.file_preview) });
      if (includeImages && part.file_preview.mime_type.toLowerCase().startsWith("image/") && part.file_preview.data_url) {
        parts.push({ type: "image_url", image_url: { url: part.file_preview.data_url } });
      }
    } else if (part.type === "tool_result_cards") {
      const text = part.cards
        .map((card) => {
          const fields = card.fields
            .map((field) => `${field.label}: ${field.value}`)
            .join("\n");
          const items = card.items
            .slice(0, 5)
            .map((item, index) => {
              const details = item.details.map((field) => `${field.label}: ${field.value}`).join("\n");
              return `${index + 1}. ${item.title}${item.subtitle ? `\n${item.subtitle}` : ""}${details ? `\n${details}` : ""}`;
            })
            .join("\n\n");
          return [`Tool result: ${card.title}`, card.summary || "", fields, items || card.text || ""].filter(Boolean).join("\n");
        })
        .join("\n\n");
      if (text.trim()) {
        parts.push({ type: "text", text: text.slice(0, 8000) });
      }
    } else if (part.type === "image_proposal") {
      const proposalLines = [
        "Pending image proposal awaiting approval:",
        `Prompt: ${part.image_proposal.prompt}`,
        `Mode: ${part.image_proposal.mode}`,
        part.image_proposal.reference_sources?.length ? `Reference sources: ${part.image_proposal.reference_sources.join(", ")}` : "",
        part.image_proposal.mask_prompt ? `Mask prompt: ${part.image_proposal.mask_prompt}` : "",
      ].filter(Boolean);
      parts.push({ type: "text", text: proposalLines.join("\n") });
    } else if (part.type === "action_proposal") {
      const proposalLines = [
        "Pending action proposal awaiting approval:",
        `Action type: ${part.action_proposal.action_type}`,
        `Title: ${part.action_proposal.title}`,
        `Risk: ${part.action_proposal.risk_level}`,
        `Details: ${part.action_proposal.details}`,
      ].filter(Boolean);
      parts.push({ type: "text", text: proposalLines.join("\n") });
    }
  }

  const hasImage = parts.some((part) => part.type === "image_url");
  if (hasImage) {
    return parts;
  }
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

export const extractAgentMessageText = (content: BrainMessage["content"]) => {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

export const normalizeIntentText = (value: string) =>
  value.toLowerCase();

export const isExplicitApprovalText = (text: string) => {
  const normalized = normalizeIntentText(text).replace(/[!?.,]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return [
    "ok",
    "okay",
    "oke",
    "yes",
    "yeah",
    "yep",
    "duoc",
    "duoc roi",
    "u",
    "um",
    "uhm",
    "duyet",
    "duyet di",
    "lam di",
    "ok lam di",
    "oke lam di",
    "tao di",
    "ok tao di",
    "oke tao di",
    "xoa di",
    "ok xoa di",
    "oke xoa di",
  ].includes(normalized);
};

export const findPendingImageProposal = (chatMessages: ChatMessage[]) => {
  for (let messageIndex = chatMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = chatMessages[messageIndex];
    if (message.role !== "assistant") continue;
    if (!Array.isArray(message.content)) return null;
    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex];
      if (part.type === "image_proposal") {
        return { messageId: message.id, partIndex, proposal: part.image_proposal };
      }
    }
    return null;
  }
  return null;
};

export const findPendingActionProposal = (chatMessages: ChatMessage[]) => {
  for (let messageIndex = chatMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = chatMessages[messageIndex];
    if (message.role !== "assistant") continue;
    if (!Array.isArray(message.content)) return null;
    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex];
      if (part.type === "action_proposal") {
        return { messageId: message.id, partIndex, proposal: part.action_proposal };
      }
    }
    return null;
  }
  return null;
};

export const compactMessageForBrain = (message: ChatMessage, isLatest: boolean, includeImages: boolean): BrainMessage | null => {
  const agentContent = buildAgentMessageContent(message.content, includeImages);
  if (message.role === "assistant" && !extractAgentMessageText(agentContent).trim()) {
    return null;
  }

  if (!Array.isArray(agentContent)) {
    return {
      role: message.role,
      content: agentContent,
    };
  }

  if (isLatest) {
    return {
      role: message.role,
      content: agentContent,
    };
  }

  return {
    role: message.role,
    content: agentContent,
  };
};

export const compactContentForStorage = (content: ChatMessage["content"]): ChatMessage["content"] => {
  if (typeof content === "string") {
    return content.slice(0, 12_000);
  }

  const parts = content
    .map((part): ChatContentPart | null => {
      if (part.type === "text") {
        const text = part.text.slice(0, 12_000);
        return text.trim() ? { type: "text", text } : null;
      }
      if (part.type === "image_url") {
        const localPath = part.image_url.local_path;
        const url = localPath ? "" : part.image_url.url;
        if (!localPath && !url) return null;
        return {
          type: "image_url",
          image_url: {
            url,
            local_path: localPath,
          },
        };
      }
      if (part.type === "image_proposal") {
        return part;
      }
      if (part.type === "action_proposal") {
        return part;
      }
      if (part.type === "file_preview") {
        return {
          type: "file_preview",
          file_preview: {
            ...part.file_preview,
            data_url: null,
          },
        };
      }
      return null;
    })
    .filter((part): part is ChatContentPart => Boolean(part));

  return parts.length ? parts : extractMessageText(content).slice(0, 12_000);
};

export const chatMessageHasContent = (message: ChatMessage) => {
  if (typeof message.content === "string") {
    return Boolean(message.content.trim() || message.thinking?.trim());
  }
  return message.content.length > 0 || Boolean(message.thinking?.trim());
};

export const textLooksVietnamese = (text: string) =>
  /[\u0102\u0103\u00C2\u00E2\u0110\u0111\u00CA\u00EA\u00D4\u00F4\u01A0\u01A1\u01AF\u01B0\u00C0-\u1EF9]/u.test(text);

export const conversationWantsVietnamese = (chatMessages: ChatMessage[]) =>
  chatMessages
    .slice(-8)
    .some((message) => textLooksVietnamese(extractMessageText(message.content)));

export const compactChatSessionForStorage = (chatMessages: ChatMessage[]) =>
  chatMessages
    .slice(-80)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: compactContentForStorage(message.content),
      thinking: message.thinking?.slice(0, 6_000),
      created_at: message.created_at,
      completed_at: message.completed_at,
      duration_ms: message.duration_ms,
    }))
    .filter(chatMessageHasContent) as ChatMessage[];

export const compactSessionFingerprint = (chatMessages: ChatMessage[]) =>
  JSON.stringify(compactChatSessionForStorage(chatMessages));

export const parseStoredChatSession = (raw: string): ChatMessage[] => {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((message): ChatMessage | null => {
        if (
          !message ||
          typeof message.id !== "string" ||
          (message.role !== "user" && message.role !== "assistant")
        ) {
          return null;
        }
        const rawContent = message.content;
        let content: ChatMessage["content"] | null = null;
        if (typeof rawContent === "string") {
          content = rawContent;
        } else if (Array.isArray(rawContent)) {
          const parts = rawContent
            .map((part): ChatContentPart | null => {
              if (!part || typeof part !== "object") return null;
              if (part.type === "text" && typeof part.text === "string") {
                return { type: "text", text: part.text };
              }
              if (
                part.type === "image_url" &&
                part.image_url &&
                typeof part.image_url === "object"
              ) {
                const url = typeof part.image_url.url === "string" ? part.image_url.url : "";
                const localPath =
                  typeof part.image_url.local_path === "string" ? part.image_url.local_path : undefined;
                if (!url && !localPath) return null;
                return { type: "image_url", image_url: { url, local_path: localPath } };
              }
              if (
                part.type === "image_proposal" &&
                part.image_proposal &&
                typeof part.image_proposal.prompt === "string" &&
                typeof part.image_proposal.mode === "string"
              ) {
                return { type: "image_proposal", image_proposal: part.image_proposal };
              }
              if (
                part.type === "action_proposal" &&
                part.action_proposal &&
                typeof part.action_proposal.title === "string"
              ) {
                return { type: "action_proposal", action_proposal: part.action_proposal };
              }
              if (
                part.type === "file_preview" &&
                part.file_preview &&
                typeof part.file_preview.path === "string" &&
                typeof part.file_preview.name === "string" &&
                typeof part.file_preview.mime_type === "string"
              ) {
                return {
                  type: "file_preview",
                  file_preview: {
                    path: part.file_preview.path,
                    name: part.file_preview.name,
                    extension:
                      typeof part.file_preview.extension === "string"
                        ? part.file_preview.extension
                        : "",
                    mime_type: part.file_preview.mime_type,
                    size_bytes:
                      typeof part.file_preview.size_bytes === "number"
                        ? part.file_preview.size_bytes
                        : 0,
                    data_url:
                      typeof part.file_preview.data_url === "string"
                        ? part.file_preview.data_url
                        : null,
                    text:
                      typeof part.file_preview.text === "string" ? part.file_preview.text : null,
                    perception:
                      typeof part.file_preview.perception === "string"
                        ? part.file_preview.perception
                        : null,
                    truncated: Boolean(part.file_preview.truncated),
                  },
                };
              }
              return null;
            })
            .filter((part): part is ChatContentPart => Boolean(part));
          content = parts.length ? parts : null;
        }
        if (!content) return null;
        return {
          id: message.id,
          role: message.role,
          content,
          thinking: typeof message.thinking === "string" ? message.thinking : undefined,
          created_at: typeof message.created_at === "number" ? message.created_at : timestampFromMessageId(message.id),
          completed_at: typeof message.completed_at === "number" ? message.completed_at : undefined,
          duration_ms: typeof message.duration_ms === "number" ? message.duration_ms : undefined,
        };
      })
      .filter((message): message is ChatMessage => Boolean(message && chatMessageHasContent(message)))
      .slice(-80);
  } catch {
    return [];
  }
};

export const buildBrainMessages = (systemPrompt: string, chatMessages: ChatMessage[], includeImages: boolean): BrainMessage[] => {
  const recentMessages = chatMessages.slice(-MAX_BRAIN_HISTORY_MESSAGES);
  const lastIndex = recentMessages.length - 1;
  return [
    { role: "system", content: systemPrompt },
    ...recentMessages
      .map((message, index) => compactMessageForBrain(message, index === lastIndex, includeImages))
      .filter((message): message is BrainMessage => Boolean(message)),
  ];
};

const TOOL_AGENT_HISTORY_MESSAGES = 30;
const TOOL_AGENT_OLDER_CONTEXT_EXCLUDE_RECENT = 30;
const TOOL_AGENT_OLDER_CONTEXT_LIMIT = 3600;
const TOOL_AGENT_LATEST_TEXT_LIMIT = 6000;
const TOOL_AGENT_USER_TEXT_LIMIT = 2400;
const TOOL_AGENT_ASSISTANT_TEXT_LIMIT = 1600;

export const truncateForToolAgent = (text: string, limit: number) => {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}\n[message truncated]`;
};

export const compactToolAgentContent = (
  originalContent: ChatMessage["content"],
  role: ChatMessage["role"],
  isLatest: boolean,
): BrainMessage["content"] => {
  const content = buildAgentMessageContent(originalContent, false);
  const limit = isLatest
    ? TOOL_AGENT_LATEST_TEXT_LIMIT
    : role === "user"
      ? TOOL_AGENT_USER_TEXT_LIMIT
      : TOOL_AGENT_ASSISTANT_TEXT_LIMIT;

  if (typeof content === "string") {
    const text = truncateForToolAgent(content, limit);
    if (!Array.isArray(originalContent)) {
      return text;
    }
    const imageMarkers = originalContent.flatMap((part) => {
      if (part.type === "image_url") {
        return [{
          type: "image_url" as const,
          image_url: {
            url: "",
            local_path: part.image_url.local_path,
          },
        }];
      }
      if (part.type === "file_preview" && part.file_preview.mime_type.toLowerCase().startsWith("image/")) {
        return [{
          type: "image_url" as const,
          image_url: {
            url: "",
            local_path: part.file_preview.path,
          },
        }];
      }
      return [];
    });
    if (!imageMarkers.length) {
      return text;
    }
    return [
      ...(text.trim() ? [{ type: "text" as const, text }] : []),
      ...imageMarkers,
    ];
  }

  const parts = content
    .filter((part) => part.type === "text")
    .map((part) => ({
      ...part,
      text: truncateForToolAgent(part.text, limit),
    }))
    .filter((part) => part.text.trim());

  return parts.map((part) => part.text).join("\n").trim();
};

const buildOlderToolContext = (chatMessages: ChatMessage[]) => {
  const olderMessages = chatMessages.slice(0, -TOOL_AGENT_OLDER_CONTEXT_EXCLUDE_RECENT);
  if (!olderMessages.length) return "";

  const lines = olderMessages
    .map((message) => {
      const text = extractMessageText(message.content).replace(/\s+/g, " ").trim();
      if (!text) return "";
      const speaker = message.role === "user" ? "User" : "Assistant";
      return `${speaker}: ${text.slice(0, 260)}`;
    })
    .filter(Boolean);

  if (!lines.length) return "";
  return lines.join("\n").slice(-TOOL_AGENT_OLDER_CONTEXT_LIMIT);
};

export const buildToolAgentMessages = (chatMessages: ChatMessage[]): BrainMessage[] => {
  const recentMessages = chatMessages.slice(-TOOL_AGENT_HISTORY_MESSAGES);
  const lastIndex = recentMessages.length - 1;
  const compacted: BrainMessage[] = [];
  const olderContext = buildOlderToolContext(chatMessages);
  if (olderContext.trim()) {
    compacted.push({
      role: "assistant",
      content: `Earlier conversation context for continuity:\n${olderContext}`,
    });
  }
  recentMessages.forEach((message, index) => {
    const content = compactToolAgentContent(
      message.content,
      message.role,
      index === lastIndex,
    );
    const hasImageMarker = Array.isArray(content) && content.some((part) => part.type === "image_url");
    if (!extractAgentMessageText(content).trim() && !hasImageMarker) return;
    compacted.push({
      role: message.role,
      content,
    });
  });
  return compacted;
};
