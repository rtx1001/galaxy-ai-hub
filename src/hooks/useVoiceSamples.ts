import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VoiceSample } from "../appCore";

export function useVoiceSamples({
  settingsLoaded,
  voiceFolder,
  personalityProfileOpen,
  userProfileOpen,
  selectedVoicePath,
  selectedUserVoicePath,
}: {
  settingsLoaded: boolean;
  voiceFolder: string;
  personalityProfileOpen: boolean;
  userProfileOpen: boolean;
  selectedVoicePath: string;
  selectedUserVoicePath: string;
}) {
  const [voiceSamples, setVoiceSamples] = useState<VoiceSample[]>([]);
  const selectedVoiceRowRef = useRef<HTMLDivElement | null>(null);
  const selectedUserVoiceRowRef = useRef<HTMLDivElement | null>(null);

  const refreshVoiceSamples = useCallback(async () => {
    const samples = await invoke<VoiceSample[]>("list_voice_samples", {
      folder: voiceFolder || null,
    });
    setVoiceSamples(samples);
    return samples;
  }, [voiceFolder]);

  useEffect(() => {
    if (!settingsLoaded) return;
    refreshVoiceSamples().catch((error) => {
      console.error("Voice sample load error:", error);
    });
  }, [settingsLoaded, refreshVoiceSamples]);

  useEffect(() => {
    if (!settingsLoaded || (!personalityProfileOpen && !userProfileOpen)) return;
    refreshVoiceSamples().catch((error) => {
      console.error("Voice sample refresh error:", error);
    });
  }, [settingsLoaded, personalityProfileOpen, userProfileOpen, refreshVoiceSamples]);

  useEffect(() => {
    if (!personalityProfileOpen) return;
    const handle = window.setTimeout(() => {
      selectedVoiceRowRef.current?.scrollIntoView({ block: "center" });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [personalityProfileOpen, selectedVoicePath, voiceSamples.length]);

  useEffect(() => {
    if (!userProfileOpen) return;
    const handle = window.setTimeout(() => {
      selectedUserVoiceRowRef.current?.scrollIntoView({ block: "center" });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [userProfileOpen, selectedUserVoicePath, voiceSamples.length]);

  return {
    voiceSamples,
    selectedVoiceRowRef,
    selectedUserVoiceRowRef,
  };
}
