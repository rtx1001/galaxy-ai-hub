import { ChevronDownIcon, CloseIcon, PlusIcon } from "./Icons";

export function WorkspaceSection({
  open,
  linkedFolders,
  onToggle,
  onAdd,
  onRemove,
}: {
  open: boolean;
  linkedFolders: string[];
  onToggle: (open: boolean) => void;
  onAdd: () => void;
  onRemove: (folder: string) => void;
}) {
  return (
    <details
      className="overflow-hidden rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className="grid h-12 cursor-pointer list-none grid-cols-[minmax(0,1fr)_86px_16px] items-center gap-1 px-3 [&::-webkit-details-marker]:hidden">
        <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Workspace</div>
        <div className="flex min-w-0 items-center justify-start gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9aa0a6]">
          <span>
            <span className="font-bold text-[#e3e3e3]">{linkedFolders.length}</span>{" "}
            <span>linked</span>
          </span>
        </div>
        <ChevronDownIcon className="details-chevron h-4 w-4 shrink-0 text-[#c4c7c5]" />
      </summary>
      <div className="space-y-2.5 border-t border-[#282a2c] px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-[#9aa0a6]">Manage the workspace folders the assistant can use.</div>
          <button
            type="button"
            title="Add workspace folder"
            onClick={onAdd}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#282a2c] bg-[#1e1f20] text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]"
          >
            <PlusIcon className="h-4.5 w-4.5" />
          </button>
        </div>
        {linkedFolders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#3a3b3d] bg-[#131314] px-4 py-4 text-sm text-[#c4c7c5]">
            No workspace folder selected.
          </div>
        ) : (
          linkedFolders.map((folder) => (
            <div key={folder} className="flex items-center gap-2 rounded-2xl border border-[#282a2c] bg-[#131314] px-3 py-2">
              <div className="min-w-0 flex-1 truncate text-sm text-[#e3e3e3]" title={folder}>{folder}</div>
              <button
                type="button"
                title="Remove workspace folder"
                onClick={() => onRemove(folder)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#282a2c] bg-rose-500/15 text-rose-200 transition hover:bg-rose-500/25"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </details>
  );
}
