import { useEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { VoiceSetupStatus } from "../types";

export function useVoiceHelpers({
  lastComposerInputAtRef,
  setSetupNotice,
}: {
  lastComposerInputAtRef: RefObject<number>;
  setSetupNotice: (notice: string) => void;
}) {
  const [voiceSetupStatus, setVoiceSetupStatus] = useState<VoiceSetupStatus>({
    state: "idle",
    message: "Voice helper is waiting.",
    progress: 0,
    ready: false,
  });
  const [omniVoiceStatus, setOmniVoiceStatus] = useState<VoiceSetupStatus>({
    state: "idle",
    message: "Voice playback engine is waiting.",
    progress: 0,
    ready: false,
  });
  const voiceAutoPrepareStartedRef = useRef(false);

  const prepareVoiceHelpers = async (showNotice = false) => {
    if (voiceAutoPrepareStartedRef.current) return;
    voiceAutoPrepareStartedRef.current = true;
    if (showNotice) {
      setSetupNotice("Preparing voice helper so speech is ready on first use...");
    }
    try {
      const voiceStatus = await invoke<VoiceSetupStatus>("start_voice_setup");
      setVoiceSetupStatus(voiceStatus);
    } catch (error) {
      console.error("Voice helper auto-prepare error:", error);
    }
    try {
      const ttsStatus = await invoke<VoiceSetupStatus>("prepare_omnivoice_engine");
      setOmniVoiceStatus(ttsStatus);
    } catch (error) {
      console.error("Voice TTS auto-prepare error:", error);
    }
  };

  useEffect(() => {
    let active = true;
    let intervalHandle: ReturnType<typeof setInterval> | undefined;

    const syncVoiceStatus = async () => {
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;
      try {
        const status = await invoke<VoiceSetupStatus>("get_voice_setup_status");
        if (!active) return;
        setVoiceSetupStatus(status);
      } catch (error) {
        if (!active) return;
        console.error("Voice status error:", error);
      }
    };

    syncVoiceStatus();
    intervalHandle = setInterval(syncVoiceStatus, 5000);

    return () => {
      active = false;
      if (intervalHandle) clearInterval(intervalHandle);
    };
  }, [lastComposerInputAtRef]);

  useEffect(() => {
    let active = true;
    let intervalHandle: ReturnType<typeof setInterval> | undefined;

    const syncOmniVoiceStatus = async () => {
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;
      try {
        const status = await invoke<VoiceSetupStatus>(
          "get_omnivoice_engine_status",
        );
        if (!active) return;
        setOmniVoiceStatus(status);
      } catch (error) {
        if (!active) return;
        console.error("OmniVoice status error:", error);
      }
    };

    syncOmniVoiceStatus();
    intervalHandle = setInterval(syncOmniVoiceStatus, 5000);

    return () => {
      active = false;
      if (intervalHandle) clearInterval(intervalHandle);
    };
  }, [lastComposerInputAtRef]);

  return {
    voiceSetupStatus,
    omniVoiceStatus,
    setVoiceSetupStatus,
    setOmniVoiceStatus,
    prepareVoiceHelpers,
  };
}
