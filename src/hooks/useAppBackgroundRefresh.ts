import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VoiceSample } from "../appCore";

type UseAppBackgroundRefreshOptions = {
  automationMonth: Date;
  googleClientId: string;
  googleClientSecret: string;
  googleConnected: boolean;
  linkedFolders: string[];
  refreshAutomationJobs: () => void | Promise<void>;
  refreshGoogleCalendarEvents: (month?: Date) => Promise<void>;
  refreshGoogleStatus: () => Promise<unknown>;
  refreshPendingShellActions: () => void | Promise<void>;
  refreshToolRuns: () => void | Promise<void>;
  selectedVoicePath: string;
  settingsLoaded: boolean;
  settingsReadyForSave: boolean;
  updateActiveCharacterVoicePath: (voicePath: string) => void;
  voiceSamples: VoiceSample[];
};

export function useAppBackgroundRefresh({
  automationMonth,
  googleClientId,
  googleClientSecret,
  googleConnected,
  linkedFolders,
  refreshAutomationJobs,
  refreshGoogleCalendarEvents,
  refreshGoogleStatus,
  refreshPendingShellActions,
  refreshToolRuns,
  selectedVoicePath,
  settingsLoaded,
  settingsReadyForSave,
  updateActiveCharacterVoicePath,
  voiceSamples,
}: UseAppBackgroundRefreshOptions) {
  useEffect(() => {
    refreshPendingShellActions();
    refreshAutomationJobs();
    refreshToolRuns();
    refreshGoogleStatus().catch((error) => console.error("Google startup status error:", error));
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !linkedFolders.length) {
      return;
    }
    invoke<Array<{ path: string; exists: boolean; message: string }>>("validate_workspace_folders", {
      folders: linkedFolders,
    })
      .then((statuses) => {
        const missing = statuses.filter((status) => !status.exists);
        if (missing.length) {
          console.warn(
            "Workspace startup check found missing folders:",
            missing.map((status) => `${status.path}: ${status.message}`).join("; "),
          );
        }
      })
      .catch((error) => console.error("Workspace startup check error:", error));
  }, [settingsLoaded, linkedFolders]);

  useEffect(() => {
    if (!settingsLoaded || !googleConnected) {
      return;
    }

    refreshGoogleCalendarEvents(automationMonth).catch((error) => console.error("Google Calendar refresh error:", error));
  }, [settingsLoaded, googleConnected, automationMonth, googleClientId, googleClientSecret]);

  useEffect(() => {
    if (!settingsLoaded || !settingsReadyForSave) {
      return;
    }

    if (!selectedVoicePath && voiceSamples.length > 0) {
      updateActiveCharacterVoicePath(voiceSamples[0].path);
      return;
    }

    if (
      selectedVoicePath &&
      voiceSamples.length > 0 &&
      !voiceSamples.some((sample) => sample.path === selectedVoicePath)
    ) {
      updateActiveCharacterVoicePath(voiceSamples[0].path);
    }
  }, [settingsLoaded, settingsReadyForSave, selectedVoicePath, voiceSamples]);
}
