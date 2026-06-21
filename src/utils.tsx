import { ToolResultItem, ToolResultField } from "./types";
import { convertFileSrc } from "@tauri-apps/api/core";

export const INLINE_PATTERN = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<>()]+|www\.[^\s<>()]+|`[^`]+`|\*\*[^*]+\*\*|#[0-9a-f]{6}\b)/gi;

export const formatBytes = (bytes: number) => {
      if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
      const units = ["B", "KB", "MB", "GB", "TB"];
      const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
      const value = bytes / 1024 ** exponent;
      return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
    };
export const cleanDisplayPath = (value: string) =>
      value
        .split("\\\\?\\UNC\\").join("\\\\")
        .split("\\\\?\\").join("");

export const localAssetUrl = (path?: string | null) => {
  const value = path?.trim();
  if (!value) return "";
  try {
    return convertFileSrc(value);
  } catch {
    return "";
  }
};

export const MEDIA_VOLUME_STORAGE_KEY = "galaxy_media_volume";
export const MEDIA_VOLUME_EVENT = "galaxy-media-volume-change";

export const clampMediaVolume = (value: number) =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));

export const loadMediaVolume = () => {
  try {
    const stored = localStorage.getItem(MEDIA_VOLUME_STORAGE_KEY);
    if (!stored) return 1;
    return clampMediaVolume(Number(stored));
  } catch {
    return 1;
  }
};

export const saveMediaVolume = (value: number) => {
  const nextVolume = clampMediaVolume(value);
  try {
    localStorage.setItem(MEDIA_VOLUME_STORAGE_KEY, String(nextVolume));
    window.dispatchEvent(new CustomEvent(MEDIA_VOLUME_EVENT, { detail: { volume: nextVolume } }));
  } catch {
    // localStorage can be unavailable in restricted environments.
  }
  return nextVolume;
};
export const renderInlineText = (text: string, keyPrefix: string) => {
      const displayText = cleanDisplayPath(text);
      const parts = displayText.split(INLINE_PATTERN);
      return parts.map((part, index) => {
        const markdownLink = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/i);
        if (markdownLink) {
          return (
            <a
              key={`${keyPrefix}-md-link-${index}`}
              href={markdownLink[2]}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent-color)] underline decoration-[var(--accent-soft-strong)] underline-offset-4 hover:decoration-[var(--accent-color)]"
            >
              {markdownLink[1]}
            </a>
          );
        }
        if (/^(https?:\/\/|www\.)/i.test(part)) {
          const href = part.startsWith("www.") ? `https://${part}` : part;
          return (
            <a
              key={`${keyPrefix}-link-${index}`}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="break-all text-[var(--accent-color)] underline decoration-[var(--accent-soft-strong)] underline-offset-4 hover:decoration-[var(--accent-color)]"
            >
              {part}
            </a>
          );
        }
        if (/^`[^`]+`$/.test(part)) {
      return (
        <code key={`${keyPrefix}-code-${index}`} className="rounded-md bg-[#0f1011] px-1.5 py-0.5 text-[0.92em] text-[#dfe3ea] ring-1 ring-[#282a2c]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^#[0-9a-f]{6}$/i.test(part)) {
      return (
        <span key={`${keyPrefix}-color-${index}`} className="inline-flex items-center gap-1.5 align-middle">
          <span className="h-3.5 w-3.5 rounded-full ring-1 ring-white/20" style={{ backgroundColor: part }} />
          <code className="rounded-md bg-[#0f1011] px-1.5 py-0.5 text-[0.92em] text-[#dfe3ea] ring-1 ring-[#282a2c]">{part}</code>
        </span>
      );
    }
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return (
        <strong key={`${keyPrefix}-strong-${index}`} className="font-semibold text-[#f8fafd]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={`${keyPrefix}-text-${index}`}>{part}</span>;
  });
};

export const toolCardStyle = (kind: string) => {
      if (kind === "gmail") return { label: "Gmail", dot: "bg-[#8ab4f8]", ring: "ring-[#8ab4f8]/20" };
      if (kind === "calendar") return { label: "Calendar", dot: "bg-[#81c995]", ring: "ring-[#81c995]/20" };
      if (kind === "web_search") return { label: "Web", dot: "bg-[#fdd663]", ring: "ring-[#fdd663]/20" };
      if (kind === "file_search" || kind === "folder" || kind === "file_content") {
        return { label: "Files", dot: "bg-[#c58af9]", ring: "ring-[#c58af9]/20" };
      }
      if (kind === "media") return { label: "Media", dot: "bg-[#ff8a80]", ring: "ring-[#ff8a80]/20" };
      if (kind === "time") return { label: "Time", dot: "bg-[var(--accent-color)]", ring: "ring-[var(--accent-soft)]" };
      if (kind === "error") return { label: "Error", dot: "bg-[#ff6b7a]", ring: "ring-[#ff6b7a]/20" };
      if (kind === "approval_required" || kind === "image_proposal") {
        return { label: "Approval", dot: "bg-[#fdd663]", ring: "ring-[#fdd663]/20" };
      }
      return { label: kind.replace(/_/g, " "), dot: "bg-[var(--accent-color)]", ring: "ring-[var(--accent-soft)]" };
    };
export const fieldValue = (item: ToolResultItem, label: string) =>
      item.details.find((field) => field.label.toLowerCase() === label.toLowerCase())?.value ?? "";
export const compactDetailsForKind = (kind: string, item: ToolResultItem) => {
      const preferred =
        kind === "gmail"
          ? ["Date", "From", "Preview"]
          : kind === "calendar"
            ? ["Start", "End", "Location", "Details"]
            : kind === "web_search"
              ? ["Source"]
              : kind === "file_search" || kind === "media" || kind === "folder"
                ? ["Type", "Size", "Path", "Folder"]
                : [];
      const selected = preferred
        .map((label) => item.details.find((field) => field.label === label))
        .filter(Boolean) as ToolResultField[];
      return selected.length ? selected : item.details.slice(0, 5);
    };
export const clampNumber = (value: number, min: number, max: number) =>
      Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export const getVietnameseLunarDate = (date: Date) => {
  try {
    const formatter = new Intl.DateTimeFormat('vi-VN-u-ca-chinese', {
      day: 'numeric',
      month: 'numeric',
    });
    const parts = formatter.formatToParts(date);
    const day = parts.find(p => p.type === 'day')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    return `\u00c2m l\u1ecbch: ${day}/${month}`;
  } catch (e) {
    return "";
  }
};

export const pauseOtherMediaElements = (current: HTMLMediaElement) => {
  document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => {
    if (media !== current && !media.paused) {
      media.pause();
    }
  });
};
