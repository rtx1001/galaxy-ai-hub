import { useEffect } from "react";
import type { VoiceSample } from "../appCore";

type UseAppBackgroundRefreshOptions = {
  automationMonth: Date;
  googleClientId: string;
  googleClientSecret: string;
  googleConnected: boolean;
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
