import { GoogleConnectionStatus } from "../appCore";
import { ChevronDownIcon } from "./Icons";

export function GoogleSection({
  open,
  status,
  notice,
  busy,
  clientId,
  clientSecret,
  onToggle,
  onClientIdChange,
  onClientSecretChange,
  onConnectToggle,
  onRefreshCalendar,
}: {
  open: boolean;
  status: GoogleConnectionStatus;
  notice: string;
  busy: boolean;
  clientId: string;
  clientSecret: string;
  onToggle: (open: boolean) => void;
  onClientIdChange: (value: string) => void;
  onClientSecretChange: (value: string) => void;
  onConnectToggle: () => void;
  onRefreshCalendar: () => void;
}) {
  const needsReconnect = !status.connected && Boolean(status.email);
  const connectionLabel = status.connected ? "Online" : "Offline";
  const noticeText = notice || "Connect Google to show Calendar events in the app calendar.";
  const actionLabel = busy
    ? status.connected
      ? "Disconnecting..."
      : needsReconnect
        ? "Reconnecting..."
        : "Connecting..."
    : status.connected
      ? "Disconnect"
      : needsReconnect
        ? "Reconnect"
        : "Connect";

  return (
    <section className="overflow-hidden rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm">
      <details open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
        <summary className="grid h-12 cursor-pointer list-none grid-cols-[minmax(0,1fr)_86px_16px] items-center gap-1 px-3 [&::-webkit-details-marker]:hidden">
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Google</div>
          <div className="flex min-w-0 items-center justify-start gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#c4c7c5]">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${status.connected ? "bg-[#79d06f]" : "bg-[#3a3b3d]"}`} />
            <span className="min-w-0 truncate">{connectionLabel}</span>
          </div>
          <ChevronDownIcon className="details-chevron h-4 w-4 shrink-0 text-[#c4c7c5]" />
        </summary>
        <div className="space-y-3 border-t border-[#282a2c] px-3 py-3">
          <div className="px-1 text-xs leading-5 text-[#c4c7c5]">
            <div className="font-semibold text-[#e3e3e3]">
              {status.connected ? `Connected${status.email ? `: ${status.email}` : ""}` : "Not connected"}
            </div>
            <div className="mt-0.5">{noticeText}</div>
          </div>
          <div className="space-y-2 text-sm text-[#e3e3e3]">
            <input
              value={clientId}
              onChange={(event) => onClientIdChange(event.target.value)}
              className="w-full rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-2.5 text-sm text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]"
              placeholder="Google OAuth Client ID"
            />
            <input
              value={clientSecret}
              onChange={(event) => onClientSecretChange(event.target.value)}
              className="w-full rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-2.5 text-sm text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]"
              placeholder="Google OAuth Client Secret"
              type="password"
            />
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-2.5 text-sm font-semibold text-[var(--accent-color)] transition hover:bg-[#282a2c]"
            >
              Go to Google Cloud Console
            </a>
          </div>
          <button
            type="button"
            onClick={onConnectToggle}
            disabled={busy || (!status.connected && (!clientId.trim() || !clientSecret.trim()))}
            className={`w-full rounded-2xl px-3 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${status.connected ? "border border-[#282a2c] bg-[#131314] text-[#e3e3e3] hover:bg-[#282a2c]" : "text-[#131314]"}`}
            style={!status.connected ? { backgroundColor: "var(--accent-color)" } : undefined}
          >
            {actionLabel}
          </button>
          {status.connected && (
            <button
              type="button"
              onClick={onRefreshCalendar}
              disabled={busy}
              className="w-full rounded-2xl border border-[#282a2c] bg-[#131314] px-3 py-2.5 text-sm font-semibold text-[#e3e3e3] transition hover:bg-[#282a2c] disabled:opacity-50"
            >
              Refresh Calendar Events
            </button>
          )}
        </div>
      </details>
    </section>
  );
}
