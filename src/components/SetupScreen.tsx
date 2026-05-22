import { BrainIcon, BrushIcon, CheckIcon, CloseIcon, DownloadIcon, MicIcon, SpeakerIcon, WrenchIcon } from "./Icons";
import {
  SETUP_PARTS,
  SetupCatalog,
  SetupInstallProgress,
  SetupPartKey,
  SetupPreflightReport,
  SetupTier,
  SystemInfo,
  setupDownloadSizeSummary,
  setupPartIntro,
  setupPartModel,
  setupTierDescription,
  setupTierLabel,
} from "../appCore";
import { CURRENT_APP_VERSION } from "../hooks/useAvailableUpdate";

type SetupTheme = {
  accent: string;
  hover: string;
  soft: string;
};

type SetupScreenProps = {
  theme: SetupTheme;
  brandLogo: string;
  systemInfo: SystemInfo | null;
  hardwareGpuLabel: string;
  hardwareRamLabel: string;
  activeSetupTier: SetupTier;
  recommendedSetupTier: SetupTier;
  onSelectSetupTier: (tier: SetupTier) => void;
  setupCatalog: SetupCatalog | null;
  setupInstalling: boolean;
  activeSetupPartKey: string;
  setupPreflight: SetupPreflightReport | null;
  setupProgress: SetupInstallProgress | null;
  onClose: () => void;
  onChooseFiles: () => void;
  onInstall: () => void;
  onInstallPart: (partKey: SetupPartKey) => void;
};

export function SetupScreen({
  theme,
  brandLogo,
  systemInfo,
  hardwareGpuLabel,
  hardwareRamLabel,
  activeSetupTier,
  recommendedSetupTier,
  onSelectSetupTier,
  setupCatalog,
  setupInstalling,
  activeSetupPartKey,
  setupPreflight,
  setupProgress,
  onClose,
  onChooseFiles,
  onInstall,
  onInstallPart,
}: SetupScreenProps) {
  const hasInstalledParts = Boolean(setupCatalog?.parts.some((part) => part.installed));
  const hasMissingParts = Boolean(setupCatalog?.parts.some((part) => !part.installed));
  const sizeSummary = setupDownloadSizeSummary(setupCatalog);
  const tierLabel = setupTierLabel(activeSetupTier);
  const recommendedTierLabel = setupTierLabel(recommendedSetupTier);
  const installButtonLabel = !setupCatalog
    ? "Checking..."
    : setupInstalling
    ? "Installing..."
    : !hasMissingParts
      ? `Start ${tierLabel}`
      : hasInstalledParts
      ? "Repair missing files"
      : `Install ${tierLabel}`;

  return (
    <div
      className="setup-screen"
      style={
        {
          "--accent-color": theme.accent,
          "--accent-hover": theme.hover,
          "--accent-soft": theme.soft,
          "--accent-soft-strong": `${theme.accent}44`,
        } as React.CSSProperties
      }
    >
      <div className="setup-shell">
        <button
          type="button"
          className="setup-close-button"
          onClick={onClose}
          disabled={setupInstalling}
          title="Back to chat"
        >
          <CloseIcon className="h-4.5 w-4.5" />
        </button>
        <div className="setup-hero">
          <div className="setup-logo">
            <img src={brandLogo} alt="" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="setup-kicker">Welcome to Galaxy AI Hub</div>
            <h1 className="setup-title">Build your local AI companion</h1>
            <p className="setup-copy">Version {CURRENT_APP_VERSION}</p>
          </div>
        </div>

        <div className="setup-grid">
          <section className="setup-card setup-hardware-card">
            <div className="setup-card-title">Selected Setup</div>
            <div className="setup-tier-badge">
              <span>{setupTierLabel(activeSetupTier)}</span>
              <small>{setupTierDescription(activeSetupTier)}</small>
            </div>
            <div className="setup-spec-list">
              <div>
                <span>CPU</span>
                <strong>{systemInfo?.cpu_name || "Checking..."}</strong>
              </div>
              <div>
                <span>GPU</span>
                <strong>{hardwareGpuLabel || "Checking..."}</strong>
              </div>
              <div>
                <span>RAM</span>
                <strong>{hardwareRamLabel}</strong>
              </div>
              <div>
                <span>VRAM</span>
                <strong>{systemInfo ? `${(systemInfo.total_vram_mb / 1024).toFixed(1)} GB` : "Checking..."}</strong>
              </div>
            </div>
            <div className="setup-tier-row">
              {(["light", "balanced", "high"] as SetupTier[]).map((tier) => (
                <button
                  key={tier}
                  type="button"
                  className={`setup-tier-button ${activeSetupTier === tier ? "active" : ""}`}
                  onClick={() => onSelectSetupTier(tier)}
                >
                  <span>{setupTierLabel(tier)}</span>
                </button>
              ))}
            </div>
            <div className="setup-size-note">
              <strong>{sizeSummary.total}</strong>
              {sizeSummary.parts.length > 0 && (
                <div className="mt-2 space-y-1">
                  {sizeSummary.parts.map((part) => (
                    <div key={part.title} className="flex items-center justify-between gap-3">
                      <span>{part.title}</span>
                      <span>{part.size}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="setup-preflight">
              <div className="setup-preflight-title">Fresh PC check</div>
              <div className="setup-preflight-list">
                {(setupPreflight?.checks || []).slice(0, 6).map((check) => (
                  <div key={check.key} className={`setup-preflight-item ${check.status === "ok" ? "ok" : "attention"}`} title={check.message}>
                    <span />
                    <strong>{check.label}</strong>
                  </div>
                ))}
                {!setupPreflight && <div className="setup-preflight-empty">Checking this PC...</div>}
              </div>
            </div>
          </section>

          <section className="setup-card setup-parts-card">
            <div className="setup-card-title">What will be installed</div>
            <div className="setup-parts">
              {SETUP_PARTS.map((part) => {
                const catalogPart = setupCatalog?.parts.find((item) => item.key === part.key);
                const sizeLabel = catalogPart?.files.map((file) => file.size_hint).join(" + ") || part.note;
                const isActivePart = setupInstalling && activeSetupPartKey === part.key;
                const statusLabel = catalogPart?.installed
                  ? "Installed"
                  : setupCatalog
                    ? "Missing"
                    : "Checking";
                const actionLabel = catalogPart?.installed
                  ? "Installed"
                  : isActivePart
                    ? setupProgress?.stage === "ready"
                      ? "Installed"
                      : "Installing"
                    : hasInstalledParts
                      ? "Repair"
                      : "Install";
                const ActionIcon = catalogPart?.installed
                  ? CheckIcon
                  : hasInstalledParts
                    ? WrenchIcon
                    : DownloadIcon;

                return (
                  <div key={part.key} className={`setup-part ${catalogPart?.installed ? "installed" : ""} ${isActivePart ? "active" : ""}`}>
                    <div className="setup-part-icon">
                      {part.icon === "brain" ? (
                        <BrainIcon className="h-5 w-5" />
                      ) : part.icon === "voice" ? (
                        <SpeakerIcon className="h-5 w-5" />
                      ) : (
                        <BrushIcon className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="setup-part-title-row">
                        <span className="setup-part-title">{part.title}</span>
                        <span className="setup-part-status-text">{statusLabel}</span>
                      </div>
                      <div className="setup-part-intro">{setupPartIntro(part)}</div>
                      <div className="setup-part-model">{setupPartModel(part, activeSetupTier)}</div>
                      <div className="setup-part-size">{sizeLabel}</div>
                    </div>
                    <button
                      type="button"
                      className={`setup-part-state ${catalogPart?.installed ? "installed" : ""}`}
                      onClick={() => onInstallPart(part.key)}
                      disabled={setupInstalling || !catalogPart || catalogPart.installed}
                      title={statusLabel}
                    >
                      <ActionIcon className={actionLabel === "Repair" ? "h-4.5 w-4.5" : "h-3.5 w-3.5"} />
                      <span>{actionLabel}</span>
                    </button>
                  </div>
                );
              })}
              {(() => {
                const voicePart = setupCatalog?.parts.find((item) => item.key === "voice");
                const helperInstalled = Boolean(voicePart?.installed);
                const statusLabel = helperInstalled ? "Installed" : "Missing";
                return (
                  <div className={`setup-part ${helperInstalled ? "installed" : ""}`}>
                    <div className="setup-part-icon">
                      <MicIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="setup-part-title-row">
                        <span className="setup-part-title">Voice Helper</span>
                        <span className="setup-part-status-text">{statusLabel}</span>
                      </div>
                      <div className="setup-part-intro">The part that listens and prepares voice samples.</div>
                      <div className="setup-part-model">Speech recognition and voice preparation</div>
                      <div className="setup-part-size">Included with the voice setup</div>
                    </div>
                    <button
                      type="button"
                      className={`setup-part-state ${helperInstalled ? "installed" : ""}`}
                      onClick={() => onInstallPart("voice")}
                      disabled={setupInstalling || !voicePart || helperInstalled}
                      title={statusLabel}
                    >
                      {helperInstalled ? <CheckIcon className="h-3.5 w-3.5" /> : <DownloadIcon className="h-3.5 w-3.5" />}
                      <span>{helperInstalled ? "Installed" : "Install"}</span>
                    </button>
                  </div>
                );
              })()}
            </div>
          </section>
        </div>

        <div className="setup-footer">
          <div className="setup-footer-info">
            <div className="setup-footer-note setup-recommended-indicator">
              <span />
              <strong>Recommended setup: <b>{recommendedTierLabel}</b></strong>
            </div>
            {(setupInstalling || setupProgress) && (
              <div className="setup-progress" role="status" aria-live="polite">
                <div className="setup-progress-meta">
                  <span>{setupProgress?.label || "Preparing installer"}</span>
                  <strong>{setupProgress?.file_count ? `${setupProgress.file_index}/${setupProgress.file_count}` : "0%"}</strong>
                </div>
                <div className="setup-progress-track">
                  <div
                    className="setup-progress-fill"
                    style={{ width: `${Math.max(3, setupProgress?.percent ?? 0)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="setup-actions">
            <button
              type="button"
              className="setup-secondary-button"
              onClick={onChooseFiles}
              disabled={setupInstalling}
            >
              Choose files myself
            </button>
            <button
              type="button"
              className="setup-primary-button"
              onClick={onInstall}
              disabled={setupInstalling || !setupCatalog}
            >
              {installButtonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
