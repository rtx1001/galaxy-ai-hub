import { type CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "./Icons";

export const IMAGE_MODE_OPTIONS = [
  { value: "text_image", label: "TEXT_IMAGE", displayName: "text_image" },
  { value: "image_image", label: "IMAGE_IMAGE", displayName: "image_image" },
  { value: "bot_image", label: "BOT_IMAGE", displayName: "bot_image" },
  { value: "user_image", label: "USER_IMAGE", displayName: "user_image" },
  { value: "user_bot_image", label: "USER_BOT_IMAGE", displayName: "user_bot_image" },
];

export const normalizeImageMode = (mode: string) => {
  if (mode === "text_to_image" || mode === "txt2img" || mode === "text2img") return "text_image";
  if (mode === "image_to_image" || mode === "img2img" || mode === "image2image") return "image_image";
  if (mode === "avatar_image" || mode === "avatar_to_image" || mode === "bot_avatar_image") return "bot_image";
  if (mode === "user_avatar_image" || mode === "avatar_user_image") return "user_image";
  if (mode === "user_character_image" || mode === "user_and_character_image" || mode === "both_avatars_image") return "user_bot_image";
  return mode || "text_image";
};

export const imageModeLabel = (mode: string) =>
  IMAGE_MODE_OPTIONS.find((option) => option.value === normalizeImageMode(mode))?.label ?? normalizeImageMode(mode).toUpperCase();

export const imageToolDisplayName = (mode: string) => {
  return normalizeImageMode(mode);
};

export function ImageModeDropdown({
  value,
  onChange,
  className = "",
  minWidthClass = "min-w-[142px]",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  minWidthClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [theme, setTheme] = useState({
    accent: "#f0c531",
    soft: "rgba(240, 197, 49, 0.18)",
    stroke: "rgba(240, 197, 49, 0.32)",
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);
  const normalizedValue = normalizeImageMode(value);
  const selectedLabel = imageModeLabel(normalizedValue);

  useEffect(() => {
    if (!open) return;
    const updateRect = () => {
      const button = buttonRef.current;
      const nextRect = button?.getBoundingClientRect();
      if (nextRect) {
        setRect(nextRect);
      }
      if (button) {
        const styles = window.getComputedStyle(button);
        setTheme({
          accent: styles.getPropertyValue("--accent-color").trim() || "#f0c531",
          soft: styles.getPropertyValue("--accent-soft").trim() || "rgba(240, 197, 49, 0.18)",
          stroke: styles.getPropertyValue("--accent-soft-strong").trim() || "rgba(240, 197, 49, 0.32)",
        });
      }
    };
    updateRect();
    const closeMenu = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        portalRef.current &&
        !portalRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-7 ${minWidthClass} items-center justify-between gap-1.5 rounded-full border px-2.5 text-[9.5px] font-bold uppercase tracking-[0.11em] transition ${
          open
            ? "border-[var(--accent-soft-strong)] bg-[var(--accent-soft)] text-[#f1f3f4]"
            : "border-[#282a2c] bg-[#0f1011] text-[#c4c7c5] hover:border-[var(--accent-soft-strong)]"
        }`}
        title="Choose image generation mode"
      >
        <span className="text-[#9aa0a6]">Mode</span>
        <span className="min-w-0 flex-1 truncate text-left text-[#f1f3f4]">{selectedLabel}</span>
        <ChevronDownIcon className={`h-3 w-3 shrink-0 text-[var(--accent-color)] transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={portalRef}
            className="fixed z-[500] overflow-hidden rounded-2xl border border-[#282a2c] bg-[#131314] p-1 shadow-2xl ring-1 ring-black/40"
            style={
              {
                left: rect.left,
                top: rect.bottom + 6,
                width: rect.width,
                "--accent-color": theme.accent,
                "--accent-soft": theme.soft,
                "--accent-soft-strong": theme.stroke,
              } as CSSProperties
            }
          >
            {IMAGE_MODE_OPTIONS.map((option) => {
              const selected = option.value === normalizedValue;
              const selectedStyle: CSSProperties | undefined = selected
                ? {
                    backgroundColor: theme.soft,
                    color: theme.accent,
                    boxShadow: `inset 0 0 0 1px ${theme.stroke}`,
                  }
                : undefined;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  style={selectedStyle}
                  className={`mb-0.5 flex h-7 w-full items-center rounded-full px-2.5 text-left text-[9.5px] font-bold uppercase tracking-[0.11em] outline-none last:mb-0 transition focus:outline-none ${
                    selected ? "" : "text-[#dfe3ea] hover:bg-[#1e1f20]/80 hover:text-[var(--accent-color)]"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
