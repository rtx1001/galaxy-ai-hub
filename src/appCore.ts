import { ChatContentPart, ChatMessage, ToolResultCard, ImageProposal, ActionProposal, FilePreviewResult } from './types';
import { clampNumber, formatBytes } from './utils';

export type VramMemoryStatus = {
  available: boolean;
  used_mb: number;
  total_mb: number;
  free_mb: number;
};

export type OmniVoiceVramEstimate = {
  required_mb: number;
  model_mb: number;
  overhead_mb: number;
};

export type AudioSynthesisResult = {
  audio_base64: string;
  mime_type: string;
};

export type LocalImageDataUrl = {
  data_url: string;
  path: string;
};

export type VoiceSample = {
  name: string;
  label: string;
  path: string;
  language?: string | null;
  language_probability?: number | null;
};

export type SystemInfo = {
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

export type ModelLibraryEntry = {
  path: string;
  name: string;
  relative_path: string;
  has_vision: boolean;
};

export type ModelStatus = {
  status: string;
  message: string;
  has_vision: boolean;
  model_name: string;
  model_path: string;
  gpu_layers: number;
};

export type FileActionResult = {
  success: boolean;
  message: string;
  path: string | null;
};
export type AgentReactResult = {
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
export type MemoryItem = {
  id: number;
  kind: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  created_at: number;
  updated_at: number;
};
export type ToolTrace = {
  tool: string;
  success: boolean;
  summary: string;
};

export type ToolRunRecord = {
  id: number;
  tool_name: string;
  input_json: string;
  output_text: string;
  success: boolean;
  duration_ms: number;
  created_at: number;
};

export type TelegramBotStatus = {
  success: boolean;
  message: string;
  username: string | null;
};

export type TelegramGuest = {
  id: string;
  name: string;
};

export type PendingShellAction = {
  id: number;
  command: string;
  working_directory: string;
  purpose: string;
  risk_level: string;
  timeout_seconds: number;
  created_at: number;
};

export type ShellExecutionResult = {
  id: number;
  command: string;
  working_directory: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  duration_ms: number;
};

export type ShellToolRequest = {
  purpose?: string;
  command?: string;
  working_directory?: string;
  timeout_seconds?: number;
};

export type AutomationJob = {
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

export type GoogleConnectionStatus = {
  connected: boolean;
  email: string | null;
  expires_at: number | null;
};

export type GoogleCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string | null;
  description: string | null;
  html_link: string | null;
};

export type ThemeSwatch = {
  id: string;
  accent: string;
  hover: string;
  soft: string;
};

export type AutomationRepeat = "once" | "every_minutes" | "every_hours" | "daily" | "weekly" | "monthly";
export type AutomationEveryUnit = "minutes" | "hours";
export type SendOptions = {
  text?: string;
  imageDataUrl?: string;
  imagePath?: string;
  sourceLabel?: string;
  skipLocalIntent?: boolean;
  silentUser?: boolean;
  autoApproveActions?: boolean;
};

export type AppSettings = {
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

export type PersonalityPreset = {
  id: string;
  name: string;
  prompt: string;
  avatar?: string;
  voice_path?: string;
};

export type UserProfilePreset = {
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

export type CharacterSettings = {
  voice_path: string;
  avatar: string;
  prompt: string;
  greeting: string;
  notes: string;
};

export type CharacterFiles = {
  id: string;
  name: string;
  folder: string;
  soul: string;
  settings: CharacterSettings;
};

export const syncSoulCoreIdentity = (soul: string, name: string, prompt: string) => {
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

export type BrainMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

const MAX_BRAIN_HISTORY_MESSAGES = 18;

export const DEFAULT_SETTINGS: AppSettings = {
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
  memory_size: 32768,
  reply_length: 4096,
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

export type SetupTier = "light" | "balanced" | "high";
export type SetupPartKey = "brain" | "voice" | "image";

export type SetupPart = {
  key: SetupPartKey;
  title: string;
  icon: "brain" | "voice" | "image";
  purpose: string;
  light: string;
  balanced: string;
  high: string;
  note: string;
};

export type SetupFile = {
  label: string;
  url: string;
  destination: string;
  size_hint: string;
  extract_to?: string | null;
};

export type SetupPartCatalog = {
  key: SetupPartKey;
  title: string;
  files: SetupFile[];
  installed: boolean;
};

export type SetupCatalog = {
  tier: SetupTier;
  parts: SetupPartCatalog[];
  brain_model_folder: string;
  selected_brain_model_path: string;
};

export type SetupInstallResult = {
  success: boolean;
  message: string;
  catalog: SetupCatalog;
};

export type SetupInstallProgress = {
  stage: string;
  part_key: SetupPartKey | "";
  label: string;
  file_index: number;
  file_count: number;
  percent: number;
  message: string;
};

export type SetupPreflightCheck = {
  key: string;
  label: string;
  status: "ok" | "attention" | string;
  message: string;
};

export type SetupPreflightReport = {
  checks: SetupPreflightCheck[];
  ready: boolean;
};

export const SETUP_PARTS: SetupPart[] = [
  {
    key: "brain",
    title: "Brain",
    icon: "brain",
    purpose: "Main chat, reasoning, memory, and tool use.",
    light: "Gemma 4 E2B Hauhau Q4",
    balanced: "Gemma 4 E4B Hauhau Q4",
    high: "Gemma 4 E4B Hauhau Q8",
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

export const setupTierFromSystem = (info: SystemInfo | null): SetupTier => {
  if (!info) return "balanced";
  if (info.total_ram_mb >= 60000 && info.total_vram_mb >= 12000) return "high";
  if (info.total_ram_mb >= 30000 && info.total_vram_mb >= 8000) return "balanced";
  return "light";
};

export const setupTierLabel = (tier: SetupTier) => {
  if (tier === "high") return "High";
  if (tier === "balanced") return "Balanced";
  return "Light";
};

export const setupTierDescription = (tier: SetupTier) => {
  if (tier === "high") return "Best for larger context, smoother voice, and heavier image work.";
  if (tier === "balanced") return "Best default for local chat, voice, and 1024px image generation.";
  return "Best for lighter PCs. Chat comes first and other models swap when needed.";
};

export const setupPartModel = (part: SetupPart, tier: SetupTier) => {
  if (tier === "high") return part.high;
  if (tier === "balanced") return part.balanced;
  return part.light;
};

export const setupPartIntro = (part: SetupPart) => {
  if (part.key === "brain") return "The part that thinks and chats.";
  if (part.key === "voice") return "The part that lets characters speak.";
  return "The part that paints and edits images.";
};

export const setupTotalSizeLabel = (catalog: SetupCatalog | null) => {
  if (!catalog) return "Checking download size...";
  const labels = catalog.parts.flatMap((part) => part.files.map((file) => file.size_hint));
  if (!labels.length) return "Download size will be shown before install.";
  return `Downloads: ${labels.join(" + ")}`;
};

const setupSizeHintToMb = (label: string) => {
  const match = label.match(/([\d.]+)\s*(gb|mb)/i);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  return match[2].toLowerCase() === "gb" ? value * 1024 : value;
};

const setupMbLabel = (mb: number) => {
  if (mb <= 0) return "size pending";
  if (mb >= 1024) return `about ${(mb / 1024).toFixed(1)} GB`;
  return `about ${Math.round(mb)} MB`;
};

export const setupFilesSizeLabel = (files: SetupFile[] | undefined, fallback = "Size pending") => {
  if (!files?.length) return fallback;
  const mb = files.reduce((sum, file) => sum + setupSizeHintToMb(file.size_hint), 0);
  return `Estimated size: ${setupMbLabel(mb)}`;
};

export const setupDownloadSizeSummary = (catalog: SetupCatalog | null) => {
  if (!catalog) {
    return {
      total: "Checking download size...",
      parts: [] as Array<{ title: string; size: string }>,
    };
  }
  const parts = catalog.parts.map((part) => {
    const mb = part.files.reduce((sum, file) => sum + setupSizeHintToMb(file.size_hint), 0);
    return {
      title: part.title,
      size: setupMbLabel(mb),
    };
  });
  const totalMb = parts.reduce((sum, part) => sum + setupSizeHintToMb(part.size), 0);
  return {
    total: totalMb > 0 ? `Total size: ${setupMbLabel(totalMb).replace(/^about\s+/i, "~")}` : "All selected parts are ready.",
    parts,
  };
};


export const createMessageId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const SPEECH_CACHE_LIMIT = 12;
const SHELL_TOOL_PATTERN = /<galaxy_shell>\s*([\s\S]*?)\s*<\/galaxy_shell>/i;
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
        return part;
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

const TOOL_AGENT_HISTORY_MESSAGES = 14;
const TOOL_AGENT_LATEST_TEXT_LIMIT = 6000;
const TOOL_AGENT_USER_TEXT_LIMIT = 2400;
const TOOL_AGENT_ASSISTANT_TEXT_LIMIT = 1600;

export const truncateForToolAgent = (text: string, limit: number) => {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}\n[message truncated]`;
};

export const compactToolAgentContent = (
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

export const buildToolAgentMessages = (chatMessages: ChatMessage[]): BrainMessage[] => {
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

export const normalizeIntentText = (value: string) =>
  value.toLowerCase();

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

export const toLocalDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const monthTitle = (date: Date) =>
  new Intl.DateTimeFormat(undefined, { month: "short" }).format(date).toUpperCase();

export const getLunarLabel = (date: Date) => {
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

export const buildMonthDays = (monthDate: Date) => {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
};

export const googleEventMatchesDate = (event: GoogleCalendarEvent, dateKey: string) =>
  event.start.slice(0, 10) === dateKey || event.end.slice(0, 10) === dateKey;

export const googleEventTimeLabel = (event: GoogleCalendarEvent | null, withDate = false) => {
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

export const buildGoogleMonthRange = (monthDate: Date) => {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1, 0, 0, 0, 0);
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1, 0, 0, 0, 0);
  return { timeMin: first.toISOString(), timeMax: last.toISOString() };
};

export const normalizeCalendarEventForDisplay = (event: GoogleCalendarEvent): GoogleCalendarEvent => {
  if (event.all_day) {
    return event;
  }
  const start = event.start && !/[zZ]|[+-]\d{2}:\d{2}$/.test(event.start) ? `${event.start}Z` : event.start;
  const end = event.end && !/[zZ]|[+-]\d{2}:\d{2}$/.test(event.end) ? `${event.end}Z` : event.end;
  return { ...event, start, end };
};

export const buildAutomationSchedule = (
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

export const automationRepeatLabel = (repeat: string) => {
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

export const automationScheduleLabel = (value: string, selectedDate: string) => {
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

export const parseAutomationSchedule = (schedule: string, fallbackDate: string) => {
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

export const compactAutomationSummary = (name: string, schedule: string, prompt: string, fallbackDate: string) => {
  const scheduleText = automationScheduleLabel(schedule, fallbackDate);
  const task = prompt.trim().replace(/\s+/g, " ");
  return [name.trim(), scheduleText, task].filter(Boolean).join(" - ");
};

export const parseTimeParts = (time = "") => {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return { hours: 0, minutes: 0 };
  return { hours: Number(match[1]), minutes: Number(match[2]) };
};

export const automationIntervalMinutes = (repeat: string) => {
  const everyMatch = /^@every:(\d+)(m|h)$/.exec(repeat);
  if (everyMatch) return Number(everyMatch[1]) * (everyMatch[2] === "h" ? 60 : 1);
  if (repeat === "@5m") return 5;
  if (repeat === "@15m") return 15;
  if (repeat === "@30m") return 30;
  if (repeat === "@hourly") return 60;
  return 0;
};

export const getAutomationDueAt = (job: AutomationJob, now: Date) => {
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
