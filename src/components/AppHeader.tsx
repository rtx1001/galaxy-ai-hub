import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { DownloadIcon, GearIcon, MenuIcon } from "./Icons";
import { IconButton } from "./UI";
import { ResourceHeader } from "./ResourceHeader";
import { AvailableUpdate } from "../hooks/useAvailableUpdate";
import { ModelLoadStatus } from "../types";

type AppHeaderProps = {
  activeTaskType: "none" | "llm" | "voice" | "image";
  appVersion: string;
  availableUpdate: AvailableUpdate | null;
  brainStatus: "Idle" | "Loading" | "Ready" | "Thinking" | "Error";
  dateTimeLine: string;
  isAudioPlaying: boolean;
  isGeneratingImage: boolean;
  leftPanelOpen: boolean;
  modelLoadStatus: ModelLoadStatus;
  previewingVoicePath: string | null;
  rightPanelOpen: boolean;
  setLeftPanelOpen: (updater: (prev: boolean) => boolean) => void;
  setRightPanelOpen: (updater: (prev: boolean) => boolean) => void;
  speakingMessageId: string | null;
  topProgressActive: boolean;
  topProgressPercent: number;
  topStatusText: string;
};

export function AppHeader({
  activeTaskType,
  appVersion,
  availableUpdate,
  brainStatus,
  dateTimeLine,
  isAudioPlaying,
  isGeneratingImage,
  leftPanelOpen,
  modelLoadStatus,
  previewingVoicePath,
  rightPanelOpen,
  setLeftPanelOpen,
  setRightPanelOpen,
  speakingMessageId,
  topProgressActive,
  topProgressPercent,
  topStatusText,
}: AppHeaderProps) {
  const [toastVisible, setToastVisible] = useState(false);
  const [toastStatus, setToastStatus] = useState({
    text: "",
    progressActive: false,
    progressPercent: 0,
    brainStatus,
  });

  useEffect(() => {
    let clearHandle: number | undefined;
    if (topStatusText) {
      setToastStatus({
        text: topStatusText,
        progressActive: topProgressActive,
        progressPercent: topProgressPercent,
        brainStatus,
      });
      setToastVisible(true);
    } else {
      setToastVisible(false);
      clearHandle = window.setTimeout(() => {
        setToastStatus((prev) => ({ ...prev, text: "" }));
      }, 320);
    }
    return () => {
      if (clearHandle) window.clearTimeout(clearHandle);
    };
  }, [brainStatus, topProgressActive, topProgressPercent, topStatusText]);

  return (
    <header className="relative z-30 shrink-0 overflow-visible border-b border-[#282a2c] bg-[#131314] px-3 py-2">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <IconButton title={rightPanelOpen ? "Close model controls" : "Open model controls"} onClick={() => setRightPanelOpen((prev) => !prev)} size="sm" active={rightPanelOpen}>
          <MenuIcon />
        </IconButton>
        <div className="min-w-0 overflow-hidden">
          <ResourceHeader
            activeTaskType={activeTaskType}
            brainStatus={brainStatus}
            modelState={modelLoadStatus.state}
            isGeneratingImage={isGeneratingImage}
            isAudioPlaying={isAudioPlaying}
            isVoiceBusy={Boolean(speakingMessageId || previewingVoicePath || isAudioPlaying)}
          />
        </div>
        <IconButton title={leftPanelOpen ? "Close app settings" : "Open app settings"} onClick={() => setLeftPanelOpen((prev) => !prev)} size="sm" active={leftPanelOpen}>
          <GearIcon />
        </IconButton>
      </div>
      <div className="mt-3 text-center text-[11px] font-medium text-[#9aa0a6]">
        <span>Galaxy AI Hub {appVersion}</span>
        <span className="mx-2 text-[#5f6368]">·</span>
        <span>{dateTimeLine}</span>
      </div>

      {availableUpdate && (
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            onClick={() => openUrl(availableUpdate.url).catch((error) => console.error("Open release page error:", error))}
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-[color:var(--accent-soft-strong)] bg-[color:var(--accent-soft)] px-3 py-1 text-[11px] font-bold tracking-[0.12em] text-[color:var(--accent-color)] transition hover:border-[color:var(--accent-color)] hover:bg-[color:var(--accent-soft-strong)]"
            title={`Open Galaxy AI Hub ${availableUpdate.version} release page`}
          >
            <DownloadIcon />
            <span className="truncate">New Update available</span>
          </button>
        </div>
      )}

      {toastStatus.text && (
        <div className="pointer-events-none absolute left-3 right-3 top-full z-40 mt-2 flex justify-center">
          <div
            className={`w-full max-w-[720px] rounded-2xl border border-[#282a2c]/45 bg-[#1e1f20]/30 px-3 py-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.18)] backdrop-blur-[2px] transition duration-300 ease-out ${
              toastVisible ? "translate-y-0 scale-100 opacity-100" : "-translate-y-1.5 scale-[0.98] opacity-0"
            }`}
          >
            <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-[#c4c7c5]">
              <span className="min-w-0 truncate">{toastStatus.text}</span>
              {toastStatus.progressActive && <span className="shrink-0 text-[#9aa0a6]">{Math.round(toastStatus.progressPercent)}%</span>}
            </div>
            {toastStatus.progressActive && (
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#282a2c]">
                <div
                  className={`h-full transition-all duration-300 ${toastStatus.brainStatus === "Error" ? "bg-rose-500" : ""}`}
                  style={{ width: `${toastStatus.progressPercent}%`, backgroundColor: toastStatus.brainStatus === "Error" ? undefined : "var(--accent-color)" }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
