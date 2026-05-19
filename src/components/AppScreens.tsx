import brandLogo from "../assets/logo-gah.svg";

export function StartupScreen() {
  return (
    <div className="startup-screen" role="status" aria-live="polite">
      <div className="startup-card">
        <div className="startup-logo">
          <img src={brandLogo} alt="" aria-hidden="true" />
        </div>
        <div className="startup-kicker">Galaxy AI Hub</div>
        <div className="startup-title">Starting up</div>
        <div className="startup-message">Loading saved settings...</div>
        <div className="startup-bar" />
      </div>
    </div>
  );
}

export function SettingsLoadErrorScreen({ error }: { error: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[#131314] px-6 text-[#e3e3e3]">
      <div className="max-w-xl rounded-[28px] border border-rose-500/30 bg-[#1e1f20] px-6 py-5 shadow-2xl">
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-rose-300">
          Settings Load Error
        </div>
        <div className="mt-2 text-sm leading-6 text-[#c4c7c5]">
          The app could not load saved settings, so it stopped before showing editable defaults.
        </div>
        <pre className="mt-4 whitespace-pre-wrap rounded-2xl border border-[#282a2c] bg-[#131314] p-3 text-xs text-rose-100">
          {error}
        </pre>
      </div>
    </div>
  );
}
