import { ChevronDownIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon } from "./Icons";
import type { MediaPlayerStatus } from "../appCore";

export function MediaPlayerSection({
  open,
  status,
  onToggle,
  onPlay,
  onPause,
  onNext,
  onPrevious,
}: {
  open: boolean;
  status: MediaPlayerStatus;
  busy: boolean;
  onToggle: (open: boolean) => void;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const online = status.app_open || status.playing;
  const label = status.active_app || (online ? "Active" : "Ready");
  const controlButtonFocusClass = "focus:outline-none focus-visible:outline-none focus-visible:ring-0";

  return (
    <section className="overflow-hidden rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm">
      <details open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
        <summary className="grid h-12 cursor-pointer list-none grid-cols-[minmax(0,1fr)_86px_16px] items-center gap-1 px-3 [&::-webkit-details-marker]:hidden">
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Media Player</div>
          <div className="flex min-w-0 items-center justify-start gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#c4c7c5]">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${online ? "bg-[#79d06f]" : "bg-[#3a3b3d]"}`} />
            <span className="min-w-0 truncate">{label.toUpperCase()}</span>
          </div>
          <ChevronDownIcon className="details-chevron h-4 w-4 shrink-0 text-[#c4c7c5]" />
        </summary>

        <div className="border-t border-[#282a2c] px-3 py-3">
          <div className="flex items-center justify-center gap-2 rounded-full border border-[var(--accent-soft-strong)] bg-[var(--accent-soft)] px-2 py-1.5">
            <button type="button" onClick={onPrevious} className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-[#d7e6ff] transition hover:bg-white/10 ${controlButtonFocusClass}`}>
              <PreviousIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={status.playing ? onPause : onPlay}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#d7e6ff] text-[#131314] transition hover:brightness-110 ${controlButtonFocusClass}`}
            >
              {status.playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4 translate-x-px" />}
            </button>
            <button type="button" onClick={onNext} className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-[#d7e6ff] transition hover:bg-white/10 ${controlButtonFocusClass}`}>
              <NextIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
