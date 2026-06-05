import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ChevronDownIcon, CloseIcon, PlusIcon } from "./Icons";
import { ImageModeDropdown, normalizeImageMode } from "./ImageModeDropdown";
import { NumberStepper } from "./UI";
import { clampNumber } from "../utils";

type StudioReference = {
  id: string;
  label: string;
  src: string;
};

type LocalImageDataUrl = {
  data_url: string;
  path: string;
};

const imageReferencesForMode = ({
  mode,
  assistantAvatar,
  userAvatar,
}: {
  mode: string;
  assistantAvatar?: string;
  userAvatar?: string;
}) => {
  const normalizedMode = normalizeImageMode(mode);
  const refs: StudioReference[] = [];
  if (normalizedMode === "bot_image" && assistantAvatar) {
    refs.push({ id: "bot", label: "Bot avatar", src: assistantAvatar });
  } else if (normalizedMode === "user_image" && userAvatar) {
    refs.push({ id: "user", label: "User avatar", src: userAvatar });
  } else if (normalizedMode === "user_bot_image") {
    if (userAvatar) refs.push({ id: "user", label: "User avatar", src: userAvatar });
    if (assistantAvatar) refs.push({ id: "bot", label: "Bot avatar", src: assistantAvatar });
  }
  return refs;
};

export function ImageStudioSection({
  open,
  drawing,
  quickPrompt,
  quickMode,
  assistantAvatar,
  userAvatar,
  imageWidth,
  imageHeight,
  isGeneratingImage,
  onToggle,
  onQuickPromptChange,
  onQuickModeChange,
  onGenerate,
  onImageWidthChange,
  onImageHeightChange,
}: {
  open: boolean;
  drawing: boolean;
  quickPrompt: string;
  quickMode: string;
  assistantAvatar?: string;
  userAvatar?: string;
  imageWidth: number;
  imageHeight: number;
  isGeneratingImage: boolean;
  onToggle: (open: boolean) => void;
  onQuickPromptChange: (value: string) => void;
  onQuickModeChange: (value: string) => void;
  onGenerate: (extraReferenceImages?: string[]) => void;
  onImageWidthChange: (value: number) => void;
  onImageHeightChange: (value: number) => void;
}) {
  const [inputImageRefs, setInputImageRefs] = useState<StudioReference[]>([]);
  const normalizedMode = normalizeImageMode(quickMode);
  const references = imageReferencesForMode({
    mode: quickMode,
    assistantAvatar,
    userAvatar,
  });
  useEffect(() => {
    if (normalizeImageMode(quickMode) !== "image_image") {
      setInputImageRefs([]);
    }
  }, [quickMode]);
  const addInputImages = async () => {
    const remaining = Math.max(0, 4 - inputImageRefs.length);
    if (!remaining) return;
    const selected = await openDialog({
      directory: false,
      multiple: true,
      title: "Choose input image",
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] },
      ],
    });
    const paths = (Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : []).slice(0, remaining);
    if (!paths.length) return;
    const loaded: StudioReference[] = [];
    for (const path of paths) {
      try {
        const result = await invoke<LocalImageDataUrl>("read_local_image_data_url", { path });
        loaded.push({
          id: `${result.path}-${Date.now()}-${loaded.length}`,
          label: result.path.split(/[\\/]/).pop() || "Input image",
          src: result.data_url,
        });
      } catch (error) {
        console.error("Image Studio input load error:", error);
      }
    }
    if (loaded.length) {
      setInputImageRefs((prev) => [...prev, ...loaded].slice(0, 4));
    }
  };
  const needsInputImage = normalizedMode === "image_image";
  const generateDisabled =
    !quickPrompt.trim() ||
    isGeneratingImage ||
    (needsInputImage && inputImageRefs.length === 0);
  return (
    <details
      className="rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className="grid h-12 cursor-pointer list-none grid-cols-[minmax(0,1fr)_86px_16px] items-center gap-1 px-3 [&::-webkit-details-marker]:hidden">
        <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Image Studio</div>
        <div className={`flex min-w-0 items-center justify-start gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${drawing ? "text-[var(--accent-color)]" : "text-[#c4c7c5]"}`}>
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${drawing ? "animate-pulse bg-[var(--accent-color)] shadow-[0_0_10px_var(--accent-color)]" : "bg-[#79d06f]"}`}
          />
          <span className="min-w-0 truncate">{drawing ? "Drawing" : "Ready"}</span>
        </div>
        <ChevronDownIcon className="details-chevron h-4 w-4 shrink-0 text-[#c4c7c5]" />
      </summary>
      <div className="space-y-3 border-t border-[#282a2c] px-4 py-3">
        <label className="block">
          <span className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#c4c7c5]">Prompt</span>
            <ImageModeDropdown
              value={quickMode}
              onChange={onQuickModeChange}
              minWidthClass="min-w-[142px]"
              className="shrink-0"
            />
          </span>
          <textarea
            value={quickPrompt}
            onChange={(event) => onQuickPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                onGenerate();
              }
            }}
            rows={3}
            placeholder="Describe an image..."
            className="w-full resize-none rounded-2xl border border-[#282a2c] bg-[#131314] px-3 py-2 text-sm leading-relaxed text-[#e3e3e3] outline-none transition placeholder:text-[#9aa0a6] focus:border-[var(--accent-color)]"
          />
        </label>
        {normalizeImageMode(quickMode) !== "text_image" && (
          <div className="flex min-h-8 items-center gap-1.5">
            {(normalizedMode === "image_image" ? inputImageRefs : references).map((ref) => (
              <span
                key={ref.id}
                className="group/ref relative inline-flex h-8 w-8 shrink-0 overflow-hidden rounded-full border border-[var(--accent-soft-strong)] bg-[#0f1011] p-0.5 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              >
                <img src={ref.src} alt="" className="h-full w-full rounded-full object-cover" />
                {normalizedMode === "image_image" && (
                  <button
                    type="button"
                    aria-label={`Remove ${ref.label}`}
                    title={`Remove ${ref.label}`}
                    onClick={() => setInputImageRefs((prev) => prev.filter((item) => item.id !== ref.id))}
                    className="absolute inset-0 flex items-center justify-center rounded-full bg-black/70 text-white opacity-0 backdrop-blur-[1px] transition hover:bg-rose-500/85 group-hover/ref:opacity-100"
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            ))}
            {normalizedMode === "image_image" && inputImageRefs.length < 4 && (
              <button
                type="button"
                onClick={addInputImages}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#282a2c] bg-[#0f1011] text-[#c4c7c5] transition hover:border-[var(--accent-soft-strong)] hover:text-[var(--accent-color)]"
                title="Add input image"
              >
                <PlusIcon className="h-3.5 w-3.5" />
              </button>
            )}
            {normalizedMode === "image_image" && !inputImageRefs.length && (
              <span className="rounded-full border border-[#282a2c] bg-[#131314] px-3 py-1.5 text-[11px] font-semibold text-[#9aa0a6]">
                Input image needed
              </span>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => onGenerate(inputImageRefs.map((ref) => ref.src))}
          disabled={generateDisabled}
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
              onChange={(value) => onImageWidthChange(clampNumber(value, 256, 2048))}
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
              onChange={(value) => onImageHeightChange(clampNumber(value, 256, 2048))}
              className="w-full min-w-[112px]"
            />
          </label>
        </div>
      </div>
    </details>
  );
}
