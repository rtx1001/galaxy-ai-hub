import { SystemInfo } from './models';

export type SetupTier = "light" | "balanced" | "high";
export type SetupPartKey = "brain" | "voice" | "voice_helper" | "image";

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
    light: "Z-Image Turbo Q4 at 512px",
    balanced: "Z-Image Turbo Q6 at 1024px",
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
