import { Dispatch, SetStateAction } from "react";
import { BrainIcon, BrushIcon, CloseIcon, SpeakerIcon } from "./Icons";
import {
  SETUP_PARTS,
  SetupCatalog,
  SetupInstallProgress,
  SetupTier,
  SystemInfo,
  setupDownloadSizeSummary,
  setupPartIntro,
  setupPartModel,
  setupTierDescription,
  setupTierLabel,
} from "../appCore";

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
  setupTierOverride: SetupTier | null;
  setSetupTierOverride: Dispatch<SetStateAction<SetupTier | null>>;
  setupCatalog: SetupCatalog | null;
  setupInstalling: boolean;
  activeSetupPartKey: string;
  setupProgress: SetupInstallProgress | null;
  setupNotice: string;
  onClose: () => void;
  onChooseFiles: () => void;
  onInstall: () => void;
};

export function SetupScreen({
  theme,
  brandLogo,
  systemInfo,
  hardwareGpuLabel,
  hardwareRamLabel,
  activeSetupTier,
  setupTierOverride,
  setSetupTierOverride,
  setupCatalog,
  setupInstalling,
  activeSetupPartKey,
  setupProgress,
  setupNotice,
  onClose,
  onChooseFiles,
  onInstall,
}: SetupScreenProps) {
  const hasInstalledParts = Boolean(setupCatalog?.parts.some((part) => part.installed));
  const hasMissingParts = Boolean(setupCatalog?.parts.some((part) => !part.installed));
  const sizeSummary = setupDownloadSizeSummary(setupCatalog);
  const installButtonLabel = setupInstalling
    ? "Installing..."
    : hasInstalledParts && hasMissingParts
      ? "Repair missing files"
      : "Install recommended setup";

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
            <div className="setup-kicker">Welcome to Galaxy</div>
            <h1 className="setup-title">Build your local AI companion</h1>
            <p className="setup-copy">
              Galaxy needs three local parts before it can chat, speak, and create images.
              Pick the setup that fits this PC, then let the app prepare everything in this folder.
            </p>
          </div>
        </div>

        <div className="setup-grid">
          <section className="setup-card setup-hardware-card">
            <div className="setup-card-title">Recommended setup</div>
            <div className="setup-tier-badge">
              <span>{setupTierLabel(activeSetupTier)}</span>
              <small>{setupTierOverride ? "Selected by you" : "Picked for this PC"}</small>
            </div>
            <p className="setup-muted">{setupTierDescription(activeSetupTier)}</p>
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
                  onClick={() => setSetupTierOverride(tier)}
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
          </section>

          <section className="setup-card setup-parts-card">
            <div className="setup-card-title">What will be installed</div>
            <div className="setup-parts">
              {SETUP_PARTS.map((part) => {
                const catalogPart = setupCatalog?.parts.find((item) => item.key === part.key);
                const sizeLabel = catalogPart?.files.map((file) => file.size_hint).join(" + ") || part.note;
                const isActivePart = setupInstalling && activeSetupPartKey === part.key;
                const partState = catalogPart?.installed
                  ? "Ready"
                  : isActivePart
                    ? setupProgress?.stage === "ready"
                      ? "Ready"
                      : "Installing"
                    : setupInstalling
                      ? "Queued"
                      : "Needed";

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
                      <div className="setup-part-title">{part.title}</div>
                      <div className="setup-part-intro">{setupPartIntro(part)}</div>
                      <div className="setup-part-model">{setupPartModel(part, activeSetupTier)}</div>
                      <div className="setup-part-size">{sizeLabel}</div>
                    </div>
                    <div className="setup-part-state">{partState}</div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className="setup-footer">
          <div className="setup-footer-info">
            <div className="setup-footer-note">
              {setupNotice || "You can change models later. First startup only prepares a working default setup."}
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
              disabled={setupInstalling}
            >
              {installButtonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
