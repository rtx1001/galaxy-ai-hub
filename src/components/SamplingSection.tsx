import { ChevronDownIcon, RefreshIcon } from "./Icons";
import { SliderField } from "./UI";

export function SamplingSection({
  open,
  temperature,
  topK,
  topP,
  minP,
  repeatLastN,
  repeatPenalty,
  onToggle,
  onReset,
  onTemperatureChange,
  onTopKChange,
  onTopPChange,
  onMinPChange,
  onRepeatLastNChange,
  onRepeatPenaltyChange,
}: {
  open: boolean;
  temperature: number;
  topK: number;
  topP: number;
  minP: number;
  repeatLastN: number;
  repeatPenalty: number;
  onToggle: (open: boolean) => void;
  onReset: () => void;
  onTemperatureChange: (value: number) => void;
  onTopKChange: (value: number) => void;
  onTopPChange: (value: number) => void;
  onMinPChange: (value: number) => void;
  onRepeatLastNChange: (value: number) => void;
  onRepeatPenaltyChange: (value: number) => void;
}) {
  return (
    <details
      className="overflow-hidden rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
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
              onReset();
            }}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#282a2c] bg-[#1e1f20] text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
          >
            <RefreshIcon className="h-4 w-4" />
          </button>
          <ChevronDownIcon className="details-chevron h-4 w-4 shrink-0 text-[#c4c7c5]" />
        </div>
      </summary>
      <div className="space-y-4 border-t border-[#282a2c] px-3 py-3">
        <SliderField label="Temperature" value={temperature} min={0} max={2} step={0.1} onChange={onTemperatureChange} helper="Lower is steadier. Higher is more random." />
        <SliderField label="Top K" value={topK} min={0} max={200} step={1} onChange={onTopKChange} helper="Limits choices to the top tokens. 0 disables it." />
        <SliderField label="Top P" value={topP} min={0} max={1} step={0.05} onChange={onTopPChange} helper="Keeps the most likely token group. 1 disables it." />
        <SliderField label="Min P" value={minP} min={0} max={1} step={0.05} onChange={onMinPChange} helper="Drops very unlikely tokens. 0 disables it." />
        <SliderField label="Repeat Last N" value={repeatLastN} min={-1} max={4096} step={1} onChange={onRepeatLastNChange} helper="How much recent text repeat penalty checks. -1 means full context." />
        <SliderField label="Repeat Penalty" value={repeatPenalty} min={0.8} max={2} step={0.05} onChange={onRepeatPenaltyChange} helper="Higher discourages repeated wording. 1 disables it." />
      </div>
    </details>
  );
}
