import { ChevronDownIcon } from "./Icons";
import { NumberStepper } from "./UI";
import { clampNumber } from "../utils";

export function ImageStudioSection({
  open,
  drawing,
  quickPrompt,
  imageWidth,
  imageHeight,
  isGeneratingImage,
  onToggle,
  onQuickPromptChange,
  onGenerate,
  onImageWidthChange,
  onImageHeightChange,
}: {
  open: boolean;
  drawing: boolean;
  quickPrompt: string;
  imageWidth: number;
  imageHeight: number;
  isGeneratingImage: boolean;
  onToggle: (open: boolean) => void;
  onQuickPromptChange: (value: string) => void;
  onGenerate: () => void;
  onImageWidthChange: (value: number) => void;
  onImageHeightChange: (value: number) => void;
}) {
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
          <span className="mb-1.5 block text-xs font-semibold text-[#c4c7c5]">Quick prompt</span>
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
        <button
          type="button"
          onClick={onGenerate}
          disabled={!quickPrompt.trim() || isGeneratingImage}
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
