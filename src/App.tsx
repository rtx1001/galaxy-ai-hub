import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";
import brandLogo from "./assets/logo-gah.svg";
import { ChatContentPart, ChatMessage, ChatSessions, EngineInfo, ModelLoadStatus, VoiceSetupStatus, ToolResultCard, ImageProposal, ActionProposal, FilePreviewResult } from "./types";
import { MicIcon, SendIcon, StopIcon, ImageIcon, FolderIcon, SpeakerIcon, EraserIcon, EditIcon, PlusIcon, CloseIcon, ChevronDownIcon, ChevronUpIcon, PlayIcon, CameraIcon, BrainIcon, EyeIcon, GearIcon, MenuIcon, TrashIcon, BrushIcon, RefreshIcon, RepeatIcon, SaveIcon } from "./components/Icons";
import { IconButton, SliderField, NumberStepper, AvatarImage } from "./components/UI";
import { FilePreviewCard, ToolResultCards, ImageProposalCard, ActionProposalCard } from "./components/ToolCards";
import { FormattedMessageText } from "./components/ChatBubble";
import { HeartbeatMonitor } from "./components/HeartbeatMonitor";
import { ResourceHeader } from "./components/ResourceHeader";
import { clampNumber, formatBytes, getVietnameseLunarDate } from "./utils";

type VramMemoryStatus = {
  available: boolean;
  used_mb: number;
  total_mb: number;
  free_mb: number;
};

type OmniVoiceVramEstimate = {
  required_mb: number;
  model_mb: number;
  overhead_mb: number;
};

type AudioSynthesisResult = {
  audio_base64: string;
  mime_type: string;
};

type LocalImageDataUrl = {
  data_url: string;
  path: string;
};

type VoiceSample = {
  name: string;
  label: string;
  path: string;
  language?: string | null;
  language_probability?: number | null;
};

type SystemInfo = {
  has_nvidia_gpu: boolean;
  gpu_details: string;
  total_vram_mb: number;
  total_ram_mb: number;
  cpu_name: string;
  cpu_threads: number;
  recommended_chat_gpu_layers: number;
  recommended_task_gpu_layers: number;
  recommended_context_size: number;
};

type ModelLibraryEntry = {
  path: string;
  name: string;
  relative_path: string;
  has_vision: boolean;
};

type ModelStatus = {
  status: string;
  message: string;
  has_vision: boolean;
  model_name: string;
  model_path: string;
  gpu_layers: number;
};

type FileActionResult = {
  success: boolean;
  message: string;
  path: string | null;
};
type AgentReactResult = {
  answer: string;
  thinking?: string | null;
  tool_used: string | null;
  observation: string | null;
  cards: ToolResultCard[];
  image_proposal: ImageProposal | null;
  file_preview: FilePreviewResult | null;
  action_proposal: ActionProposal | null;
  tool_trace: ToolTrace[];
};
type MemoryItem = {
  id: number;
  kind: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  created_at: number;
  updated_at: number;
};
type ToolTrace = {
  tool: string;
  success: boolean;
  summary: string;
};

type ToolRunRecord = {
  id: number;
  tool_name: string;
  input_json: string;
  output_text: string;
  success: boolean;
  duration_ms: number;
  created_at: number;
};

type TelegramBotStatus = {
  success: boolean;
  message: string;
  username: string | null;
};

type TelegramGuest = {
  id: string;
  name: string;
};

type PendingShellAction = {
  id: number;
  command: string;
  working_directory: string;
  purpose: string;
  risk_level: string;
  timeout_seconds: number;
  created_at: number;
};

type ShellExecutionResult = {
  id: number;
  command: string;
  working_directory: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  duration_ms: number;
};

type ShellToolRequest = {
  purpose?: string;
  command?: string;
  working_directory?: string;
  timeout_seconds?: number;
};

type AutomationJob = {
  id: number;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
};

type GoogleConnectionStatus = {
  connected: boolean;
  email: string | null;
  expires_at: number | null;
};

type GoogleCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string | null;
  description: string | null;
  html_link: string | null;
};

type ThemeSwatch = {
  id: string;
  accent: string;
  hover: string;
  soft: string;
};

type AutomationRepeat = "once" | "every_minutes" | "every_hours" | "daily" | "weekly" | "monthly";
type AutomationEveryUnit = "minutes" | "hours";
type SendOptions = {
  text?: string;
  imageDataUrl?: string;
  imagePath?: string;
  sourceLabel?: string;
  skipLocalIntent?: boolean;
  silentUser?: boolean;
  autoApproveActions?: boolean;
};

type AppSettings = {
  setup_completed: boolean;
  user_name: string;
  user_avatar: string;
  user_description: string;
  user_location_label: string;
  user_latitude: number | null;
  user_longitude: number | null;
  theme_swatch_id: string;
  live_conversation: boolean;
  telegram_bot_token: string;
  telegram_owner_id: string;
  telegram_guests: TelegramGuest[];
  thinking_enabled: boolean;
  google_client_id: string;
  google_client_secret: string;
  google_redirect_uri: string;
  image_width: number;
  image_height: number;
  voice_folder: string;
  selected_voice_path: string;
  creativity: number;
  sampling_temperature: number;
  top_k: number;
  top_p: number;
  min_p: number;
  repeat_last_n: number;
  repeat_penalty: number;
  memory_size: number;
  reply_length: number;
  intelligence_quality: number;
  personality: string;
  personality_presets: PersonalityPreset[];
  selected_personality_id: string;
  user_profiles: UserProfilePreset[];
  selected_user_profile_id: string;
  model_folder: string;
  selected_model_path: string;
  linked_folders: string[];
  ui_left_panel_open: boolean;
  ui_right_panel_open: boolean;
  ui_workspace_open: boolean;
  ui_image_studio_open: boolean;
  ui_calendar_open: boolean;
  ui_automation_open: boolean;
  ui_telegram_open: boolean;
  ui_google_open: boolean;
  ui_tool_activity_open: boolean;
  ui_sampling_open: boolean;
};

type PersonalityPreset = {
  id: string;
  name: string;
  prompt: string;
  avatar?: string;
  voice_path?: string;
};

type UserProfilePreset = {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  voice_path?: string;
  location_label?: string;
  latitude?: number | null;
  longitude?: number | null;
  auto_speech?: boolean;
};

type CharacterSettings = {
  voice_path: string;
  avatar: string;
  prompt: string;
  greeting: string;
  notes: string;
};

type CharacterFiles = {
  id: string;
  name: string;
  folder: string;
  soul: string;
  settings: CharacterSettings;
};

const syncSoulCoreIdentity = (soul: string, name: string, prompt: string) => {
  const cleanName = name.trim() || "Assistant";
  const cleanPrompt = prompt.trim() || "A helpful, emotionally aware companion assistant.";
  const baseSoul = soul.trim()
    ? soul.trim()
    : `# ${cleanName} Soul\n\n## Core Identity\n\n${cleanPrompt}\n\n## Emotional Cognition\n\n- First notice the user's language, mood, and implied need before deciding whether to act.\n\n## Speech Style\n\n- Stay natural and concise.\n\n## Boundaries\n\n- Do not invent actions, files, messages, events, or facts.\n`;

  const corePattern = /(## Core Identity\s*\n\n)([\s\S]*?)(?=\n\n## |\s*$)/;
  if (corePattern.test(baseSoul)) {
    return baseSoul.replace(corePattern, `$1${cleanPrompt}`);
  }
  return `${baseSoul}\n\n## Core Identity\n\n${cleanPrompt}`.trim();
};

type BrainMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

const MAX_BRAIN_HISTORY_MESSAGES = 18;

const DEFAULT_SETTINGS: AppSettings = {
  setup_completed: false,
  user_name: "You",
  user_avatar: "",
  user_description: "",
  user_location_label: "",
  user_latitude: null,
  user_longitude: null,
  theme_swatch_id: "blue",
  live_conversation: false,
  telegram_bot_token: "",
  telegram_owner_id: "",
  telegram_guests: [],
  thinking_enabled: false,
  google_client_id: "",
  google_client_secret: "",
  google_redirect_uri: "http://127.0.0.1:8765/google/callback",
  image_width: 1024,
  image_height: 1024,
  voice_folder: "",
  selected_voice_path: "",
  creativity: 50,
  sampling_temperature: 0.6,
  top_k: 40,
  top_p: 0.9,
  min_p: 0.1,
  repeat_last_n: 64,
  repeat_penalty: 1.0,
  memory_size: 4096,
  reply_length: 512,
  intelligence_quality: 50,
  personality: "You are a helpful and friendly AI assistant.",
  personality_presets: [
    {
      id: "default",
      name: "Helpful",
      prompt: "You are a helpful and friendly AI assistant.",
      avatar: "",
    },
  ],
  selected_personality_id: "default",
  user_profiles: [
    {
      id: "default_user",
      name: "You",
      description: "",
      avatar: "",
      voice_path: "",
      location_label: "",
      latitude: null,
      longitude: null,
      auto_speech: true,
    },
  ],
  selected_user_profile_id: "default_user",
  model_folder: "",
  selected_model_path: "",
  linked_folders: [],
  ui_left_panel_open: true,
  ui_right_panel_open: true,
  ui_workspace_open: false,
  ui_image_studio_open: false,
  ui_calendar_open: false,
  ui_automation_open: false,
  ui_telegram_open: false,
  ui_google_open: false,
  ui_tool_activity_open: false,
  ui_sampling_open: false,
};

type SetupTier = "light" | "balanced" | "high";
type SetupPartKey = "brain" | "voice" | "image";

type SetupPart = {
  key: SetupPartKey;
  title: string;
  icon: "brain" | "voice" | "image";
  purpose: string;
  light: string;
  balanced: string;
  high: string;
  note: string;
};

type SetupFile = {
  label: string;
  url: string;
  destination: string;
  size_hint: string;
};

type SetupPartCatalog = {
  key: SetupPartKey;
  title: string;
  files: SetupFile[];
  installed: boolean;
};

type SetupCatalog = {
  tier: SetupTier;
  parts: SetupPartCatalog[];
  brain_model_folder: string;
  selected_brain_model_path: string;
};

type SetupInstallResult = {
  success: boolean;
  message: string;
  catalog: SetupCatalog;
};

type SetupInstallProgress = {
  stage: string;
  part_key: SetupPartKey | "";
  label: string;
  file_index: number;
  file_count: number;
  percent: number;
  message: string;
};

const SETUP_PARTS: SetupPart[] = [
  {
    key: "brain",
    title: "Brain",
    icon: "brain",
    purpose: "Main chat, reasoning, memory, and tool use.",
    light: "Gemma 4 E2B GGUF Q4/Q5",
    balanced: "Gemma 4 E4B GGUF Q5/Q6",
    high: "Gemma 4 E4B GGUF Q8",
    note: "The app always gives the LLM first priority.",
  },
  {
    key: "voice",
    title: "Voice",
    icon: "voice",
    purpose: "Local character speech and one-shot voice samples.",
    light: "Q4 voice model, loaded only when needed",
    balanced: "Q8 voice model, kept ready when VRAM allows",
    high: "Q8 voice model, persistent beside the LLM when possible",
    note: "Starter samples are included for new users.",
  },
  {
    key: "image",
    title: "Image Studio",
    icon: "image",
    purpose: "Text-to-image and image editing from chat.",
    light: "Qwen Image Edit Q3 at smaller resolutions",
    balanced: "Qwen Image Edit Q4 at 1024px",
    high: "Qwen Image Edit Q5 at 1024-1536px",
    note: "Image files stay outside Git and will be downloaded by setup.",
  },
];

const setupTierFromSystem = (info: SystemInfo | null): SetupTier => {
  if (!info) return "balanced";
  if (info.total_ram_mb >= 60000 && info.total_vram_mb >= 12000) return "high";
  if (info.total_ram_mb >= 30000 && info.total_vram_mb >= 8000) return "balanced";
  return "light";
};

const setupTierLabel = (tier: SetupTier) => {
  if (tier === "high") return "High";
  if (tier === "balanced") return "Balanced";
  return "Light";
};

const setupTierDescription = (tier: SetupTier) => {
  if (tier === "high") return "Best for larger context, smoother voice, and heavier image work.";
  if (tier === "balanced") return "Best default for local chat, voice, and 1024px image generation.";
  return "Best for lighter PCs. Chat comes first and other models swap when needed.";
};

const setupPartModel = (part: SetupPart, tier: SetupTier) => {
  if (tier === "high") return part.high;
  if (tier === "balanced") return part.balanced;
  return part.light;
};

const setupPartIntro = (part: SetupPart) => {
  if (part.key === "brain") return "The part that thinks and chats.";
  if (part.key === "voice") return "The part that lets characters speak.";
  return "The part that paints and edits images.";
};

const setupTotalSizeLabel = (catalog: SetupCatalog | null) => {
  if (!catalog) return "Checking download size...";
  const labels = catalog.parts.flatMap((part) => part.files.map((file) => file.size_hint));
  if (!labels.length) return "Download size will be shown before install.";
  return `Downloads: ${labels.join(" + ")}`;
};


const createMessageId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SPEECH_CACHE_LIMIT = 12;
const SHELL_TOOL_PATTERN = /<galaxy_shell>\s*([\s\S]*?)\s*<\/galaxy_shell>/i;
const extractMessageText = (content: ChatMessage["content"]) => {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

const splitAssistantTextForChat = (text: string) => {
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

const splitAssistantMessageForChat = (message: ChatMessage): ChatMessage[] => {
  if (message.role !== "assistant" || typeof message.content !== "string") return [message];
  const chunks = splitAssistantTextForChat(message.content);
  if (chunks.length <= 1) return [{ ...message, content: chunks[0] ?? message.content }];
  return chunks.map((chunk, index) => ({
    ...message,
    id: index === 0 ? message.id : createMessageId(),
    content: chunk,
    thinking: index === 0 ? message.thinking : undefined,
  }));
};

type DisplayLanguage = "en" | "vi";

const detectDisplayLanguage = (text: string): DisplayLanguage => {
  return /[\u0100-\u024f\u1ea0-\u1ef9]/.test(text) ? "vi" : "en";
};

const THEME_SWATCHS: ThemeSwatch[] = [
  { id: "blue", accent: "#a8c7fa", hover: "#bfd4fb", soft: "rgba(168, 199, 250, 0.18)" },
  { id: "green", accent: "#7bd17a", hover: "#96e093", soft: "rgba(123, 209, 122, 0.18)" },
  { id: "lime", accent: "#d7db63", hover: "#e3e882", soft: "rgba(215, 219, 99, 0.18)" },
  { id: "gold", accent: "#f0c531", hover: "#f4d25c", soft: "rgba(240, 197, 49, 0.18)" },
  { id: "orange", accent: "#f45c3d", hover: "#f77860", soft: "rgba(244, 92, 61, 0.18)" },
  { id: "pink", accent: "#d45aae", hover: "#dd78bf", soft: "rgba(212, 90, 174, 0.18)" },
  { id: "purple", accent: "#a95de6", hover: "#bb7ced", soft: "rgba(169, 93, 230, 0.18)" },
];

const filePreviewContextText = (preview: FilePreviewResult) => {
  const mime = preview.mime_type.toLowerCase();
  const lines = [
    "File preview shown in this conversation:",
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

const buildAgentMessageContent = (content: ChatMessage["content"], includeImages: boolean): BrainMessage["content"] => {
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

const extractAgentMessageText = (content: BrainMessage["content"]) => {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

const isExplicitApprovalText = (text: string) => {
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

const findPendingImageProposal = (chatMessages: ChatMessage[]) => {
  for (let messageIndex = chatMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = chatMessages[messageIndex];
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex];
      if (part.type === "image_proposal") {
        return { messageId: message.id, partIndex, proposal: part.image_proposal };
      }
    }
  }
  return null;
};

const findPendingActionProposal = (chatMessages: ChatMessage[]) => {
  for (let messageIndex = chatMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = chatMessages[messageIndex];
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex];
      if (part.type === "action_proposal") {
        return { messageId: message.id, partIndex, proposal: part.action_proposal };
      }
    }
  }
  return null;
};

const compactMessageForBrain = (message: ChatMessage, isLatest: boolean, includeImages: boolean): BrainMessage | null => {
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

const compactContentForStorage = (content: ChatMessage["content"]): ChatMessage["content"] => {
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
      return null;
    })
    .filter((part): part is ChatContentPart => Boolean(part));

  return parts.length ? parts : extractMessageText(content).slice(0, 12_000);
};

const chatMessageHasContent = (message: ChatMessage) => {
  if (typeof message.content === "string") {
    return Boolean(message.content.trim() || message.thinking?.trim());
  }
  return message.content.length > 0 || Boolean(message.thinking?.trim());
};

const textLooksVietnamese = (text: string) =>
  /[\u0102\u0103\u00C2\u00E2\u0110\u0111\u00CA\u00EA\u00D4\u00F4\u01A0\u01A1\u01AF\u01B0\u00C0-\u1EF9]/u.test(text);

const conversationWantsVietnamese = (chatMessages: ChatMessage[]) =>
  chatMessages
    .slice(-8)
    .some((message) => textLooksVietnamese(extractMessageText(message.content)));

const compactChatSessionForStorage = (chatMessages: ChatMessage[]) =>
  chatMessages
    .slice(-80)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: compactContentForStorage(message.content),
      thinking: message.thinking?.slice(0, 6_000),
    }))
    .filter(chatMessageHasContent) as ChatMessage[];

const compactSessionFingerprint = (chatMessages: ChatMessage[]) =>
  JSON.stringify(compactChatSessionForStorage(chatMessages));

const parseStoredChatSession = (raw: string): ChatMessage[] => {
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
        };
      })
      .filter((message): message is ChatMessage => Boolean(message && chatMessageHasContent(message)))
      .slice(-80);
  } catch {
    return [];
  }
};

const buildBrainMessages = (systemPrompt: string, chatMessages: ChatMessage[], includeImages: boolean): BrainMessage[] => {
  const recentMessages = chatMessages.slice(-MAX_BRAIN_HISTORY_MESSAGES);
  const lastIndex = recentMessages.length - 1;
  return [
    { role: "system", content: systemPrompt },
    ...recentMessages
      .map((message, index) => compactMessageForBrain(message, index === lastIndex, includeImages))
      .filter((message): message is BrainMessage => Boolean(message)),
  ];
};

const TOOL_AGENT_HISTORY_MESSAGES = 14;
const TOOL_AGENT_LATEST_TEXT_LIMIT = 6000;
const TOOL_AGENT_USER_TEXT_LIMIT = 2400;
const TOOL_AGENT_ASSISTANT_TEXT_LIMIT = 1600;

const truncateForToolAgent = (text: string, limit: number) => {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}\n[message truncated]`;
};

const compactToolAgentContent = (
  content: BrainMessage["content"],
  role: ChatMessage["role"],
  isLatest: boolean,
): BrainMessage["content"] => {
  const limit = isLatest
    ? TOOL_AGENT_LATEST_TEXT_LIMIT
    : role === "user"
      ? TOOL_AGENT_USER_TEXT_LIMIT
      : TOOL_AGENT_ASSISTANT_TEXT_LIMIT;

  if (typeof content === "string") {
    return truncateForToolAgent(content, limit);
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

const buildToolAgentMessages = (chatMessages: ChatMessage[]): BrainMessage[] => {
  const recentMessages = chatMessages.slice(-TOOL_AGENT_HISTORY_MESSAGES);
  const lastIndex = recentMessages.length - 1;
  const compacted: BrainMessage[] = [];
  recentMessages.forEach((message, index) => {
    const content = compactToolAgentContent(
      buildAgentMessageContent(message.content, false),
      message.role,
      index === lastIndex,
    );
    if (!extractAgentMessageText(content).trim()) return;
    compacted.push({
      role: message.role,
      content,
    });
  });
  return compacted;
};

const isGpuFitError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /free device memory|failed to fit|n_gpu_layers|out of memory|oom/i.test(message);
};

const estimateTokens = (text: string) => Math.max(0, Math.ceil(text.length / 4));

const extractShellToolRequest = (text: string): ShellToolRequest | null => {
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

const stripShellToolRequest = (text: string) =>
  text.replace(SHELL_TOOL_PATTERN, "").trim();

const withSpeechSentenceBreaks = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/([.!?\u2026])\s*\n+\s*/g, "$1 ")
    .replace(/([^.!?\u2026\s])\s*\n+\s*/g, "$1. ")
    .replace(/\n+/g, ". ");

const stripSpeechLeadingZero = (value: string) => {
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) ? String(numeric) : value;
};

const normalizeTextForSpeechReading = (text: string) => {
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

const sanitizeTextForSpeech = (text: string) => {
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

const formatReactThinking = (result: AgentReactResult) => {
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

const includesAnyPhrase = (text: string, phrases: string[]) =>
  phrases.some((phrase) => text.includes(phrase));

const normalizeIntentText = (value: string) =>
  value.toLowerCase();

const getDefaultLocalContext = () => "unknown";
const formatFileActionResult = (result: FileActionResult) =>
  [
    result.success ? "File action completed." : "File action could not be completed.",
    result.message,
    result.path ? `Path: ${result.path}` : "",
  ].filter(Boolean).join("\n");

const formatShellResult = (result: ShellExecutionResult) => {
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

const formatToolRunTime = (createdAt: number) => {
  if (!createdAt) return "";
  return new Date(createdAt * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatToolDuration = (durationMs?: number) => {
  if (!durationMs || durationMs < 0) return "0s";
  if (durationMs < 1000) {
    return `${Math.max(0.1, durationMs / 1000).toFixed(1)}s`;
  }
  const seconds = Math.round(durationMs / 1000);
  return `${seconds}s`;
};

const parseToolJson = (value: string) => {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const readToolString = (record: Record<string, unknown>, key: string) => {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
};

const toolRunDisplayName = (run: ToolRunRecord) => {
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

const toolRunBrief = (run: ToolRunRecord) => {
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

const toLocalDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const monthTitle = (date: Date) =>
  new Intl.DateTimeFormat(undefined, { month: "short" }).format(date).toUpperCase();

const getLunarLabel = (date: Date) => {
  try {
    const parts = new Intl.DateTimeFormat("vi-VN-u-ca-chinese", {
      day: "numeric",
      month: "numeric",
    }).formatToParts(date);
    const day = parts.find((part) => part.type === "day")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    return day && month ? `${day}/${month}` : "";
  } catch {
    return "";
  }
};

const buildMonthDays = (monthDate: Date) => {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
};

const googleEventMatchesDate = (event: GoogleCalendarEvent, dateKey: string) =>
  event.start.slice(0, 10) === dateKey || event.end.slice(0, 10) === dateKey;

const googleEventTimeLabel = (event: GoogleCalendarEvent | null, withDate = false) => {
  if (!event) return "";
  if (event.all_day) {
    try {
      const d = event.start ? new Date(event.start) : new Date();
      return withDate ? `${toLocalDateKey(d)} - All day` : "All day";
    } catch {
      return "All day";
    }
  }
  const start = new Date(event.start || "");
  const end = new Date(event.end || "");
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
  if (Number.isNaN(start.getTime())) return "";
  
  const timeStr = Number.isNaN(end.getTime()) 
    ? timeFormat.format(start) 
    : `${timeFormat.format(start)} - ${timeFormat.format(end)}`;
    
  if (withDate) {
    try {
      const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
      return `${dateFormat.format(start)} - ${timeStr}`;
    } catch {
      return timeStr;
    }
  }
  return timeStr;
};

const buildGoogleMonthRange = (monthDate: Date) => {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1, 0, 0, 0, 0);
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1, 0, 0, 0, 0);
  return { timeMin: first.toISOString(), timeMax: last.toISOString() };
};

const normalizeCalendarEventForDisplay = (event: GoogleCalendarEvent): GoogleCalendarEvent => {
  if (event.all_day) {
    return event;
  }
  const start = event.start && !/[zZ]|[+-]\d{2}:\d{2}$/.test(event.start) ? `${event.start}Z` : event.start;
  const end = event.end && !/[zZ]|[+-]\d{2}:\d{2}$/.test(event.end) ? `${event.end}Z` : event.end;
  return { ...event, start, end };
};

const buildAutomationSchedule = (
  date: string,
  time: string,
  repeat: AutomationRepeat,
  everyAmount = 15,
  everyUnit: AutomationEveryUnit = "minutes",
) => {
  const safeEveryAmount = Math.max(1, Math.floor(everyAmount || 1));
  const everySuffix = repeat === "every_hours" || everyUnit === "hours" ? "h" : "m";
  const repeatPart =
    repeat === "once"
      ? ""
      : repeat === "every_minutes" || repeat === "every_hours"
        ? ` @every:${safeEveryAmount}${everySuffix}`
          : ` @${repeat}`;
  const timePart = time ? ` ${time}` : "";
  return `${date}${repeatPart}${timePart}`.trim();
};

const automationRepeatLabel = (repeat: string) => {
  const everyMatch = /^@?every:(\d+)(m|h)$/.exec(repeat);
  if (everyMatch) {
    const amount = Number(everyMatch[1]);
    const unit = everyMatch[2] === "h" ? "hour" : "min";
    return `Every ${amount} ${unit}${unit === "hour" && amount !== 1 ? "s" : ""}`;
  }
  if (repeat === "@5m" || repeat === "5m") return "Every 5 min";
  if (repeat === "@15m" || repeat === "15m") return "Every 15 min";
  if (repeat === "@30m" || repeat === "30m") return "Every 30 min";
  if (repeat === "@hourly" || repeat === "hourly") return "Every 1 hour";
  if (repeat === "@daily" || repeat === "daily") return "Daily";
  if (repeat === "@weekly" || repeat === "weekly") return "Weekly";
  if (repeat === "@monthly" || repeat === "monthly") return "Monthly";
  return "Once";
};

const automationScheduleLabel = (value: string, selectedDate: string) => {
  const trimmed = value.trim();
  if (!trimmed) return `Once - ${selectedDate}`;
  const parts = trimmed.split(/\s+/);
  if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
    const repeat = parts.find((part) => part.startsWith("@")) ?? "";
    const time = parts.find((part) => /^\d{2}:\d{2}$/.test(part)) ?? "";
    const day = parts[0];
    const repeatLabel = repeat ? automationRepeatLabel(repeat) : `Once - ${day}`;
    return `${repeatLabel}${time ? ` - ${time}` : ""}`;
  }
  if (/^\d{2}:\d{2}$/.test(trimmed)) return `Once - ${selectedDate} - ${trimmed}`;
  if (trimmed.startsWith("@")) return automationRepeatLabel(trimmed);
  return trimmed;
};

const parseAutomationSchedule = (schedule: string, fallbackDate: string) => {
  const parts = schedule.trim().split(/\s+/).filter(Boolean);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(parts[0] || "") ? parts[0] : fallbackDate;
  const repeatToken = parts.find((part) => /^@(5m|15m|30m|hourly|daily|weekly|monthly|every:\d+[mh])$/.test(part));
  const time = parts.find((part) => /^\d{2}:\d{2}$/.test(part)) || "";
  if (!repeatToken) return { date, time, repeat: "once" as AutomationRepeat, everyAmount: 15, everyUnit: "minutes" as AutomationEveryUnit };
  const everyMatch = /^@every:(\d+)(m|h)$/.exec(repeatToken);
  if (everyMatch) {
    const everyUnit = everyMatch[2] === "h" ? "hours" : "minutes";
    return {
      date,
      time,
      repeat: everyUnit === "hours" ? "every_hours" as AutomationRepeat : "every_minutes" as AutomationRepeat,
      everyAmount: clampNumber(Number(everyMatch[1]), 1, everyUnit === "hours" ? 24 : 1440),
      everyUnit: everyUnit as AutomationEveryUnit,
    };
  }
  if (repeatToken === "@hourly") return { date, time, repeat: "every_hours" as AutomationRepeat, everyAmount: 1, everyUnit: "hours" as AutomationEveryUnit };
  if (repeatToken === "@5m" || repeatToken === "@15m" || repeatToken === "@30m") {
    return { date, time, repeat: "every_minutes" as AutomationRepeat, everyAmount: Number(repeatToken.slice(1, -1)), everyUnit: "minutes" as AutomationEveryUnit };
  }
  return { date, time, repeat: repeatToken.slice(1) as AutomationRepeat, everyAmount: 15, everyUnit: "minutes" as AutomationEveryUnit };
};

const compactAutomationSummary = (name: string, schedule: string, prompt: string, fallbackDate: string) => {
  const scheduleText = automationScheduleLabel(schedule, fallbackDate);
  const task = prompt.trim().replace(/\s+/g, " ");
  return [name.trim(), scheduleText, task].filter(Boolean).join(" - ");
};

const parseTimeParts = (time = "") => {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return { hours: 0, minutes: 0 };
  return { hours: Number(match[1]), minutes: Number(match[2]) };
};

const automationIntervalMinutes = (repeat: string) => {
  const everyMatch = /^@every:(\d+)(m|h)$/.exec(repeat);
  if (everyMatch) return Number(everyMatch[1]) * (everyMatch[2] === "h" ? 60 : 1);
  if (repeat === "@5m") return 5;
  if (repeat === "@15m") return 15;
  if (repeat === "@30m") return 30;
  if (repeat === "@hourly") return 60;
  return 0;
};

const getAutomationDueAt = (job: AutomationJob, now: Date) => {
  const parts = job.schedule.trim().split(/\s+/).filter(Boolean);
  const datePart = parts[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;

  const repeat = parts.find((part) => /^@(5m|15m|30m|hourly|daily|weekly|monthly|every:\d+[mh])$/.test(part));
  const timePart = parts.find((part) => /^\d{2}:\d{2}$/.test(part)) ?? "";
  const anchor = new Date(`${datePart}T00:00:00`);
  if (Number.isNaN(anchor.getTime()) || now < anchor) return null;

  const { hours, minutes } = parseTimeParts(timePart);
  const firstRun = new Date(anchor);
  firstRun.setHours(hours, minutes, 0, 0);

  const interval = repeat ? automationIntervalMinutes(repeat) : 0;
  if (interval > 0) {
    if (now < firstRun) return null;
    const elapsed = now.getTime() - firstRun.getTime();
    const intervalMs = interval * 60_000;
    return firstRun.getTime() + Math.floor(elapsed / intervalMs) * intervalMs;
  }

  const candidate = new Date(now);
  candidate.setHours(hours, minutes, 0, 0);

  if (!repeat) {
    candidate.setFullYear(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  } else if (repeat === "@weekly" && candidate.getDay() !== anchor.getDay()) {
    return null;
  } else if (repeat === "@monthly" && candidate.getDate() !== anchor.getDate()) {
    return null;
  }

  if (now < candidate) return null;
  return candidate.getTime();
};
const extractTextValue = (value: unknown): string => {
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

const extractChoiceText = (choice: unknown) => {
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

const extractChatResponseText = (data: unknown) => {
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

const stripThinkBlocks = (text: string) =>
  text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();

const detectVoicePreviewText = (sample?: VoiceSample) => {
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

const previewTextForDetectedLanguage = (language?: string | null) => {
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

function App() {
  const [brainStatus, setBrainStatus] = useState<"Idle" | "Loading" | "Ready" | "Thinking" | "Error">("Idle");
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [engineStatus, setEngineStatus] = useState<"initializing" | "downloading" | "ready" | "error">("initializing");
  const [engineErrorMsg, setEngineErrorMsg] = useState("");
  const [, setEngineInfo] = useState<EngineInfo | null>(null);
  const [modelLoadStatus, setModelLoadStatus] = useState<ModelLoadStatus>({
    state: "idle",
    message: "",
    progress: 0,
  });
  const [voiceSetupStatus, setVoiceSetupStatus] = useState<VoiceSetupStatus>({
    state: "idle",
    message: "Voice helper is waiting.",
    progress: 0,
    ready: false,
  });
  const [omniVoiceStatus, setOmniVoiceStatus] = useState<VoiceSetupStatus>({
    state: "idle",
    message: "Voice playback engine is waiting.",
    progress: 0,
    ready: false,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatDisplayLanguage: DisplayLanguage = (() => {
    const latestUserText = [...messages]
      .reverse()
      .find((message) => message.role === "user" && extractMessageText(message.content).trim());
    return detectDisplayLanguage(extractMessageText(latestUserText?.content ?? ""));
  })();
  const [chatSessions, setChatSessions] = useState<ChatSessions>({});
  const [input, setInput] = useState("");
  const [composerHasText, setComposerHasText] = useState(false);
  const [userName, setUserName] = useState(DEFAULT_SETTINGS.user_name);
  const [userAvatar, setUserAvatar] = useState(DEFAULT_SETTINGS.user_avatar);
  const [userDescription, setUserDescription] = useState(DEFAULT_SETTINGS.user_description);
  const [userProfiles, setUserProfiles] = useState<UserProfilePreset[]>(DEFAULT_SETTINGS.user_profiles);
  const [selectedUserProfileId, setSelectedUserProfileId] = useState(DEFAULT_SETTINGS.selected_user_profile_id);
  const [userProfileMenuOpen, setUserProfileMenuOpen] = useState(false);
  const [userProfileOpen, setUserProfileOpen] = useState(false);
  const [deleteUserProfileConfirmOpen, setDeleteUserProfileConfirmOpen] = useState(false);
  const [userLocationLabel, setUserLocationLabel] = useState(DEFAULT_SETTINGS.user_location_label);
  const [userLatitude, setUserLatitude] = useState<number | null>(DEFAULT_SETTINGS.user_latitude);
  const [userLongitude, setUserLongitude] = useState<number | null>(DEFAULT_SETTINGS.user_longitude);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [pendingShellActions, setPendingShellActions] = useState<PendingShellAction[]>([]);
  const [executingShellActionId, setExecutingShellActionId] = useState<number | null>(null);
  const [toolRuns, setToolRuns] = useState<ToolRunRecord[]>([]);
  const [toolRunsOpen, setToolRunsOpen] = useState(DEFAULT_SETTINGS.ui_tool_activity_open);
  const [automationJobs, setAutomationJobs] = useState<AutomationJob[]>([]);
  const [automationOpen, setAutomationOpen] = useState(DEFAULT_SETTINGS.ui_automation_open);
  const [workspaceOpen, setWorkspaceOpen] = useState(DEFAULT_SETTINGS.ui_workspace_open);
  const [imageStudioOpen, setImageStudioOpen] = useState(DEFAULT_SETTINGS.ui_image_studio_open);
  const [calendarOpen, setCalendarOpen] = useState(DEFAULT_SETTINGS.ui_calendar_open);
  const [telegramPanelOpen, setTelegramPanelOpen] = useState(DEFAULT_SETTINGS.ui_telegram_open);
  const [googlePanelOpen, setGooglePanelOpen] = useState(DEFAULT_SETTINGS.ui_google_open);
  const [samplingOpen, setSamplingOpen] = useState(DEFAULT_SETTINGS.ui_sampling_open);
  const [automationName, setAutomationName] = useState("");
  const [automationPrompt, setAutomationPrompt] = useState("");
  const [automationDate, setAutomationDate] = useState(() => toLocalDateKey(new Date()));
  const [automationTime, setAutomationTime] = useState("");
  const [automationRepeat, setAutomationRepeat] = useState<AutomationRepeat>("once");
  const [automationEveryAmount, setAutomationEveryAmount] = useState(15);
  const [automationEveryUnit, setAutomationEveryUnit] = useState<AutomationEveryUnit>("minutes");
  const [automationTimeMenuOpen, setAutomationTimeMenuOpen] = useState(false);
  const [automationDateMenuOpen, setAutomationDateMenuOpen] = useState(false);
  const [automationMonthMenuOpen, setAutomationMonthMenuOpen] = useState(false);
  const [automationEveryUnitMenuOpen, setAutomationEveryUnitMenuOpen] = useState(false);
  const [automationEditorMonth, setAutomationEditorMonth] = useState(() => new Date());
  const [automationMonth, setAutomationMonth] = useState(() => new Date());
  const [selectedAutomationDate, setSelectedAutomationDate] = useState(() => toLocalDateKey(new Date()));
  const [automationEditorOpen, setAutomationEditorOpen] = useState(false);
  const [editingAutomationId, setEditingAutomationId] = useState<number | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [freshChatConfirmOpen, setFreshChatConfirmOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [composerNotice, setComposerNotice] = useState("");
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [themeSwatchId, setThemeSwatchId] = useState(DEFAULT_SETTINGS.theme_swatch_id);
  const [clearMemoryConfirmOpen, setClearMemoryConfirmOpen] = useState(false);
  const [clearSessionToo, setClearSessionToo] = useState(false);
  const [deletePersonalityConfirmOpen, setDeletePersonalityConfirmOpen] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsReadyForSave, setSettingsReadyForSave] = useState(false);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [setupCompleted, setSetupCompleted] = useState(DEFAULT_SETTINGS.setup_completed);
  const [setupTierOverride, setSetupTierOverride] = useState<SetupTier | null>(null);
  const [setupCatalog, setSetupCatalog] = useState<SetupCatalog | null>(null);
  const [setupInstalling, setSetupInstalling] = useState(false);
  const [setupNotice, setSetupNotice] = useState("");
  const [setupProgress, setSetupProgress] = useState<SetupInstallProgress | null>(null);
  const [collapsedImageParts, setCollapsedImageParts] = useState<Record<string, boolean>>({});
  const [imageViewer, setImageViewer] = useState<{ url: string; localPath?: string; zoom: number; x: number; y: number } | null>(null);
  const [liveConversation, setLiveConversation] = useState(DEFAULT_SETTINGS.live_conversation);
  const [telegramBotToken, setTelegramBotToken] = useState(DEFAULT_SETTINGS.telegram_bot_token);
  const [telegramOwnerId, setTelegramOwnerId] = useState(DEFAULT_SETTINGS.telegram_owner_id);
  const [telegramGuests, setTelegramGuests] = useState<TelegramGuest[]>(DEFAULT_SETTINGS.telegram_guests);
  const [telegramGuestDraft, setTelegramGuestDraft] = useState<TelegramGuest | null>(null);
  const [telegramStatus, setTelegramStatus] = useState("");
  const [telegramRunning, setTelegramRunning] = useState(false);
  const [googleClientId, setGoogleClientId] = useState(DEFAULT_SETTINGS.google_client_id);
  const [googleClientSecret, setGoogleClientSecret] = useState(DEFAULT_SETTINGS.google_client_secret);
  const [googleRedirectUri, setGoogleRedirectUri] = useState(DEFAULT_SETTINGS.google_redirect_uri);
  const [googleStatus, setGoogleStatus] = useState<GoogleConnectionStatus>({
    connected: false,
    email: null,
    expires_at: null,
  });
  const [googleCalendarEvents, setGoogleCalendarEvents] = useState<GoogleCalendarEvent[]>([]);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleNotice, setGoogleNotice] = useState("");
  const [selectedGoogleEvent, setSelectedGoogleEvent] = useState<GoogleCalendarEvent | null>(null);
  const [googleDeleteTarget, setGoogleDeleteTarget] = useState<GoogleCalendarEvent | null>(null);
  const [imageWidth, setImageWidth] = useState(DEFAULT_SETTINGS.image_width);
  const [imageHeight, setImageHeight] = useState(DEFAULT_SETTINGS.image_height);
  const [quickImagePrompt, setQuickImagePrompt] = useState("");
  const [voiceFolder, setVoiceFolder] = useState(DEFAULT_SETTINGS.voice_folder);
  const [selectedVoicePath, setSelectedVoicePath] = useState(DEFAULT_SETTINGS.selected_voice_path);
  const [creativity, setCreativity] = useState(DEFAULT_SETTINGS.creativity);
  const [samplingTemperature, setSamplingTemperature] = useState(DEFAULT_SETTINGS.sampling_temperature);
  const [topK, setTopK] = useState(DEFAULT_SETTINGS.top_k);
  const [topP, setTopP] = useState(DEFAULT_SETTINGS.top_p);
  const [minP, setMinP] = useState(DEFAULT_SETTINGS.min_p);
  const [repeatLastN, setRepeatLastN] = useState(DEFAULT_SETTINGS.repeat_last_n);
  const [repeatPenalty, setRepeatPenalty] = useState(DEFAULT_SETTINGS.repeat_penalty);
  const [memorySize, setMemorySize] = useState(DEFAULT_SETTINGS.memory_size);
  const [replyLength, setReplyLength] = useState(DEFAULT_SETTINGS.reply_length);
  const [intelligenceQuality, setIntelligenceQuality] = useState(DEFAULT_SETTINGS.intelligence_quality);
  const [personality, setPersonality] = useState(DEFAULT_SETTINGS.personality);
  const [personalityAvatar, setPersonalityAvatar] = useState(DEFAULT_SETTINGS.personality_presets[0].avatar ?? "");
  const [personalityPresets, setPersonalityPresets] = useState<PersonalityPreset[]>(DEFAULT_SETTINGS.personality_presets);
  const [selectedPersonalityId, setSelectedPersonalityId] = useState(DEFAULT_SETTINGS.selected_personality_id);
  const [personalityMemory, setPersonalityMemory] = useState("");
  const [characterSoul, setCharacterSoul] = useState("");
  const [characterFolder, setCharacterFolder] = useState("");
  const [modelFolder, setModelFolder] = useState(DEFAULT_SETTINGS.model_folder);
  const [linkedFolders, setLinkedFolders] = useState<string[]>(DEFAULT_SETTINGS.linked_folders);
  const [voiceSamples, setVoiceSamples] = useState<VoiceSample[]>([]);
  const [availableModels, setAvailableModels] = useState<ModelLibraryEntry[]>([]);
  const [selectedModelPath, setSelectedModelPath] = useState(DEFAULT_SETTINGS.selected_model_path);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [hasVision, setHasVision] = useState(false);
  const [activeTaskType, setActiveTaskType] = useState<"none" | "llm" | "voice" | "image">("none");
  const [pendingAutoLoadPath, setPendingAutoLoadPath] = useState<string | null>(null);
  const [leftPanelOpen, setLeftPanelOpen] = useState(DEFAULT_SETTINGS.ui_left_panel_open);
  const [rightPanelOpen, setRightPanelOpen] = useState(DEFAULT_SETTINGS.ui_right_panel_open);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [quickModelMenuOpen, setQuickModelMenuOpen] = useState(false);
  const [personalityMenuOpen, setPersonalityMenuOpen] = useState(false);
  const [personalityProfileOpen, setPersonalityProfileOpen] = useState(false);
  const [personalityNameDraft, setPersonalityNameDraft] = useState(DEFAULT_SETTINGS.personality_presets[0].name);
  const [dateTimeLine, setDateTimeLine] = useState("");
  const [, setLastTokenSpeed] = useState(0);
  const [, setLastContextTokens] = useState(0);
  const [previewingVoicePath, setPreviewingVoicePath] = useState<string | null>(null);
  const [thinkingEnabled, setThinkingEnabled] = useState(DEFAULT_SETTINGS.thinking_enabled);
  const [isCompactLayout, setIsCompactLayout] = useState(
    typeof window !== "undefined"
      ? window.innerWidth - 292 * 2 < 482
      : false,
  );

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const userAvatarPickerRef = useRef<HTMLInputElement | null>(null);
  const personalityAvatarPickerRef = useRef<HTMLInputElement | null>(null);
  const avatarTargetPersonalityIdRef = useRef<string | null>(null);
  const selectedVoiceRowRef = useRef<HTMLDivElement | null>(null);
  const selectedUserVoiceRowRef = useRef<HTMLDivElement | null>(null);
  const imageViewerDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastComposerInputAtRef = useRef(0);
  const lastUiInteractionAtRef = useRef(0);
  const conversationScrollRef = useRef<HTMLElement | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const lastMessageCountRef = useRef(0);
  const chatSessionsRef = useRef<ChatSessions>({});
  const loadedChatSessionIdsRef = useRef<Set<string>>(new Set());
  const sessionShadowRef = useRef<Record<string, string>>({});
  const lastSessionMutationAtRef = useRef<Record<string, number>>({});
  const personalityMemoryShadowRef = useRef<Record<string, string>>({});
  const systemDefaultsAppliedRef = useRef(false);
  const speechCacheRef = useRef<Map<string, AudioSynthesisResult>>(new Map());
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioUrlRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioPlaybackUnlockedRef = useRef(false);
  const voicePlaybackRequestRef = useRef(0);
  const lastAutoSpokenAssistantIdRef = useRef<string | null>(null);
  const autoSpeechEligibleAssistantIdsRef = useRef<Set<string>>(new Set());
  const autoSpeechQueueRef = useRef<string[]>([]);
  const liveConversationRef = useRef(liveConversation);
  const sendInFlightRef = useRef(false);
  const activeChatAbortRef = useRef<AbortController | null>(null);
  const activeChatRequestRef = useRef(0);
  const activeTaskTypeRef = useRef(activeTaskType);
  const automationRunKeysRef = useRef<Set<string>>(new Set());
  const settingsHydratedAtRef = useRef(0);
  const telegramAutoStartAttemptedRef = useRef(false);

  const currentModelEntry =
    availableModels.find((model) => model.path === selectedModelPath) ?? null;
  const localContext = getDefaultLocalContext();
  const selectedVoiceSample =
    voiceSamples.find((sample) => sample.path === selectedVoicePath) ?? null;
  const selectedUserProfile =
    userProfiles.find((profile) => profile.id === selectedUserProfileId) ?? userProfiles[0] ?? DEFAULT_SETTINGS.user_profiles[0];
  const selectedUserVoicePath = selectedUserProfile?.voice_path || "";
  const selectedUserVoiceSample =
    voiceSamples.find((sample) => sample.path === selectedUserVoicePath) ?? null;
  const selectedThemeSwatch =
    THEME_SWATCHS.find((swatch) => swatch.id === themeSwatchId) ?? THEME_SWATCHS[0];

  useEffect(() => {
    activeTaskTypeRef.current = activeTaskType;
  }, [activeTaskType]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listen<SetupInstallProgress>("setup-install-progress", (event) => {
      if (disposed) return;
      setSetupProgress(event.payload);
      setSetupNotice(event.payload.message);
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unlisten = cleanup;
      })
      .catch((error) => console.error("Setup progress listener error:", error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    const tier = setupTierOverride ?? setupTierFromSystem(systemInfo);
    invoke<SetupCatalog>("get_setup_catalog", { tier })
      .then(setSetupCatalog)
      .catch((error) => {
        console.error("Setup catalog error:", error);
        setSetupNotice(error instanceof Error ? error.message : String(error));
      });
  }, [settingsLoaded, setupTierOverride, systemInfo]);

  const recommendedThreads = systemInfo
    ? clampNumber(Math.min(systemInfo.cpu_threads, 8), 2, Math.max(2, systemInfo.cpu_threads))
    : 4;
  const preferredChatGpuLayers = systemInfo?.has_nvidia_gpu ? 999 : 0;
  const reducedTaskGpuLayers = systemInfo?.has_nvidia_gpu
    ? Math.min(
        preferredChatGpuLayers,
        Math.max(
          4,
          Math.round(
            systemInfo.recommended_task_gpu_layers *
              (0.8 + intelligenceQuality / 100 * 0.15),
          ),
        ),
      )
    : 0;

  const refreshEngineInfo = async () => {
    const info = await invoke<EngineInfo>("get_engine_info");
    setEngineInfo(info);
    return info;
  };

  const markUiInteraction = () => {
    lastUiInteractionAtRef.current = Date.now();
  };

  const updateLastAssistantMessage = (
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last.role !== "assistant") return prev;
      updated[updated.length - 1] = updater(last);
      return updated;
    });
  };

  const updateAssistantMessageById = (
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId && message.role === "assistant" ? updater(message) : message,
      ),
    );
  };

  const finalizeAssistantMessageById = (
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    let splitIds: string[] = [];
    setMessages((prev) => {
      const index = prev.findIndex((message) => message.id === messageId && message.role === "assistant");
      if (index < 0) return prev;
      const next = [...prev];
      const updated = updater(next[index]);
      const splitMessages = splitAssistantMessageForChat(updated);
      splitIds = splitMessages.map((message) => message.id);
      next.splice(index, 1, ...splitMessages);
      return next;
    });
    return splitIds.length ? splitIds : [messageId];
  };

  const deleteImageFromChatMessage = (messageId: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId && Array.isArray(message.content)
          ? {
              ...message,
              content: [{ type: "text", text: "Image deleted." }],
              thinking: undefined,
            }
          : message,
      ),
    );
    setCollapsedImageParts((prev) => {
      const next: Record<string, boolean> = {};
      Object.entries(prev).forEach(([key, value]) => {
        if (!key.startsWith(`${messageId}:`)) {
          next[key] = value;
        }
      });
      return next;
    });
    autoSpeechEligibleAssistantIdsRef.current.delete(messageId);
    if (lastAutoSpokenAssistantIdRef.current === messageId) {
      lastAutoSpokenAssistantIdRef.current = null;
    }
    if (speakingMessageId === messageId) {
      voicePlaybackRequestRef.current += 1;
      stopActiveAudio();
      setSpeakingMessageId(null);
    }
  };

  const enrichPreviewPerception = async (messageId: string, preview: FilePreviewResult) => {
    const mime = preview.mime_type.toLowerCase();
    if (!preview.data_url || !mime.startsWith("audio/") || preview.perception) {
      return;
    }
    if (!voiceSetupStatus.ready || preview.size_bytes > 30 * 1024 * 1024) {
      return;
    }

    try {
      const result = await invoke<{ text: string; language: string; language_probability: number }>("transcribe_audio", {
        audioDataUrl: preview.data_url,
      });
      const text = result.text.trim();
      if (!text) {
        return;
      }
      const perception = `Transcript (${result.language || "unknown"}): ${text}`;
      updateAssistantMessageById(messageId, (message) => {
        if (!Array.isArray(message.content)) return message;
        return {
          ...message,
          content: message.content.map((part) =>
            part.type === "file_preview" && part.file_preview.path === preview.path
              ? { ...part, file_preview: { ...part.file_preview, perception } }
              : part,
          ),
        };
      });
    } catch (error) {
      console.error("Preview transcription error:", error);
    }
  };

  const saveActiveChatSession = (
    personalityId = selectedPersonalityId,
    session = messages,
  ) => {
    if (!personalityId) return;
    chatSessionsRef.current = {
      ...chatSessionsRef.current,
      [personalityId]: session,
    };
    setChatSessions((prev) =>
      prev[personalityId] === session ? prev : { ...prev, [personalityId]: session },
    );
  };

  const loadChatSessionForPersonality = (personalityId: string) => {
    const session = chatSessionsRef.current[personalityId] ?? [];
    setMessages(session);
    lastMessageCountRef.current = session.length;
    ensureConversationStartsAtBottom();
  };

  const appLog = (message: string) => {
    console.info(`[Galaxy] ${message}`);
    invoke("append_app_log", { message }).catch(() => {
      // Logging must never affect chat or voice playback.
    });
  };

  const refreshPendingShellActions = async () => {
    try {
      const actions = await invoke<PendingShellAction[]>("list_pending_shell_actions");
      setPendingShellActions(actions);
    } catch (error) {
      console.error("Pending shell action load error:", error);
    }
  };

  const refreshAutomationJobs = async () => {
    try {
      const jobs = await invoke<AutomationJob[]>("list_automation_jobs", { includeDisabled: true });
      setAutomationJobs(jobs);
    } catch (error) {
      console.error("Automation load error:", error);
    }
  };

  const refreshGoogleStatus = async () => {
    try {
      const status = await invoke<GoogleConnectionStatus>("get_google_connection_status");
      setGoogleStatus(status);
      return status;
    } catch (error) {
      console.error("Google status error:", error);
      setGoogleNotice(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const refreshGoogleCalendarEvents = async (monthOverride = automationMonth, statusOverride = googleStatus) => {
    if (!statusOverride.connected || !googleClientId.trim() || !googleClientSecret.trim()) {
      setGoogleCalendarEvents([]);
      return;
    }

    try {
      const { timeMin, timeMax } = buildGoogleMonthRange(monthOverride);
      const events = await invoke<GoogleCalendarEvent[]>("list_google_calendar_events", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        timeMin,
        timeMax,
      });
      setGoogleCalendarEvents(events);
      setGoogleNotice(events.length ? `Loaded ${events.length} Google Calendar event${events.length === 1 ? "" : "s"}.` : "Google Calendar is connected. No events this month.");
    } catch (error) {
      console.error("Google Calendar load error:", error);
      setGoogleNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const connectGoogle = async () => {
    if (!googleClientId.trim() || !googleClientSecret.trim() || !googleRedirectUri.trim()) {
      setGoogleNotice("Add your Google OAuth Client ID and Secret first.");
      return;
    }

    setGoogleBusy(true);
    setGoogleNotice("Opening Google sign-in...");
    try {
      const status = await invoke<GoogleConnectionStatus>("connect_google_calendar", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        redirectUri: googleRedirectUri,
      });
      setGoogleStatus(status);
      setGoogleNotice(status.email ? `Connected as ${status.email}.` : "Google Calendar connected.");
      await refreshGoogleCalendarEvents(automationMonth, status);
    } catch (error) {
      console.error("Google connect error:", error);
      setGoogleNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setGoogleBusy(false);
    }
  };

  const disconnectGoogle = async () => {
    setGoogleBusy(true);
    try {
      const status = await invoke<GoogleConnectionStatus>("disconnect_google_calendar");
      setGoogleStatus(status);
      setGoogleCalendarEvents([]);
      setGoogleNotice("Google Calendar disconnected.");
    } catch (error) {
      console.error("Google disconnect error:", error);
      setGoogleNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setGoogleBusy(false);
    }
  };

  const deleteGoogleEvent = async (id: string) => {
    setGoogleBusy(true);
    try {
      await invoke("delete_google_calendar_event", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        id: id,
      });
      refreshGoogleCalendarEvents();
    } catch (error) {
      console.error("Delete failed:", error);
      setGoogleNotice("Delete failed. Please check connection.");
    } finally {
      setGoogleBusy(false);
    }
  };

  const openDeleteGoogleEventConfirm = (event: GoogleCalendarEvent) => {
    setSelectedGoogleEvent(null);
    setGoogleDeleteTarget(normalizeCalendarEventForDisplay(event));
  };

  const openAutomationEditor = (job?: AutomationJob) => {
    if (job) {
      const parsed = parseAutomationSchedule(job.schedule, selectedAutomationDate);
      setEditingAutomationId(job.id);
      setAutomationName(job.name);
      setAutomationPrompt(job.prompt);
      setAutomationDate(parsed.date);
      setAutomationEditorMonth(new Date(`${parsed.date}T00:00:00`));
      setAutomationTime(parsed.time);
      setAutomationRepeat(parsed.repeat);
      setAutomationEveryAmount(parsed.everyAmount);
      setAutomationEveryUnit(parsed.everyUnit);
    } else {
      setEditingAutomationId(null);
      setAutomationName("");
      setAutomationPrompt("");
      setAutomationDate(selectedAutomationDate);
      setAutomationEditorMonth(new Date(`${selectedAutomationDate}T00:00:00`));
      setAutomationTime("");
      setAutomationRepeat("once");
      setAutomationEveryAmount(15);
      setAutomationEveryUnit("minutes");
    }
    setAutomationEditorOpen(true);
  };

  const saveAutomationJob = async () => {
    const scheduleDate = automationDate || selectedAutomationDate;
    const schedule = buildAutomationSchedule(scheduleDate, automationTime, automationRepeat, automationEveryAmount, automationEveryUnit);
    if (!automationName.trim() || !automationPrompt.trim() || !schedule) {
      setComposerNotice("Add an event title and task.");
      return;
    }

    try {
      const payload = {
        name: automationName,
        prompt: automationPrompt,
        schedule,
        enabled: true,
      };
      const job = editingAutomationId
        ? await invoke<AutomationJob>("update_automation_job", {
            id: editingAutomationId,
            ...payload,
          })
        : await invoke<AutomationJob>("create_automation_job", payload);
      setAutomationJobs((prev) => [job, ...prev.filter((item) => item.id !== job.id)]);
      setSelectedAutomationDate(scheduleDate);
      setAutomationMonth(new Date(`${scheduleDate}T00:00:00`));
      setEditingAutomationId(null);
      setAutomationName("");
      setAutomationPrompt("");
      setAutomationDate(scheduleDate);
      setAutomationTime("");
      setAutomationRepeat("once");
      setAutomationEveryAmount(15);
      setAutomationEveryUnit("minutes");
      setAutomationEditorOpen(false);
      setComposerNotice(editingAutomationId ? "Automation updated." : "Automation saved.");
    } catch (error) {
      setComposerNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleAutomationJob = async (job: AutomationJob) => {
    const updated = await invoke<AutomationJob>("set_automation_job_enabled", {
      id: job.id,
      enabled: !job.enabled,
    });
    setAutomationJobs((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  };

  const deleteAutomationJob = async (id: number) => {
    await invoke<boolean>("delete_automation_job", { id });
    setAutomationJobs((prev) => prev.filter((item) => item.id !== id));
  };

  const selectAutomationDate = (date: Date) => {
    const key = toLocalDateKey(date);
    setSelectedAutomationDate(key);
    setAutomationMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  };

  const automationDateLabel = (() => {
    const date = new Date(`${automationDate}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? automationDate || "Choose date"
      : new Intl.DateTimeFormat(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(date);
  })();
  const automationTimeParts = parseTimeParts(automationTime || "09:00");
  const automationPeriod = automationTimeParts.hours >= 12 ? "PM" : "AM";
  const automationHour12 = automationTimeParts.hours % 12 || 12;
  const formatAutomationTime = (hours: number, minutes: number) =>
    `${String((hours + 24) % 24).padStart(2, "0")}:${String((minutes + 60) % 60).padStart(2, "0")}`;
  const setAutomationTimeFromParts = (hours: number, minutes: number) => {
    const total = ((hours * 60 + minutes) % 1440 + 1440) % 1440;
    setAutomationTime(formatAutomationTime(Math.floor(total / 60), total % 60));
  };
  const setAutomationTimeFromClock = (hour12: number, minutes: number, period: string) => {
    const normalizedHour = clampNumber(Math.floor(hour12 || 12), 1, 12);
    const normalizedMinute = clampNumber(Math.floor(minutes || 0), 0, 59);
    const hours = period === "PM"
      ? (normalizedHour % 12) + 12
      : normalizedHour % 12;
    setAutomationTimeFromParts(hours, normalizedMinute);
  };
  const adjustAutomationTime = (minutesDelta: number) => {
    const total = automationTimeParts.hours * 60 + automationTimeParts.minutes + minutesDelta;
    setAutomationTimeFromParts(Math.floor(total / 60), total % 60);
  };
  const automationHourOptions = Array.from({ length: 12 }, (_, index) => index + 1);
  const automationMinuteOptions = Array.from({ length: 60 }, (_, index) => index);
  const automationEditorMonthDays = (() => {
    const first = new Date(automationEditorMonth.getFullYear(), automationEditorMonth.getMonth(), 1);
    const start = new Date(first);
    const mondayOffset = (first.getDay() + 6) % 7;
    start.setDate(first.getDate() - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  })();
  const automationEditorMonthTitle = new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
  }).format(automationEditorMonth);
  const automationEditorYearOptions = Array.from({ length: 5 }, (_, index) => automationEditorMonth.getFullYear() + index);
  const automationEditorMonthOptions = Array.from({ length: 12 }, (_, index) => ({
    index,
    label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(automationEditorMonth.getFullYear(), index, 1)),
  }));
  const setAutomationEditorDate = (date: Date) => {
    const key = toLocalDateKey(date);
    setAutomationDate(key);
    setAutomationEditorMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setAutomationDateMenuOpen(false);
    setAutomationMonthMenuOpen(false);
  };

  const handleShellToolRequest = async (assistantMessageId: string, replyText: string) => {
    const request = extractShellToolRequest(replyText);
    if (!request?.command?.trim()) {
      return replyText;
    }

    const visibleReply =
      stripShellToolRequest(replyText) ||
      "I prepared a system action. Review it below before it runs.";
    const action = await invoke<PendingShellAction>("propose_shell_action", {
      command: request.command,
      workingDirectory: request.working_directory || undefined,
      purpose: request.purpose || "Run the requested local system action.",
      timeoutSeconds: request.timeout_seconds || 30,
    });
    const finalReply = `${visibleReply}\n\nWaiting for your approval before running: ${action.purpose}`;
    setPendingShellActions((prev) => [...prev.filter((item) => item.id !== action.id), action]);
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantMessageId
          ? {
              ...message,
              content: finalReply,
            }
          : message,
      ),
    );
    setComposerNotice("A system action is waiting for approval.");
    return finalReply;
  };

  const refreshToolRuns = async () => {
    try {
      const runs = await invoke<ToolRunRecord[]>("list_agent_tool_runs", { limit: 10 });
      setToolRuns(runs);
    } catch (error) {
      console.error("Tool activity load error:", error);
    }
  };

  const recordClientToolRun = async (
    toolName: string,
    input: Record<string, unknown>,
    outputText: string,
    success: boolean,
    startedAt: number,
  ) => {
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    await invoke("record_agent_tool_run", {
      run: {
        tool_name: toolName,
        input_json: JSON.stringify(input),
        output_text: outputText,
        success,
        duration_ms: durationMs,
      },
    });
    refreshToolRuns().catch((error) => console.error("Tool activity refresh error:", error));
  };

  const rejectShellAction = async (id: number) => {
    await invoke<boolean>("reject_shell_action", { id });
    setPendingShellActions((prev) => prev.filter((action) => action.id !== id));
  };

  const approveShellAction = async (action: PendingShellAction) => {
    setExecutingShellActionId(action.id);
    try {
      const result = await invoke<ShellExecutionResult>("execute_shell_action", { id: action.id });
      await invoke("record_agent_tool_run", {
        run: {
          tool_name: "powershell",
          input_json: JSON.stringify(action),
          output_text: formatShellResult(result),
          success: !result.timed_out && result.exit_code === 0,
          duration_ms: Math.round(result.duration_ms),
        },
      }).catch(() => undefined);
      refreshToolRuns().catch((error) => console.error("Tool activity refresh error:", error));
      setPendingShellActions((prev) => prev.filter((item) => item.id !== action.id));
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          content: formatShellResult(result),
        },
      ]);
    } catch (error) {
      setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setExecutingShellActionId(null);
    }
  };

  const processSseEvent = (eventChunk: string) => {
    let visibleText = "";
    let fallbackText = "";

    for (const line of eventChunk.split(/\r?\n/)) {
      if (!line.startsWith("data:")) {
        continue;
      }

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        continue;
      }

      try {
        const data = JSON.parse(payload);
        const choices = Array.isArray(data.choices) ? data.choices : [];
        for (const choice of choices) {
          const extracted = extractChoiceText(choice);
          visibleText += extracted.visible;
          fallbackText += extracted.fallback;
        }
        if (choices.length === 0) {
          visibleText += extractTextValue(data.content);
          fallbackText += extractTextValue(data.reasoning_content ?? data.reasoning);
        }
      } catch (error) {
        console.error("Failed to parse SSE payload:", error);
      }
    }

    return { visibleText, fallbackText };
  };

  const stopActiveAudio = () => {
    setIsAudioPlaying(false);
    const activeSource = activeAudioSourceRef.current;
    if (activeSource) {
      activeAudioSourceRef.current = null;
      activeSource.onended = null;
      try {
        activeSource.stop();
      } catch {
        // no-op
      }
      try {
        activeSource.disconnect();
      } catch {
        // no-op
      }
    }

    const activeAudio = activeAudioRef.current;
    if (activeAudio) {
      activeAudioRef.current = null;
      activeAudio.pause();
      activeAudio.dispatchEvent(new Event("ended"));
      activeAudio.src = "";
    }

    if (activeAudioUrlRef.current) {
      URL.revokeObjectURL(activeAudioUrlRef.current);
      activeAudioUrlRef.current = null;
    }
  };

  const ensureAudioPlaybackUnlocked = async () => {
    if (typeof window === "undefined") return null;
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;

    const context = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = context;

    if (context.state === "suspended") {
      await context.resume();
    }

    if (!audioPlaybackUnlockedRef.current) {
      const buffer = context.createBuffer(1, 1, Math.max(8_000, context.sampleRate));
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(0);
      source.disconnect();
      audioPlaybackUnlockedRef.current = true;
    }

    return context;
  };

  const playAudioBase64 = async (audioBase64: string, mimeType: string) => {
    const binaryString = atob(audioBase64);
    const bytes = Uint8Array.from(binaryString, (char) => char.charCodeAt(0));
    stopActiveAudio();
    await ensureAudioPlaybackUnlocked().catch(() => null);

    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    activeAudioUrlRef.current = url;

    try {
      const audio = new Audio(url);
      audio.preload = "auto";
      activeAudioRef.current = audio;
      await new Promise<void>(async (resolve, reject) => {
        const cleanup = () => {
          audio.onended = null;
          audio.onerror = null;
        };
        audio.onended = () => {
          setIsAudioPlaying(false);
          cleanup();
          resolve();
        };
        audio.onerror = () => {
          setIsAudioPlaying(false);
          cleanup();
          reject(new Error("Playback failed."));
        };
        try {
          setIsAudioPlaying(true);
          await audio.play();
        } catch (error) {
          setIsAudioPlaying(false);
          cleanup();
          reject(
            error instanceof Error
              ? error
              : new Error("Playback could not start."),
          );
        }
      });
    } finally {
      setIsAudioPlaying(false);
      if (activeAudioRef.current?.src === url) {
        activeAudioRef.current = null;
      }
      if (activeAudioUrlRef.current === url) {
        URL.revokeObjectURL(url);
        activeAudioUrlRef.current = null;
      }
    }
  };

  const unloadLlmForTask = async (taskType: "voice" | "image") => {
    if (activeTaskTypeRef.current === taskType) {
      return;
    }

    stopActiveAudio();

    if (activeTaskTypeRef.current === "llm" || brainStatus === "Ready" || brainStatus === "Thinking") {
      setComposerNotice(taskType === "voice" ? "Preparing voice playback..." : "Preparing image creation...");
      try {
        await invoke<ModelStatus>("stop_model");
      } catch (error) {
        console.error("Model stop error:", error);
      }
      setBrainStatus("Idle");
      setModelLoadStatus({
        state: "idle",
        message: "No chat brain is loaded.",
        progress: 0,
      });
    }

    activeTaskTypeRef.current = taskType;
    setActiveTaskType(taskType);
  };

  const chooseVoiceVramMode = async () => {
    const llmIsLoaded =
      activeTaskTypeRef.current === "llm" ||
      brainStatus === "Ready" ||
      brainStatus === "Thinking";

    if (!llmIsLoaded) {
      activeTaskTypeRef.current = "voice";
      setActiveTaskType("voice");
      return "voice-only" as const;
    }

    try {
      const [vram, estimate] = await Promise.all([
        invoke<VramMemoryStatus>("get_vram_memory_status"),
        invoke<OmniVoiceVramEstimate>("estimate_omnivoice_vram_need"),
      ]);
      appLog(
        `voice vram check free=${vram.free_mb}MB used=${vram.used_mb}MB total=${vram.total_mb}MB need=${estimate.required_mb}MB`,
      );

      if (vram.available && vram.free_mb >= estimate.required_mb) {
        setComposerNotice("Loading voice...");
        return "shared" as const;
      }
    } catch (error) {
      console.error("Voice VRAM check error:", error);
      appLog(`voice vram check failed ${error instanceof Error ? error.message : String(error)}`);
    }

    await unloadLlmForTask("voice");
    return "swapped" as const;
  };

  const waitForModelReady = async (message = "Loading the selected brain...") => {
    const deadline = Date.now() + 10 * 60 * 1000;
    setBrainStatus("Loading");

    while (Date.now() < deadline) {
      const status = await invoke<ModelLoadStatus>("get_model_load_status");
      setModelLoadStatus(status);

      if (status.state === "ready") {
        setBrainStatus("Ready");
        return;
      }

      if (status.state === "error") {
        throw new Error(status.message);
      }

      try {
        const healthRes = await fetch("http://127.0.0.1:8080/health");
        if (healthRes.ok) {
          setModelLoadStatus({
            state: "ready",
            message: "Brain loaded and ready.",
            progress: 100,
          });
          setBrainStatus("Ready");
          return;
        }
      } catch {
        // keep waiting
      }

      setModelLoadStatus((prev) => ({
        state: prev.state || "loading",
        message: prev.message || message,
        progress: Math.max(prev.progress, 8),
      }));
      await sleep(1500);
    }

    throw new Error("Timed out waiting for the brain to become ready.");
  };

  const rememberSpeech = (key: string, value: AudioSynthesisResult) => {
    const cache = speechCacheRef.current;
    cache.delete(key);
    cache.set(key, value);

    while (cache.size > SPEECH_CACHE_LIMIT) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) break;
      cache.delete(oldestKey);
    }
  };

  const synthesizeAndPlaySpeech = async (
    text: string,
    voiceSamplePath: string,
    requestId: number,
    manageVram = true,
  ) => {
    const speechText = sanitizeTextForSpeech(text);
    if (!speechText) {
      return;
    }

    stopActiveAudio();
    const cleanText = speechText.trim();
    const cacheKey = JSON.stringify([voiceSamplePath || "", cleanText]);
    const cached = speechCacheRef.current.get(cacheKey);
    const voiceTaskStartedAt = performance.now();
    const voiceInput = {
      voice_sample: voiceSamplePath ? voiceSamplePath.split(/[/\\]/).pop() : "default",
      text: cleanText.slice(0, 220),
      manage_vram: manageVram,
    };

    if (cached) {
      if (requestId !== voicePlaybackRequestRef.current) return;
      recordClientToolRun(
        "voice_cached",
        { ...voiceInput, cached: true },
        "Played cached voice audio.",
        true,
        voiceTaskStartedAt,
      ).catch(() => undefined);
      await playAudioBase64(cached.audio_base64, cached.mime_type);
      return;
    }

    let voiceMode: "shared" | "swapped" | "voice-only" | "none" = "none";
    let result: AudioSynthesisResult;
    try {
      if (manageVram) {
        voiceMode = await chooseVoiceVramMode();
      }

      setComposerNotice("Loading voice...");
      appLog(`voice synth start sample=${voiceSamplePath || "<design>"} request=${requestId} manageVram=${manageVram} mode=${voiceMode}`);
      await invoke("prepare_omnivoice_engine").catch(() => undefined);
      appLog(`voice synth engine ready sample=${voiceSamplePath || "<design>"} request=${requestId}`);
      result = await invoke<AudioSynthesisResult>("synthesize_speech", {
        text: cleanText,
        voiceSamplePath: voiceSamplePath || null,
        useSidecar: false,
      });
    } catch (error) {
      if (manageVram && voiceMode === "shared" && isGpuFitError(error)) {
        appLog(`voice synth shared mode failed from GPU memory, retrying with LLM unloaded`);
        await unloadLlmForTask("voice");
        try {
          result = await invoke<AudioSynthesisResult>("synthesize_speech", {
            text: cleanText,
            voiceSamplePath: voiceSamplePath || null,
            useSidecar: false,
          });
        } catch (retryError) {
          recordClientToolRun(
            "voice_speech",
            { ...voiceInput, mode: "swapped" },
            retryError instanceof Error ? retryError.message : String(retryError),
            false,
            voiceTaskStartedAt,
          ).catch(() => undefined);
          throw retryError;
        }
      } else {
        recordClientToolRun(
          "voice_speech",
          { ...voiceInput, mode: voiceMode },
          error instanceof Error ? error.message : String(error),
          false,
          voiceTaskStartedAt,
        ).catch(() => undefined);
        throw error;
      }
    }
    appLog(`voice synth received audio bytes_b64=${result.audio_base64.length} request=${requestId}`);
    rememberSpeech(cacheKey, result);
    if (requestId !== voicePlaybackRequestRef.current) return;
    recordClientToolRun(
      "voice_speech",
      { ...voiceInput, mode: voiceMode },
      "Generated voice audio.",
      true,
      voiceTaskStartedAt,
    ).catch(() => undefined);
    await playAudioBase64(result.audio_base64, result.mime_type);
    appLog(`voice synth playback started request=${requestId}`);
  };

  const speakMessageText = async (
    messageId: string,
    text: string,
    role: "user" | "assistant",
  ) => {
    const speechText = sanitizeTextForSpeech(text);
    if (!speechText.trim()) {
      return;
    }

    setSpeakingMessageId(messageId);
    const requestId = ++voicePlaybackRequestRef.current;
    const voicePath = role === "user" ? selectedUserVoicePath : selectedVoicePath;
    try {
      await synthesizeAndPlaySpeech(speechText, voicePath, requestId);
      setComposerNotice("");
    } catch (error) {
      console.error("Speech error:", error);
      setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === voicePlaybackRequestRef.current) {
        setSpeakingMessageId(null);
      }
      if (activeTaskTypeRef.current === "voice") {
        activeTaskTypeRef.current = "none";
        setActiveTaskType("none");
      }
      if (!sendInFlightRef.current && !isStreaming) {
        setBrainStatus(activeTaskTypeRef.current === "llm" ? "Ready" : "Idle");
      }
    }
  };

  const playAutoSpeechQueue = async (queue: string[], requestId: number) => {
    for (const messageId of queue) {
      if (requestId !== voicePlaybackRequestRef.current) return;
      const message = messages.find((item) => item.id === messageId && item.role === "assistant");
      const speechText = sanitizeTextForSpeech(message ? extractMessageText(message.content) : "");
      if (!speechText.trim()) {
        autoSpeechEligibleAssistantIdsRef.current.delete(messageId);
        continue;
      }

      autoSpeechEligibleAssistantIdsRef.current.delete(messageId);
      lastAutoSpokenAssistantIdRef.current = messageId;
      setSpeakingMessageId(messageId);
      try {
        await synthesizeAndPlaySpeech(speechText, selectedVoicePath, requestId);
      } catch (error) {
        console.error("Live speech error:", error);
        appLog(`live speech failed message=${messageId} error=${error instanceof Error ? error.message : String(error)}`);
        setComposerNotice(error instanceof Error ? error.message : String(error));
        return;
      } finally {
        if (requestId === voicePlaybackRequestRef.current) {
          setSpeakingMessageId(null);
        }
        if (activeTaskTypeRef.current === "voice") {
          activeTaskTypeRef.current = "none";
          setActiveTaskType("none");
        }
      }
    }
    if (requestId === voicePlaybackRequestRef.current) {
      setComposerNotice("");
      if (!sendInFlightRef.current && !isStreaming) {
        setBrainStatus(activeTaskTypeRef.current === "llm" ? "Ready" : "Idle");
      }
    }
  };

  const generateNaturalImageCompletionReply = async (
    prompt: string,
    mode: string,
    imageDataUrl: string,
  ) => {
    const activePersonality =
      personalityPresets.find((preset) => preset.id === selectedPersonalityId) ?? personalityPresets[0];
    const userLanguageHint =
      chatDisplayLanguage === "vi"
        ? "Reply in the same Vietnamese tone the user is using."
        : "Reply in the same language and tone the user is using.";
    const profilePrompt = [
      `Assistant profile:
Name: ${activePersonality?.name || "Assistant"}
Instructions:
${personality || activePersonality?.prompt || "You are a helpful assistant."}`,
      characterSoul.trim() ? `\nAdditional character context:\n${characterSoul.trim()}` : "",
      userName.trim() || userDescription.trim()
        ? `\nUser profile:\nName: ${userName.trim() || "User"}\nAbout user: ${userDescription.trim() || ""}`
        : "",
      `\nTask: You just finished creating an image for the user. Write one short, natural assistant message for the chat bubble. ${userLanguageHint} Do not mention tools, prompts, files, generation engines, or approval. Do not ask a generic follow-up unless it feels natural. Keep it under 24 words.`,
    ].join("");

    const userContent = hasVision
      ? [
          {
            type: "text",
            text: `The created image is attached. Original image request mode: ${mode}. Visual request: ${prompt}`,
          },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ]
      : `Original image request mode: ${mode}. Visual request: ${prompt}`;

    try {
      await ensureChatModelReady();
      const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: profilePrompt },
            { role: "user", content: userContent },
          ],
          temperature: Math.min(0.8, Math.max(0.45, samplingTemperature)),
          top_k: topK,
          top_p: topP,
          min_p: minP,
          repeat_last_n: repeatLastN,
          repeat_penalty: repeatPenalty,
          max_tokens: 64,
          stream: false,
          chat_template_kwargs: {
            enable_thinking: false,
            thinking: false,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Image reply failed with status ${response.status}`);
      }

      const reply = stripThinkBlocks(extractChatResponseText(await response.json()))
        .replace(/\s+/g, " ")
        .trim();
      return reply;
    } catch (error) {
      console.error("Image completion reply error:", error);
      appLog(`image completion reply failed error=${error instanceof Error ? error.message : String(error)}`);
      return "";
    }
  };

  const previewVoiceSample = async (sample: VoiceSample) => {
    if (previewingVoicePath === sample.path) {
      voicePlaybackRequestRef.current += 1;
      stopActiveAudio();
      setPreviewingVoicePath(null);
      return;
    }

    voicePlaybackRequestRef.current += 1;
    stopActiveAudio();
    const requestId = voicePlaybackRequestRef.current;
    setPreviewingVoicePath(sample.path);
    try {
      await ensureAudioPlaybackUnlocked().catch(() => null);
      await synthesizeAndPlaySpeech(
        detectVoicePreviewText(sample),
        sample.path,
        requestId,
      );
      setComposerNotice("");
    } catch (error) {
      console.error("Voice preview error:", error);
      setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === voicePlaybackRequestRef.current) {
        setPreviewingVoicePath(null);
      }
      if (activeTaskTypeRef.current === "voice") {
        activeTaskTypeRef.current = "none";
        setActiveTaskType("none");
      }
    }
  };

  const ensureChatModelReady = async () => {
    const targetModelPath = selectedModelPath || availableModels[0]?.path || "";
    if (!targetModelPath) {
      setComposerNotice("Choose a GGUF folder with a brain first.");
      return false;
    }

    if (engineStatus !== "ready") {
      setPendingAutoLoadPath(targetModelPath);
      setComposerNotice("The brain engine is still getting ready.");
      return false;
    }

    let shouldLoadModel =
      activeTaskTypeRef.current !== "llm" ||
      brainStatus !== "Ready" ||
      selectedModelPath !== targetModelPath;

    if (!shouldLoadModel) {
      try {
        const healthRes = await fetch("http://127.0.0.1:8080/health");
        shouldLoadModel = !healthRes.ok;
      } catch {
        shouldLoadModel = true;
      }
    }

    if (shouldLoadModel) {
      stopActiveAudio();
      setComposerNotice("Loading the chat brain...");
      await invoke("stop_omnivoice_engine").catch(() => undefined);
      await loadModelPath(targetModelPath);
    }

    return true;
  };

  const updateEngineForVision = async () => {
    if (!systemInfo) {
      throw new Error("System info is not ready yet.");
    }

    setEngineStatus("downloading");
    setModelLoadStatus({
      state: "loading",
      message: "Updating the brain engine so it can look at pictures...",
      progress: 5,
    });

    const result = await invoke<{ success: boolean; message: string }>("download_engine", {
      hasNvidiaGpu: systemInfo.has_nvidia_gpu,
      forceRefresh: true,
    });

    if (!result.success) {
      setEngineStatus("error");
      throw new Error(result.message);
    }

    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      const info = await refreshEngineInfo();
      if (info.ready && info.supports_mmproj) {
        setEngineStatus("ready");
        setEngineErrorMsg("");
        return;
      }
      await sleep(4000);
    }

    throw new Error("Timed out while updating the picture-aware brain engine.");
  };

  const loadModelPath = async (modelPath: string) => {
    if (!modelPath) {
      return;
    }

    if (engineStatus !== "ready") {
      setPendingAutoLoadPath(modelPath);
      setComposerNotice("The brain engine is still getting ready.");
      return;
    }

    setSelectedModelPath(modelPath);
    setBrainStatus("Loading");
    activeTaskTypeRef.current = "llm";
    setActiveTaskType("llm");
    setModelLoadStatus({
      state: "starting",
      message: "Launching the selected brain...",
      progress: 2,
    });

    try {
      let activeGpuLayers = preferredChatGpuLayers;
      let result = await invoke<ModelStatus>("start_model", {
        modelPath,
        contextSize: memorySize,
        threads: recommendedThreads,
        gpuLayers: activeGpuLayers,
        reducedGpuLayers: reducedTaskGpuLayers,
      });

      if (result.status === "engine_update_required") {
        setModelLoadStatus({
          state: "loading",
          message: result.message,
          progress: 4,
        });
        await updateEngineForVision();
        result = await invoke<ModelStatus>("start_model", {
          modelPath,
          contextSize: memorySize,
          threads: recommendedThreads,
          gpuLayers: activeGpuLayers,
          reducedGpuLayers: reducedTaskGpuLayers,
        });
      }

      if (result.status !== "success") {
        throw new Error(result.message);
      }

      setSelectedModel(result.model_name);
      setHasVision(result.has_vision);
      activeTaskTypeRef.current = "llm";
      setActiveTaskType("llm");
      {
        const notices: string[] = [];
        if (!result.has_vision) {
          notices.push("This brain can chat, but it cannot look at pictures.");
        }
        if (result.gpu_layers < activeGpuLayers) {
          notices.push("Loaded with automatic memory placement to keep the main brain stable.");
        }
        setComposerNotice(notices.join(" "));
      }
      try {
        await waitForModelReady();
      } catch (error) {
        const fallbackGpuLayers = reducedTaskGpuLayers || 0;
        if (
          activeGpuLayers > fallbackGpuLayers &&
          fallbackGpuLayers > 0 &&
          isGpuFitError(error)
        ) {
          activeGpuLayers = fallbackGpuLayers;
          setModelLoadStatus({
            state: "starting",
            message: "The brain was too large for full graphics power. Trying a safer graphics setting...",
            progress: 2,
          });
          result = await invoke<ModelStatus>("start_model", {
            modelPath,
            contextSize: memorySize,
            threads: recommendedThreads,
            gpuLayers: activeGpuLayers,
            reducedGpuLayers: fallbackGpuLayers,
          });
          if (result.status !== "success") {
            throw new Error(result.message);
          }
          setSelectedModel(result.model_name);
          setHasVision(result.has_vision);
          activeTaskTypeRef.current = "llm";
          setActiveTaskType("llm");
          {
            const notices = [
              "Loaded with a safer graphics setting because full graphics power did not fit.",
            ];
            if (!result.has_vision) {
              notices.push("This brain can chat, but it cannot look at pictures.");
            }
            if (result.gpu_layers < activeGpuLayers) {
              notices.push("The engine also trimmed GPU layers automatically.");
            }
            setComposerNotice(notices.join(" "));
          }
          await waitForModelReady("Trying a safer graphics setting...");
        } else {
          throw error;
        }
      }
      setPendingAutoLoadPath(null);
    } catch (error) {
      console.error("Brain load error:", error);
      activeTaskTypeRef.current = "none";
      setActiveTaskType("none");
      setBrainStatus("Error");
      setModelLoadStatus({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
        progress: 100,
      });
    }
  };

  const scanModelLibrary = async (
    folderPath: string,
    preferredPath?: string,
    autoLoad?: boolean,
  ) => {
    if (!folderPath) {
      setAvailableModels([]);
      setSelectedModelPath("");
      setSelectedModel(null);
      return;
    }

    try {
      const models = await invoke<ModelLibraryEntry[]>("scan_model_folder", {
        folderPath,
      });
      setAvailableModels(models);

      if (models.length === 0) {
        setComposerNotice("No GGUF brains were found in that folder.");
        setSelectedModelPath("");
        return;
      }

      const targetPath =
        preferredPath && models.some((model) => model.path === preferredPath)
          ? preferredPath
          : models[0].path;
      setSelectedModelPath(targetPath);
      setComposerNotice("");

      if (autoLoad) {
        if (engineStatus === "ready") {
          await loadModelPath(targetPath);
        } else {
          setPendingAutoLoadPath(targetPath);
        }
      }
    } catch (error) {
      console.error("Model library scan error:", error);
      setComposerNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const handleChooseModelFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose your GGUF library folder",
      defaultPath: modelFolder || undefined,
    });

    if (typeof selected !== "string") {
      return;
    }

    setModelFolder(selected);
    await scanModelLibrary(selected, "", false);
  };

  const handleChooseVoiceFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose voice samples folder",
      defaultPath: voiceFolder || undefined,
    });

    if (typeof selected !== "string") {
      return;
    }

    setVoiceFolder(selected);
    updateActiveCharacterVoicePath("");
  };

  const handleAddLinkedFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Add a folder for future file tools",
      defaultPath: linkedFolders[0] || undefined,
    });

    if (typeof selected !== "string") {
      return;
    }

    setLinkedFolders((prev) =>
      prev.includes(selected) ? prev : [...prev, selected],
    );
  };

  const handleRemoveLinkedFolder = (folderPath: string) => {
    setLinkedFolders((prev) => prev.filter((folder) => folder !== folderPath));
  };

  const handleTestTelegram = async () => {
    setTelegramStatus("Checking Telegram...");
    try {
      const status = await invoke<TelegramBotStatus>("test_telegram_bot", {
        token: telegramBotToken,
      });
      setTelegramStatus(status.message);
    } catch (error) {
      setTelegramStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const buildSystemContextBlock = () => [
    `Time: ${new Date().toLocaleString()}`,
    `Location: ${localContext}`,
    `Default location: ${localContext}`,
    `Character folder: ${characterFolder || "not initialized"}`,
    `Active model: ${currentModelName}`,
    `Workspace folders: ${linkedFolders.length ? linkedFolders.join("; ") : "none"}`,
    `Google: ${googleStatus.connected ? "online" : "offline"}`,
    `Telegram: ${telegramRunning ? "online" : "offline"}`,
    `Voice: input ${voiceSetupStatus.ready ? "ready" : "not ready"}, tts ${omniVoiceStatus.ready ? "ready" : "not ready"}`,
    "Image: local Qwen image model",
  ].join(" | ");

  const buildAssistantRuntimePrompt = () => {
    const activePersonality =
      personalityPresets.find((preset) => preset.id === selectedPersonalityId) ?? personalityPresets[0];
    return [
      `Assistant profile:
Name: ${activePersonality?.name || "Assistant"}
Instructions:
${personality || activePersonality?.prompt || "Helpful assistant."}
`,
      characterSoul.trim() ? `\nAdditional character context:\n${characterSoul.trim()}` : "",
      personalityMemory.trim()
        ? `\nConversation memory:
${personalityMemory.trim()}
`
        : "",
      userName.trim() || userDescription.trim()
        ? `\nUser profile:\nName: ${userName.trim() || "User"}\nAbout user: ${userDescription.trim() || "No extra details."}`
        : "",
      linkedFolders.length
        ? `\nPermitted workspace folders:\n${linkedFolders.join("\n")}`
        : "\nPermitted workspace folders: none selected.",
      `\nConnected utilities:
Google Calendar: ${googleStatus.connected ? `online${googleStatus.email ? ` (${googleStatus.email})` : ""}` : "offline"}
Gmail: ${googleStatus.connected ? "online" : "offline"}
Telegram control: ${telegramRunning ? "online" : "offline"}
Voice input: ${voiceSetupStatus.ready ? "ready" : "not ready"}
Voice TTS: ${omniVoiceStatus.ready ? "ready" : "not ready"}
Image generation: local Qwen image model
User location: ${localContext}`,
    ].join("");
  };

  const updateActiveCharacterVoicePath = (voicePath: string) => {
    setSelectedVoicePath(voicePath);
    if (!selectedPersonalityId) return;
    setPersonalityPresets((prev) =>
      prev.map((preset) =>
        preset.id === selectedPersonalityId ? { ...preset, voice_path: voicePath } : preset,
      ),
    );
  };

  const updateActiveUserProfile = (patch: Partial<UserProfilePreset>) => {
    setUserProfiles((prev) =>
      prev.map((profile) =>
        profile.id === selectedUserProfileId ? { ...profile, ...patch } : profile,
      ),
    );
  };

  const updateActiveUserVoicePath = (voicePath: string) => {
    updateActiveUserProfile({ voice_path: voicePath });
  };

  const saveActiveCharacterFiles = async (
    override?: Partial<CharacterSettings> & { name?: string; soul?: string },
  ) => {
    const activePersonality =
      personalityPresets.find((preset) => preset.id === selectedPersonalityId) ?? personalityPresets[0];
    if (!activePersonality) return;
    const nextName = override?.name ?? activePersonality.name;
    const nextPrompt = override?.prompt ?? (personality || activePersonality.prompt || "");
    const settings: CharacterSettings = {
      voice_path: override?.voice_path ?? selectedVoicePath ?? "",
      avatar: override?.avatar ?? activePersonality.avatar ?? personalityAvatar ?? "",
      prompt: nextPrompt,
      greeting: override?.greeting ?? "",
      notes: override?.notes ?? "",
    };
    const nextSoul = syncSoulCoreIdentity(override?.soul ?? characterSoul, nextName, nextPrompt);
    const saved = await invoke<CharacterFiles>("save_character_files", {
      id: activePersonality.id,
      name: nextName,
      soul: nextSoul,
      settings,
    });
    setCharacterSoul(saved.soul);
    setCharacterFolder(saved.folder);
  };

  const handleStartTelegram = async () => {
    setTelegramStatus("Starting Telegram control...");
    try {
      const status = await invoke<TelegramBotStatus>("start_telegram_bot", {
        token: telegramBotToken,
        ownerUserId: telegramOwnerId,
        systemPrompt: buildAssistantRuntimePrompt(),
        temperature: samplingTemperature,
        thinkingEnabled,
        topK,
        topP,
        minP,
        repeatLastN,
        repeatPenalty,
        maxTokens: Math.min(replyLength, 768),
        googleClientId,
        googleClientSecret,
        folders: linkedFolders,
      });
      setTelegramRunning(status.success);
      setTelegramStatus(status.message);
    } catch (error) {
      setTelegramRunning(false);
      setTelegramStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handleStopTelegram = async () => {
    try {
      const status = await invoke<TelegramBotStatus>("stop_telegram_bot");
      setTelegramRunning(false);
      setTelegramStatus(status.message);
    } catch (error) {
      setTelegramStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const setAutoVoiceMode = (enabled: boolean) => {
    if (enabled) {
      ensureAudioPlaybackUnlocked().catch(() => null);
      invoke("prepare_omnivoice_engine").catch(() => undefined);
    }
    setLiveConversation(enabled);
  };

  const handleImageSelected = (dataUrl: string, localPath: string | null = null) => {
    setComposerNotice("");
    setImage(dataUrl);
    setImagePath(localPath);
  };

  const attachImageFromFile = (file: File | null | undefined) => {
    if (!file || !file.type.startsWith("image/")) {
      setComposerNotice("Please choose a picture file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const localPath = typeof (file as File & { path?: string }).path === "string"
        ? (file as File & { path?: string }).path ?? null
        : null;
      handleImageSelected(event.target?.result as string, localPath);
    };
    reader.readAsDataURL(file);
  };

  const chooseImageForComposer = async () => {
    const selected = await open({
      directory: false,
      multiple: false,
      title: "Choose an image",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] }],
    });
    if (typeof selected !== "string") return;
    try {
      const result = await invoke<LocalImageDataUrl>("read_local_image_data_url", { path: selected });
      handleImageSelected(result.data_url, result.path);
    } catch (error) {
      setComposerNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const revealImageLocation = async (localPath: string) => {
    try {
      await invoke("reveal_file_location", { path: localPath });
    } catch (error) {
      console.error("Reveal image location error:", error);
      setComposerNotice(`Image saved at: ${localPath}`);
    }
  };

  const refreshTelegramGuests = async () => {
    try {
      const guests = await invoke<TelegramGuest[]>("list_telegram_guests");
      setTelegramGuests(Array.isArray(guests) ? guests : []);
    } catch (error) {
      console.error("Telegram guest refresh error:", error);
    }
  };

  const addTelegramGuest = () => {
    const id = telegramGuestDraft?.id.trim() ?? "";
    if (!id) return;
    const name = telegramGuestDraft?.name.trim() || id;
    setTelegramGuests((prev) => {
      if (prev.some((guest) => guest.id === id)) {
        return prev.map((guest) => (guest.id === id ? { id, name } : guest));
      }
      return [...prev, { id, name }];
    });
    setTelegramGuestDraft(null);
  };

  const removeTelegramGuest = (id: string) => {
    setTelegramGuests((prev) => prev.filter((guest) => guest.id !== id));
  };

  const openImageViewer = (url: string, localPath?: string) => {
    if (!url) return;
    imageViewerDragRef.current = null;
    setImageViewer({ url, localPath, zoom: 1, x: 0, y: 0 });
  };

  useEffect(() => {
    if (!imageViewer) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setImageViewer(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [imageViewer]);

  const readAvatarImage = (
    file: File | null | undefined,
    onReady: (dataUrl: string) => void,
  ) => {
    if (!file || !file.type.startsWith("image/")) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const originalDataUrl = event.target?.result as string;
      const imageElement = new Image();
      imageElement.onload = () => {
        const maxSide = 512;
        const scale = Math.min(1, maxSide / Math.max(imageElement.width, imageElement.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(imageElement.width * scale));
        canvas.height = Math.max(1, Math.round(imageElement.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          onReady(originalDataUrl);
          return;
        }
        context.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
        onReady(canvas.toDataURL("image/jpeg", 0.82));
      };
      imageElement.onerror = () => onReady(originalDataUrl);
      imageElement.src = originalDataUrl;
    };
    reader.readAsDataURL(file);
  };

  const compressAvatarDataUrl = (dataUrl: string) =>
    new Promise<string>((resolve) => {
      if (!/^data:image\//i.test(dataUrl) || dataUrl.length < 220_000) {
        resolve(dataUrl);
        return;
      }

      const imageElement = new Image();
      imageElement.onload = () => {
        const maxSide = 512;
        const scale = Math.min(1, maxSide / Math.max(imageElement.width, imageElement.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(imageElement.width * scale));
        canvas.height = Math.max(1, Math.round(imageElement.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(dataUrl);
          return;
        }
        context.fillStyle = "#131314";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      imageElement.onerror = () => resolve(dataUrl);
      imageElement.src = dataUrl;
    });

  const personalityMemoryKind = (id = selectedPersonalityId) => `personality:${id}`;

  const handleChatScroll = (e: React.UIEvent<HTMLDivElement>) => {
    markUiInteraction();
    const target = e.target as HTMLDivElement;
    const isScrolledUp = target.scrollHeight - target.scrollTop - target.clientHeight > 150;
    setShowScrollBottom(isScrolledUp);
  };

  const scrollToBottom = () => {
    if (conversationScrollRef.current) {
      conversationScrollRef.current.scrollTo({
        top: conversationScrollRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  };

  const previewUserVoiceSample = async (sample: VoiceSample) => {
    await previewVoiceSample(sample);
  };

  const snapConversationToBottom = () => {
    const container = conversationScrollRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "auto",
    });
  };

  const ensureConversationStartsAtBottom = () => {
    window.requestAnimationFrame(() => {
      snapConversationToBottom();
      window.requestAnimationFrame(() => {
        snapConversationToBottom();
      });
    });
    window.setTimeout(() => {
      snapConversationToBottom();
    }, 60);
  };

  const compactPersonalityMemory = (memory: string, feedback: string) => {
    const cleanFeedback = feedback.replace(/\s+/g, " ").trim();
    if (!cleanFeedback) return memory.trim();
    const bullet = `- ${cleanFeedback}`;
    const existing = memory
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line !== bullet);
    const next = [...existing, bullet].slice(-14).join("\n");
    return next.length > 2200 ? next.slice(next.length - 2200).replace(/^[^\n]*\n?/, "") : next;
  };

  const isPersonalityTrainingFeedback = (text: string) => {
    const lower = normalizeIntentText(text);
    return includesAnyPhrase(lower, [
      "remember",
      "learn",
      "from now on",
      "answer like",
      "dont answer",
      "do not answer",
      "bad answer",
      "good answer",
      "format like",
      "style like",
      "sai",
    ]);
  };

  const updatePersonalityMemoryAfterTurn = async (userText: string, answerText: string) => {
    if (!selectedPersonalityId || !isPersonalityTrainingFeedback(userText)) return;
    const feedback = `User feedback: ${userText}${answerText.trim() ? ` | Last answer summary: ${answerText.trim().slice(0, 220)}` : ""}`;
    const nextMemory = compactPersonalityMemory(personalityMemory, feedback);
    setPersonalityMemory(nextMemory);
    personalityMemoryShadowRef.current[selectedPersonalityId] = nextMemory;
    try {
      await invoke<MemoryItem>("remember_local_memory", {
        kind: personalityMemoryKind(),
        key: "compact_style_memory",
        value: nextMemory,
        source: "personality_training",
        confidence: 0.9,
      });
    } catch (error) {
      console.error("Personality memory save error:", error);
    }
  };

  const deletePersonalityMemory = async (personalityId: string) => {
    try {
      const items = await invoke<MemoryItem[]>("list_local_memory", {
        kind: personalityMemoryKind(personalityId),
        limit: 100,
      });
      await Promise.all(items.map((item) => invoke<boolean>("forget_local_memory", { id: item.id })));
    } catch (error) {
      console.error("Personality memory delete error:", error);
    }
  };

  const handleClearPersonalityMemory = async () => {
    if (!selectedPersonalityId) return;
    try {
      // Clear the compact style memory from the DB
      await deletePersonalityMemory(selectedPersonalityId);
      setPersonalityMemory("");
      // Optionally clear the saved chat session too
      if (clearSessionToo) {
        await invoke<boolean>("delete_personality_chat_session", { personalityId: selectedPersonalityId });
        setMessages([]);
      }
    } catch (error) {
      console.error("Clear memory error:", error);
    } finally {
      setClearMemoryConfirmOpen(false);
      setClearSessionToo(false);
    }
  };

  const dismissImageProposal = (messageId: string, proposalIndex: number) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId || !Array.isArray(message.content)) {
          return message;
        }
        const nextContent = message.content.filter((_, index) => index !== proposalIndex);
        return {
          ...message,
          content: nextContent.length ? nextContent : "Image creation was cancelled.",
        };
      }),
    );
  };

  const dismissChatPart = (messageId: string, partIndex: number, fallbackText: string) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId || !Array.isArray(message.content)) {
          return message;
        }
        const nextContent = message.content.filter((_, index) => index !== partIndex);
        return {
          ...message,
          content: nextContent.length ? nextContent : fallbackText,
        };
      }),
    );
  };

  const proposalString = (proposal: ActionProposal, key: string) => {
    const value = proposal.arguments?.[key];
    return typeof value === "string" ? value : "";
  };

  const proposalJsonPayload = (proposal: ActionProposal, key: string) => {
    const value = proposal.arguments?.[key];
    if (value == null) {
      return null;
    }
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value);
  };

  const executeActionProposal = async (proposal: ActionProposal) => {
    if (proposal.action_type === "write_file") {
      const result = await invoke<FileActionResult>("write_linked_text_file", {
        relativePath: proposalString(proposal, "relative_path"),
        content: proposalString(proposal, "content"),
        rootFolder: proposalString(proposal, "root_folder") || linkedFolders[0],
        folders: linkedFolders,
      });
      return formatFileActionResult(result);
    }
    if (proposal.action_type === "move_file") {
      const result = await invoke<FileActionResult>("move_linked_file", {
        source: proposalString(proposal, "source"),
        destinationRelativePath: proposalString(proposal, "destination_relative_path"),
        rootFolder: proposalString(proposal, "root_folder") || linkedFolders[0],
        folders: linkedFolders,
      });
      return formatFileActionResult(result);
    }
    if (proposal.action_type === "delete_file") {
      const result = await invoke<FileActionResult>("trash_linked_file", {
        source: proposalString(proposal, "source"),
        folders: linkedFolders,
      });
      return formatFileActionResult(result);
    }
    if (proposal.action_type === "run_powershell") {
      const action = await invoke<PendingShellAction>("propose_shell_action", {
        command: proposalString(proposal, "command"),
        workingDirectory: proposalString(proposal, "working_directory") || undefined,
        purpose: proposalString(proposal, "purpose") || proposal.details,
        timeoutSeconds: Number(proposal.arguments?.timeout_seconds) || 30,
      });
      setPendingShellActions((prev) => [...prev.filter((item) => item.id !== action.id), action]);
      return `System action is waiting for final approval: ${action.purpose}`;
    }
    if (proposal.action_type === "gmail_send") {
      return await invoke<string>("send_google_gmail_message", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        to: proposalString(proposal, "to"),
        subject: proposalString(proposal, "subject"),
        body: proposalString(proposal, "body"),
        senderName: selectedUserProfile?.name || userName || undefined,
      });
    }
    if (proposal.action_type === "gmail_trash") {
      return await invoke<string>("trash_google_gmail_message", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        id: proposalString(proposal, "id"),
      });
    }
    if (proposal.action_type === "calendar_create") {
      const result = await invoke<{ id: string; title: string; html_link: string | null }>("create_google_calendar_event", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        title: proposalString(proposal, "title"),
        start: proposalString(proposal, "start"),
        end: proposalString(proposal, "end"),
        description: proposalString(proposal, "description") || null,
        location: proposalString(proposal, "location") || null,
      });
      return `Event created: "${result.title}"${result.html_link ? ` \u2014 [Open in Calendar](${result.html_link})` : ""}`;
    }
    if (proposal.action_type === "calendar_delete") {
      return await invoke<string>("delete_google_calendar_event", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        id: proposalString(proposal, "id"),
      });
    }
    if (proposal.action_type === "google_contact_delete") {
      return await invoke<string>("delete_google_contact", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        resourceName: proposalString(proposal, "resource_name"),
      });
    }
    if (proposal.action_type === "google_action") {
      return await invoke<string>("execute_google_api", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        method: proposalString(proposal, "method") || "POST",
        url: proposalString(proposal, "url"),
        payload: proposalJsonPayload(proposal, "payload"),
      });
    }
    throw new Error("This action type is not supported yet.");
  };

  const naturalizeSystemResult = async (userRequest: string, rawResult: string) => {
    const trimmed = rawResult.trim();
    if (!trimmed) return "";
    try {
      const ready = await ensureChatModelReady();
      if (!ready) return trimmed;
      const languageHint = conversationWantsVietnamese(messages) || textLooksVietnamese(userRequest)
        ? "Reply in natural Vietnamese matching the current conversation."
        : "Reply in the current conversation language.";
      const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stream: false,
          temperature: samplingTemperature,
          top_k: topK,
          top_p: topP,
          min_p: minP,
          repeat_last_n: repeatLastN,
          repeat_penalty: repeatPenalty,
          max_tokens: Math.min(160, replyLength),
          messages: [
            {
              role: "system",
              content: `Turn a verified system/tool result into one short, natural assistant reply. ${languageHint} Do not expose message IDs, raw API wording, JSON, tool names, or backend status unless the user explicitly needs it.`,
            },
            {
              role: "user",
              content: `Original user request:\n${userRequest.trim() || "(scheduled automation)"}\n\nVerified result:\n${trimmed}`,
            },
          ],
        }),
      });
      if (!response.ok) return trimmed;
      const body = await response.json();
      const reply = body?.choices?.[0]?.message?.content;
      return typeof reply === "string" && reply.trim() ? reply.trim() : trimmed;
    } catch (error) {
      console.error("Naturalize system result error:", error);
      return trimmed;
    }
  };

  const approveActionProposal = async (messageId: string, partIndex: number, proposal: ActionProposal) => {
    setIsApproving(true);
    try {
      console.log("Approving action:", proposal.action_type, proposal.arguments);
      const rawResult = await executeActionProposal(proposal);
      const naturalResultText = await naturalizeSystemResult(proposal.details || proposal.action_type, rawResult);
      dismissChatPart(messageId, partIndex, "Action approved.");
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          content: naturalResultText,
        },
      ]);
      return;
    } catch (error) {
      console.error("Action approval error:", error);
      setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setIsApproving(false);
    }
  };

  const handleSend = async (options: SendOptions = {}) => {
    const promptText = options.text ?? composerInputRef.current?.value ?? input;
    const attachedImage = options.imageDataUrl ?? (options.text ? null : image);
    const attachedImagePath = options.imagePath ?? imagePath;
    if ((!promptText.trim() && !attachedImage) || isStreaming) {
      return;
    }

    if (sendInFlightRef.current) {
      appLog("Blocked a duplicate send event while another chat request was already running.");
      return;
    }

    if (liveConversation) {
      ensureAudioPlaybackUnlocked().catch(() => null);
    }

    sendInFlightRef.current = true;
    const requestId = activeChatRequestRef.current + 1;
    activeChatRequestRef.current = requestId;
    const isRequestStale = () => activeChatRequestRef.current !== requestId;

    let content: string | ChatContentPart[] = promptText;
    if (attachedImage) {
      content = [
        { type: "text", text: promptText || "Describe this image." },
        { type: "image_url", image_url: { url: attachedImage, local_path: attachedImagePath ?? undefined } },
      ];
    }

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content,
    };

    if (!options.silentUser) {
      setMessages((prev) => [...prev, userMessage]);
    }
    if (!options.text) {
      setComposerText("");
    }
    if (!options.silentUser && liveConversationRef.current && selectedUserProfile?.auto_speech !== false && typeof content === "string" && content.trim()) {
      void speakMessageText(userMessage.id, content, "user").catch((error) => {
        console.error("Live user speech error:", error);
      });
    }

    if (!attachedImage && typeof content === "string" && isExplicitApprovalText(content)) {
      const pendingImageProposal = findPendingImageProposal(messages);
      if (pendingImageProposal) {
        void handleGenerateImage(
          pendingImageProposal.proposal.prompt,
          pendingImageProposal.proposal.mode,
          pendingImageProposal.proposal.mask_prompt,
        );
        sendInFlightRef.current = false;
        return;
      }
      const pendingActionProposal = findPendingActionProposal(messages);
      if (pendingActionProposal) {
        void approveActionProposal(
          pendingActionProposal.messageId,
          pendingActionProposal.partIndex,
          pendingActionProposal.proposal,
        );
        sendInFlightRef.current = false;
        return;
      }
    }

    const assistantMessageId = createMessageId();
    setComposerNotice("");
    const newMessages: ChatMessage[] = [...messages, userMessage];
    setMessages((prev) => [...prev, { id: assistantMessageId, role: "assistant", content: "" }]);
    if (attachedImage && !options.imageDataUrl) {
      setImage(null);
      setImagePath(null);
    }
    setIsStreaming(true);
    setBrainStatus("Loading");

    const temperature = samplingTemperature;
    let generatedText = "";
    let fallbackGeneratedText = "";
    let generatedThinking = "";
    let failed = false;
    let lastUiFlush = 0;
    const flushStreamedText = (force = false) => {
      if (isRequestStale()) return;
      const now = Date.now();
      if (!force && now - lastUiFlush < 45) {
        return;
      }
      lastUiFlush = now;
      updateLastAssistantMessage((last) => ({
        ...last,
        content: generatedText,
      }));
    };

    try {
      if (isRequestStale()) return;
      const ready = await ensureChatModelReady();
      if (!ready) {
        throw new Error("The chat brain is not ready yet.");
      }

      if (attachedImage && !hasVision) {
        throw new Error("This brain cannot look at pictures yet.");
      }

      setBrainStatus("Thinking");
      const activePersonality =
        personalityPresets.find((preset) => preset.id === selectedPersonalityId) ?? personalityPresets[0];
      const profilePrompt = [
        `Assistant profile:
Name: ${activePersonality?.name || "Assistant"}
Instructions:
${personality || activePersonality?.prompt || "You are a helpful assistant."}`,
        characterSoul.trim() ? `\nAdditional character context:\n${characterSoul.trim()}` : "",
        personalityMemory.trim()
          ? `\nConversation memory:
${personalityMemory.trim()}`
          : "",
        userName.trim() || userDescription.trim()
          ? `\nUser profile:\nName: ${userName.trim() || "User"}\nAbout user: ${userDescription.trim() || ""}`
          : "",
        `\nCurrent date: ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`,
      ].join("");
      const requestMessages = buildBrainMessages(profilePrompt, newMessages, hasVision);
      const toolAgentMessages = buildToolAgentMessages(newMessages);
      setLastContextTokens(
        [
          ...requestMessages.filter((message) => message.role === "system"),
          ...toolAgentMessages,
        ].reduce((total, message) => {
          const content = Array.isArray(message.content)
            ? extractMessageText(message.content)
            : message.content;
          return total + estimateTokens(content);
        }, 0),
      );
      const generationStartedAt = performance.now();

      if (!attachedImage) {
        setComposerNotice("Thinking with tools...");
        appLog(
          `chat-trace request model=${selectedModelPath || "none"} thinking=${thinkingEnabled} messages=${toolAgentMessages.length}/${newMessages.length} user=${JSON.stringify(promptText).slice(0, 600)}`,
        );
        const reactResult = await invoke<AgentReactResult>("agent_jan_chat", {
          runtimePrompt: profilePrompt,
          contextBlock: buildSystemContextBlock(),
          messages: toolAgentMessages,
          folders: linkedFolders,
          googleClientId,
          googleClientSecret,
          temperature,
          topK,
          topP,
          minP,
          repeatLastN,
          repeatPenalty,
          maxTokens: replyLength,
          thinkingEnabled,
        });
        if (isRequestStale()) {
          return;
        }
        if (reactResult.tool_trace?.length) {
          refreshToolRuns().catch((error) => console.error("Tool activity refresh error:", error));
        }
        generatedText = reactResult.answer;
        generatedThinking = thinkingEnabled ? formatReactThinking(reactResult) : "";
        appLog(
          `chat-trace response tool=${reactResult.tool_used || "none"} answer=${JSON.stringify(reactResult.answer || "").slice(0, 800)} thinking=${generatedThinking ? "yes" : "no"}`,
        );
        if (options.autoApproveActions && reactResult.action_proposal) {
          const rawResult = await executeActionProposal(reactResult.action_proposal);
          generatedText = await naturalizeSystemResult(promptText, rawResult);
          const finalizedAssistantIds = finalizeAssistantMessageById(assistantMessageId, (last) => ({
            ...last,
            content: generatedText,
            thinking: thinkingEnabled ? generatedThinking || last.thinking : undefined,
          }));
          const elapsedSeconds = Math.max(0.1, (performance.now() - generationStartedAt) / 1000);
          setLastTokenSpeed(estimateTokens(generatedText) / elapsedSeconds);
          setBrainStatus("Ready");
          setComposerNotice("");
          await updatePersonalityMemoryAfterTurn(promptText, generatedText);
          if (liveConversationRef.current) {
            finalizedAssistantIds.forEach((id) => autoSpeechEligibleAssistantIdsRef.current.add(id));
          }
          return;
        }
        const structuredParts: ChatContentPart[] = [{ type: "text", text: generatedText }];
        if (reactResult.cards?.length) {
          structuredParts.push({ type: "tool_result_cards", cards: reactResult.cards });
        }
        if (reactResult.file_preview) {
          structuredParts.push({ type: "file_preview", file_preview: reactResult.file_preview });
        }
        if (reactResult.image_proposal) {
          structuredParts.push({ type: "image_proposal", image_proposal: reactResult.image_proposal });
        }
        if (reactResult.action_proposal) {
          structuredParts.push({ type: "action_proposal", action_proposal: reactResult.action_proposal });
        }
        const finalizedAssistantIds = finalizeAssistantMessageById(assistantMessageId, (last) => ({
          ...last,
          content: structuredParts.length > 1 ? structuredParts : generatedText,
          thinking: thinkingEnabled ? generatedThinking || last.thinking : undefined,
        }));
        if (reactResult.file_preview) {
          enrichPreviewPerception(assistantMessageId, reactResult.file_preview).catch((error) =>
            console.error("Preview perception enrichment error:", error),
          );
        }
        const elapsedSeconds = Math.max(0.1, (performance.now() - generationStartedAt) / 1000);
        setLastTokenSpeed(estimateTokens(generatedText) / elapsedSeconds);
        setBrainStatus("Ready");
        setComposerNotice("");
        await updatePersonalityMemoryAfterTurn(promptText, generatedText);
        if (liveConversationRef.current) {
          finalizedAssistantIds.forEach((id) => autoSpeechEligibleAssistantIdsRef.current.add(id));
        }
        return;
      }

      const chatPayload = {
        messages: requestMessages,
        temperature,
        top_k: topK,
        top_p: topP,
        min_p: minP,
        repeat_last_n: repeatLastN,
        repeat_penalty: repeatPenalty,
        max_tokens: replyLength,
        chat_template_kwargs: {
          enable_thinking: thinkingEnabled,
          thinking: thinkingEnabled,
        },
      };

      const abortController = new AbortController();
      activeChatAbortRef.current = abortController;
      const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          ...chatPayload,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Chat request failed with status ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let pendingChunk = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (isRequestStale()) break;

        pendingChunk += decoder.decode(value, { stream: true });
        const events = pendingChunk.split(/\r?\n\r?\n/);
        pendingChunk = events.pop() ?? "";

        for (const eventChunk of events) {
          if (isRequestStale()) break;
          const eventText = processSseEvent(eventChunk);
          generatedText += eventText.visibleText;
          fallbackGeneratedText += eventText.fallbackText;
          if (thinkingEnabled) {
            generatedThinking += eventText.fallbackText;
          }
          const elapsedSeconds = Math.max(0.1, (performance.now() - generationStartedAt) / 1000);
          setLastTokenSpeed(estimateTokens(generatedText) / elapsedSeconds);
          flushStreamedText();
        }
      }

      if (pendingChunk.trim()) {
        if (isRequestStale()) return;
        const eventText = processSseEvent(pendingChunk.trim());
        generatedText += eventText.visibleText;
        fallbackGeneratedText += eventText.fallbackText;
        if (thinkingEnabled) {
          generatedThinking += eventText.fallbackText;
        }
        const elapsedSeconds = Math.max(0.1, (performance.now() - generationStartedAt) / 1000);
        setLastTokenSpeed(estimateTokens(generatedText) / elapsedSeconds);
      }

      if (!generatedText.trim()) {
        if (fallbackGeneratedText.trim()) {
          const answerResponse = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abortController.signal,
            body: JSON.stringify({
              messages: [
                ...requestMessages,
                {
                  role: "assistant",
                  content: fallbackGeneratedText.trim(),
                },
                {
                  role: "user",
                  content: "Now give the final answer only. Do not include hidden thinking.",
                },
              ],
              temperature,
              top_k: topK,
              top_p: topP,
              min_p: minP,
              repeat_last_n: repeatLastN,
              repeat_penalty: repeatPenalty,
              max_tokens: replyLength,
              stream: false,
              chat_template_kwargs: {
                enable_thinking: false,
                thinking: false,
              },
            }),
          });

          if (answerResponse.ok) {
            generatedText = extractChatResponseText(await answerResponse.json());
          }
          if (!generatedText.trim()) {
            generatedText = fallbackGeneratedText.trim();
          }
        } else {
          const retryResponse = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abortController.signal,
            body: JSON.stringify({ ...chatPayload, stream: false }),
          });

          if (!retryResponse.ok) {
            throw new Error(`Chat retry failed with status ${retryResponse.status}`);
          }

          const retryData = await retryResponse.json();
          generatedText = extractChatResponseText(retryData);
        }
      }

      if (!generatedText.trim()) {
        appLog(
          `Chat returned no text after stream and retry. model=${selectedModelPath || "none"} messages=${newMessages.length}`,
        );
        throw new Error("The brain returned no text.");
      }
      if (thinkingEnabled && generatedThinking.trim()) {
        updateLastAssistantMessage((last) => ({
          ...last,
          thinking: generatedThinking.trim(),
        }));
      }
      if (isRequestStale()) return;
      generatedText = await handleShellToolRequest(assistantMessageId, generatedText);
      flushStreamedText(true);
      const finalizedAssistantIds = finalizeAssistantMessageById(assistantMessageId, (last) => ({
        ...last,
        content: generatedText,
        thinking: thinkingEnabled ? generatedThinking.trim() || last.thinking : undefined,
      }));
      await updatePersonalityMemoryAfterTurn(promptText, generatedText);
      if (liveConversationRef.current) {
        finalizedAssistantIds.forEach((id) => autoSpeechEligibleAssistantIdsRef.current.add(id));
      }

    } catch (error) {
      if (isRequestStale()) {
        return;
      }
      console.error("Chat error:", error);
      if (error instanceof Error && error.name === "AbortError") {
        updateLastAssistantMessage((last) =>
          last.content === "" ? { ...last, content: "[Stopped]" } : last,
        );
        setComposerNotice("Stopped.");
        setBrainStatus("Ready");
        return;
      }
      const partialReply = generatedText.trim();
      if (partialReply) {
        finalizeAssistantMessageById(assistantMessageId, (last) => ({
          ...last,
          content: partialReply,
        }));
        setComposerNotice(
          error instanceof Error
            ? `The reply stopped early: ${error.message}`
            : "The reply stopped early.",
        );
        setBrainStatus("Ready");
      } else {
        updateLastAssistantMessage((last) => ({
          ...last,
          content:
            error instanceof Error
              ? `[Error: ${error.message}]`
              : "[Error: Connection to the brain failed.]",
        }));
        setBrainStatus("Error");
        failed = true;
      }
    } finally {
      if (!isRequestStale()) {
        setIsStreaming(false);
        sendInFlightRef.current = false;
        if (!failed && !liveConversation) {
          setBrainStatus("Ready");
        }
      }
      activeChatAbortRef.current = null;
    }
  };

  const stopActiveResponse = () => {
    activeChatRequestRef.current += 1;
    activeChatAbortRef.current?.abort();
    activeChatAbortRef.current = null;
    sendInFlightRef.current = false;
    setIsStreaming(false);
    setBrainStatus("Ready");
    setComposerNotice("Stopped.");
  };

  useEffect(() => {
    if (!settingsLoaded) return;

    const checkAutomations = () => {
      if (sendInFlightRef.current || isStreaming || engineStatus !== "ready" || !selectedModelPath) {
        return;
      }
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;

      const now = new Date();
      const dueJob = automationJobs.find((job) => {
        if (!job.enabled) return false;
        const dueAt = getAutomationDueAt(job, now);
        if (!dueAt) return false;
        if ((job.last_run_at ?? 0) * 1000 >= dueAt) return false;
        const runKey = `${job.id}:${dueAt}`;
        if (automationRunKeysRef.current.has(runKey)) return false;
        automationRunKeysRef.current.add(runKey);
        return true;
      });

      if (!dueJob) return;

      setComposerNotice(`Running scheduled task: ${dueJob.name}`);
      invoke<AutomationJob>("mark_automation_job_ran", { id: dueJob.id })
        .then((updated) => {
          setAutomationJobs((prev) => prev.map((job) => (job.id === updated.id ? updated : job)));
        })
        .catch((error) => console.error("Automation mark error:", error));

      handleSend({
        text: dueJob.prompt,
        sourceLabel: dueJob.name,
        skipLocalIntent: true,
        silentUser: true,
        autoApproveActions: true,
      }).catch((error) => console.error("Automation run error:", error));
    };

    checkAutomations();
    const handle = window.setInterval(checkAutomations, 15_000);
    return () => window.clearInterval(handle);
  }, [settingsLoaded, automationJobs, isStreaming, engineStatus, selectedModelPath]);

  const handleGenerateImage = async (promptOverride?: string, mode = "text_to_image", maskPrompt?: string | null) => {
    const prompt = (promptOverride ?? composerInputRef.current?.value ?? input).trim();
    if (!prompt || isGeneratingImage) {
      return;
    }
    const latestChatImage = [...messages]
      .reverse()
      .find((message) =>
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === "image_url"),
      )
      ?.content;
    const latestChatImageUrl = Array.isArray(latestChatImage)
      ? latestChatImage.find((part) => part.type === "image_url")?.image_url.url
      : null;
    const initImageDataUrls = (() => {
      if (mode === "avatar_image") return assistantAvatar ? [assistantAvatar] : [];
      if (mode === "user_avatar_image" || mode === "avatar_user_image") return userAvatar ? [userAvatar] : [];
      if (mode === "user_character_image" || mode === "user_and_character_image" || mode === "both_avatars_image") {
        return [userAvatar, assistantAvatar].filter((value): value is string => Boolean(value));
      }
      const source = image || (mode === "image_to_image" && latestChatImageUrl?.startsWith("data:image/") ? latestChatImageUrl : null);
      return source ? [source] : [];
    })();
    const needsReferenceImage = mode === "avatar_image" || mode === "user_avatar_image" || mode === "avatar_user_image" || mode === "user_character_image" || mode === "user_and_character_image" || mode === "both_avatars_image" || mode === "image_to_image";
    const needsBothAvatars = mode === "user_character_image" || mode === "user_and_character_image" || mode === "both_avatars_image";
    if (needsBothAvatars && initImageDataUrls.length < 2) {
      setComposerNotice("This image mode needs both the user avatar and character avatar first.");
      return;
    }
    if (needsReferenceImage && initImageDataUrls.length === 0) {
      setComposerNotice("This image mode needs a profile or attached image first.");
      return;
    }

    const assistantMessageId = createMessageId();
    setIsGeneratingImage(true);
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "Sending image...",
      },
    ]);
    setComposerText("");
    const imageTaskStartedAt = performance.now();
    const imageRunInput = {
      mode,
      prompt,
      mask_prompt: maskPrompt || "",
      width: imageWidth,
      height: imageHeight,
      reference_images: initImageDataUrls.length,
    };

    try {
      await unloadLlmForTask("image");
      await invoke("stop_omnivoice_engine").catch(() => undefined);
      appLog(
        `image-trace request prompt=${JSON.stringify(prompt).slice(0, 800)} size=${imageWidth}x${imageHeight}`,
      );
      const result = await invoke<{ image_base64: string; mime_type: string; file_path: string }>("generate_image", {
        prompt,
        initImageDataUrl: initImageDataUrls[0] || null,
        initImageDataUrls,
        maskPrompt: maskPrompt || null,
        width: imageWidth,
        height: imageHeight,
      });
      const imageUrl = `data:${result.mime_type};base64,${result.image_base64}`;
      appLog(`image-trace response mime=${result.mime_type} bytes_b64=${result.image_base64.length} file=${result.file_path || "<unknown>"}`);
      setIsGeneratingImage(false);
      const naturalReply = await generateNaturalImageCompletionReply(prompt, mode, imageUrl);
      updateAssistantMessageById(assistantMessageId, (last) => ({
        ...last,
        content: [
          { type: "text", text: naturalReply || "" },
          { type: "image_url", image_url: { url: imageUrl, local_path: result.file_path } },
        ],
      }));
      if (liveConversationRef.current && naturalReply.trim()) {
        autoSpeechEligibleAssistantIdsRef.current.add(assistantMessageId);
      }
      setImage(null);
      setImagePath(null);
      setComposerNotice("");
      recordClientToolRun(
        "generate_image",
        imageRunInput,
        result.file_path ? `Generated image: ${result.file_path}` : "Generated image.",
        true,
        imageTaskStartedAt,
      ).catch(() => undefined);
    } catch (error) {
      recordClientToolRun(
        "generate_image",
        imageRunInput,
        error instanceof Error ? error.message : String(error),
        false,
        imageTaskStartedAt,
      ).catch(() => undefined);
      updateLastAssistantMessage((last) => ({
        ...last,
        content: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleQuickImageGenerate = async () => {
    const prompt = quickImagePrompt.trim();
    if (!prompt || isGeneratingImage) {
      return;
    }

    setIsGeneratingImage(true);
    setComposerNotice("Generating image...");
    const imageTaskStartedAt = performance.now();
    const imageRunInput = {
      mode: "text_to_image",
      prompt,
      width: imageWidth,
      height: imageHeight,
      source: "image_studio",
    };

    try {
      await unloadLlmForTask("image");
      await invoke("stop_omnivoice_engine").catch(() => undefined);
      appLog(
        `image-trace quick request prompt=${JSON.stringify(prompt).slice(0, 800)} size=${imageWidth}x${imageHeight}`,
      );
      const result = await invoke<{ image_base64: string; mime_type: string; file_path: string }>("generate_image", {
        prompt,
        initImageDataUrl: null,
        initImageDataUrls: [],
        maskPrompt: null,
        width: imageWidth,
        height: imageHeight,
      });
      const imageUrl = `data:${result.mime_type};base64,${result.image_base64}`;
      appLog(`image-trace quick response mime=${result.mime_type} bytes_b64=${result.image_base64.length} file=${result.file_path || "<unknown>"}`);
      setQuickImagePrompt("");
      setComposerNotice("");
      setIsGeneratingImage(false);
      recordClientToolRun(
        "generate_image",
        imageRunInput,
        result.file_path ? `Generated image: ${result.file_path}` : "Generated image.",
        true,
        imageTaskStartedAt,
      ).catch(() => undefined);
      await handleSend({
        text: prompt,
        imageDataUrl: imageUrl,
        imagePath: result.file_path,
        sourceLabel: "Image Studio",
        skipLocalIntent: true,
      });
    } catch (error) {
      console.error("Quick image generation error:", error);
      recordClientToolRun(
        "generate_image",
        imageRunInput,
        error instanceof Error ? error.message : String(error),
        false,
        imageTaskStartedAt,
      ).catch(() => undefined);
      setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleMicToggle = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (!voiceSetupStatus.ready) {
      setComposerNotice(
        voiceSetupStatus.state === "error"
          ? voiceSetupStatus.message
          : voiceSetupStatus.state === "idle"
            ? "Preparing voice listening now. Click the microphone again when it says ready."
            : "The voice helper is still getting ready. Please wait a moment.",
      );
      if (voiceSetupStatus.state === "idle") {
        await invoke("start_voice_setup");
      }
      return;
    }

    try {
      await unloadLlmForTask("voice");
      if (navigator.permissions?.query) {
        try {
          const permission = await navigator.permissions.query({ name: "microphone" as PermissionName });
          if (permission.state === "denied") {
            setComposerNotice("Microphone permission is blocked. Allow microphone access in the browser or app settings first.");
            return;
          }
        } catch {
          // Some environments do not expose microphone permission queries.
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      recordedChunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        setIsRecording(false);

        if (blob.size === 0) {
          return;
        }

        setIsTranscribing(true);
        try {
          const reader = new FileReader();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error("Could not read the recording."));
            reader.readAsDataURL(blob);
          });

          const result = await invoke<{
            text: string;
            language: string;
            language_probability: number;
          }>("transcribe_audio", {
            audioDataUrl: dataUrl,
          });

          {
            const currentText = composerInputRef.current?.value ?? input;
            setComposerText(currentText ? `${currentText} ${result.text}`.trim() : result.text);
          }
          setComposerNotice("");
        } catch (error) {
          console.error("Transcription error:", error);
          setComposerNotice(error instanceof Error ? error.message : String(error));
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      setComposerNotice("");
      setIsRecording(true);
    } catch (error) {
      console.error("Microphone error:", error);
      setComposerNotice("Microphone access was not granted. Allow microphone access and try again.");
    }
  };

  useEffect(() => {
    let active = true;

    const loadSettings = async () => {
      try {
        const stored = await invoke<AppSettings>("load_app_settings");
        if (!active) return;

        const nextUserAvatar = await compressAvatarDataUrl(stored.user_avatar || "");
        setSetupCompleted(Boolean(stored.setup_completed));
        const sourceUserProfiles = stored.user_profiles?.length
          ? stored.user_profiles
          : [{
              id: stored.selected_user_profile_id || "default_user",
              name: stored.user_name || DEFAULT_SETTINGS.user_name,
              description: stored.user_description || "",
              avatar: stored.user_avatar || "",
              voice_path: "",
              location_label: stored.user_location_label || "",
              latitude: typeof stored.user_latitude === "number" ? stored.user_latitude : null,
              longitude: typeof stored.user_longitude === "number" ? stored.user_longitude : null,
            }];
        const normalizedUserProfiles = await Promise.all(
          sourceUserProfiles.map(async (profile) => ({
            ...profile,
            avatar: await compressAvatarDataUrl(profile.avatar || ""),
            description: profile.description || "",
            voice_path: profile.voice_path || "",
            location_label: profile.location_label || "",
            latitude: typeof profile.latitude === "number" && Number.isFinite(profile.latitude) ? profile.latitude : null,
            longitude: typeof profile.longitude === "number" && Number.isFinite(profile.longitude) ? profile.longitude : null,
            auto_speech: profile.auto_speech ?? true,
          })),
        );
        const sourcePresets = stored.personality_presets?.length
          ? stored.personality_presets
          : DEFAULT_SETTINGS.personality_presets;
        const normalizedPresets = await Promise.all(
          sourcePresets.map(async (preset) => ({
            ...preset,
            avatar: await compressAvatarDataUrl(preset.avatar || ""),
          })),
        );
        if (!active) return;

        const nextUserProfileId = stored.selected_user_profile_id || normalizedUserProfiles[0]?.id || DEFAULT_SETTINGS.selected_user_profile_id;
        const activeUserProfile =
          normalizedUserProfiles.find((profile) => profile.id === nextUserProfileId) ??
          normalizedUserProfiles[0] ??
          DEFAULT_SETTINGS.user_profiles[0];
        setUserProfiles(normalizedUserProfiles);
        setSelectedUserProfileId(activeUserProfile.id);
        setUserName(activeUserProfile.name || DEFAULT_SETTINGS.user_name);
        setUserAvatar(activeUserProfile.avatar || nextUserAvatar);
        setUserDescription(activeUserProfile.description || "");
        setUserLocationLabel(activeUserProfile.location_label || "");
        setUserLatitude(typeof activeUserProfile.latitude === "number" && Number.isFinite(activeUserProfile.latitude) ? activeUserProfile.latitude : null);
        setUserLongitude(typeof activeUserProfile.longitude === "number" && Number.isFinite(activeUserProfile.longitude) ? activeUserProfile.longitude : null);
        setThemeSwatchId(
          THEME_SWATCHS.some((swatch) => swatch.id === stored.theme_swatch_id)
            ? stored.theme_swatch_id
            : DEFAULT_SETTINGS.theme_swatch_id,
        );
        setLiveConversation(stored.live_conversation);
        setTelegramBotToken(stored.telegram_bot_token || "");
        setTelegramOwnerId(stored.telegram_owner_id || "");
        setTelegramGuests(Array.isArray(stored.telegram_guests) ? stored.telegram_guests : []);
        setThinkingEnabled(Boolean(stored.thinking_enabled));
        setGoogleClientId(stored.google_client_id || "");
        setGoogleClientSecret(stored.google_client_secret || "");
        setGoogleRedirectUri(stored.google_redirect_uri || DEFAULT_SETTINGS.google_redirect_uri);
        setImageWidth(clampNumber(stored.image_width ?? DEFAULT_SETTINGS.image_width, 256, 2048));
        setImageHeight(clampNumber(stored.image_height ?? DEFAULT_SETTINGS.image_height, 256, 2048));
        setVoiceFolder(stored.voice_folder || "");
        setSelectedVoicePath(stored.selected_voice_path || "");
        setCreativity(clampNumber(stored.creativity, 0, 100));
        setSamplingTemperature(clampNumber(stored.sampling_temperature ?? DEFAULT_SETTINGS.sampling_temperature, 0, 2));
        setTopK(clampNumber(stored.top_k ?? DEFAULT_SETTINGS.top_k, 0, 200));
        setTopP(clampNumber(stored.top_p ?? DEFAULT_SETTINGS.top_p, 0, 1));
        setMinP(clampNumber(stored.min_p ?? DEFAULT_SETTINGS.min_p, 0, 1));
        setRepeatLastN(clampNumber(stored.repeat_last_n ?? DEFAULT_SETTINGS.repeat_last_n, -1, 4096));
        setRepeatPenalty(clampNumber(stored.repeat_penalty ?? DEFAULT_SETTINGS.repeat_penalty, 0.8, 2));
        setMemorySize(clampNumber(stored.memory_size, 512, 32768));
        setReplyLength(clampNumber(stored.reply_length, 64, 4096));
        setIntelligenceQuality(clampNumber(stored.intelligence_quality, 0, 100));
        setPersonality(stored.personality || DEFAULT_SETTINGS.personality);
        setPersonalityPresets(normalizedPresets);
        const nextPersonalityId = stored.selected_personality_id || DEFAULT_SETTINGS.selected_personality_id;
        setSelectedPersonalityId(nextPersonalityId);
        setPersonalityNameDraft(normalizedPresets.find((preset) => preset.id === nextPersonalityId)?.name || "Assistant");
        setPersonalityAvatar(
          normalizedPresets.find((preset) => preset.id === nextPersonalityId)?.avatar || "",
        );
        setModelFolder(stored.model_folder || "");
        setLinkedFolders(stored.linked_folders || []);
        setSelectedModelPath(stored.selected_model_path || "");
        setLeftPanelOpen(stored.ui_left_panel_open ?? DEFAULT_SETTINGS.ui_left_panel_open);
        setRightPanelOpen(stored.ui_right_panel_open ?? DEFAULT_SETTINGS.ui_right_panel_open);
        setWorkspaceOpen(stored.ui_workspace_open ?? DEFAULT_SETTINGS.ui_workspace_open);
        setImageStudioOpen(stored.ui_image_studio_open ?? DEFAULT_SETTINGS.ui_image_studio_open);
        setCalendarOpen(stored.ui_calendar_open ?? stored.ui_automation_open ?? DEFAULT_SETTINGS.ui_calendar_open);
        setAutomationOpen(stored.ui_automation_open ?? DEFAULT_SETTINGS.ui_automation_open);
        setTelegramPanelOpen(stored.ui_telegram_open ?? DEFAULT_SETTINGS.ui_telegram_open);
        setGooglePanelOpen(stored.ui_google_open ?? DEFAULT_SETTINGS.ui_google_open);
        setToolRunsOpen(stored.ui_tool_activity_open ?? DEFAULT_SETTINGS.ui_tool_activity_open);
        setSamplingOpen(stored.ui_sampling_open ?? DEFAULT_SETTINGS.ui_sampling_open);
        invoke("migrate_character_folders").catch((error) =>
          console.error("Character folder migration error:", error),
        );
        setSettingsLoadError(null);
        settingsHydratedAtRef.current = Date.now();
        setSettingsReadyForSave(true);
        setSettingsLoaded(true);
      } catch (error) {
        console.error("Settings load error:", error);
        setSettingsLoadError(error instanceof Error ? error.message : String(error));
        setSettingsReadyForSave(false);
        setSettingsLoaded(true);
      }
    };

    loadSettings();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      stopActiveAudio();
      const context = audioContextRef.current;
      audioContextRef.current = null;
      activeAudioSourceRef.current = null;
      if (context) {
        context.close().catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    liveConversationRef.current = liveConversation;
    if (!liveConversation) {
      autoSpeechEligibleAssistantIdsRef.current.clear();
      invoke("stop_omnivoice_engine").catch(() => undefined);
    }
  }, [liveConversation]);

  useEffect(() => {
    if (!settingsLoaded || telegramAutoStartAttemptedRef.current) return;
    telegramAutoStartAttemptedRef.current = true;
    if (!telegramBotToken.trim()) return;
    handleStartTelegram().catch((error) => console.error("Telegram auto-start error:", error));
  }, [settingsLoaded, telegramBotToken]);

  useEffect(() => {
    if (!settingsLoaded || !telegramRunning) return;
    refreshTelegramGuests();
    const handle = window.setInterval(refreshTelegramGuests, 5000);
    return () => window.clearInterval(handle);
  }, [settingsLoaded, telegramRunning]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const register = async (event: string, handler: () => void) => {
      const unlisten = await listen(event, handler);
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    };

    const attachTrayHandlers = async () => {
      await Promise.all([
        register("tray-toggle-telegram", () => {
          (telegramRunning ? handleStopTelegram() : handleStartTelegram()).catch((error) =>
            console.error("Tray Telegram toggle error:", error),
          );
        }),
        register("tray-toggle-auto-voice", () => setAutoVoiceMode(!liveConversation)),
      ]);
    };

    attachTrayHandlers().catch((error) => console.error("Tray handler setup error:", error));

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [
    telegramBotToken,
    telegramOwnerId,
    samplingTemperature,
    topK,
    topP,
    minP,
    repeatLastN,
    repeatPenalty,
    replyLength,
    googleClientId,
    googleClientSecret,
    linkedFolders,
    personality,
    characterSoul,
    personalityMemory,
    userName,
    userDescription,
    googleStatus.connected,
    googleStatus.email,
    telegramRunning,
    voiceSetupStatus.ready,
    omniVoiceStatus.ready,
    liveConversation,
  ]);

  useEffect(() => {
    if (!settingsLoaded) return;
    invoke("update_tray_menu_state", {
      telegramRunning,
      autoVoice: liveConversation,
    }).catch((error) => console.error("Tray menu state update error:", error));
  }, [settingsLoaded, telegramRunning, liveConversation]);

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId) return;
    const activePersonality =
      personalityPresets.find((preset) => preset.id === selectedPersonalityId) ?? personalityPresets[0];
    if (!activePersonality) return;

    let cancelled = false;
    invoke<CharacterFiles>("load_character_files", {
      id: activePersonality.id,
      name: activePersonality.name,
      prompt: activePersonality.prompt || personality || "",
      avatar: activePersonality.avatar || "",
      voicePath: activePersonality.voice_path || selectedVoicePath || "",
    })
      .then((files) => {
        if (cancelled) return;
        setCharacterSoul(files.soul);
        setCharacterFolder(files.folder);
        if (files.settings.voice_path) {
          setSelectedVoicePath(files.settings.voice_path);
        }
        setPersonalityPresets((prev) =>
          prev.map((preset) =>
            preset.id === activePersonality.id
              ? {
                  ...preset,
                  voice_path: files.settings.voice_path || preset.voice_path || "",
                  avatar: preset.avatar || files.settings.avatar || "",
                  prompt: preset.prompt || files.settings.prompt || "",
                }
              : preset,
          ),
        );
      })
      .catch((error) => {
        console.error("Character files load error:", error);
        setCharacterSoul("");
        setCharacterFolder("");
      });

    return () => {
      cancelled = true;
    };
  }, [settingsLoaded, selectedPersonalityId, personalityPresets.length]);

  useEffect(() => {
    if (!settingsLoaded || !selectedUserProfileId) return;
    updateActiveUserProfile({
      name: userName,
      avatar: userAvatar,
      description: userDescription,
      location_label: userLocationLabel,
      latitude: userLatitude,
      longitude: userLongitude,
      auto_speech: selectedUserProfile?.auto_speech ?? true,
    });
  }, [settingsLoaded, selectedUserProfileId, userName, userAvatar, userDescription, userLocationLabel, userLatitude, userLongitude, selectedUserProfile?.auto_speech]);

  useEffect(() => {
    if (!settingsLoaded || !settingsReadyForSave || !selectedPersonalityId || !characterSoul.trim()) return;
    const handle = window.setTimeout(() => {
      saveActiveCharacterFiles().catch((error) => console.error("Character files save error:", error));
    }, 900);
    return () => window.clearTimeout(handle);
  }, [settingsLoaded, settingsReadyForSave, selectedPersonalityId, selectedVoicePath, personality, personalityAvatar, characterSoul]);

  useEffect(() => {
    const applyMissingTooltip = (event: MouseEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest("button,input,textarea,select")
        : null;
      if (!(target instanceof HTMLElement) || target.getAttribute("title")) return;
      const tooltip =
        target.getAttribute("aria-label") ||
        target.getAttribute("placeholder") ||
        target.textContent?.replace(/\s+/g, " ").trim() ||
        "";
      if (tooltip) target.setAttribute("title", tooltip);
    };
    document.addEventListener("mouseover", applyMissingTooltip, true);
    return () => document.removeEventListener("mouseover", applyMissingTooltip, true);
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !settingsReadyForSave) {
      return;
    }
    if (Date.now() - settingsHydratedAtRef.current < 1500) {
      const handle = window.setTimeout(() => {
        settingsHydratedAtRef.current = 0;
      }, 1500);
      return () => window.clearTimeout(handle);
    }

    const handle = setTimeout(() => {
      invoke("save_app_settings", {
        settings: {
          live_conversation: liveConversation,
          setup_completed: setupCompleted,
          user_name: userName,
          user_avatar: userAvatar,
          user_description: userDescription,
          user_location_label: userLocationLabel,
          user_latitude: userLatitude,
          user_longitude: userLongitude,
          theme_swatch_id: themeSwatchId,
          telegram_bot_token: telegramBotToken,
          telegram_owner_id: telegramOwnerId,
          telegram_guests: telegramGuests,
          thinking_enabled: thinkingEnabled,
          google_client_id: googleClientId,
          google_client_secret: googleClientSecret,
          google_redirect_uri: googleRedirectUri,
          image_width: imageWidth,
          image_height: imageHeight,
          voice_folder: voiceFolder,
          selected_voice_path: selectedVoicePath,
          creativity,
          sampling_temperature: samplingTemperature,
          top_k: topK,
          top_p: topP,
          min_p: minP,
          repeat_last_n: repeatLastN,
          repeat_penalty: repeatPenalty,
          memory_size: memorySize,
          reply_length: replyLength,
          intelligence_quality: intelligenceQuality,
          personality,
          personality_presets: personalityPresets,
          selected_personality_id: selectedPersonalityId,
          user_profiles: userProfiles,
          selected_user_profile_id: selectedUserProfileId,
          model_folder: modelFolder,
          selected_model_path: selectedModelPath,
          linked_folders: linkedFolders,
          ui_left_panel_open: leftPanelOpen,
          ui_right_panel_open: rightPanelOpen,
          ui_workspace_open: workspaceOpen,
          ui_image_studio_open: imageStudioOpen,
          ui_calendar_open: calendarOpen,
          ui_automation_open: automationOpen,
          ui_telegram_open: telegramPanelOpen,
          ui_google_open: googlePanelOpen,
          ui_tool_activity_open: toolRunsOpen,
          ui_sampling_open: samplingOpen,
        } satisfies AppSettings,
      }).catch((error) => console.error("Settings save error:", error));
    }, 800);

    return () => clearTimeout(handle);
  }, [
    settingsLoaded,
    settingsReadyForSave,
    setupCompleted,
    userName,
    userAvatar,
    userDescription,
    userProfiles,
    selectedUserProfileId,
    userLocationLabel,
    userLatitude,
    userLongitude,
    themeSwatchId,
    liveConversation,
    telegramBotToken,
    telegramOwnerId,
    telegramGuests,
    thinkingEnabled,
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
    imageWidth,
    imageHeight,
    voiceFolder,
    selectedVoicePath,
    creativity,
    samplingTemperature,
    topK,
    topP,
    minP,
    repeatLastN,
    repeatPenalty,
    memorySize,
    replyLength,
    intelligenceQuality,
    personality,
    personalityPresets,
    selectedPersonalityId,
    modelFolder,
    selectedModelPath,
    linkedFolders,
    leftPanelOpen,
    rightPanelOpen,
    workspaceOpen,
    imageStudioOpen,
    calendarOpen,
    automationOpen,
    telegramPanelOpen,
    googlePanelOpen,
    toolRunsOpen,
    samplingOpen,
  ]);

  useEffect(() => {
    chatSessionsRef.current = chatSessions;
  }, [chatSessions]);

  useEffect(() => {
    if (!selectedPersonalityId) return;
    setChatSessions((prev) =>
      prev[selectedPersonalityId] === messages
        ? prev
        : { ...prev, [selectedPersonalityId]: messages },
    );
  }, [messages, selectedPersonalityId]);

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId || loadedChatSessionIdsRef.current.has(selectedPersonalityId)) {
      return;
    }

    let active = true;
    invoke<string>("load_personality_chat_session", { personalityId: selectedPersonalityId })
      .then((raw) => {
        if (!active) return;
        const session = parseStoredChatSession(raw);
        loadedChatSessionIdsRef.current.add(selectedPersonalityId);
        chatSessionsRef.current = { ...chatSessionsRef.current, [selectedPersonalityId]: session };
        setChatSessions((prev) => ({ ...prev, [selectedPersonalityId]: session }));
        setMessages(session);
        lastMessageCountRef.current = session.length;
        sessionShadowRef.current[selectedPersonalityId] = compactSessionFingerprint(session);
        lastSessionMutationAtRef.current[selectedPersonalityId] = Date.now();
      })
      .catch((error) => {
        console.error("Chat session load error:", error);
        loadedChatSessionIdsRef.current.add(selectedPersonalityId);
      });

    return () => {
      active = false;
    };
  }, [settingsLoaded, selectedPersonalityId]);

  useEffect(() => {
    if (!settingsLoaded) return;
    ensureConversationStartsAtBottom();
  }, [settingsLoaded, selectedPersonalityId, messages.length]);

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId || !loadedChatSessionIdsRef.current.has(selectedPersonalityId)) {
      return;
    }
    const session = compactChatSessionForStorage(messages);
    const sessionJson = JSON.stringify(session);
    sessionShadowRef.current[selectedPersonalityId] = sessionJson;
    lastSessionMutationAtRef.current[selectedPersonalityId] = Date.now();
    const handle = window.setTimeout(() => {
      invoke("save_personality_chat_session", {
        personalityId: selectedPersonalityId,
        messagesJson: sessionJson,
      }).catch((error) => console.error("Chat session save error:", error));
    }, 900);
    return () => window.clearTimeout(handle);
  }, [settingsLoaded, selectedPersonalityId, messages]);

  useEffect(() => {
    if (!settingsLoaded) return;
    const missingImages: Array<{ messageId: string; partIndex: number; path: string }> = [];
    messages.forEach((message) => {
      if (!Array.isArray(message.content)) return;
      message.content.forEach((part, partIndex) => {
        if (part.type === "image_url" && part.image_url.local_path && !part.image_url.url) {
          missingImages.push({ messageId: message.id, partIndex, path: part.image_url.local_path });
        }
      });
    });
    if (!missingImages.length) return;

    let cancelled = false;
    Promise.all(
      missingImages.map(async (item) => {
        try {
          const result = await invoke<LocalImageDataUrl>("read_local_image_data_url", { path: item.path });
          return { ...item, url: result.data_url };
        } catch (error) {
          console.error("Stored image reload error:", error);
          return { ...item, url: "" };
        }
      }),
    ).then((loaded) => {
      if (cancelled) return;
      const loadedByPart = new Map(loaded.filter((item) => item.url).map((item) => [`${item.messageId}:${item.partIndex}`, item.url]));
      if (!loadedByPart.size) return;
      setMessages((prev) =>
        prev.map((message) => {
          if (!Array.isArray(message.content)) return message;
          let changed = false;
          const content = message.content.map((part, partIndex) => {
            if (part.type !== "image_url") return part;
            const url = loadedByPart.get(`${message.id}:${partIndex}`);
            if (!url) return part;
            changed = true;
            return { ...part, image_url: { ...part.image_url, url } };
          });
          return changed ? { ...message, content } : message;
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [settingsLoaded, messages]);

  useEffect(() => {
    refreshPendingShellActions();
    refreshAutomationJobs();
    refreshToolRuns();
    refreshGoogleStatus().catch((error) => console.error("Google startup status error:", error));
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId) return;
    invoke<MemoryItem[]>("list_local_memory", {
      kind: personalityMemoryKind(selectedPersonalityId),
      limit: 20,
    })
      .then((items) => {
        const memory = items.find((item) => item.key === "compact_style_memory")?.value || "";
        setPersonalityMemory(memory);
        personalityMemoryShadowRef.current[selectedPersonalityId] = memory;
      })
      .catch((error) => {
        console.error("Personality memory load error:", error);
        setPersonalityMemory("");
        personalityMemoryShadowRef.current[selectedPersonalityId] = "";
      });
  }, [settingsLoaded, selectedPersonalityId]);

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId || !loadedChatSessionIdsRef.current.has(selectedPersonalityId)) {
      return;
    }

    let active = true;
    const syncSession = async () => {
      if (sendInFlightRef.current || isStreaming) return;
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;
      const lastMutation = lastSessionMutationAtRef.current[selectedPersonalityId] ?? 0;
      if (Date.now() - lastMutation < 1800) return;
      try {
        const raw = await invoke<string>("load_personality_chat_session", {
          personalityId: selectedPersonalityId,
        });
        if (!active) return;
        const remoteSession = parseStoredChatSession(raw);
        const remoteFingerprint = compactSessionFingerprint(remoteSession);
        const currentFingerprint =
          sessionShadowRef.current[selectedPersonalityId] ??
          compactSessionFingerprint(chatSessionsRef.current[selectedPersonalityId] ?? []);
        if (remoteFingerprint === currentFingerprint) return;
        sessionShadowRef.current[selectedPersonalityId] = remoteFingerprint;
        chatSessionsRef.current = {
          ...chatSessionsRef.current,
          [selectedPersonalityId]: remoteSession,
        };
        setChatSessions((prev) => ({ ...prev, [selectedPersonalityId]: remoteSession }));
        setMessages(remoteSession);
        lastMessageCountRef.current = remoteSession.length;
      } catch (error) {
        console.error("Chat session sync error:", error);
      }
    };

    const handle = window.setInterval(() => {
      syncSession().catch((error) => console.error("Chat session sync error:", error));
    }, telegramRunning ? 2500 : 5000);

    syncSession().catch((error) => console.error("Chat session sync error:", error));
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, [settingsLoaded, selectedPersonalityId, telegramRunning, isStreaming]);

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId) return;

    let active = true;
    const syncMemory = async () => {
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;
      try {
        const items = await invoke<MemoryItem[]>("list_local_memory", {
          kind: personalityMemoryKind(selectedPersonalityId),
          limit: 20,
        });
        if (!active) return;
        const nextMemory = items.find((item) => item.key === "compact_style_memory")?.value || "";
        if ((personalityMemoryShadowRef.current[selectedPersonalityId] ?? "") === nextMemory) {
          return;
        }
        personalityMemoryShadowRef.current[selectedPersonalityId] = nextMemory;
        setPersonalityMemory(nextMemory);
      } catch (error) {
        console.error("Personality memory sync error:", error);
      }
    };

    const handle = window.setInterval(() => {
      syncMemory().catch((error) => console.error("Personality memory sync error:", error));
    }, telegramRunning ? 2500 : 5000);

    syncMemory().catch((error) => console.error("Personality memory sync error:", error));
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, [settingsLoaded, selectedPersonalityId, telegramRunning]);

  useEffect(() => {
    if (!settingsLoaded || !googleStatus.connected) {
      return;
    }

    refreshGoogleCalendarEvents(automationMonth).catch((error) => console.error("Google Calendar refresh error:", error));
  }, [settingsLoaded, googleStatus.connected, automationMonth, googleClientId, googleClientSecret]);

  useEffect(() => {
    let isActive = true;
    let pollHandle: ReturnType<typeof setInterval> | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const initializeEngine = async () => {
      try {
        const info = await invoke<SystemInfo>("check_system");
        if (!isActive) return;
        setSystemInfo(info);

        if (!systemDefaultsAppliedRef.current) {
          setMemorySize((prev) =>
            prev === DEFAULT_SETTINGS.memory_size
              ? Math.max(prev, info.recommended_context_size)
              : prev,
          );
          systemDefaultsAppliedRef.current = true;
        }

        const ready = await invoke<boolean>("check_engine_ready");
        if (!isActive) return;
        if (ready) {
          await refreshEngineInfo();
          setEngineErrorMsg("");
          setEngineStatus("ready");
          return;
        }

        setEngineStatus("downloading");
        const result = await invoke<{ success: boolean; message: string }>("download_engine", {
          hasNvidiaGpu: info.has_nvidia_gpu,
          forceRefresh: false,
        });
        if (!isActive) return;

        if (!result.success) {
          setEngineErrorMsg(result.message);
          setEngineStatus("error");
          return;
        }

        pollHandle = setInterval(async () => {
          try {
            const isReady = await invoke<boolean>("check_engine_ready");
            if (!isActive) return;

            if (isReady && pollHandle) {
              clearInterval(pollHandle);
              if (timeoutHandle) clearTimeout(timeoutHandle);
              await refreshEngineInfo();
              setEngineErrorMsg("");
              setEngineStatus("ready");
            }
          } catch (error) {
            console.error("Engine poll error:", error);
          }
        }, 3000);

        timeoutHandle = setTimeout(() => {
          if (!isActive) return;
          if (pollHandle) clearInterval(pollHandle);
          setEngineStatus("error");
          setEngineErrorMsg("The brain download took too long. Please try again.");
        }, 20 * 60 * 1000);
      } catch (error) {
        if (!isActive) return;
        console.error(error);
        setEngineErrorMsg(error instanceof Error ? error.message : String(error));
        setEngineStatus("error");
      }
    };

    initializeEngine();

    return () => {
      isActive = false;
      if (pollHandle) clearInterval(pollHandle);
      if (timeoutHandle) clearTimeout(timeoutHandle);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let intervalHandle: ReturnType<typeof setInterval> | undefined;

    const syncVoiceStatus = async () => {
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;
      try {
        const status = await invoke<VoiceSetupStatus>("get_voice_setup_status");
        if (!active) return;
        setVoiceSetupStatus(status);

      } catch (error) {
        if (!active) return;
        console.error("Voice status error:", error);
      }
    };

    syncVoiceStatus();
    intervalHandle = setInterval(syncVoiceStatus, 5000);

    return () => {
      active = false;
      if (intervalHandle) clearInterval(intervalHandle);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let intervalHandle: ReturnType<typeof setInterval> | undefined;

    const syncOmniVoiceStatus = async () => {
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;
      try {
        const status = await invoke<VoiceSetupStatus>("get_omnivoice_engine_status");
        if (!active) return;
        setOmniVoiceStatus(status);
      } catch (error) {
        if (!active) return;
        console.error("OmniVoice status error:", error);
      }
    };

    syncOmniVoiceStatus();
    intervalHandle = setInterval(syncOmniVoiceStatus, 5000);

    return () => {
      active = false;
      if (intervalHandle) clearInterval(intervalHandle);
    };
  }, []);

  const refreshVoiceSamples = useCallback(async () => {
    const samples = await invoke<VoiceSample[]>("list_voice_samples", {
      folder: voiceFolder || null,
    });

    setVoiceSamples(samples);

    if (!selectedVoicePath && samples.length > 0) {
      updateActiveCharacterVoicePath(samples[0].path);
      return;
    }

    if (
      selectedVoicePath &&
      !samples.some((sample) => sample.path === selectedVoicePath)
    ) {
      updateActiveCharacterVoicePath(samples[0]?.path ?? "");
    }
  }, [selectedVoicePath, voiceFolder]);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    refreshVoiceSamples().catch((error) => {
      console.error("Voice sample load error:", error);
    });
  }, [settingsLoaded, refreshVoiceSamples]);

  useEffect(() => {
    if (!settingsLoaded || (!personalityProfileOpen && !userProfileOpen)) {
      return;
    }

    refreshVoiceSamples().catch((error) => {
      console.error("Voice sample refresh error:", error);
    });
  }, [settingsLoaded, personalityProfileOpen, userProfileOpen, refreshVoiceSamples]);

  useEffect(() => {
    if (!settingsLoaded || !settingsReadyForSave) {
      return;
    }

    if (!selectedVoicePath && voiceSamples.length > 0) {
      updateActiveCharacterVoicePath(voiceSamples[0].path);
      return;
    }

    if (
      selectedVoicePath &&
      voiceSamples.length > 0 &&
      !voiceSamples.some((sample) => sample.path === selectedVoicePath)
    ) {
      updateActiveCharacterVoicePath(voiceSamples[0].path);
    }
  }, [settingsLoaded, selectedVoicePath, voiceSamples]);

  useEffect(() => {
    if (!personalityProfileOpen) return;
    const handle = window.setTimeout(() => {
      selectedVoiceRowRef.current?.scrollIntoView({ block: "center" });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [personalityProfileOpen, selectedVoicePath, voiceSamples.length]);

  useEffect(() => {
    if (!userProfileOpen) return;
    const handle = window.setTimeout(() => {
      selectedUserVoiceRowRef.current?.scrollIntoView({ block: "center" });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [userProfileOpen, selectedUserVoicePath, voiceSamples.length]);

  useEffect(() => {
    if (messages.length === lastMessageCountRef.current) {
      return;
    }

    lastMessageCountRef.current = messages.length;
    const lastMessage = messages[messages.length - 1];
    window.requestAnimationFrame(() => {
      const container = conversationScrollRef.current;
      if (!container) return;

      if (lastMessage?.role === "assistant") {
        const element = document.querySelector(`[data-message-id="${lastMessage.id}"]`) as HTMLElement | null;
        if (element) {
          container.scrollTo({
            top: Math.max(0, element.offsetTop - container.offsetTop - 16),
            behavior: "smooth",
          });
        }
        return;
      }

      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    });
  }, [messages]);

  useEffect(() => {
    if (!settingsLoaded || !liveConversation || isStreaming || isGeneratingImage || isTranscribing || speakingMessageId) {
      return;
    }

    const queue = messages
      .filter((message) => message.role === "assistant" && autoSpeechEligibleAssistantIdsRef.current.has(message.id))
      .map((message) => message.id);
    if (!queue.length) {
      return;
    }

    const firstMessage = messages.find((message) => message.id === queue[0]);
    const firstText = firstMessage ? extractMessageText(firstMessage.content).trim() : "";
    if (!firstText || firstText.startsWith("[Error") || firstText === "[Stopped]") {
      autoSpeechEligibleAssistantIdsRef.current.delete(queue[0]);
      return;
    }

    if (lastAutoSpokenAssistantIdRef.current === queue[0]) {
      return;
    }

    autoSpeechQueueRef.current = queue;
    ensureAudioPlaybackUnlocked().catch(() => null);
    const requestId = ++voicePlaybackRequestRef.current;
    playAutoSpeechQueue(queue, requestId).catch((error) => {
      console.error("Live speech queue error:", error);
    });
  }, [settingsLoaded, messages, liveConversation, isStreaming, isGeneratingImage, isTranscribing, speakingMessageId, selectedVoicePath]);

  useEffect(() => {
    if (messages.length !== 0) {
      return;
    }

    window.requestAnimationFrame(() => {
      const container = conversationScrollRef.current;
      if (!container) return;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "auto",
      });
    });
  }, [messages.length, selectedPersonalityId]);

  useEffect(() => {
    const onResize = () => {
      const sideWidth = 292;
      const compact = window.innerWidth - sideWidth * 2 < 482;
      setIsCompactLayout(compact);
      if (compact) {
        setLeftPanelOpen(false);
        setRightPanelOpen(false);
      } else {
        setLeftPanelOpen(true);
        setRightPanelOpen(true);
      }
    };

    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const closeOpenDropdowns = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-dropdown-root]")) {
        return;
      }

      setModelMenuOpen(false);
      setQuickModelMenuOpen(false);
      setThemePickerOpen(false);
      setUserProfileMenuOpen(false);
      setPersonalityMenuOpen(false);
      setAutomationTimeMenuOpen(false);
      setAutomationDateMenuOpen(false);
      setAutomationMonthMenuOpen(false);
      setAutomationEveryUnitMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOpenDropdowns);
    return () => document.removeEventListener("pointerdown", closeOpenDropdowns);
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !modelFolder) {
      return;
    }

    scanModelLibrary(modelFolder, selectedModelPath, true).catch((error) =>
      console.error("Initial model scan error:", error),
    );
  }, [settingsLoaded, modelFolder]);

  useEffect(() => {
    const updateDateTime = () => {
      setDateTimeLine(
        new Intl.DateTimeFormat(undefined, {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date()),
      );
    };
    updateDateTime();
    const handle = window.setInterval(updateDateTime, 60_000);
    return () => window.clearInterval(handle);
  }, []);

  useEffect(() => {
    if (engineStatus !== "ready" || !pendingAutoLoadPath) {
      return;
    }

    loadModelPath(pendingAutoLoadPath).catch((error) =>
      console.error("Deferred model load error:", error),
    );
  }, [engineStatus, pendingAutoLoadPath]);

  const automationMonthDays = buildMonthDays(automationMonth);
  const activeAutomationCount = automationJobs.filter((job) => job.enabled).length;
  const recentAutomationJobs = [...automationJobs]
    .sort((a, b) => {
      if (a.created_at !== b.created_at) return b.created_at - a.created_at;
      return b.id - a.id;
    })
    .slice(0, 10);
  const selectedGoogleEvents = googleCalendarEvents.filter((event) =>
    googleEventMatchesDate(event, selectedAutomationDate),
  );
  const selectedAutomationDateObj = new Date(`${selectedAutomationDate}T00:00:00`);
  const selectedAutomationLabel = Number.isNaN(selectedAutomationDateObj.getTime())
    ? selectedAutomationDate
    : new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      }).format(selectedAutomationDateObj);
  const currentModelName =
    currentModelEntry?.name || selectedModel || (selectedModelPath ? "Selected brain" : "No model selected");
  const selectedPersonalityPreset =
    personalityPresets.find((preset) => preset.id === selectedPersonalityId) ?? personalityPresets[0];
  const assistantAvatar = selectedPersonalityPreset?.avatar || personalityAvatar || "";
  const hardwareGpuLabel = systemInfo?.gpu_details.replace(/\s*\(([^)]+)\)\s*$/, " - $1") ?? "";
  const hardwareRamLabel = systemInfo ? `${(systemInfo.total_ram_mb / 1024).toFixed(1)} GB` : "Unknown";
  const detectedSetupTier = setupTierFromSystem(systemInfo);
  const activeSetupTier = setupTierOverride ?? detectedSetupTier;
  const firstStartupSetupNeeded = !setupCompleted && !selectedModelPath;
  const activeSetupPartKey = setupProgress?.part_key || "";
  const conversationLogoClass = messages.length === 0
    ? "hidden"
    : "pointer-events-none absolute left-1/2 top-1/2 z-0 w-[min(52vw,360px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.045]";
  const compactComposerNotice = composerNotice
    .replace(/^Thinking with tools\.\.\.$/, "Chat: thinking with tools")
    .replace(/^Waiting for confirmation before using tools\.$/, "Chat: waiting for tool confirmation")
    .replace(/^Preparing voice playback\.\.\.$/, "Voice: preparing playback");
  const topStatusText =
    (brainStatus === "Loading" ? `Model: ${modelLoadStatus.message || "loading"}` : "") ||
    (brainStatus === "Error" ? `Model error: ${modelLoadStatus.message || "could not load"}` : "") ||
    (isGeneratingImage ? "Image: generating" : "") ||
    (isTranscribing ? "Voice: transcribing" : "") ||
    (isStreaming ? "Chat: generating reply" : "") ||
    compactComposerNotice ||
    (omniVoiceStatus.state !== "idle" && !omniVoiceStatus.ready ? "Voice: preparing playback" : "") ||
    (voiceSetupStatus.state !== "idle" && !voiceSetupStatus.ready ? `Voice input: ${voiceSetupStatus.message || "preparing"}` : "") ||
    (engineStatus === "downloading" ? "Engine: preparing model runtime" : "") ||
    (selectedModelPath ? `Ready: ${currentModelName}` : "No model loaded");
  const topProgressPercent =
    brainStatus === "Loading" || brainStatus === "Error"
      ? Math.max(8, modelLoadStatus.progress)
      : omniVoiceStatus.state !== "idle" && !omniVoiceStatus.ready
        ? Math.max(8, omniVoiceStatus.progress)
      : voiceSetupStatus.state !== "idle" && !voiceSetupStatus.ready
        ? Math.max(8, voiceSetupStatus.progress)
        : isGeneratingImage
          ? 65
          : isTranscribing
            ? 45
            : isStreaming
              ? 100
              : engineStatus === "downloading"
                ? 25
                : 0;
  const topProgressActive = topProgressPercent > 0;
  const imageStudioDrawing = isGeneratingImage;
  const waveformProcessing =
    isGeneratingImage ||
    isStreaming ||
    isTranscribing ||
    brainStatus === "Loading" ||
    brainStatus === "Thinking" ||
    modelLoadStatus.state === "starting" ||
    modelLoadStatus.state === "loading" ||
    modelLoadStatus.state === "updating" ||
    (activeTaskType === "voice" && !isAudioPlaying) ||
    activeTaskType === "image" ||
    (voiceSetupStatus.state !== "idle" && !voiceSetupStatus.ready) ||
    Boolean(
      composerNotice &&
        /(thinking|preparing|loading|generating|sending|transcribing|starting|updating)/i.test(composerNotice),
    );

  const resizeComposerTextarea = (node: HTMLTextAreaElement) => {
    node.style.height = "0px";
    node.style.height = `${Math.min(192, Math.max(42, node.scrollHeight))}px`;
  };

  const setComposerText = (text: string) => {
    lastComposerInputAtRef.current = Date.now();
    setInput(text);
    setComposerHasText(Boolean(text.trim()));
    const node = composerInputRef.current;
    if (node) {
      node.value = text;
      resizeComposerTextarea(node);
    }
  };

  const resetSamplingDefaults = () => {
    setSamplingTemperature(DEFAULT_SETTINGS.sampling_temperature);
    setTopK(DEFAULT_SETTINGS.top_k);
    setTopP(DEFAULT_SETTINGS.top_p);
    setMinP(DEFAULT_SETTINGS.min_p);
    setRepeatLastN(DEFAULT_SETTINGS.repeat_last_n);
    setRepeatPenalty(DEFAULT_SETTINGS.repeat_penalty);
  };

  useEffect(() => {
    const node = composerInputRef.current;
    if (!node) return;
    if (node.value !== input) {
      node.value = input;
    }
    setComposerHasText((previous) => {
      const next = Boolean(node.value.trim());
      return previous === next ? previous : next;
    });
    resizeComposerTextarea(node);
  }, [input]);

  const selectPersonalityPreset = (presetId: string) => {
    const preset = personalityPresets.find((item) => item.id === presetId);
    if (!preset) return;
    saveActiveChatSession();
    setSelectedPersonalityId(preset.id);
    setPersonalityNameDraft(preset.name || "Assistant");
    setPersonality(preset.prompt);
    setPersonalityAvatar(preset.avatar || "");
    if (preset.voice_path) {
      setSelectedVoicePath(preset.voice_path);
    }
    loadChatSessionForPersonality(preset.id);
    setComposerText("");
    setImage(null);
    setImagePath(null);
    setComposerNotice("");
  };

  const selectUserProfile = (profileId: string) => {
    const profile = userProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    setSelectedUserProfileId(profile.id);
    setUserName(profile.name || "You");
    setUserAvatar(profile.avatar || "");
    setUserDescription(profile.description || "");
    setUserLocationLabel(profile.location_label || "");
    setUserLatitude(typeof profile.latitude === "number" && Number.isFinite(profile.latitude) ? profile.latitude : null);
    setUserLongitude(typeof profile.longitude === "number" && Number.isFinite(profile.longitude) ? profile.longitude : null);
    setUserProfileMenuOpen(false);
  };

  const createUserProfile = () => {
    const profile: UserProfilePreset = {
      id: createMessageId(),
      name: "New user",
      description: "",
      avatar: "",
      voice_path: "",
      location_label: "",
      latitude: null,
      longitude: null,
      auto_speech: true,
    };
    setUserProfiles((prev) => [...prev, profile]);
    setSelectedUserProfileId(profile.id);
    setUserName(profile.name);
    setUserAvatar("");
    setUserDescription("");
    setUserLocationLabel("");
    setUserLatitude(null);
    setUserLongitude(null);
    setUserProfileMenuOpen(false);
    setUserProfileOpen(true);
  };

  const openUserProfile = () => {
    setUserProfileMenuOpen(false);
    setUserProfileOpen(true);
  };

  const saveActiveUserProfile = () => {
    const nextName = userName.trim() || selectedUserProfile?.name || "You";
    setUserName(nextName);
    updateActiveUserProfile({
      name: nextName,
      avatar: userAvatar,
      description: userDescription,
      voice_path: selectedUserVoicePath,
      location_label: userLocationLabel,
      latitude: userLatitude,
      longitude: userLongitude,
      auto_speech: selectedUserProfile?.auto_speech ?? true,
    });
    setUserProfileOpen(false);
  };

  const deleteSelectedUserProfile = () => {
    if (userProfiles.length <= 1) return;
    setUserProfiles((prev) => {
      const next = prev.filter((profile) => profile.id !== selectedUserProfileId);
      const fallback = next[0] ?? DEFAULT_SETTINGS.user_profiles[0];
      setSelectedUserProfileId(fallback.id);
      setUserName(fallback.name || "You");
      setUserAvatar(fallback.avatar || "");
      setUserDescription(fallback.description || "");
      setUserLocationLabel(fallback.location_label || "");
      setUserLatitude(typeof fallback.latitude === "number" && Number.isFinite(fallback.latitude) ? fallback.latitude : null);
      setUserLongitude(typeof fallback.longitude === "number" && Number.isFinite(fallback.longitude) ? fallback.longitude : null);
      return next.length ? next : DEFAULT_SETTINGS.user_profiles;
    });
    setUserProfileOpen(false);
  };

  const openPersonalityProfile = () => {
    setPersonalityNameDraft(selectedPersonalityPreset?.name || "Assistant");
    setPersonalityProfileOpen(true);
  };

  const saveCurrentPersonalityPreset = () => {
    const name = "New assistant";
    const preset: PersonalityPreset = {
      id: createMessageId(),
      name,
      prompt: "You are a helpful assistant.",
      avatar: "",
      voice_path: "",
    };
    saveActiveChatSession();
    setPersonalityPresets((prev) => [...prev, preset]);
    setSelectedPersonalityId(preset.id);
    setPersonality(preset.prompt);
    setPersonalityAvatar("");
    setSelectedVoicePath("");
    setPersonalityNameDraft(name);
    setMessages([]);
    loadedChatSessionIdsRef.current.add(preset.id);
    chatSessionsRef.current = { ...chatSessionsRef.current, [preset.id]: [] };
    setChatSessions((prev) => ({ ...prev, [preset.id]: [] }));
    sessionShadowRef.current[preset.id] = compactSessionFingerprint([]);
    lastSessionMutationAtRef.current[preset.id] = Date.now();
    setPersonalityProfileOpen(true);
  };

  const updateSelectedPersonalityPreset = () => {
    const nextName = personalityNameDraft.trim() || selectedPersonalityPreset?.name || "Assistant";
    setPersonalityPresets((prev) =>
      prev.map((preset) =>
        preset.id === selectedPersonalityId
          ? { ...preset, name: nextName, prompt: personality, avatar: personalityAvatar, voice_path: selectedVoicePath }
          : preset,
      ),
    );
    setPersonalityNameDraft(nextName);
    saveActiveCharacterFiles({
      name: nextName,
      prompt: personality,
      avatar: personalityAvatar,
      voice_path: selectedVoicePath,
      soul: characterSoul,
    }).catch((error) => console.error("Character files save error:", error));
  };

  const deleteSelectedPersonalityPreset = () => {
    if (personalityPresets.length <= 1) return;
    const deletedPersonalityId = selectedPersonalityId;
    deletePersonalityMemory(deletedPersonalityId).catch((error) => console.error("Personality memory delete error:", error));
    invoke("delete_personality_chat_session", { personalityId: deletedPersonalityId }).catch((error) =>
      console.error("Personality chat session delete error:", error),
    );
    setPersonalityPresets((prev) => {
      const next = prev.filter((preset) => preset.id !== selectedPersonalityId);
      const fallback = next[0] ?? DEFAULT_SETTINGS.personality_presets[0];
      const { [deletedPersonalityId]: _deletedSession, ...remainingSessions } = chatSessionsRef.current;
      loadedChatSessionIdsRef.current.delete(deletedPersonalityId);
      chatSessionsRef.current = remainingSessions;
      setChatSessions(remainingSessions);
      setSelectedPersonalityId(fallback.id);
      setPersonalityNameDraft(fallback.name || "Assistant");
      setPersonality(fallback.prompt);
      setPersonalityAvatar(fallback.avatar || "");
      setPersonalityMemory("");
      setMessages(remainingSessions[fallback.id] ?? []);
      return next.length ? next : DEFAULT_SETTINGS.personality_presets;
    });
  };

  const brainSection = (
    <section className="rounded-[20px] border border-[#282a2c] bg-[#1e1f20] p-2.5 shadow-sm">
      <div className="flex h-9 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">AI Brain</div>
        </div>
        <button
          type="button"
          title="Choose GGUF models folder"
          onClick={() => handleChooseModelFolder().catch((error) => console.error("Folder error:", error))}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#282a2c] bg-[#131314] text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]"
        >
          <FolderIcon className="h-4.5 w-4.5" />
        </button>
      </div>
      <div className="relative mt-2.5" data-dropdown-root>
              <button
                type="button"
                onClick={() => {
                  const next = !modelMenuOpen;
                  setUserProfileMenuOpen(false);
                  setPersonalityMenuOpen(false);
                  setQuickModelMenuOpen(false);
                  setThemePickerOpen(false);
                  setModelMenuOpen(next);
                }}
                className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[#282a2c] bg-[#131314] px-4 py-3 text-left text-sm text-[#e3e3e3] outline-none transition hover:bg-[#282a2c] focus:border-[var(--accent-color)]"
              >
          <span className="flex shrink-0 items-center gap-1.5">
            <BrainIcon className={`h-5 w-5 ${brainStatus === "Ready" || brainStatus === "Thinking" ? "text-emerald-400" : brainStatus === "Loading" ? "animate-pulse text-[var(--accent-color)]" : brainStatus === "Error" ? "text-rose-400" : "text-[#c4c7c5]"}`} />
            {currentModelEntry?.has_vision && <EyeIcon className="h-4 w-4 text-[var(--accent-color)]" />}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">
            {selectedModelPath ? currentModelName : "No model selected"}
          </span>
          <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[#c4c7c5] transition ${modelMenuOpen ? "rotate-180" : ""}`} />
        </button>

        {modelMenuOpen && (
          <div className="dropdown-scroll absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-[#282a2c] bg-[#131314] p-2 shadow-2xl">
            {availableModels.length === 0 ? (
              <div className="px-3 py-3 text-sm text-[#c4c7c5]">No model selected. Choose a GGUF folder first.</div>
            ) : (
              availableModels.map((model) => (
                <button
                  key={model.path}
                  type="button"
                  onClick={() => {
                    setModelMenuOpen(false);
                    setSelectedModelPath(model.path);
                    loadModelPath(model.path).catch((error) => console.error("Model select error:", error));
                  }}
                  className={`w-full rounded-xl px-3 py-2 text-left transition ${selectedModelPath === model.path ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent-soft-strong)]" : "hover:bg-[#1e1f20]"}`}
                >
                  <div className="flex items-center gap-2">
                    <BrainIcon className={`h-4 w-4 shrink-0 ${selectedModelPath === model.path && (brainStatus === "Ready" || brainStatus === "Thinking") ? "text-emerald-400" : "text-[#c4c7c5]"}`} />
                    {model.has_vision && <EyeIcon className="h-4 w-4 shrink-0 text-[var(--accent-color)]" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-[#e3e3e3]">{model.name}</div>
                      <div className="mt-0.5 truncate text-xs text-[#c4c7c5]">{model.relative_path}</div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <div className="mt-3 overflow-hidden rounded-2xl border border-[#282a2c] bg-[#131314] p-3">
        <HeartbeatMonitor
          accent={selectedThemeSwatch.accent}
          soft={selectedThemeSwatch.soft}
          mode={isAudioPlaying ? "voice" : waveformProcessing ? "image" : "idle"}
        />
      </div>
    </section>
  );

  const workspaceSection = (
    <details
      className="overflow-hidden rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm"
      open={workspaceOpen}
      onToggle={(event) => setWorkspaceOpen(event.currentTarget.open)}
    >
      <summary className="grid h-12 cursor-pointer list-none grid-cols-[minmax(0,1fr)_86px_16px] items-center gap-1 px-3 [&::-webkit-details-marker]:hidden">
        <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Workspace</div>
        <div className="flex min-w-0 items-center justify-start gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9aa0a6]">
          <span>
            <span className="font-bold text-[#e3e3e3]">{linkedFolders.length}</span>{" "}
            <span>linked</span>
          </span>
        </div>
        <ChevronDownIcon className="details-chevron h-4 w-4 shrink-0 text-[#c4c7c5]" />
      </summary>
      <div className="border-t border-[#282a2c] px-3 py-3 space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-[#9aa0a6]">
            Manage the workspace folders the assistant can use.
          </div>
          <button
            type="button"
            title="Add workspace folder"
            onClick={() => handleAddLinkedFolder().catch((error) => console.error(error))}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#282a2c] bg-[#1e1f20] text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]"
          >
            <PlusIcon className="h-4.5 w-4.5" />
          </button>
        </div>
        {linkedFolders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#3a3b3d] bg-[#131314] px-4 py-4 text-sm text-[#c4c7c5]">
            No workspace folder selected.
          </div>
        ) : (
          linkedFolders.map((folder) => (
            <div
              key={folder}
              className="flex items-center gap-2 rounded-2xl border border-[#282a2c] bg-[#131314] px-3 py-2"
            >
              <div className="min-w-0 flex-1 truncate text-sm text-[#e3e3e3]" title={folder}>{folder}</div>
              <button
                type="button"
                title="Remove workspace folder"
                onClick={() => handleRemoveLinkedFolder(folder)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#282a2c] bg-rose-500/15 text-rose-200 transition hover:bg-rose-500/25"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </details>
  );

  const imageStudioSection = (
    <details
      className="rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm"
      open={imageStudioOpen}
      onToggle={(event) => setImageStudioOpen(event.currentTarget.open)}
    >
      <summary className="grid h-12 cursor-pointer list-none grid-cols-[minmax(0,1fr)_86px_16px] items-center gap-1 px-3 [&::-webkit-details-marker]:hidden">
        <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Image Studio</div>
        <div className={`flex min-w-0 items-center justify-start gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${imageStudioDrawing ? "text-[var(--accent-color)]" : "text-[#c4c7c5]"}`}>
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${imageStudioDrawing ? "animate-pulse bg-[var(--accent-color)] shadow-[0_0_10px_var(--accent-color)]" : "bg-[#79d06f]"}`}
          />
          <span className="min-w-0 truncate">{imageStudioDrawing ? "Drawing" : "Ready"}</span>
        </div>
        <ChevronDownIcon className="details-chevron h-4 w-4 shrink-0 text-[#c4c7c5]" />
      </summary>
      <div className="space-y-3 border-t border-[#282a2c] px-4 py-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#c4c7c5]">Quick prompt</span>
          <textarea
            value={quickImagePrompt}
            onChange={(event) => setQuickImagePrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                void handleQuickImageGenerate();
              }
            }}
            rows={3}
            placeholder="Describe an image..."
            className="w-full resize-none rounded-2xl border border-[#282a2c] bg-[#131314] px-3 py-2 text-sm leading-relaxed text-[#e3e3e3] outline-none transition placeholder:text-[#9aa0a6] focus:border-[var(--accent-color)]"
          />
        </label>
        <button
          type="button"
          onClick={() => void handleQuickImageGenerate()}
          disabled={!quickImagePrompt.trim() || isGeneratingImage}
          className="h-10 w-full rounded-2xl border border-[#282a2c] bg-[#131314] text-sm font-bold text-[#e3e3e3] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isGeneratingImage ? "Drawing..." : "Generate"}
        </button>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="min-w-0">
            <span className="mb-1 block text-xs font-semibold text-[#c4c7c5]">Width</span>
            <NumberStepper
              value={imageWidth}
              min={256}
              max={2048}
              step={256}
              onChange={(value) => setImageWidth(clampNumber(value, 256, 2048))}
              className="w-full min-w-[112px]"
            />
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-xs font-semibold text-[#c4c7c5]">Height</span>
            <NumberStepper
              value={imageHeight}
              min={256}
              max={2048}
              step={256}
              onChange={(value) => setImageHeight(clampNumber(value, 256, 2048))}
              className="w-full min-w-[112px]"
            />
          </label>
        </div>
      </div>
    </details>
  );

  const automationSection = (
    <details
      className="overflow-hidden rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm"
      open={automationOpen}
      onToggle={(event) => setAutomationOpen(event.currentTarget.open)}
    >
      <summary className="grid h-12 cursor-pointer list-none grid-cols-[minmax(0,1fr)_86px_16px] items-center gap-1 px-3 [&::-webkit-details-marker]:hidden">
        <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Automation</div>
        <div className="flex min-w-0 items-center justify-start gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#c4c7c5]">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${activeAutomationCount ? "bg-[#79d06f]" : "bg-[#3a3b3d]"}`} />
          <span className="min-w-0 truncate">{activeAutomationCount ? `${activeAutomationCount} active` : "Idle"}</span>
        </div>
        <ChevronDownIcon className="details-chevron h-4 w-4 shrink-0 text-[#c4c7c5]" />
      </summary>
      <div className="space-y-3 border-t border-[#282a2c] px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[#e3e3e3]">Scheduled tasks</div>
            <div className="mt-0.5 text-xs text-[#9aa0a6]">{automationJobs.length} saved</div>
          </div>
          <button
            type="button"
            onClick={() => openAutomationEditor()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#282a2c] bg-[#131314] text-[#e3e3e3] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
            title="Add automation"
          >
            <PlusIcon className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="no-scrollbar max-h-[238px] space-y-1.5 overflow-y-auto rounded-2xl bg-[#131314] p-1.5 ring-1 ring-[#282a2c]">
          {recentAutomationJobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#3a3b3d] px-4 py-4 text-sm text-[#c4c7c5]">
              No automations yet.
            </div>
          ) : (
            recentAutomationJobs.map((job) => {
              const scheduleLabel = automationScheduleLabel(job.schedule, selectedAutomationDate);
              return (
              <article key={job.id} className="rounded-xl bg-[#1e1f20] px-2.5 py-2 ring-1 ring-[#282a2c]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${job.enabled ? "bg-[var(--accent-color)] shadow-[0_0_8px_var(--accent-color)]" : "bg-[#73777f]"}`} />
                      <div className="truncate text-sm font-semibold text-[#e3e3e3]">{job.name}</div>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-semibold text-[var(--accent-color)]">
                      {scheduleLabel}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-[#9aa0a6]">{job.prompt}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 pt-0.5">
                    <button
                      type="button"
                      onClick={() => toggleAutomationJob(job).catch((error) => console.error("Automation toggle error:", error))}
                      className={`h-6 rounded-lg px-1.5 text-[9px] font-bold uppercase tracking-[0.1em] transition ${job.enabled ? "bg-[var(--accent-soft)] text-[var(--accent-color)]" : "bg-[#282a2c] text-[#c4c7c5]"}`}
                      title={job.enabled ? "Pause automation" : "Start automation"}
                    >
                      {job.enabled ? "On" : "Off"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openAutomationEditor(job)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-[#131314] text-[#c4c7c5] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
                      title="Edit automation"
                    >
                      <EditIcon className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteAutomationJob(job.id).catch((error) => console.error("Automation delete error:", error))}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-[#131314] text-rose-200 transition hover:bg-rose-500/25"
                      title="Delete automation"
                    >
                      <TrashIcon className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </article>
            )})
          )}
        </div>
      </div>
    </details>
  );

  const leftPanelContent = (
    <div className="space-y-3 p-3">
      <section className="overflow-visible rounded-[20px] border border-[#282a2c] bg-[#1e1f20] p-2.5 shadow-sm">
        <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">User</div>
        <div className="mt-2 flex items-center gap-2">
          <div className="relative min-w-0 flex-1" data-dropdown-root>
            <div className="flex h-11 items-center gap-2 overflow-hidden rounded-[16px] border border-[#282a2c] bg-[#131314] p-1 text-sm text-[#e3e3e3] transition focus-within:border-[var(--accent-color)] hover:bg-[#282a2c]">
              <button
                type="button"
                onClick={openUserProfile}
                className="group relative h-9 w-9 shrink-0 overflow-hidden rounded-[12px] ring-1 ring-[#282a2c]"
                title="Edit user profile"
              >
                <AvatarImage src={userAvatar} fallback={userName || "You"} className="h-full w-full rounded-[12px]" />
                <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-[#e3e3e3] group-hover:flex">
                  <EditIcon className="h-4 w-4" />
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !userProfileMenuOpen;
                  setModelMenuOpen(false);
                  setPersonalityMenuOpen(false);
                  setQuickModelMenuOpen(false);
                  setThemePickerOpen(false);
                  setUserProfileMenuOpen(next);
                }}
                className="flex h-9 min-w-0 flex-1 items-center justify-between gap-3 px-1.5 text-left outline-none"
              >
                <span className="min-w-0 flex-1 truncate font-semibold">{selectedUserProfile?.name || "You"}</span>
                <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[#c4c7c5] transition ${userProfileMenuOpen ? "rotate-180" : ""}`} />
              </button>
            </div>
            {userProfileMenuOpen && (
              <div className="dropdown-scroll absolute left-0 right-0 top-full z-50 mt-1.5 max-h-56 overflow-y-auto rounded-[18px] border border-[#282a2c] bg-[#131314] p-1.5 shadow-2xl">
                {userProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => selectUserProfile(profile.id)}
                    className={`flex w-full items-center gap-2 rounded-[16px] px-2 py-1.5 text-left transition ${selectedUserProfileId === profile.id ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent-soft-strong)]" : "hover:bg-[#1e1f20]"}`}
                  >
                    <AvatarImage src={profile.avatar} fallback={profile.name} className="h-8 w-8 rounded-[12px]" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#e3e3e3]">{profile.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <IconButton size="lg" title="Create user profile" onClick={createUserProfile}>
            <PlusIcon className="h-5 w-5" />
          </IconButton>
        </div>
      </section>

      <details
        className="overflow-hidden rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm"
        open={calendarOpen}
        onToggle={(event) => setCalendarOpen(event.currentTarget.open)}
      >
        <summary className="grid h-12 cursor-pointer list-none grid-cols-[minmax(0,1fr)_16px] items-center gap-2 px-3 [&::-webkit-details-marker]:hidden">
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Calendar</div>
          <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[#c4c7c5] transition ${calendarOpen ? "rotate-180" : ""}`} />
        </summary>
        <div className="space-y-2.5 border-t border-[#282a2c] p-3">
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setAutomationMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))} className="rounded-xl border border-[#282a2c] bg-[#131314] px-3 py-2 text-sm font-bold text-[#e3e3e3] transition hover:bg-[#282a2c]">{"\u2039"}</button>
            <div className="text-center">
              <div className="font-title text-xl font-bold text-[#e3e3e3]">{monthTitle(automationMonth)}</div>
              <div className="text-[11px] text-[#9aa0a6]">{automationMonth.getFullYear()}</div>
            </div>
            <button type="button" onClick={() => setAutomationMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))} className="rounded-xl border border-[#282a2c] bg-[#131314] px-3 py-2 text-sm font-bold text-[#e3e3e3] transition hover:bg-[#282a2c]">{"\u203A"}</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-[#9aa0a6]">
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
              <div key={`${day}-${index}`} className={index === 0 ? "text-rose-400" : ""}>{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {automationMonthDays.map((date) => {
              const key = toLocalDateKey(date);
              const inMonth = date.getMonth() === automationMonth.getMonth();
              const selected = key === selectedAutomationDate;
              const today = key === toLocalDateKey(new Date());
              const dayGoogleEvents = googleCalendarEvents.filter((event) => googleEventMatchesDate(event, key));
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectAutomationDate(date)}
                  title={getVietnameseLunarDate(date)}
                  className={`relative flex aspect-square w-full max-w-9 justify-self-center rounded-lg border px-1 text-center transition ${selected ? "border-[#e3e3e3] bg-[#e3e3e3] text-[#131314]" : today ? "border-[var(--accent-color)] bg-[#131314] text-[#e3e3e3] hover:bg-[#282a2c]" : "border-transparent bg-[#131314] text-[#e3e3e3] hover:border-[#282a2c] hover:bg-[#282a2c]"} ${!inMonth ? "opacity-35" : ""}`}
                >
                  <div className="flex min-w-0 flex-1 flex-col items-center justify-center">
                    <div className={`text-sm font-bold leading-none ${date.getDay() === 0 && !selected ? "text-rose-400" : ""}`}>{date.getDate()}</div>
                  </div>
                  <div className="absolute bottom-1 flex min-h-1 justify-center gap-0.5">
                    {dayGoogleEvents.slice(0, 3).map((event) => <span key={event.id} className="h-1.5 w-1.5 rounded-full bg-[var(--accent-color)]" />)}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="rounded-2xl border border-[#282a2c] bg-[#131314] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-[#e3e3e3]">{selectedAutomationLabel}</div>
                <div className="mt-0.5 text-xs text-[#73777f]">Lunar {getLunarLabel(selectedAutomationDateObj) || "unavailable"}</div>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {selectedGoogleEvents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#3a3b3d] px-4 py-3 text-sm text-[#c4c7c5]">No events on this date.</div>
              ) : (
                <>
                {selectedGoogleEvents.map((event) => (
                  <div
                    key={`google-${event.id}`}
                    className="group relative cursor-pointer rounded-2xl p-3 ring-1 ring-[var(--accent-soft)] transition"
                    style={{ backgroundColor: "color-mix(in srgb, var(--accent-color) 12%, #131314)" }}
                    onClick={() => setSelectedGoogleEvent(normalizeCalendarEventForDisplay(event))}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[#e3e3e3]">{event.title}</div>
                        <div className="mt-0.5 truncate text-xs text-[var(--accent-color)]">Google Calendar - {googleEventTimeLabel(event)}</div>
                        {event.location && <div className="mt-1 truncate text-xs text-[#c4c7c5]">{event.location}</div>}
                      </div>
                      <div className="rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--accent-color)]">Google</div>
                    </div>
                    <button
                      type="button"
                      title="Delete event"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDeleteGoogleEventConfirm(event);
                      }}
                      className="absolute bottom-2 right-2 rounded-lg p-1 text-[var(--accent-color)] opacity-40 transition hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                </>
              )}
            </div>
          </div>
        </div>
      </details>
      {automationSection}
      {workspaceSection}
      {imageStudioSection}

      <section className="overflow-hidden rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm">
        <details
          open={telegramPanelOpen}
          onToggle={(event) => setTelegramPanelOpen(event.currentTarget.open)}
        >
          <summary className="grid h-12 cursor-pointer list-none grid-cols-[minmax(0,1fr)_86px_16px] items-center gap-1 px-3 [&::-webkit-details-marker]:hidden">
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Telegram</div>
            <div className="flex min-w-0 items-center justify-start gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#c4c7c5]">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${telegramRunning ? "bg-[#79d06f]" : "bg-[#3a3b3d]"}`} />
              <span className="min-w-0 truncate">{telegramRunning ? "Online" : "Offline"}</span>
            </div>
            <ChevronDownIcon className="details-chevron h-4 w-4 shrink-0 text-[#c4c7c5]" />
          </summary>
          <div className="space-y-2.5 border-t border-[#282a2c] px-3 py-3">
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={telegramBotToken}
                  onChange={(event) => setTelegramBotToken(event.target.value)}
                  className="min-w-0 flex-1 rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-2.5 text-sm text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]"
                  placeholder="Paste Telegram bot token"
                  type="password"
                />
                <button
                  type="button"
                  onClick={() => handleTestTelegram().catch((error) => console.error("Telegram error:", error))}
                  className="rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-2.5 text-sm font-semibold text-[#e3e3e3] transition hover:bg-[#282a2c]"
                >
                  Test
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="max-w-[92px] shrink-0 truncate px-1 text-sm font-bold" style={{ color: "var(--accent-color)" }}>
                  {userName.trim() || "Owner"}
                </span>
                <input
                  value={telegramOwnerId}
                  onChange={(event) => setTelegramOwnerId(event.target.value)}
                  className="min-w-0 flex-1 rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-2.5 text-sm text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]"
                  placeholder="Owner Telegram ID"
                />
              </div>
            </div>
            <div className="rounded-2xl bg-[#131314] p-2 ring-1 ring-[#282a2c]">
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#c4c7c5]">
                  {telegramGuests.length ? `${telegramGuests.length} guests` : "Guests"}
                </div>
                <IconButton
                  title="Add guest"
                  size="sm"
                  onClick={() => setTelegramGuestDraft((draft) => draft ?? { id: "", name: "" })}
                >
                  <PlusIcon className="h-4 w-4" />
                </IconButton>
              </div>
              <div className="panel-scroll max-h-[172px] space-y-1.5 overflow-y-auto">
                {telegramGuestDraft && (
                  <div className="rounded-xl bg-[#1e1f20] p-2 ring-1 ring-[#282a2c]">
                    <input
                      value={telegramGuestDraft.name}
                      onChange={(event) => setTelegramGuestDraft((draft) => ({ ...(draft ?? { id: "", name: "" }), name: event.target.value }))}
                      className="mb-1.5 w-full rounded-xl border border-[#282a2c] bg-[#0f1011] px-2 py-1.5 text-xs text-[#e3e3e3] outline-none focus:border-[var(--accent-color)]"
                      placeholder="Guest name"
                    />
                    <div className="flex gap-1.5">
                      <input
                        value={telegramGuestDraft.id}
                        onChange={(event) => setTelegramGuestDraft((draft) => ({ ...(draft ?? { id: "", name: "" }), id: event.target.value }))}
                        className="min-w-0 flex-1 rounded-xl border border-[#282a2c] bg-[#0f1011] px-2 py-1.5 text-xs text-[#e3e3e3] outline-none focus:border-[var(--accent-color)]"
                        placeholder="Telegram ID"
                      />
                      <IconButton title="Save guest" size="sm" onClick={addTelegramGuest}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
                          <path d="M17 21v-8H7v8" />
                          <path d="M7 3v5h8" />
                        </svg>
                      </IconButton>
                      <IconButton title="Cancel" size="sm" onClick={() => setTelegramGuestDraft(null)}>
                        <CloseIcon className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </div>
                )}
                {telegramGuests.length === 0 && !telegramGuestDraft ? (
                  <div className="rounded-xl border border-dashed border-[#3a3b3d] px-3 py-2 text-xs leading-5 text-[#9aa0a6]">
                    Group taggers are added here automatically. Guests can chat only.
                  </div>
                ) : (
                  telegramGuests.map((guest) => (
                    <div key={guest.id} className="flex min-h-[52px] items-center justify-between gap-2 rounded-xl bg-[#1e1f20] px-2.5 py-2 ring-1 ring-[#282a2c]">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-[#e3e3e3]">{guest.name || guest.id}</div>
                        <div className="mt-0.5 truncate text-[10px] text-[#9aa0a6]">{guest.id}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeTelegramGuest(guest.id)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#9aa0a6] transition hover:bg-rose-500/10 hover:text-rose-300"
                        title="Remove guest"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                (telegramRunning ? handleStopTelegram() : handleStartTelegram()).catch((error) =>
                  console.error(telegramRunning ? "Telegram stop error:" : "Telegram start error:", error),
                )
              }
              className={`w-full rounded-2xl px-3 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
                telegramRunning
                  ? "border border-[#282a2c] bg-[#131314] text-[#e3e3e3] hover:bg-[#282a2c]"
                  : "text-[#131314]"
              }`}
              style={!telegramRunning ? { backgroundColor: "var(--accent-color)" } : undefined}
              disabled={!telegramRunning && !telegramBotToken.trim()}
            >
              {telegramRunning ? "Stop" : "Start"}
            </button>
            {telegramStatus && <div className="text-xs text-[#c4c7c5]">{telegramStatus}</div>}
          </div>
        </details>
      </section>

      <section className="overflow-hidden rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm">
        <details
          open={googlePanelOpen}
          onToggle={(event) => setGooglePanelOpen(event.currentTarget.open)}
        >
          <summary className="grid h-12 cursor-pointer list-none grid-cols-[minmax(0,1fr)_86px_16px] items-center gap-1 px-3 [&::-webkit-details-marker]:hidden">
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Google</div>
            <div className="flex min-w-0 items-center justify-start gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#c4c7c5]">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${googleStatus.connected ? "bg-[#79d06f]" : "bg-[#3a3b3d]"}`} />
              <span className="min-w-0 truncate">{googleStatus.connected ? "Online" : "Offline"}</span>
            </div>
            <ChevronDownIcon className="details-chevron h-4 w-4 shrink-0 text-[#c4c7c5]" />
          </summary>
          <div className="space-y-3 border-t border-[#282a2c] px-3 py-3">
            <div className="px-1 text-xs leading-5 text-[#c4c7c5]">
              <div className="font-semibold text-[#e3e3e3]">
                {googleStatus.connected ? `Connected${googleStatus.email ? `: ${googleStatus.email}` : ""}` : "Not connected"}
              </div>
              <div className="mt-0.5">{googleNotice || "Connect Google to show Calendar events in the app calendar."}</div>
            </div>
            <div className="rounded-2xl bg-[#131314] p-3 text-sm text-[#e3e3e3] ring-1 ring-[#282a2c]">
              <div className="space-y-2">
                <input
                  value={googleClientId}
                  onChange={(event) => setGoogleClientId(event.target.value)}
                  className="w-full rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-2.5 text-sm text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]"
                  placeholder="Google OAuth Client ID"
                />
                <input
                  value={googleClientSecret}
                  onChange={(event) => setGoogleClientSecret(event.target.value)}
                  className="w-full rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-2.5 text-sm text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]"
                  placeholder="Google OAuth Client Secret"
                  type="password"
                />
                <input
                  value={googleRedirectUri}
                  onChange={(event) => setGoogleRedirectUri(event.target.value)}
                  className="w-full rounded-xl border border-[#282a2c] bg-[#0f1011] px-3 py-2 text-xs text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]"
                  placeholder="Local redirect address"
                />
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-full items-center justify-center rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-2.5 text-sm font-semibold text-[var(--accent-color)] transition hover:bg-[#282a2c]"
                >
                  Go to Google Cloud Console
                </a>
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                (googleStatus.connected ? disconnectGoogle() : connectGoogle()).catch((error) =>
                  console.error(googleStatus.connected ? "Google disconnect error:" : "Google connect error:", error),
                )
              }
              disabled={googleBusy || (!googleStatus.connected && (!googleClientId.trim() || !googleClientSecret.trim()))}
              className={`w-full rounded-2xl px-3 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
                googleStatus.connected
                  ? "border border-[#282a2c] bg-[#131314] text-[#e3e3e3] hover:bg-[#282a2c]"
                  : "text-[#131314]"
              }`}
              style={!googleStatus.connected ? { backgroundColor: "var(--accent-color)" } : undefined}
            >
              {googleBusy ? (googleStatus.connected ? "Disconnecting..." : "Connecting...") : googleStatus.connected ? "Disconnect" : "Connect"}
            </button>
            {googleStatus.connected && (
              <button
                type="button"
                onClick={() => refreshGoogleCalendarEvents().catch((error) => console.error("Google Calendar refresh error:", error))}
                disabled={googleBusy}
                className="w-full rounded-2xl border border-[#282a2c] bg-[#131314] px-3 py-2.5 text-sm font-semibold text-[#e3e3e3] transition hover:bg-[#282a2c] disabled:opacity-50"
              >
                Refresh Calendar Events
              </button>
            )}
          </div>
        </details>
      </section>
    </div>
  );

  const toolActivitySection = (
    <details
      className="overflow-hidden rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm"
      open={toolRunsOpen}
      onToggle={(event) => setToolRunsOpen(event.currentTarget.open)}
    >
      <summary className="grid h-12 cursor-pointer list-none grid-cols-[minmax(0,1fr)_16px] items-center gap-2 px-3 [&::-webkit-details-marker]:hidden">
        <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Tool Activity</div>
        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[#c4c7c5] transition ${toolRunsOpen ? "rotate-180" : ""}`} />
      </summary>
      <div className="border-t border-[#282a2c] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#c4c7c5]">
            {toolRuns.length ? `${Math.min(toolRuns.length, 10)} recent calls` : "No calls yet"}
          </div>
          <IconButton
            title="Refresh tool activity"
            onClick={() => refreshToolRuns().catch((error) => console.error("Tool activity refresh error:", error))}
            size="sm"
          >
            <RefreshIcon className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="rounded-2xl bg-[#131314] p-2 ring-1 ring-[#282a2c]">
          <div className="panel-scroll max-h-[228px] space-y-1.5 overflow-y-auto">
            {toolRuns.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#3a3b3d] px-3 py-2 text-xs text-[#9aa0a6]">
                Tool calls will appear here after the assistant uses voice, images, Gmail, Calendar, files, web, media, or system actions.
              </div>
            ) : (
              toolRuns.slice(0, 10).map((run) => (
                <div key={run.id} className="rounded-xl bg-[#1e1f20] px-2.5 py-2 ring-1 ring-[#282a2c]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-xs font-bold text-[#e3e3e3]">{toolRunDisplayName(run)}</div>
                    <div className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${run.success ? "bg-[#79d06f]/15 text-[#b8f5b2]" : "bg-rose-500/15 text-rose-200"}`}>
                      {run.success ? "OK" : "Error"}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[#9aa0a6]">
                    <span className="min-w-0 truncate">Done {formatToolRunTime(run.created_at)}</span>
                    <span className="shrink-0">{formatToolDuration(run.duration_ms)}</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] leading-4 text-[#c4c7c5]">{toolRunBrief(run)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </details>
  );

  const rightPanelContent = (
    <div className="space-y-3 p-3">
      <section className="overflow-visible rounded-[20px] border border-[#282a2c] bg-[#1e1f20] p-2.5 shadow-sm">
        <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Personality</div>
        <div className="mt-2 flex items-center gap-2">
          <div className="relative min-w-0 flex-1" data-dropdown-root>
            <div className="flex h-11 items-center gap-2 overflow-hidden rounded-[16px] border border-[#282a2c] bg-[#131314] p-1 text-sm text-[#e3e3e3] transition focus-within:border-[var(--accent-color)] hover:bg-[#282a2c]">
              <button
                type="button"
                onClick={openPersonalityProfile}
                className="group relative h-9 w-9 shrink-0 overflow-hidden rounded-[12px] ring-1 ring-[#282a2c]"
                title="Edit character profile"
              >
                <AvatarImage src={selectedPersonalityPreset?.avatar || personalityAvatar} fallback={selectedPersonalityPreset?.name || "AI"} className="h-full w-full rounded-[12px]" />
                <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-[#e3e3e3] group-hover:flex">
                  <EditIcon className="h-4 w-4" />
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !personalityMenuOpen;
                  setModelMenuOpen(false);
                  setUserProfileMenuOpen(false);
                  setQuickModelMenuOpen(false);
                  setThemePickerOpen(false);
                  setPersonalityMenuOpen(next);
                }}
                className="flex h-9 min-w-0 flex-1 items-center justify-between gap-3 px-1.5 text-left outline-none"
              >
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {selectedPersonalityPreset?.name ?? "Choose personality"}
                </span>
                <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[#c4c7c5] transition ${personalityMenuOpen ? "rotate-180" : ""}`} />
              </button>
            </div>
            {personalityMenuOpen && (
              <div className="dropdown-scroll absolute left-0 right-0 top-full z-50 mt-1.5 max-h-56 overflow-y-auto rounded-[18px] border border-[#282a2c] bg-[#131314] p-1.5 shadow-2xl">
                {personalityPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      selectPersonalityPreset(preset.id);
                      setPersonalityMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-[16px] px-2 py-1.5 text-left transition ${selectedPersonalityId === preset.id ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent-soft-strong)]" : "hover:bg-[#1e1f20]"}`}
                  >
                    <AvatarImage src={preset.avatar} fallback={preset.name} className="h-8 w-8 rounded-[12px]" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#e3e3e3]">{preset.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <IconButton size="lg" title="Create assistant profile" onClick={saveCurrentPersonalityPreset}>
            <PlusIcon className="h-5 w-5" />
          </IconButton>
        </div>
      </section>

      {brainSection}

      {/* Clear Memory Confirmation Modal */}
      {clearMemoryConfirmOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setClearMemoryConfirmOpen(false)}>
          <div className="mx-4 w-full max-w-sm rounded-[24px] border border-[#282a2c] bg-[#1e1f20] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </span>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-300">Clear Memory</div>
                <div className="text-sm font-bold text-[#f1f3f4]">Clear Memory</div>
                <div className="text-xs text-[#9aa0a6]">
                  {selectedPersonalityPreset?.name ?? "This character"}
                </div>
              </div>
            </div>
            <p className="text-sm leading-6 text-[#c4c7c5] mb-4">
              This will erase everything this character has learned about your preferences and style. The character description itself stays untouched.
            </p>
            <label className="flex items-center gap-2.5 rounded-xl bg-[#131314] px-3 py-2.5 mb-5 cursor-pointer ring-1 ring-[#282a2c]">
              <input
                type="checkbox"
                checked={clearSessionToo}
                onChange={(e) => setClearSessionToo(e.target.checked)}
                className="h-4 w-4 rounded accent-[var(--accent-color)]"
              />
              <span className="text-xs text-[#c4c7c5]">Also clear chat history for this character</span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleClearPersonalityMemory().catch(console.error)}
                className="flex-1 rounded-2xl border py-2.5 text-xs font-bold transition hover:brightness-110"
                style={{
                  borderColor: "#8a6722",
                  backgroundColor: "#4d3a16",
                  color: "#f3d274",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                }}
              >
                Clear Memory
              </button>
              <button
                type="button"
                onClick={() => { setClearMemoryConfirmOpen(false); setClearSessionToo(false); }}
                className="flex-1 rounded-2xl border border-[#282a2c] bg-[#131314] py-2.5 text-xs font-bold text-[#e3e3e3] transition hover:bg-[#282a2c]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {userProfileOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={() => setUserProfileOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-[780px] overflow-hidden rounded-[24px] border border-[#282a2c] bg-[#1e1f20] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-[#282a2c] px-5 py-4">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--accent-color)" }}>User Profile</div>
                <div className="mt-1 truncate text-lg font-bold text-[#f1f3f4]">{userName.trim() || "You"}</div>
              </div>
              <IconButton title="Close profile editor" onClick={() => setUserProfileOpen(false)}>
                <CloseIcon />
              </IconButton>
            </div>

            <div className="grid min-h-0 gap-4 px-5 py-4 md:h-[620px] md:grid-cols-[minmax(0,0.9fr)_minmax(320px,1fr)]">
              <div className="flex min-h-0 flex-col gap-3 rounded-2xl border border-[#282a2c] bg-[#1b1c1e] p-4">
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => userAvatarPickerRef.current?.click()}
                    className="group relative h-40 w-40 shrink-0 overflow-hidden rounded-[20px] ring-1 ring-[#282a2c]"
                    title="Change avatar"
                  >
                    <AvatarImage src={userAvatar} fallback={userName || "You"} className="h-full w-full rounded-[20px]" />
                    <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-[#e3e3e3] group-hover:flex">
                      <CameraIcon className="h-6 w-6" />
                    </span>
                  </button>
                </div>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-[#c4c7c5]">Profile name</span>
                  <input
                    value={userName}
                    onChange={(event) => setUserName(event.target.value)}
                    className="h-11 w-full rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 text-sm font-semibold text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]"
                    placeholder="Your name"
                  />
                </label>

                <label className="flex min-h-0 flex-1 flex-col">
                  <span className="mb-2 block text-xs font-semibold text-[#c4c7c5]">About you</span>
                  <textarea
                    value={userDescription}
                    onChange={(event) => setUserDescription(event.target.value)}
                    rows={8}
                    className="min-h-[250px] flex-1 resize-none rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-3 text-sm leading-6 text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]"
                    placeholder="Details the assistant should remember about you."
                  />
                </label>
              </div>

              <div className="flex min-h-0 flex-col rounded-2xl border border-[#282a2c] bg-[#0f1011] p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[#e3e3e3]">User voice</div>
                  <div className="shrink-0 text-xs font-semibold text-[#c4c7c5]">{voiceSamples.length} samples</div>
                </div>

                <div className="mb-3 flex items-center gap-2 rounded-2xl border border-[#282a2c] bg-[#131314] px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9aa0a6]">Voice folder</div>
                    <div className="mt-1 truncate text-xs text-[#c4c7c5]" title={voiceFolder || "Default voices folder"}>
                      {voiceFolder || "Default voices folder"}
                    </div>
                  </div>
                  <IconButton title="Choose voice samples folder" onClick={() => handleChooseVoiceFolder().catch((error) => console.error("Voice folder error:", error))} size="sm">
                    <FolderIcon className="h-4 w-4" />
                  </IconButton>
                </div>

                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#c4c7c5]">Selected voice sample</span>
                  {selectedUserVoiceSample && <span className="max-w-[160px] truncate text-[var(--accent-color)]">{selectedUserVoiceSample.label}</span>}
                </div>
                <div className="min-h-0 flex-1 overflow-hidden border-t border-[var(--accent-soft-strong)] pt-1">
                  <div className="profile-voice-list h-full space-y-1.5 overflow-y-auto pr-3" data-voice-menu>
                    {voiceSamples.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[#282a2c] px-3 py-8 text-center text-sm text-[#c4c7c5]">No voice samples found.</div>
                    ) : (
                      voiceSamples.map((sample) => {
                        const selected = selectedUserVoicePath === sample.path;
                        const previewing = previewingVoicePath === sample.path;
                        return (
                          <div
                            key={sample.path}
                            ref={selected ? selectedUserVoiceRowRef : undefined}
                            data-selected-voice={selected ? "true" : undefined}
                            className={`flex items-center gap-2 rounded-xl px-2 py-1.5 transition ${selected ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent-soft-strong)]" : "hover:bg-[#1e1f20]"}`}
                          >
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                previewUserVoiceSample(sample);
                              }}
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#282a2c] bg-[#1e1f20] text-[var(--accent-color)] transition hover:bg-[#282a2c]"
                              title={`Preview ${sample.label}`}
                            >
                              {previewing ? <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-color)]" /> : <PlayIcon />}
                            </button>
                            <button
                              type="button"
                              onClick={() => updateActiveUserVoicePath(sample.path)}
                              className="min-w-0 flex-1 text-left"
                              title={sample.name}
                            >
                              <div className="truncate text-[13px] font-semibold text-[#e3e3e3]">{sample.label}</div>
                              <div className="truncate text-[10px] leading-4 text-[#9aa0a6]">Preview</div>
                            </button>
                            <span className={`h-2 w-2 shrink-0 rounded-full ${selected ? "bg-[var(--accent-color)]" : "bg-[#3a3b3d]"}`} />
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#282a2c] px-5 py-2">
              <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#c4c7c5]" title="Play your messages with this profile voice when main Auto voice is on">
                <button
                  type="button"
                  onClick={() => updateActiveUserProfile({ auto_speech: !(selectedUserProfile?.auto_speech ?? true) })}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition ${(selectedUserProfile?.auto_speech ?? true) ? "bg-[var(--accent-color)]" : "bg-[#3a3b3d]"}`}
                  aria-pressed={selectedUserProfile?.auto_speech ?? true}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[#0f1011] transition ${(selectedUserProfile?.auto_speech ?? true) ? "left-[18px]" : "left-0.5"}`} />
                </button>
                <span className="truncate">Auto speech</span>
              </label>
              <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={userProfiles.length <= 1}
                onClick={() => {
                  setUserProfileOpen(false);
                  setDeleteUserProfileConfirmOpen(true);
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#282a2c] bg-[#131314] text-rose-200 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                title="Delete user profile"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={saveActiveUserProfile}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--accent-color)] bg-[var(--accent-color)] text-[#131314] transition hover:brightness-110"
                title="Save user profile"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              </button>
              <button
                type="button"
                onClick={() => setUserProfileOpen(false)}
                className="h-10 rounded-2xl border border-[#282a2c] bg-[#131314] px-4 text-xs font-bold text-[#e3e3e3] transition hover:bg-[#282a2c]"
              >
                Close
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteUserProfileConfirmOpen && (
        <div className="fixed inset-0 z-[205] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={() => setDeleteUserProfileConfirmOpen(false)}>
          <div className="mx-4 w-full max-w-sm rounded-[24px] border border-[#282a2c] bg-[#1e1f20] p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-200">
                <TrashIcon className="h-5 w-5" />
              </span>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-300">Delete User Profile</div>
                <div className="text-sm font-bold text-[#f1f3f4]">{userName.trim() || "This profile"}</div>
              </div>
            </div>
            <p className="mb-5 text-sm leading-6 text-[#c4c7c5]">
              This will delete this saved user profile. Chat history and assistant profiles stay untouched.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={userProfiles.length <= 1}
                onClick={() => {
                  deleteSelectedUserProfile();
                  setDeleteUserProfileConfirmOpen(false);
                }}
                className="flex-1 rounded-2xl border border-rose-500/30 bg-rose-500/15 py-2.5 text-xs font-bold text-rose-100 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setDeleteUserProfileConfirmOpen(false)}
                className="flex-1 rounded-2xl border border-[#282a2c] bg-[#131314] py-2.5 text-xs font-bold text-[#e3e3e3] transition hover:bg-[#282a2c]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {personalityProfileOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={() => setPersonalityProfileOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-[780px] overflow-hidden rounded-[24px] border border-[#282a2c] bg-[#1e1f20] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-[#282a2c] px-5 py-4">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--accent-color)" }}>Assistant Profile</div>
                <div className="mt-1 truncate text-lg font-bold text-[#f1f3f4]">{selectedPersonalityPreset?.name || "Assistant"}</div>
              </div>
              <IconButton title="Close profile editor" onClick={() => setPersonalityProfileOpen(false)}>
                <CloseIcon />
              </IconButton>
            </div>

            <div className="grid min-h-0 gap-4 px-5 py-4 md:h-[620px] md:grid-cols-[minmax(0,0.9fr)_minmax(320px,1fr)]">
              <div className="flex min-h-0 flex-col gap-3 rounded-2xl border border-[#282a2c] bg-[#1b1c1e] p-4">
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      avatarTargetPersonalityIdRef.current = selectedPersonalityId;
                      personalityAvatarPickerRef.current?.click();
                    }}
                    className="group relative h-40 w-40 shrink-0 overflow-hidden rounded-[20px] ring-1 ring-[#282a2c]"
                    title="Change avatar"
                  >
                    <AvatarImage src={selectedPersonalityPreset?.avatar || personalityAvatar} fallback={selectedPersonalityPreset?.name || "AI"} className="h-full w-full rounded-[20px]" />
                    <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-[#e3e3e3] group-hover:flex">
                      <CameraIcon className="h-6 w-6" />
                    </span>
                  </button>
                </div>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-[#c4c7c5]">Character name</span>
                  <input
                    value={personalityNameDraft}
                    onChange={(event) => setPersonalityNameDraft(event.target.value)}
                    className="h-11 w-full rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 text-sm font-semibold text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]"
                    placeholder="Assistant name"
                  />
                </label>

                <label className="flex min-h-0 flex-1 flex-col">
                  <span className="mb-2 block text-xs font-semibold text-[#c4c7c5]">Personality</span>
                  <textarea
                    value={personality}
                    onChange={(event) => setPersonality(event.target.value)}
                    rows={8}
                    className="min-h-[250px] flex-1 resize-none rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-3 text-sm leading-6 text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]"
                    placeholder="Describe how this assistant should think, speak, and behave."
                  />
                </label>

              </div>

              <div className="flex min-h-0 flex-col rounded-2xl border border-[#282a2c] bg-[#0f1011] p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[#e3e3e3]">Character voice</div>
                  </div>
                  <div className="shrink-0 text-xs font-semibold text-[#c4c7c5]">{voiceSamples.length} samples</div>
                </div>

                <div className="mb-3 flex items-center gap-2 rounded-2xl border border-[#282a2c] bg-[#131314] px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9aa0a6]">Voice folder</div>
                    <div className="mt-1 truncate text-xs text-[#c4c7c5]" title={voiceFolder || "Default voices folder"}>
                      {voiceFolder || "Default voices folder"}
                    </div>
                  </div>
                  <IconButton title="Choose voice samples folder" onClick={() => handleChooseVoiceFolder().catch((error) => console.error("Voice folder error:", error))} size="sm">
                    <FolderIcon className="h-4 w-4" />
                  </IconButton>
                </div>

                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#c4c7c5]">Selected voice sample</span>
                  {selectedVoiceSample && <span className="max-w-[160px] truncate text-[var(--accent-color)]">{selectedVoiceSample.label}</span>}
                </div>
                <div className="min-h-0 flex-1 overflow-hidden border-t border-[var(--accent-soft-strong)] pt-1">
                  <div className="profile-voice-list h-full space-y-1.5 overflow-y-auto pr-3" data-voice-menu>
                    {voiceSamples.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[#282a2c] px-3 py-8 text-center text-sm text-[#c4c7c5]">No voice samples found.</div>
                    ) : (
                      voiceSamples.map((sample) => {
                        const selected = selectedVoicePath === sample.path;
                        const previewing = previewingVoicePath === sample.path;
                        return (
                          <div
                            key={sample.path}
                            ref={selected ? selectedVoiceRowRef : undefined}
                            data-selected-voice={selected ? "true" : undefined}
                            className={`flex items-center gap-2 rounded-xl px-2 py-1.5 transition ${selected ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent-soft-strong)]" : "hover:bg-[#1e1f20]"}`}
                          >
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                previewVoiceSample(sample);
                              }}
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#282a2c] bg-[#1e1f20] text-[var(--accent-color)] transition hover:bg-[#282a2c]"
                              title={`Preview ${sample.label}`}
                            >
                              {previewing ? <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-color)]" /> : <PlayIcon />}
                            </button>
                            <button
                              type="button"
                              onClick={() => updateActiveCharacterVoicePath(sample.path)}
                              className="min-w-0 flex-1 text-left"
                              title={sample.name}
                            >
                              <div className="truncate text-[13px] font-semibold text-[#e3e3e3]">{sample.label}</div>
                              <div className="truncate text-[10px] leading-4 text-[#9aa0a6]">Preview</div>
                            </button>
                            <span className={`h-2 w-2 shrink-0 rounded-full ${selected ? "bg-[var(--accent-color)]" : "bg-[#3a3b3d]"}`} />
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-end justify-between gap-4 border-t border-[#282a2c] px-5 py-2">
              <div className="flex min-w-0 items-end gap-3">
                <label className="block w-[132px] shrink-0">
                  <div className="mb-1 text-[11px] font-semibold text-[#c4c7c5]">Context size</div>
                  <NumberStepper value={memorySize} min={512} max={32768} step={512} onChange={setMemorySize} className="w-[132px]" />
                </label>
                <label className="block w-[132px] shrink-0">
                  <div className="mb-1 text-[11px] font-semibold text-[#c4c7c5]">Reply size</div>
                  <NumberStepper value={replyLength} min={64} max={4096} step={64} onChange={setReplyLength} className="w-[132px]" />
                </label>
              </div>
              <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={personalityPresets.length <= 1}
                onClick={() => {
                  setPersonalityProfileOpen(false);
                  setDeletePersonalityConfirmOpen(true);
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#282a2c] bg-[#131314] text-rose-200 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                title="Delete profile"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setPersonalityProfileOpen(false);
                  setClearMemoryConfirmOpen(true);
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#282a2c] bg-[#131314] text-amber-300 transition hover:bg-amber-500/15"
                title="Clear learned memory"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  updateSelectedPersonalityPreset();
                  setPersonalityProfileOpen(false);
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--accent-color)] bg-[var(--accent-color)] text-[#131314] transition hover:brightness-110"
                title="Save profile"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              </button>
              <button
                type="button"
                onClick={() => setPersonalityProfileOpen(false)}
                className="h-10 rounded-2xl border border-[#282a2c] bg-[#131314] px-4 text-xs font-bold text-[#e3e3e3] transition hover:bg-[#282a2c]"
              >
                Close
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deletePersonalityConfirmOpen && (
        <div className="fixed inset-0 z-[205] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={() => setDeletePersonalityConfirmOpen(false)}>
          <div className="mx-4 w-full max-w-sm rounded-[24px] border border-[#282a2c] bg-[#1e1f20] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-200">
                <TrashIcon className="h-5 w-5" />
              </span>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-300">Delete Character</div>
                <div className="text-sm font-bold text-[#f1f3f4]">{selectedPersonalityPreset?.name ?? "This character"}</div>
              </div>
            </div>
            <p className="mb-5 text-sm leading-6 text-[#c4c7c5]">
              This will delete this character profile, its learned memory, and its saved chat history.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={personalityPresets.length <= 1}
                onClick={() => {
                  deleteSelectedPersonalityPreset();
                  setDeletePersonalityConfirmOpen(false);
                }}
                className="flex-1 rounded-2xl border border-rose-500/30 bg-rose-500/15 py-2.5 text-xs font-bold text-rose-100 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setDeletePersonalityConfirmOpen(false)}
                className="flex-1 rounded-2xl border border-[#282a2c] bg-[#131314] py-2.5 text-xs font-bold text-[#e3e3e3] transition hover:bg-[#282a2c]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {toolActivitySection}

      <details
        className="overflow-hidden rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm"
        open={samplingOpen}
        onToggle={(event) => setSamplingOpen(event.currentTarget.open)}
      >
        <summary className="flex h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 [&::-webkit-details-marker]:hidden">
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Sampling</div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9aa0a6]">
            <button
              type="button"
              title="Reset sampling"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                resetSamplingDefaults();
              }}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#282a2c] bg-[#131314] text-[#c4c7c5] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
            >
              <RefreshIcon className="h-4 w-4" />
            </button>
            <ChevronDownIcon className="details-chevron h-4 w-4 shrink-0 text-[#c4c7c5]" />
          </div>
        </summary>
        <div className="border-t border-[#282a2c] px-3 py-3 space-y-4">
          <SliderField
            label="Temperature"
            value={samplingTemperature}
            min={0}
            max={2}
            step={0.1}
            onChange={setSamplingTemperature}
            helper="Lower is steadier. Higher is more random."
          />
          <SliderField
            label="Top K"
            value={topK}
            min={0}
            max={200}
            step={1}
            onChange={setTopK}
            helper="Limits choices to the top tokens. 0 disables it."
          />
          <SliderField
            label="Top P"
            value={topP}
            min={0}
            max={1}
            step={0.05}
            onChange={setTopP}
            helper="Keeps the most likely token group. 1 disables it."
          />
          <SliderField
            label="Min P"
            value={minP}
            min={0}
            max={1}
            step={0.05}
            onChange={setMinP}
            helper="Drops very unlikely tokens. 0 disables it."
          />
          <SliderField
            label="Repeat Last N"
            value={repeatLastN}
            min={-1}
            max={4096}
            step={1}
            onChange={setRepeatLastN}
            helper="How much recent text repeat penalty checks. -1 means full context."
          />
          <SliderField
            label="Repeat Penalty"
            value={repeatPenalty}
            min={0.8}
            max={2}
            step={0.05}
            onChange={setRepeatPenalty}
            helper="Higher discourages repeated wording. 1 disables it."
          />
        </div>
      </details>
    </div>
  );

  const handleInstallSetupBundle = async () => {
    if (setupInstalling) return;
    setSetupInstalling(true);
    setSetupProgress({
      stage: "starting",
      part_key: "",
      label: "",
      file_index: 0,
      file_count: setupCatalog?.parts.reduce((count, part) => count + part.files.length, 0) || 0,
      percent: 0,
      message: "Preparing local model folders...",
    });
    setSetupNotice("Downloading local AI parts. This can take a long time on the first run...");
    try {
      const result = await invoke<SetupInstallResult>("install_setup_bundle", {
        tier: activeSetupTier,
      });
      setSetupCatalog(result.catalog);
      setModelFolder(result.catalog.brain_model_folder);
      setSelectedModelPath(result.catalog.selected_brain_model_path);
      setSetupCompleted(true);
      setLeftPanelOpen(true);
      setRightPanelOpen(true);
      setSetupNotice(result.message);
      await scanModelLibrary(
        result.catalog.brain_model_folder,
        result.catalog.selected_brain_model_path,
        true,
      );
    } catch (error) {
      console.error("Setup install error:", error);
      setSetupNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSetupInstalling(false);
    }
  };

  if (!settingsLoaded) {
    return (
      <div className="startup-screen" role="status" aria-live="polite">
        <div className="startup-card">
          <div className="startup-logo">
            <img src={brandLogo} alt="" aria-hidden="true" />
          </div>
          <div className="startup-kicker">Galaxy AI Hub</div>
          <div className="startup-title">Starting up</div>
          <div className="startup-message">Loading saved settings...</div>
          <div className="startup-bar" />
        </div>
      </div>
    );
  }

  if (settingsLoadError) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#131314] px-6 text-[#e3e3e3]">
        <div className="max-w-xl rounded-[28px] border border-rose-500/30 bg-[#1e1f20] px-6 py-5 shadow-2xl">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-rose-300">
            Settings Load Error
          </div>
          <div className="mt-2 text-sm leading-6 text-[#c4c7c5]">
            The app could not load saved settings, so it stopped before showing editable defaults.
          </div>
          <pre className="mt-4 whitespace-pre-wrap rounded-2xl border border-[#282a2c] bg-[#131314] p-3 text-xs text-rose-100">
            {settingsLoadError}
          </pre>
        </div>
      </div>
    );
  }

  if (firstStartupSetupNeeded) {
    return (
      <div
        className="setup-screen"
        style={
          {
            "--accent-color": selectedThemeSwatch.accent,
            "--accent-hover": selectedThemeSwatch.hover,
            "--accent-soft": selectedThemeSwatch.soft,
            "--accent-soft-strong": `${selectedThemeSwatch.accent}44`,
          } as React.CSSProperties
        }
      >
        <div className="setup-shell">
          <div className="setup-hero">
            <div className="setup-logo">
              <img src={brandLogo} alt="" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="setup-kicker">Welcome to Galaxy</div>
              <h1 className="setup-title">Build your local AI companion</h1>
              <p className="setup-copy">
                Galaxy needs three local parts before it can chat, speak, and create images.
                Pick the setup that fits this PC, then let the app prepare everything in this folder.
              </p>
            </div>
          </div>

          <div className="setup-grid">
            <section className="setup-card setup-hardware-card">
              <div className="setup-card-title">Recommended setup</div>
              <div className="setup-tier-badge">
                <span>{setupTierLabel(activeSetupTier)}</span>
                <small>{setupTierOverride ? "Selected by you" : "Picked for this PC"}</small>
              </div>
              <p className="setup-muted">{setupTierDescription(activeSetupTier)}</p>
              <div className="setup-spec-list">
                <div>
                  <span>CPU</span>
                  <strong>{systemInfo?.cpu_name || "Checking..."}</strong>
                </div>
                <div>
                  <span>GPU</span>
                  <strong>{hardwareGpuLabel || "Checking..."}</strong>
                </div>
                <div>
                  <span>RAM</span>
                  <strong>{hardwareRamLabel}</strong>
                </div>
                <div>
                  <span>VRAM</span>
                  <strong>{systemInfo ? `${(systemInfo.total_vram_mb / 1024).toFixed(1)} GB` : "Checking..."}</strong>
                </div>
              </div>
              <div className="setup-tier-row">
                {(["light", "balanced", "high"] as SetupTier[]).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    className={`setup-tier-button ${activeSetupTier === tier ? "active" : ""}`}
                    onClick={() => setSetupTierOverride(tier)}
                  >
                    <span>{setupTierLabel(tier)}</span>
                  </button>
                ))}
              </div>
              <div className="setup-size-note">{setupTotalSizeLabel(setupCatalog)}</div>
            </section>

            <section className="setup-card setup-parts-card">
              <div className="setup-card-title">What will be installed</div>
              <div className="setup-parts">
                {SETUP_PARTS.map((part) => (
                  (() => {
                    const catalogPart = setupCatalog?.parts.find((item) => item.key === part.key);
                    const sizeLabel = catalogPart?.files.map((file) => file.size_hint).join(" + ") || part.note;
                    const isActivePart = setupInstalling && activeSetupPartKey === part.key;
                    const partState = catalogPart?.installed
                      ? "Ready"
                      : isActivePart
                        ? setupProgress?.stage === "ready" ? "Ready" : "Installing"
                        : setupInstalling
                          ? "Queued"
                          : "Needed";
                    return (
                  <div key={part.key} className={`setup-part ${catalogPart?.installed ? "installed" : ""} ${isActivePart ? "active" : ""}`}>
                    <div className="setup-part-icon">
                      {part.icon === "brain" ? (
                        <BrainIcon className="h-5 w-5" />
                      ) : part.icon === "voice" ? (
                        <SpeakerIcon className="h-5 w-5" />
                      ) : (
                        <BrushIcon className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="setup-part-title">{part.title}</div>
                      <div className="setup-part-intro">{setupPartIntro(part)}</div>
                      <div className="setup-part-model">{setupPartModel(part, activeSetupTier)}</div>
                      <div className="setup-part-size">{sizeLabel}</div>
                    </div>
                    <div className="setup-part-state">{partState}</div>
                  </div>
                    );
                  })()
                ))}
              </div>
            </section>
          </div>

          <div className="setup-footer">
            <div className="setup-footer-info">
              <div className="setup-footer-note">
                {setupNotice || "You can change models later. First startup only prepares a working default setup."}
              </div>
              {(setupInstalling || setupProgress) && (
                <div className="setup-progress" role="status" aria-live="polite">
                  <div className="setup-progress-meta">
                    <span>{setupProgress?.label || "Preparing installer"}</span>
                    <strong>{setupProgress?.file_count ? `${setupProgress.file_index}/${setupProgress.file_count}` : "0%"}</strong>
                  </div>
                  <div className="setup-progress-track">
                    <div
                      className="setup-progress-fill"
                      style={{ width: `${Math.max(3, setupProgress?.percent ?? 0)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="setup-actions">
              <button
                type="button"
                className="setup-secondary-button"
                onClick={() => {
                  setSetupCompleted(true);
                  setLeftPanelOpen(true);
                  setRightPanelOpen(true);
                }}
                disabled={setupInstalling}
              >
                Choose files myself
              </button>
              <button
                type="button"
                className="setup-primary-button"
                onClick={() => void handleInstallSetupBundle()}
                disabled={setupInstalling}
              >
                {setupInstalling ? "Installing..." : "Install recommended setup"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className="min-h-screen text-[#e3e3e3]"
        style={
          {
            background: "linear-gradient(180deg, #131314 0%, #17181a 40%, #131314 100%)",
            "--accent-color": selectedThemeSwatch.accent,
            "--accent-hover": selectedThemeSwatch.hover,
            "--accent-soft": selectedThemeSwatch.soft,
            "--accent-soft-strong": `${selectedThemeSwatch.accent}44`,
          } as React.CSSProperties
        }
      >
      <input
        ref={userAvatarPickerRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          readAvatarImage(event.target.files?.[0], setUserAvatar);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={personalityAvatarPickerRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          readAvatarImage(event.target.files?.[0], (dataUrl) => {
            const targetId = avatarTargetPersonalityIdRef.current || selectedPersonalityId;
            setPersonalityAvatar(dataUrl);
            setPersonalityPresets((prev) =>
              prev.map((preset) =>
                preset.id === targetId ? { ...preset, avatar: dataUrl } : preset,
              ),
            );
            avatarTargetPersonalityIdRef.current = null;
          });
          event.currentTarget.value = "";
        }}
      />

      {freshChatConfirmOpen && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={() => setFreshChatConfirmOpen(false)}>
          <div className="w-full max-w-md rounded-[28px] bg-[#1e1f20] p-6 shadow-2xl ring-1 ring-[#282a2c]" onClick={(e) => e.stopPropagation()}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--accent-color)" }}>Clear Chat</div>
            <h3 className="font-title text-xl text-[#e3e3e3]">Clear chat?</h3>
            <p className="mt-2 text-sm leading-6 text-[#c4c7c5]">
              This clears only the visible conversation and current attached image. It does not delete saved settings, personalities, Google login, folders, or long-term memory.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                title="Clear the visible chat only"
                onClick={() => {
                  setMessages([]);
                  if (selectedPersonalityId) {
                    chatSessionsRef.current = {
                      ...chatSessionsRef.current,
                      [selectedPersonalityId]: [],
                    };
                    setChatSessions((prev) => ({ ...prev, [selectedPersonalityId]: [] }));
                  }
                  setComposerText("");
                  setImage(null);
                  setImagePath(null);
                  setComposerNotice("");
                  setFreshChatConfirmOpen(false);
                }}
                className="rounded-2xl border px-5 py-2.5 text-sm font-semibold shadow-sm transition hover:brightness-110"
                style={{
                  borderColor: "color-mix(in srgb, var(--accent-color) 32%, transparent)",
                  backgroundColor: "color-mix(in srgb, var(--accent-color) 18%, #131314 82%)",
                  color: "color-mix(in srgb, var(--accent-color) 72%, white 28%)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                }}
              >
                Clear Chat
              </button>
              <button
                type="button"
                title="Keep the current conversation"
                onClick={() => setFreshChatConfirmOpen(false)}
                className="rounded-2xl border border-[#282a2c] bg-[#1e1f20] px-4 py-2.5 text-sm font-semibold text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {automationEditorOpen && (
        <div className="fixed inset-0 z-[86] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={() => setAutomationEditorOpen(false)}>
          <div className="w-full max-w-2xl overflow-hidden rounded-[28px] bg-[#1e1f20] shadow-2xl ring-1 ring-[#282a2c]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 px-5 pt-5">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-[var(--accent-color)]">
                  <RepeatIcon className="h-4 w-4" />
                  Automation
                </div>
                <h3 className="mt-1 font-title text-2xl text-[#e3e3e3]">{editingAutomationId ? "Edit automation" : "Schedule a task"}</h3>
                <p className="mt-1 text-sm leading-6 text-[#c4c7c5]">Choose the timing and keep the task instruction short and clear.</p>
              </div>
              <div className="px-5 pt-5">
                <IconButton title="Close" onClick={() => setAutomationEditorOpen(false)}>
                  <CloseIcon />
                </IconButton>
              </div>
            </div>

            <div className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_280px]">
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.16em] text-[#9aa0a6]">Task name</span>
                  <input
                    value={automationName}
                    onChange={(event) => setAutomationName(event.target.value)}
                    className="w-full rounded-2xl border border-[#282a2c] bg-[#131314] px-4 py-3 text-sm font-semibold text-[#e3e3e3] outline-none transition placeholder:text-[#73777f] focus:border-[var(--accent-color)]"
                    placeholder="Morning weather brief"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.16em] text-[#9aa0a6]">What should happen?</span>
                  <textarea
                    value={automationPrompt}
                    onChange={(event) => setAutomationPrompt(event.target.value)}
                    rows={6}
                    className="max-h-52 min-h-[152px] w-full resize-none overflow-y-auto rounded-3xl border border-[#282a2c] bg-[#131314] px-4 py-3 text-sm leading-6 text-[#e3e3e3] outline-none transition placeholder:text-[#73777f] focus:border-[var(--accent-color)]"
                    placeholder="Check tomorrow's weather and tell me if I should bring an umbrella."
                  />
                </label>
                <div className="px-1 text-xs leading-5 text-[#c4c7c5]">
                  <div className="font-bold uppercase tracking-[0.16em] text-[var(--accent-color)]">Job preview</div>
                  <div className="mt-1 text-sm font-semibold leading-6 text-[#e3e3e3]/90">
                    {compactAutomationSummary(automationName || "Untitled task", buildAutomationSchedule(automationDate, automationTime, automationRepeat, automationEveryAmount, automationEveryUnit), automationPrompt || "No instruction yet", automationDate)}
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] bg-[#1b1c1e] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--accent-color)]">Schedule</div>
                  <div className="mt-2 w-full truncate rounded-2xl bg-[var(--accent-soft)] px-3 py-2 text-xs font-bold text-[var(--accent-color)]">
                    {automationScheduleLabel(buildAutomationSchedule(automationDate, automationTime, automationRepeat, automationEveryAmount, automationEveryUnit), automationDate)}
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#9aa0a6]">Date</div>
                    <div className="relative" data-dropdown-root>
                      <button
                        type="button"
                        onClick={() => {
                          setAutomationDateMenuOpen((open) => !open);
                          setAutomationMonthMenuOpen(false);
                        }}
                        className="flex h-11 w-full items-center justify-between rounded-2xl bg-[var(--accent-soft)] px-3 text-left text-sm font-semibold text-[var(--accent-color)] shadow-inner shadow-black/20 ring-1 ring-[var(--accent-soft-strong)] transition hover:brightness-110"
                      >
                        <span className="min-w-0 truncate">{automationDateLabel}</span>
                        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[var(--accent-color)] transition ${automationDateMenuOpen ? "rotate-180" : ""}`} />
                      </button>
                      {automationDateMenuOpen && (
                        <div className="absolute left-0 right-0 top-full z-[130] mt-2 rounded-[22px] bg-[#131314] p-3 shadow-2xl ring-1 ring-[#282a2c]">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => setAutomationMonthMenuOpen((open) => !open)}
                              className="min-w-0 truncate rounded-xl px-2 py-1 text-left text-xs font-bold text-[#e3e3e3] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
                            >
                              {automationEditorMonthTitle}
                            </button>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setAutomationEditorMonth((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#1e1f20] text-[#c4c7c5] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
                                title="Previous month"
                              >
                                <ChevronUpIcon className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setAutomationEditorMonth((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#1e1f20] text-[#c4c7c5] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
                                title="Next month"
                              >
                                <ChevronDownIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          {automationMonthMenuOpen ? (
                            <div className="max-h-72 overflow-y-auto rounded-2xl bg-[#101112] p-2 ring-1 ring-[#282a2c]">
                              {automationEditorYearOptions.map((year) => (
                                <div key={year} className="mb-3 last:mb-0">
                                  <button
                                    type="button"
                                    onClick={() => setAutomationEditorMonth((date) => new Date(year, date.getMonth(), 1))}
                                    className={`mb-2 h-8 w-full rounded-xl px-2 text-left text-xs font-bold transition ${
                                      automationEditorMonth.getFullYear() === year
                                        ? "bg-[var(--accent-soft)] text-[var(--accent-color)]"
                                        : "text-[#e3e3e3] hover:bg-[#282a2c]"
                                    }`}
                                  >
                                    {year}
                                  </button>
                                  <div className="grid grid-cols-4 gap-1.5">
                                    {automationEditorMonthOptions.map((month) => {
                                      const selected = automationEditorMonth.getFullYear() === year && automationEditorMonth.getMonth() === month.index;
                                      return (
                                        <button
                                          key={`${year}-${month.index}`}
                                          type="button"
                                          onClick={() => {
                                            setAutomationEditorMonth(new Date(year, month.index, 1));
                                            setAutomationMonthMenuOpen(false);
                                          }}
                                          className={`h-8 rounded-xl text-xs font-bold transition ${
                                            selected
                                              ? "bg-[var(--accent-color)] text-[#131314]"
                                              : "text-[#e3e3e3] hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
                                          }`}
                                        >
                                          {month.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <>
                              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-[#e3e3e3]">
                                {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
                                  <div key={day} className="py-1">{day}</div>
                                ))}
                              </div>
                              <div className="mt-1 grid grid-cols-7 gap-1">
                                {automationEditorMonthDays.map((date) => {
                                  const key = toLocalDateKey(date);
                                  const selected = key === automationDate;
                                  const inMonth = date.getMonth() === automationEditorMonth.getMonth();
                                  return (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={() => setAutomationEditorDate(date)}
                                      className={`h-8 rounded-xl text-xs font-bold transition ${
                                        selected
                                          ? "bg-[var(--accent-color)] text-[#131314] shadow-[0_0_12px_var(--accent-soft-strong)]"
                                          : inMonth
                                            ? "text-[#e3e3e3] hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
                                            : "text-[#73777f] hover:bg-[#282a2c]"
                                      }`}
                                    >
                                      {date.getDate()}
                                    </button>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#9aa0a6]">Start time</div>
                    <div className="relative" data-dropdown-root>
                      <button
                        type="button"
                        onClick={() => setAutomationTimeMenuOpen((open) => !open)}
                        className={`flex h-11 w-full items-center justify-between rounded-2xl px-3 text-left text-sm font-semibold shadow-inner shadow-black/20 ring-1 transition hover:bg-[#18191b] ${
                          automationTime
                            ? "bg-[var(--accent-soft)] text-[var(--accent-color)] ring-[var(--accent-soft-strong)]"
                            : "bg-[#0f1011] text-[#e3e3e3] ring-[#282a2c] hover:ring-[var(--accent-soft-strong)]"
                        }`}
                      >
                        <span>{automationTime ? `${automationHour12}:${String(automationTimeParts.minutes).padStart(2, "0")} ${automationPeriod}` : "Choose exact time"}</span>
                        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[var(--accent-color)] transition ${automationTimeMenuOpen ? "rotate-180" : ""}`} />
                      </button>
                      {automationTimeMenuOpen && (
                        <div className="absolute left-0 right-0 top-full z-[120] mt-2 overflow-hidden rounded-[22px] bg-[#131314] p-2 shadow-2xl ring-1 ring-[#282a2c]">
                          <div className="grid grid-cols-[1fr_1fr_0.8fr] gap-2">
                            <div>
                              <button type="button" onClick={() => setAutomationTimeFromClock(automationHour12 === 12 ? 1 : automationHour12 + 1, automationTimeParts.minutes, automationPeriod)} className="mb-1 flex h-7 w-full items-center justify-center rounded-xl border border-[#282a2c] bg-[#131314] text-xs font-semibold text-[#c4c7c5] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]" title="Next hour">
                                +
                              </button>
                              <div className="automation-time-scroll max-h-28 overflow-y-auto pr-1">
                                {automationHourOptions.map((hour) => (
                                  <button
                                    key={hour}
                                    type="button"
                                    onClick={() => setAutomationTimeFromClock(hour, automationTimeParts.minutes, automationPeriod)}
                                    className={`mb-1 flex h-8 w-full items-center justify-center rounded-xl text-xs font-bold transition last:mb-0 ${
                                      automationHour12 === hour
                                        ? "bg-[var(--accent-color)] text-[#131314] shadow-[0_0_12px_var(--accent-soft-strong)]"
                                        : "bg-[#18191b] text-[#c4c7c5] hover:bg-[#282a2c]"
                                    }`}
                                  >
                                    {hour}
                                  </button>
                                ))}
                              </div>
                              <button type="button" onClick={() => setAutomationTimeFromClock(automationHour12 === 1 ? 12 : automationHour12 - 1, automationTimeParts.minutes, automationPeriod)} className="mt-1 flex h-7 w-full items-center justify-center rounded-xl border border-[#282a2c] bg-[#131314] text-xs font-semibold text-[#c4c7c5] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]" title="Previous hour">
                                -
                              </button>
                            </div>
                            <div>
                              <button type="button" onClick={() => adjustAutomationTime(1)} className="mb-1 flex h-7 w-full items-center justify-center rounded-xl border border-[#282a2c] bg-[#131314] text-xs font-semibold text-[#c4c7c5] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]" title="Next minute">
                                +
                              </button>
                              <div className="automation-time-scroll max-h-28 overflow-y-auto pr-1">
                                {automationMinuteOptions.map((minute) => (
                                  <button
                                    key={minute}
                                    type="button"
                                    onClick={() => setAutomationTimeFromClock(automationHour12, minute, automationPeriod)}
                                    className={`mb-1 flex h-8 w-full items-center justify-center rounded-xl text-xs font-bold transition last:mb-0 ${
                                      automationTimeParts.minutes === minute
                                        ? "bg-[var(--accent-color)] text-[#131314] shadow-[0_0_12px_var(--accent-soft-strong)]"
                                        : "bg-[#18191b] text-[#c4c7c5] hover:bg-[#282a2c]"
                                    }`}
                                  >
                                    {String(minute).padStart(2, "0")}
                                  </button>
                                ))}
                              </div>
                              <button type="button" onClick={() => adjustAutomationTime(-1)} className="mt-1 flex h-7 w-full items-center justify-center rounded-xl border border-[#282a2c] bg-[#131314] text-xs font-semibold text-[#c4c7c5] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]" title="Previous minute">
                                -
                              </button>
                            </div>
                            <div className="flex flex-col gap-2 pt-7">
                              {["AM", "PM"].map((period) => (
                                <button
                                  key={period}
                                  type="button"
                                  onClick={() => setAutomationTimeFromClock(automationHour12, automationTimeParts.minutes, period)}
                                  className={`h-10 rounded-xl text-xs font-bold transition ${
                                    automationPeriod === period
                                      ? "bg-[var(--accent-color)] text-[#131314] shadow-[0_0_12px_var(--accent-soft-strong)]"
                                      : "bg-[#18191b] text-[#c4c7c5] hover:bg-[#282a2c]"
                                  }`}
                                >
                                  {period}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9aa0a6]">Repeat</div>
                    <div className="text-[11px] font-semibold text-[#73777f]">From {automationTime || "time"}</div>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { label: "Once", value: "once" },
                      { label: "Daily", value: "daily" },
                      { label: "Weekly", value: "weekly" },
                      { label: "Monthly", value: "monthly" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setAutomationRepeat(option.value as AutomationRepeat);
                          if (option.value !== "once" && !automationTime) {
                            setAutomationTime("09:00");
                          }
                        }}
                        className={`h-9 rounded-xl text-xs font-bold transition ${
                          automationRepeat === option.value
                            ? "bg-[var(--accent-color)] text-[#131314] shadow-[0_0_14px_var(--accent-soft-strong)]"
                            : "bg-[#0f1011] text-[#c4c7c5] ring-1 ring-[#282a2c] hover:bg-[#282a2c]"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className={`mt-2 rounded-2xl p-2 transition ${automationRepeat === "every_minutes" || automationRepeat === "every_hours" ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent-soft-strong)]" : "bg-[#0f1011] ring-1 ring-[#282a2c]"}`}>
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#9aa0a6]">Every</div>
                    <div className="grid grid-cols-[1fr_1.35fr] gap-2">
                      <div
                        className={`grid h-10 min-w-0 grid-cols-[minmax(38px,1fr)_28px_28px] overflow-hidden rounded-xl shadow-sm ring-1 transition ${
                          automationRepeat === "every_minutes" || automationRepeat === "every_hours"
                            ? "bg-[var(--accent-soft)] text-[var(--accent-color)] ring-[var(--accent-soft-strong)]"
                            : "bg-[#101112] text-[#e3e3e3] ring-[#282a2c]"
                        }`}
                        onFocus={() => setAutomationRepeat(automationEveryUnit === "hours" ? "every_hours" : "every_minutes")}
                      >
                        <input
                          type="number"
                          min={1}
                          max={automationEveryUnit === "hours" ? 24 : 1440}
                          value={automationEveryAmount}
                          onChange={(event) => {
                            const next = clampNumber(Number(event.target.value || 1), 1, automationEveryUnit === "hours" ? 24 : 1440);
                            setAutomationEveryAmount(next);
                            setAutomationRepeat(automationEveryUnit === "hours" ? "every_hours" : "every_minutes");
                            if (!automationTime) setAutomationTime("09:00");
                          }}
                          className="number-input min-w-0 appearance-none bg-transparent px-1 text-center text-sm font-bold leading-none outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setAutomationEveryAmount((value) => clampNumber(value - 1, 1, automationEveryUnit === "hours" ? 24 : 1440));
                            setAutomationRepeat(automationEveryUnit === "hours" ? "every_hours" : "every_minutes");
                            if (!automationTime) setAutomationTime("09:00");
                          }}
                          className="grid h-full w-full place-items-center border-l border-[var(--accent-soft-strong)] text-sm font-bold transition hover:bg-[var(--accent-soft)]"
                          aria-label="Decrease interval"
                        >
                          -
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAutomationEveryAmount((value) => clampNumber(value + 1, 1, automationEveryUnit === "hours" ? 24 : 1440));
                            setAutomationRepeat(automationEveryUnit === "hours" ? "every_hours" : "every_minutes");
                            if (!automationTime) setAutomationTime("09:00");
                          }}
                          className="grid h-full w-full place-items-center border-l border-[var(--accent-soft-strong)] text-sm font-bold transition hover:bg-[var(--accent-soft)]"
                          aria-label="Increase interval"
                        >
                          +
                        </button>
                      </div>
                      <div className="relative" data-dropdown-root>
                        <button
                          type="button"
                          onClick={() => setAutomationEveryUnitMenuOpen((open) => !open)}
                          className={`flex h-10 w-full items-center justify-between rounded-xl px-3 text-sm font-bold ring-1 transition hover:brightness-110 ${
                            automationRepeat === "every_minutes" || automationRepeat === "every_hours"
                              ? "bg-[var(--accent-soft)] text-[var(--accent-color)] ring-[var(--accent-soft-strong)]"
                              : "bg-[#101112] text-[#e3e3e3] ring-[#282a2c]"
                          }`}
                        >
                          <span>{automationEveryUnit}</span>
                          <ChevronDownIcon className={`h-4 w-4 text-[#c4c7c5] transition ${automationEveryUnitMenuOpen ? "rotate-180" : ""}`} />
                        </button>
                        {automationEveryUnitMenuOpen && (
                          <div className="absolute left-0 right-0 top-full z-[125] mt-1.5 rounded-xl bg-[#131314] p-1.5 shadow-2xl ring-1 ring-[#282a2c]">
                            {(["minutes", "hours"] as AutomationEveryUnit[]).map((unit) => (
                              <button
                                key={unit}
                                type="button"
                                onClick={() => {
                                  setAutomationEveryUnit(unit);
                                  setAutomationEveryUnitMenuOpen(false);
                                  setAutomationRepeat(unit === "hours" ? "every_hours" : "every_minutes");
                                  setAutomationEveryAmount((value) => clampNumber(value, 1, unit === "hours" ? 24 : 1440));
                                  if (!automationTime) setAutomationTime("09:00");
                                }}
                                className={`mb-1 flex h-9 w-full items-center rounded-xl px-3 text-left text-sm font-bold transition last:mb-0 ${
                                  automationEveryUnit === unit
                                    ? "bg-[var(--accent-color)] text-[#131314]"
                                    : "text-[#e3e3e3] hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
                                }`}
                              >
                                {unit}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[#282a2c] px-5 py-4">
                <button
                  type="button"
                  onClick={() => {
                    setAutomationEditorOpen(false);
                    setEditingAutomationId(null);
                  }}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#282a2c] bg-[#131314] text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]"
                  title="Cancel"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              <button
                type="button"
                onClick={() => saveAutomationJob().catch((error) => console.error("Automation save error:", error))}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border text-sm font-semibold shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  borderColor: "color-mix(in srgb, var(--accent-color) 32%, transparent)",
                  backgroundColor: "color-mix(in srgb, var(--accent-color) 18%, #131314 82%)",
                  color: "color-mix(in srgb, var(--accent-color) 72%, white 28%)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                }}
                disabled={!automationName.trim() || !automationPrompt.trim()}
                title="Save automation"
              >
                <SaveIcon className="h-4.5 w-4.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="flex h-screen overflow-hidden"
        onPointerMove={markUiInteraction}
        onWheel={markUiInteraction}
      >
        <aside
          className={`${leftPanelOpen ? "flex" : "hidden"} ${
            isCompactLayout ? "fixed inset-y-0 left-0 z-50 w-[320px]" : "relative z-30 w-[292px] flex-none"
          } flex-col border-r border-[#323437] bg-[#18191b]`}
        >
          <div className="flex h-14 items-center justify-between border-b border-[#282a2c] px-4">
            <div className="text-sm font-semibold text-[#e3e3e3]">App Settings</div>
            <IconButton size="sm" title="Close app settings" onClick={() => setLeftPanelOpen(false)}>
              <CloseIcon />
            </IconButton>
          </div>
          <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">{leftPanelContent}</div>
        </aside>

        {isCompactLayout && leftPanelOpen && (
          <button
            type="button"
            onClick={() => setLeftPanelOpen(false)}
            className="fixed inset-0 z-40 bg-black/35"
            aria-label="Close app settings overlay"
          />
        )}

        <main
          className="relative flex min-w-0 flex-1 flex-col overflow-hidden w-full"
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            attachImageFromFile(event.dataTransfer.files[0]);
          }}
        >
          {isDragging && (
            <div className="absolute inset-0 z-40 flex items-center justify-center border-4 border-dashed bg-[#131314]/80 backdrop-blur-sm" style={{ borderColor: "var(--accent-soft-strong)" }}>
              <div className="rounded-[28px] bg-[#1e1f20] px-8 py-6 text-center shadow-xl ring-1 ring-[#282a2c]">
                <div className="font-title text-2xl text-[#e3e3e3]">Drop an image here</div>
                <div className="mt-2 text-sm text-[#c4c7c5]">The assistant will add it to the chat with your instruction.</div>
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
            <img src={brandLogo} alt="" aria-hidden="true" className={conversationLogoClass} />
          </div>

          <header className="shrink-0 border-b border-[#282a2c] bg-[#131314] px-3 py-2">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
              <IconButton title={leftPanelOpen ? "Close app settings" : "Open app settings"} onClick={() => setLeftPanelOpen((prev) => !prev)} size="sm" active={leftPanelOpen}>
                <GearIcon />
              </IconButton>
              <div className="min-w-0 overflow-hidden">
                <ResourceHeader
                  activeTaskType={activeTaskType}
                  brainStatus={brainStatus}
                  modelState={modelLoadStatus.state}
                  isGeneratingImage={isGeneratingImage}
                  isAudioPlaying={isAudioPlaying}
                  isVoiceBusy={Boolean(speakingMessageId || previewingVoicePath || isAudioPlaying)}
                />
              </div>
              <IconButton title={rightPanelOpen ? "Close model controls" : "Open model controls"} onClick={() => setRightPanelOpen((prev) => !prev)} size="sm" active={rightPanelOpen}>
                <MenuIcon />
              </IconButton>
            </div>
            <div className="mt-3 text-center text-[11px] font-medium text-[#9aa0a6]">
              {dateTimeLine}
            </div>

            {topStatusText && (
              <div className="mt-1.5 rounded-2xl border border-[#282a2c] bg-[#1e1f20] px-3 py-1.5">
                <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-[#c4c7c5]">
                  <span className="min-w-0 truncate">{topStatusText}</span>
                  {topProgressActive && <span className="shrink-0 text-[#9aa0a6]">{Math.round(topProgressPercent)}%</span>}
                </div>
                {topProgressActive && (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#282a2c]">
                    <div
                      className={`h-full transition-all duration-300 ${brainStatus === "Error" ? "bg-rose-500" : ""}`}
                      style={{ width: `${topProgressPercent}%`, backgroundColor: brainStatus === "Error" ? undefined : "var(--accent-color)" }}
                    />
                  </div>
                )}
              </div>
            )}
          </header>

          {engineErrorMsg && (
            <div className="shrink-0 border-b border-rose-500/20 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
              {engineErrorMsg}
            </div>
          )}

          <section ref={conversationScrollRef} onScroll={handleChatScroll} className="conversation-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 relative">
            {messages.length === 0 ? (
              <div className="relative z-10 mx-auto flex h-full max-w-3xl flex-col items-center justify-center text-center">
                <img src={brandLogo} alt="Galaxy AI Hub" className="mx-auto h-auto w-full max-w-[260px] object-contain" />
                <h1 className="mt-8 font-title text-4xl tracking-tight text-[#f4f6f8] md:text-5xl">Start a conversation.</h1>
                {systemInfo && (
                  <div className="mt-8 w-full max-w-[740px] rounded-[22px] border border-[#282a2c] bg-[#1b1c1e] px-6 py-4 text-left shadow-[0_12px_40px_rgba(0,0,0,0.28)]">
                    <div className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[112px_minmax(0,1fr)]">
                      <button
                        type="button"
                        onClick={openPersonalityProfile}
                        className="h-28 w-28 shrink-0 overflow-hidden rounded-[18px] bg-[#131314] text-left ring-1 ring-[#282a2c] transition hover:ring-[var(--accent-color)]"
                        title="Open assistant profile"
                      >
                        <AvatarImage src={assistantAvatar} fallback={selectedPersonalityPreset?.name || "AI"} className="h-full w-full rounded-[18px]" />
                      </button>
                      <div className="min-w-0 self-center">
                        <div className="text-[24px] font-semibold leading-none tracking-tight text-[#f4f6f8]">{selectedPersonalityPreset?.name || "Assistant"}</div>
                        <div className="mt-1 text-[10px] font-bold uppercase leading-none tracking-[0.22em] text-[#c4c7c5]">Hardware Check</div>
                        <dl className="mt-2 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px] leading-4 sm:grid-cols-[82px_minmax(0,1fr)]">
                          <dt className="font-semibold text-[#9aa0a6]">CPU</dt>
                          <dd className="min-w-0 break-words text-[#e3e3e3]">{systemInfo.cpu_name}</dd>
                          <dt className="font-semibold text-[#9aa0a6]">GPU ? VRAM</dt>
                          <dd className="min-w-0 break-words text-[#e3e3e3]">{hardwareGpuLabel}</dd>
                          <dt className="font-semibold text-[#9aa0a6]">RAM</dt>
                          <dd className="min-w-0 break-words text-[#e3e3e3]">{hardwareRamLabel}</dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-5">
                {messages.map((message, index) => {
                  const messageText = extractMessageText(message.content);
                  const canSpeak =
                    Boolean(messageText) &&
                    !(typeof message.content === "string" && message.content.startsWith("[Error"));
                  const firstImagePartIndex = Array.isArray(message.content)
                    ? message.content.findIndex((part) => part.type === "image_url" && Boolean(part.image_url.local_path))
                    : -1;
                  const firstImagePart = firstImagePartIndex >= 0 && Array.isArray(message.content)
                    ? (message.content[firstImagePartIndex] as Extract<ChatContentPart, { type: "image_url" }>)
                    : undefined;
                  const firstImagePath = firstImagePart?.image_url.local_path;
                  const firstImagePartKey = firstImagePartIndex >= 0 ? `${message.id}:${firstImagePartIndex}` : "";
                  const firstImageCollapsed = firstImagePartKey ? Boolean(collapsedImageParts[firstImagePartKey]) : false;
                  const hasImageContent = Array.isArray(message.content) && message.content.some((part) => part.type === "image_url");
                  const isTypingIndicator =
                    message.role === "assistant" &&
                    message.content === "" &&
                    index === messages.length - 1 &&
                    isStreaming;
                  const imageFolderTitle = "Open image folder";

                  return (
                    <div
                      key={message.id}
                      data-message-id={message.id}
                      className={`chat-message-row flex items-start gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      {message.role === "assistant" && (
                        <div
                          className="mt-1 h-10 w-10 shrink-0 overflow-hidden rounded-2xl bg-[#1e1f20] ring-1 ring-[#282a2c]"
                          title={selectedPersonalityPreset?.name || "Assistant"}
                        >
                          <AvatarImage src={assistantAvatar} fallback={selectedPersonalityPreset?.name || "AI"} className="h-full w-full rounded-2xl" />
                        </div>
                      )}
                      <div
                        className={`chat-bubble min-w-0 max-w-[88%] overflow-hidden rounded-[28px] shadow-sm ring-1 ${hasImageContent ? "px-3 py-3" : isTypingIndicator ? "px-4 py-3" : "px-5 py-4"} ${
                          message.role === "user"
                            ? "text-[#e3e3e3]"
                            : "bg-[#1e1f20] text-[#e3e3e3] ring-[#282a2c]"
                        }`}
                        style={message.role === "user" ? { backgroundColor: "var(--accent-soft)", boxShadow: "inset 0 0 0 1px var(--accent-soft-strong)" } : undefined}
                      >
                        {message.role === "assistant" && message.thinking && (
                          <details className="mb-3 overflow-hidden rounded-2xl border border-[#282a2c] bg-[#131314] px-3 py-2 text-xs text-[#c4c7c5]">
                            <summary className="cursor-pointer select-none font-semibold text-[var(--accent-color)]">
                              Thinking process
                            </summary>
                            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans leading-6">
                              {message.thinking}
                            </pre>
                          </details>
                        )}
                        {Array.isArray(message.content) ? (
                          <div className="space-y-3">
                            {message.content.map((part, partIndex) =>
                              part.type === "text" ? (
                                <FormattedMessageText key={partIndex} text={part.text} compact={message.role === "user"} />
                              ) : part.type === "image_url" ? (
                                (() => {
                                  const imagePartKey = `${message.id}:${partIndex}`;
                                  const imageCollapsed = Boolean(collapsedImageParts[imagePartKey]);
                                  const viewTitle = "View image";
                                  return (
                                    <div key={partIndex} className="relative overflow-visible">
                                      <div className="hidden">
                                        <button
                                          type="button"
                                          title={imageCollapsed ? "Expand image" : "Collapse image"}
                                          onClick={() =>
                                            setCollapsedImageParts((prev) => ({
                                              ...prev,
                                              [imagePartKey]: !prev[imagePartKey],
                                            }))
                                          }
                                          className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#282a2c] bg-[#131314]/90 text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
                                        >
                                          {imageCollapsed ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronUpIcon className="h-3.5 w-3.5" />}
                                        </button>
                                      </div>
                                      {imageCollapsed ? (
                                        <div className="flex h-10 items-center rounded-[14px] border border-dashed border-[#3a3b3d] px-3 text-sm font-semibold text-[#c4c7c5]">
                                          Image collapsed
                                        </div>
                                      ) : (
                                        <>
                                          {part.image_url.url ? (
                                            <button
                                              type="button"
                                              title={viewTitle}
                                              onClick={() => openImageViewer(part.image_url.url, part.image_url.local_path)}
                                              className="block w-full overflow-hidden rounded-[14px] text-left"
                                            >
                                              <img
                                                src={part.image_url.url}
                                                alt="Chat visual"
                                                className="max-h-[420px] w-full rounded-[14px] object-contain transition hover:brightness-110"
                                              />
                                            </button>
                                          ) : (
                                            <div className="flex h-52 items-center justify-center rounded-[14px] border border-[#282a2c] bg-[#131314]/35 text-sm text-[#9aa0a6]">
                                              Reloading image...
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  );
                                })()
                              ) : part.type === "image_proposal" ? (
                                <ImageProposalCard
                                  key={partIndex}
                                  proposal={part.image_proposal}
                                  disabled={isGeneratingImage}
                                  language="en"
                                  onCancel={() => dismissImageProposal(message.id, partIndex)}
                                  onGenerate={(prompt) => {
                                    dismissImageProposal(message.id, partIndex);
                                    void handleGenerateImage(prompt, part.image_proposal.mode, part.image_proposal.mask_prompt);
                                  }}
                                />
                              ) : part.type === "action_proposal" ? (
                                <ActionProposalCard
                                  key={partIndex}
                                  proposal={part.action_proposal}
                                  disabled={isApproving}
                                  language="en"
                                  onCancel={() => dismissChatPart(message.id, partIndex, "Action was cancelled.")}
                                  onApprove={() => {
                                    void approveActionProposal(message.id, partIndex, part.action_proposal);
                                  }}
                                />
                              ) : part.type === "tool_result_cards" ? (
                                 <ToolResultCards 
                                   key={partIndex} 
                                   cards={part.cards} 
                                   language="en"
                                   onDeleteCalendarEvent={(event) => {
                                     openDeleteGoogleEventConfirm(event);
                                   }}
                                 />
                              ) : (
                                <FilePreviewCard
                                  key={partIndex}
                                  preview={part.file_preview}
                                  linkedFolders={linkedFolders}
                                  language="en"
                                />
                              ),
                            )}
                          </div>
                        ) : isTypingIndicator ? (
                          <span className="flex h-4 items-center gap-1">
                            <span className="h-2 w-2 animate-bounce rounded-full bg-[#c4c7c5]" />
                            <span className="h-2 w-2 animate-bounce rounded-full bg-[#c4c7c5] [animation-delay:120ms]" />
                            <span className="h-2 w-2 animate-bounce rounded-full bg-[#c4c7c5] [animation-delay:240ms]" />
                          </span>
                        ) : (
                          <FormattedMessageText text={message.content} compact={message.role === "user"} />
                        )}

                        {(firstImagePath || canSpeak) && (
                          <div className="mt-2 flex items-center justify-between gap-3">
                            {firstImagePath ? (
                              <button
                                type="button"
                                title={imageFolderTitle}
                                onClick={() => void revealImageLocation(firstImagePath)}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-[#282a2c] bg-[#131314] text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
                              >
                                <FolderIcon className="h-4 w-4" />
                              </button>
                            ) : (
                              <span className="h-8 w-8" />
                            )}
                            <div className="flex items-center gap-2">
                              {firstImagePartKey && (
                                <button
                                  type="button"
                                  title="Delete image message"
                                  onClick={() => deleteImageFromChatMessage(message.id)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#282a2c] bg-[#131314] text-[#e3e3e3] transition hover:bg-rose-500/10 hover:text-rose-300"
                                >
                                  <TrashIcon className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {firstImagePartKey && (
                                <button
                                  type="button"
                                  title={firstImageCollapsed ? "Expand image" : "Collapse image"}
                                  onClick={() =>
                                    setCollapsedImageParts((prev) => ({
                                      ...prev,
                                      [firstImagePartKey]: !prev[firstImagePartKey],
                                    }))
                                  }
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#282a2c] bg-[#131314] text-[#e3e3e3] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
                                >
                                  {firstImageCollapsed ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronUpIcon className="h-3.5 w-3.5" />}
                                </button>
                              )}
                              {canSpeak && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (speakingMessageId === message.id) {
                                      voicePlaybackRequestRef.current += 1;
                                      stopActiveAudio();
                                      setSpeakingMessageId(null);
                                      return;
                                    }

                                    ensureAudioPlaybackUnlocked()
                                      .catch(() => null)
                                      .finally(() => {
                                        speakMessageText(message.id, messageText, message.role);
                                      });
                                  }}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#282a2c] bg-[#131314] text-[#e3e3e3] transition hover:bg-[#282a2c]"
                                  title={speakingMessageId === message.id ? "Stop speech" : "Speak"}
                                >
                                  {speakingMessageId === message.id ? <StopIcon className="h-3.5 w-3.5" /> : <SpeakerIcon className="h-4 w-4" />}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      {message.role === "user" && (
                        <button
                          type="button"
                          onClick={openUserProfile}
                          className="mt-1 h-10 w-10 shrink-0 overflow-hidden rounded-2xl"
                          style={{ backgroundColor: "var(--accent-soft)", boxShadow: "inset 0 0 0 1px var(--accent-soft-strong)" }}
                          title="Edit user profile"
                        >
                          <AvatarImage src={userAvatar} fallback={userName || "You"} className="h-full w-full rounded-2xl" />
                        </button>
                      )}
                    </div>
                  );
                })}
                <div ref={conversationEndRef} className="h-6 shrink-0" />
              </div>
            )}
            {showScrollBottom && (
              <button
                onClick={() => scrollToBottom()}
                className="sticky bottom-4 left-1/2 -translate-x-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-[#3d3f42]/90 text-[var(--accent-color)] shadow-lg backdrop-blur-md transition hover:bg-[#4a4c50]/90 active:scale-95 border border-[#52555a]"
                title="Scroll to bottom"
              >
                <ChevronDownIcon className="h-5 w-5" />
              </button>
            )}
          </section>

          <footer className="shrink-0 border-t border-[#282a2c] bg-[#131314] px-4 py-4">
            <div className="mx-auto w-full max-w-5xl rounded-[30px] border border-[#282a2c] bg-[#1e1f20] p-3 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
              {pendingShellActions.length > 0 && (
                <div className="mb-3 space-y-2">
                  {pendingShellActions.map((action) => (
                    <div key={action.id} className="overflow-hidden rounded-[22px] bg-[#131314] ring-1 ring-[#282a2c]">
                      <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-[10px] text-[var(--accent-color)]">{"\u25B6"}</span>
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--accent-color)]" />
                          <div className="truncate text-sm font-semibold text-[#e3e3e3]">System action request</div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${action.risk_level === "high" ? "bg-rose-500/15 text-rose-200" : action.risk_level === "medium" ? "bg-amber-500/15 text-amber-200" : ""}`}
                          style={action.risk_level === "low" ? { backgroundColor: "var(--accent-soft)", color: "var(--accent-color)" } : undefined}
                        >
                          {action.risk_level}
                        </span>
                      </div>
                      <div className="border-t border-[#282a2c] p-3">
                        <div className="text-xs leading-5 text-[#c4c7c5]">{action.purpose}</div>
                        <details className="mt-2 overflow-hidden rounded-2xl border border-[#282a2c] bg-[#0f1011] text-xs text-[#c4c7c5]">
                          <summary className="cursor-pointer select-none px-3 py-2 font-semibold text-[var(--accent-color)] [&::-webkit-details-marker]:hidden">
                            {"\u25B6"} Command
                          </summary>
                          <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap border-t border-[#282a2c] p-3 text-xs leading-5 text-[#e3e3e3]">{action.command}</pre>
                        </details>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 truncate text-xs text-[#c4c7c5]" title={action.working_directory}>
                          Folder: {action.working_directory}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => rejectShellAction(action.id).catch((error) => console.error("Reject shell action error:", error))}
                            className="rounded-full border border-[#282a2c] bg-[#131314] px-4 py-2 text-xs font-semibold text-[#e3e3e3] transition hover:bg-[#282a2c]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => approveShellAction(action).catch((error) => console.error("Approve shell action error:", error))}
                            disabled={executingShellActionId === action.id}
                            className="rounded-full px-4 py-2 text-xs font-semibold text-[#131314] transition disabled:opacity-50"
                            style={{ backgroundColor: "var(--accent-color)" }}
                          >
                            {executingShellActionId === action.id ? "Running..." : "Run"}
                          </button>
                        </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {image && (
                <div className="mb-3 flex items-center gap-3 rounded-3xl bg-[#131314] p-3 ring-1 ring-[#282a2c]">
                  <img src={image} alt="Attached preview" className="h-14 w-14 rounded-2xl bg-[#131314] object-contain" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#e3e3e3]">Image ready</div>
                    <div className="truncate text-xs text-[#c4c7c5]">The selected brain will receive this picture with your next message.</div>
                  </div>
                  <IconButton title="Remove image" onClick={() => {
                    setImage(null);
                    setImagePath(null);
                  }}>
                    <CloseIcon />
                  </IconButton>
                </div>
              )}

              <div className="flex items-center gap-2 rounded-[24px] border border-[#282a2c] bg-[#131314] py-1.5 pl-4 pr-2">
                <textarea
                  ref={composerInputRef}
                  defaultValue={input}
                  onInput={(event) => {
                    lastComposerInputAtRef.current = Date.now();
                    const node = event.currentTarget;
                    setComposerHasText((previous) => {
                      const next = Boolean(node.value.trim());
                      return previous === next ? previous : next;
                    });
                    resizeComposerTextarea(node);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSend().catch((error) => console.error("Send error:", error));
                    }
                  }}
                  onPaste={(event) => {
                    const items = event.clipboardData?.items;
                    if (!items) return;
                    for (let i = 0; i < items.length; i++) {
                      if (items[i].type.startsWith("image/")) {
                        const file = items[i].getAsFile();
                        if (file) {
                          attachImageFromFile(file);
                          event.preventDefault();
                          return;
                        }
                      }
                    }
                  }}
                  rows={1}
                  className="min-h-[40px] w-full resize-none overflow-y-auto bg-transparent px-3 py-[10px] text-sm leading-5 text-[#e3e3e3] outline-none placeholder:text-[#73777f]"
                  placeholder="Ask Galaxy anything..."
                />
                <button
                  type="button"
                  onClick={() => {
                    if (isStreaming || sendInFlightRef.current) {
                      stopActiveResponse();
                      return;
                    }
                    handleSend().catch((error) => console.error("Send error:", error));
                  }}
                  disabled={!isStreaming && !sendInFlightRef.current && ((!composerHasText && !image) || engineStatus !== "ready")}
                  className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-2xl text-sm font-semibold transition disabled:cursor-not-allowed"
                  style={
                    isStreaming || sendInFlightRef.current
                      ? { backgroundColor: "var(--accent-color)", color: "#131314" }
                      : composerHasText || image
                        ? { backgroundColor: selectedThemeSwatch.accent, color: "#131314" }
                        : { backgroundColor: "#2d2e30", color: "#5f6368" }
                  }
                  onMouseEnter={(event) => {
                    if (event.currentTarget.disabled || isStreaming || sendInFlightRef.current || (!composerHasText && !image)) return;
                    event.currentTarget.style.backgroundColor = selectedThemeSwatch.hover;
                  }}
                  onMouseLeave={(event) => {
                    if (event.currentTarget.disabled) return;
                    event.currentTarget.style.backgroundColor = composerHasText || image ? selectedThemeSwatch.accent : "#2d2e30";
                  }}
                >
                  {isStreaming || sendInFlightRef.current ? (
                    <StopIcon className="h-4.5 w-4.5" />
                  ) : (
                    <SendIcon className="h-5 w-5" />
                  )}
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-[#282a2c] px-1 pt-2">
                <div className="flex gap-1">
                  <IconButton title={thinkingEnabled ? "AI brain reasoning is on" : "Enable AI brain reasoning"} onClick={() => setThinkingEnabled((prev) => !prev)} active={thinkingEnabled}>
                    <BrainIcon className="h-5 w-5" />
                  </IconButton>
                  <IconButton
                    title={liveConversation ? "Live voice playback is on" : "Enable live voice playback"}
                    onClick={() => setAutoVoiceMode(!liveConversation)}
                    active={liveConversation}
                  >
                    <SpeakerIcon className="h-4.5 w-4.5" />
                  </IconButton>
                  <IconButton title={isRecording ? "Stop voice input recording" : isTranscribing ? "Voice input is transcribing" : "Start voice input"} onClick={() => handleMicToggle().catch((error) => console.error("Mic error:", error))} active={isRecording} disabled={isTranscribing}>
                    <MicIcon className="h-4.5 w-4.5" />
                  </IconButton>
                  <IconButton title="Open image generation or attach an image" onClick={() => chooseImageForComposer().catch((error) => console.error("Choose image error:", error))}>
                    <ImageIcon className="h-4.5 w-4.5" />
                  </IconButton>
                  <div className="relative" data-dropdown-root>
                    <button
                      type="button"
                      title="Choose theme color"
                      onClick={() => {
                        const next = !themePickerOpen;
                        setModelMenuOpen(false);
                        setUserProfileMenuOpen(false);
                        setPersonalityMenuOpen(false);
                        setQuickModelMenuOpen(false);
                        setThemePickerOpen(next);
                      }}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#282a2c] bg-[#1e1f20] text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]"
                      style={{
                        color: themePickerOpen ? selectedThemeSwatch.accent : undefined,
                        boxShadow: themePickerOpen ? `inset 0 0 0 1px ${selectedThemeSwatch.soft}` : undefined,
                      }}
                    >
                    <BrushIcon className="h-4.5 w-4.5" />
                    </button>
                    {themePickerOpen && (
                      <div className="absolute bottom-full left-1/2 z-50 mb-3 -translate-x-1/2 rounded-full border border-[#282a2c] bg-[#1e1f20] px-3 py-2 shadow-2xl">
                        <div className="flex items-center gap-2">
                          {THEME_SWATCHS.map((swatch) => (
                            <button
                              key={swatch.id}
                              type="button"
                              title={swatch.id}
                              onClick={() => {
                                setThemeSwatchId(swatch.id);
                                setThemePickerOpen(false);
                              }}
                              className="flex h-8 w-8 items-center justify-center rounded-full border transition"
                              style={{
                                backgroundColor: swatch.accent,
                                borderColor: swatch.id === themeSwatchId ? "#f3f4f6" : "rgba(255,255,255,0.12)",
                                boxShadow: swatch.id === themeSwatchId ? `0 0 0 2px ${swatch.soft}` : "none",
                              }}
                            >
                              <span className="sr-only">{swatch.id}</span>
                            </button>
                          ))}
                        </div>
                        <div
                          className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-[#282a2c] bg-[#1e1f20]"
                        />
                      </div>
                    )}
                  </div>
                  <IconButton title="Clear chat" onClick={() => {
                    setFreshChatConfirmOpen(true);
                  }}>
                    <EraserIcon className="h-4.5 w-4.5" />
                  </IconButton>
                  {isTranscribing && (
                    <div className="ml-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: selectedThemeSwatch.accent }}>
                      <div className="h-2 w-2 animate-ping rounded-full" style={{ backgroundColor: selectedThemeSwatch.accent }} />
                      <span>Transcribing...</span>
                    </div>
                  )}
                </div>

                <div className="relative" data-dropdown-root>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !quickModelMenuOpen;
                        setModelMenuOpen(false);
                        setUserProfileMenuOpen(false);
                        setPersonalityMenuOpen(false);
                        setThemePickerOpen(false);
                        setQuickModelMenuOpen(next);
                      }}
                      className="flex max-w-[136px] items-center gap-2 overflow-hidden rounded-xl bg-[#0f1011] px-3 py-1.5 ring-1 ring-[#282a2c] transition hover:bg-[#1a1b1c]"
                    >
                      <div className="flex items-center gap-1.5">
                        <BrainIcon className={`h-3.5 w-3.5 shrink-0 ${brainStatus === "Ready" || brainStatus === "Thinking" ? "text-emerald-400" : "text-[#73777f]"}`} />
                        {currentModelEntry?.has_vision && <EyeIcon className="h-3.5 w-3.5 shrink-0 text-[var(--accent-color)]" />}
                        <span className="max-w-[96px] truncate text-[10px] font-bold uppercase tracking-[0.14em] text-[#e3e3e3]">
                          {selectedModel || "No Model"}
                        </span>
                      </div>
                    <ChevronDownIcon className={`h-3 w-3 text-[#73777f] transition-transform ${quickModelMenuOpen ? "rotate-180" : ""}`} />
                  </button>

                  {quickModelMenuOpen && (
                    <div className="dropdown-scroll absolute bottom-full right-0 z-50 mb-2 max-h-80 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-[#282a2c] bg-[#131314] p-2 shadow-2xl">
                      {availableModels.length === 0 ? (
                        <div className="p-4 text-center text-xs text-[#73777f]">No models found</div>
                      ) : (
                        availableModels.map((model) => (
                          <button
                            key={model.path}
                            type="button"
                            onClick={() => {
                              setQuickModelMenuOpen(false);
                              setSelectedModelPath(model.path);
                              loadModelPath(model.path).catch((error) => console.error("Model select error:", error));
                            }}
                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${selectedModelPath === model.path ? "bg-[var(--accent-soft)] text-[var(--accent-color)]" : "text-[#c4c7c5] hover:bg-[#282a2c]"}`}
                          >
                            <BrainIcon className={`h-4 w-4 shrink-0 ${selectedModelPath === model.path && (brainStatus === "Ready" || brainStatus === "Thinking") ? "text-emerald-400" : "text-[#c4c7c5]"}`} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold">{model.name}</div>
                              <div className="truncate text-[10px] opacity-60">{model.path.split(/[/\\]/).pop()}</div>
                            </div>
                            {model.has_vision && <EyeIcon className="h-4 w-4 shrink-0 text-[var(--accent-color)]" />}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </footer>
        </main>

        <aside
          className={`${rightPanelOpen ? "flex" : "hidden"} ${
            isCompactLayout ? "fixed inset-y-0 right-0 z-50 w-[320px]" : "relative z-30 w-[292px] flex-none"
          } flex-col border-l border-[#323437] bg-[#18191b]`}
        >
          <div className="flex h-14 items-center justify-between border-b border-[#282a2c] px-4">
            <div className="text-sm font-semibold text-[#e3e3e3]">Model Controls</div>
            <IconButton size="sm" title="Close model controls" onClick={() => setRightPanelOpen(false)}>
              <CloseIcon />
            </IconButton>
          </div>
          <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">{rightPanelContent}</div>
        </aside>

        {isCompactLayout && rightPanelOpen && (
          <button
            type="button"
            onClick={() => setRightPanelOpen(false)}
            className="fixed inset-0 z-40 bg-black/35"
            aria-label="Close model controls overlay"
          />
        )}
      </div>
    </div>

    {imageViewer && (
        <div
          className="fixed inset-0 z-[320] flex items-center justify-center bg-black/82 p-4 backdrop-blur-sm"
          onClick={() => setImageViewer(null)}
        >
          <div
            className="h-full w-full overflow-hidden"
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => {
              event.preventDefault();
              const direction = event.deltaY > 0 ? -0.18 : 0.18;
              setImageViewer((prev) =>
                prev
                  ? {
                      ...prev,
                      zoom: clampNumber(Number((prev.zoom + direction).toFixed(2)), 0.6, 6),
                    }
                  : prev,
              );
            }}
          >
            <img
              src={imageViewer.url}
              alt="Full size preview"
              draggable={false}
              className="h-full w-full cursor-grab select-none object-contain active:cursor-grabbing"
              style={{
                transform: `translate(${imageViewer.x}px, ${imageViewer.y}px) scale(${imageViewer.zoom})`,
                transition: imageViewerDragRef.current ? "none" : "transform 120ms ease-out",
              }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                imageViewerDragRef.current = {
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  originX: imageViewer.x,
                  originY: imageViewer.y,
                  moved: false,
                };
              }}
              onPointerMove={(event) => {
                const drag = imageViewerDragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                const dx = event.clientX - drag.startX;
                const dy = event.clientY - drag.startY;
                if (Math.abs(dx) + Math.abs(dy) > 5) {
                  drag.moved = true;
                }
                setImageViewer((prev) =>
                  prev ? { ...prev, x: drag.originX + dx, y: drag.originY + dy } : prev,
                );
              }}
              onPointerUp={(event) => {
                const drag = imageViewerDragRef.current;
                imageViewerDragRef.current = null;
                if (!drag || drag.pointerId !== event.pointerId || !drag.moved) {
                  setImageViewer(null);
                }
              }}
            />
          </div>
        </div>
      )}

    {selectedGoogleEvent && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={() => setSelectedGoogleEvent(null)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-[#1e1f20] p-6 shadow-2xl ring-1 ring-[#282a2c]" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-title text-xl text-[#e3e3e3]">{selectedGoogleEvent.title || "Untitled Event"}</h3>
            <div className="mt-4 space-y-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9aa0a6]">Time</div>
                <div className="mt-1 text-sm text-[#e3e3e3]">{googleEventTimeLabel(selectedGoogleEvent, true)}</div>
              </div>
              {selectedGoogleEvent.location && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9aa0a6]">Location</div>
                  <div className="mt-1 text-sm text-[#e3e3e3]">{selectedGoogleEvent.location}</div>
                </div>
              )}
              {selectedGoogleEvent.description && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9aa0a6]">Description</div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-[#e3e3e3]">{selectedGoogleEvent.description}</div>
                </div>
              )}
            </div>
            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  openDeleteGoogleEventConfirm(selectedGoogleEvent);
                }}
                className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-5 py-2.5 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/20"
              >
                Delete Event
              </button>
              <button
                type="button"
                onClick={() => setSelectedGoogleEvent(null)}
                className="rounded-2xl border border-[#282a2c] bg-[#131314] px-5 py-2.5 text-sm font-semibold text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    {googleDeleteTarget && (
        <div className="fixed inset-0 z-[310] flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm" onClick={() => setGoogleDeleteTarget(null)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-[#1e1f20] p-6 shadow-2xl ring-1 ring-[#282a2c]" onClick={(e) => e.stopPropagation()}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-300">Delete Event</div>
            <h3 className="mt-2 font-title text-xl text-[#e3e3e3]">{googleDeleteTarget.title || "Untitled Event"}</h3>
            <div className="mt-4 space-y-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9aa0a6]">Time</div>
                <div className="mt-1 text-sm text-[#e3e3e3]">{googleEventTimeLabel(googleDeleteTarget, true)}</div>
              </div>
              {googleDeleteTarget.location && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9aa0a6]">Location</div>
                  <div className="mt-1 text-sm text-[#e3e3e3]">{googleDeleteTarget.location}</div>
                </div>
              )}
              {googleDeleteTarget.description && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9aa0a6]">Description</div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-[#e3e3e3]">{googleDeleteTarget.description}</div>
                </div>
              )}
            </div>
            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={async () => {
                  const id = googleDeleteTarget.id;
                  setGoogleDeleteTarget(null);
                  if (id) {
                    await deleteGoogleEvent(id).catch((error) => console.error("Google event delete error:", error));
                  }
                }}
                className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-5 py-2.5 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/20"
              >
                Delete Event
              </button>
              <button
                type="button"
                onClick={() => setGoogleDeleteTarget(null)}
                className="rounded-2xl border border-[#282a2c] bg-[#131314] px-5 py-2.5 text-sm font-semibold text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
