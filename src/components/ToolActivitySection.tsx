import { ToolRunRecord, formatToolDuration, formatToolRunTime, toolRunBrief, toolRunDisplayName } from "../appCore";
import { ChevronDownIcon, EraserIcon } from "./Icons";
import { IconButton } from "./UI";

export function ToolActivitySection({
  open,
  toolRuns,
  onToggle,
  onClear,
}: {
  open: boolean;
  toolRuns: ToolRunRecord[];
  onToggle: (open: boolean) => void;
  onClear: () => void;
}) {
  return (
    <details
      className="overflow-hidden rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className="grid h-12 cursor-pointer list-none grid-cols-[minmax(0,1fr)_16px] items-center gap-2 px-3 [&::-webkit-details-marker]:hidden">
        <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Tool Activity</div>
        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[#c4c7c5] transition ${open ? "rotate-180" : ""}`} />
      </summary>
      <div className="border-t border-[#282a2c] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#c4c7c5]">
            {toolRuns.length ? `${Math.min(toolRuns.length, 10)} recent calls` : "No calls yet"}
          </div>
          <IconButton title="Clear recent calls" onClick={onClear} size="sm" disabled={!toolRuns.length}>
            <EraserIcon className="h-4 w-4" />
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
}
