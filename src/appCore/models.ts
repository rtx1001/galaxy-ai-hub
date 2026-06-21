import {
  ActionProposal,
  ChatContentPart,
  FilePreviewResult,
  ImageProposal,
  ToolResultCard,
} from '../types';

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
  duration_seconds?: number | null;
  sample_rate_hz?: number | null;
  channels?: number | null;
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

export type MediaTrackInfo = {
  title: string;
  artist: string;
  artwork_url?: string | null;
};

export type MediaPlayerStatus = {
  app_open: boolean;
  connected: boolean;
  playing: boolean;
  account_name?: string | null;
  active_app?: string | null;
  track?: MediaTrackInfo | null;
  message: string;
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
  brainText?: string;
  editMessageId?: string;
  sourceLabel?: string;
  skipLocalIntent?: boolean;
  silentUser?: boolean;
  preInsertedUserMessageId?: string;
  deferUntilAudioIdle?: boolean;
  queueSpeechAfterCurrent?: boolean;
  waitForUserSpeechStart?: boolean;
  waitForUserFinalSpeechChunkStart?: boolean;
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
  user_auto_pilot: boolean;
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
  ui_media_player_open: boolean;
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
  memory: string;
  settings: CharacterSettings;
};

export type SharedProfileKind = "user" | "personality";

export const profileRefId = (kind: SharedProfileKind, id: string) => `${kind}:${id}`;

export const parseProfileRefId = (
  value: string,
  fallbackKind: SharedProfileKind,
): { kind: SharedProfileKind; id: string } => {
  if (value.startsWith("user:")) return { kind: "user", id: value.slice(5) };
  if (value.startsWith("personality:")) return { kind: "personality", id: value.slice(12) };
  return { kind: fallbackKind, id: value };
};

export const userProfileFromPersonality = (preset: PersonalityPreset): UserProfilePreset => ({
  id: profileRefId("personality", preset.id),
  name: preset.name || "You",
  description: preset.prompt || "",
  avatar: preset.avatar || "",
  voice_path: preset.voice_path || "",
  location_label: "",
  latitude: null,
  longitude: null,
  auto_speech: true,
});

export const personalityFromUserProfile = (profile: UserProfilePreset): PersonalityPreset => ({
  id: profileRefId("user", profile.id),
  name: profile.name || "Assistant",
  prompt: profile.description || `Act as ${profile.name || "this profile"} naturally.`,
  avatar: profile.avatar || "",
  voice_path: profile.voice_path || "",
});

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
  user_auto_pilot: false,
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
  ui_media_player_open: false,
  ui_tool_activity_open: false,
  ui_sampling_open: false,
};
