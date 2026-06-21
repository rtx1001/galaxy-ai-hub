import { TelegramGuest } from "../appCore";
import { ChevronDownIcon, CloseIcon, PlusIcon, TrashIcon } from "./Icons";
import { IconButton } from "./UI";

export function TelegramSection({
  open,
  running,
  botToken,
  ownerName,
  ownerId,
  status,
  guests,
  guestDraft,
  onToggle,
  onBotTokenChange,
  onOwnerIdChange,
  onGuestDraftChange,
  onSaveGuest,
  onRemoveGuest,
  onTest,
  onStartStop,
}: {
  open: boolean;
  running: boolean;
  botToken: string;
  ownerName: string;
  ownerId: string;
  status: string;
  guests: TelegramGuest[];
  guestDraft: TelegramGuest | null;
  onToggle: (open: boolean) => void;
  onBotTokenChange: (value: string) => void;
  onOwnerIdChange: (value: string) => void;
  onGuestDraftChange: (draft: TelegramGuest | null) => void;
  onSaveGuest: () => void;
  onRemoveGuest: (id: string) => void;
  onTest: () => void;
  onStartStop: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm">
      <details open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
        <summary className="grid h-12 cursor-pointer list-none grid-cols-[minmax(0,1fr)_86px_16px] items-center gap-1 px-3 [&::-webkit-details-marker]:hidden">
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Telegram</div>
          <div className="flex min-w-0 items-center justify-start gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#c4c7c5]">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${running ? "bg-[#79d06f]" : "bg-[#3a3b3d]"}`} />
            <span className="min-w-0 truncate">{running ? "Online" : "Offline"}</span>
          </div>
          <ChevronDownIcon className="details-chevron h-4 w-4 shrink-0 text-[#c4c7c5]" />
        </summary>
        <div className="space-y-2.5 border-t border-[#282a2c] px-3 py-3">
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                value={botToken}
                onChange={(event) => onBotTokenChange(event.target.value)}
                className="min-w-0 flex-1 rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-2.5 text-sm text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]"
                placeholder="Paste Telegram bot token"
                type="password"
              />
              <button
                type="button"
                onClick={onTest}
                className="rounded-2xl border border-[#282a2c] bg-[#1e1f20] px-3 py-2.5 text-sm font-semibold text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]"
              >
                Test
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="max-w-[92px] shrink-0 truncate px-1 text-sm font-bold" style={{ color: "var(--accent-color)" }}>
                {ownerName || "Owner"}
              </span>
              <input
                value={ownerId}
                onChange={(event) => onOwnerIdChange(event.target.value)}
                className="min-w-0 flex-1 rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-2.5 text-sm text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]"
                placeholder="Owner Telegram ID"
              />
            </div>
          </div>
          <div className="rounded-2xl bg-[#131314] p-2 ring-1 ring-[#282a2c]">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#c4c7c5]">
                {guests.length ? `${guests.length} guests` : "Guests"}
              </div>
              <IconButton title="Add guest" size="sm" onClick={() => onGuestDraftChange(guestDraft ?? { id: "", name: "" })}>
                <PlusIcon className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="panel-scroll max-h-[172px] space-y-1.5 overflow-y-auto">
              {guestDraft && (
                <div className="rounded-xl bg-[#1e1f20] p-2 ring-1 ring-[#282a2c]">
                  <input
                    value={guestDraft.name}
                    onChange={(event) => onGuestDraftChange({ ...guestDraft, name: event.target.value })}
                    className="mb-1.5 w-full rounded-xl border border-[#282a2c] bg-[#0f1011] px-2 py-1.5 text-xs text-[#e3e3e3] outline-none focus:border-[var(--accent-color)]"
                    placeholder="Guest name"
                  />
                  <div className="flex gap-1.5">
                    <input
                      value={guestDraft.id}
                      onChange={(event) => onGuestDraftChange({ ...guestDraft, id: event.target.value })}
                      className="min-w-0 flex-1 rounded-xl border border-[#282a2c] bg-[#0f1011] px-2 py-1.5 text-xs text-[#e3e3e3] outline-none focus:border-[var(--accent-color)]"
                      placeholder="Telegram ID"
                    />
                    <IconButton title="Save guest" size="sm" onClick={onSaveGuest}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
                        <path d="M17 21v-8H7v8" />
                        <path d="M7 3v5h8" />
                      </svg>
                    </IconButton>
                    <IconButton title="Cancel" size="sm" onClick={() => onGuestDraftChange(null)}>
                      <CloseIcon className="h-4 w-4" />
                    </IconButton>
                  </div>
                </div>
              )}
              {guests.length === 0 && !guestDraft ? (
                <div className="rounded-xl border border-dashed border-[#3a3b3d] px-3 py-2 text-xs leading-5 text-[#9aa0a6]">
                  Group taggers are added here automatically. Guests can chat only.
                </div>
              ) : (
                guests.map((guest) => (
                  <div key={guest.id} className="flex min-h-[52px] items-center justify-between gap-2 rounded-xl bg-[#1e1f20] px-2.5 py-2 ring-1 ring-[#282a2c]">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-[#e3e3e3]">{guest.name || guest.id}</div>
                      <div className="mt-0.5 truncate text-[10px] text-[#9aa0a6]">{guest.id}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveGuest(guest.id)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#9aa0a6] transition hover:bg-rose-500/10 hover:text-rose-300"
                      title="Remove guest"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onStartStop}
            className={`w-full rounded-2xl px-3 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${running ? "border border-[#282a2c] bg-[#131314] text-[#e3e3e3] hover:bg-[#282a2c]" : "text-[#131314]"}`}
            style={!running ? { backgroundColor: "var(--accent-color)" } : undefined}
            disabled={!running && !botToken.trim()}
          >
            {running ? "Stop" : "Start"}
          </button>
          {status && <div className="text-xs text-[#c4c7c5]">{status}</div>}
        </div>
      </details>
    </section>
  );
}
