import { AutomationJob, automationScheduleLabel } from "../appCore";
import { ChevronDownIcon, EditIcon, PlusIcon, TrashIcon } from "./Icons";

export function AutomationSection({
  open,
  activeCount,
  jobs,
  recentJobs,
  selectedDate,
  onToggle,
  onAdd,
  onEdit,
  onToggleJob,
  onDelete,
}: {
  open: boolean;
  activeCount: number;
  jobs: AutomationJob[];
  recentJobs: AutomationJob[];
  selectedDate: string;
  onToggle: (open: boolean) => void;
  onAdd: () => void;
  onEdit: (job: AutomationJob) => void;
  onToggleJob: (job: AutomationJob) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <details
      className="overflow-hidden rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className="grid h-12 cursor-pointer list-none grid-cols-[minmax(0,1fr)_86px_16px] items-center gap-1 px-3 [&::-webkit-details-marker]:hidden">
        <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Automation</div>
        <div className="flex min-w-0 items-center justify-start gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#c4c7c5]">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${activeCount ? "bg-[#79d06f]" : "bg-[#3a3b3d]"}`} />
          <span className="min-w-0 truncate">{activeCount ? `${activeCount} active` : "Idle"}</span>
        </div>
        <ChevronDownIcon className="details-chevron h-4 w-4 shrink-0 text-[#c4c7c5]" />
      </summary>
      <div className="space-y-3 border-t border-[#282a2c] px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[#e3e3e3]">Scheduled tasks</div>
            <div className="mt-0.5 text-xs text-[#9aa0a6]">{jobs.length} saved</div>
          </div>
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#282a2c] bg-[#1e1f20] text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
            title="Add automation"
          >
            <PlusIcon className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="no-scrollbar max-h-[238px] space-y-1.5 overflow-y-auto rounded-2xl bg-[#131314] p-1.5 ring-1 ring-[#282a2c]">
          {recentJobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#3a3b3d] px-4 py-4 text-sm text-[#c4c7c5]">
              No automations yet.
            </div>
          ) : (
            recentJobs.map((job) => {
              const scheduleLabel = automationScheduleLabel(job.schedule, selectedDate);
              return (
                <article key={job.id} className="rounded-xl bg-[#1e1f20] px-2.5 py-2 ring-1 ring-[#282a2c]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${job.enabled ? "bg-[var(--accent-color)] shadow-[0_0_8px_var(--accent-color)]" : "bg-[#73777f]"}`} />
                        <div className="truncate text-sm font-semibold text-[#e3e3e3]">{job.name}</div>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] font-semibold text-[var(--accent-color)]">{scheduleLabel}</div>
                      <div className="mt-0.5 truncate text-[11px] text-[#9aa0a6]">{job.prompt}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 pt-0.5">
                      <button
                        type="button"
                        onClick={() => onToggleJob(job)}
                        className={`h-6 rounded-lg px-1.5 text-[9px] font-bold uppercase tracking-[0.1em] transition ${job.enabled ? "bg-[var(--accent-soft)] text-[var(--accent-color)]" : "bg-[#282a2c] text-[#c4c7c5]"}`}
                        title={job.enabled ? "Pause automation" : "Start automation"}
                      >
                        {job.enabled ? "On" : "Off"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(job)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-[#131314] text-[#c4c7c5] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
                        title="Edit automation"
                      >
                        <EditIcon className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(job.id)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-[#131314] text-rose-200 transition hover:bg-rose-500/25"
                        title="Delete automation"
                      >
                        <TrashIcon className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </details>
  );
}
