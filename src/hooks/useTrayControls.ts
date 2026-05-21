import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type UseTrayControlsOptions = {
  settingsLoaded: boolean;
  telegramRunning: boolean;
  autoVoice: boolean;
  onToggleTelegram: () => Promise<void>;
  onToggleAutoVoice: () => void;
};

export function useTrayControls({
  settingsLoaded,
  telegramRunning,
  autoVoice,
  onToggleTelegram,
  onToggleAutoVoice,
}: UseTrayControlsOptions) {
  const onToggleTelegramRef = useRef(onToggleTelegram);
  const onToggleAutoVoiceRef = useRef(onToggleAutoVoice);
  onToggleTelegramRef.current = onToggleTelegram;
  onToggleAutoVoiceRef.current = onToggleAutoVoice;

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const register = async (event: string, handler: () => void) => {
      const unlisten = await listen(event, handler);
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    };

    const attachTrayHandlers = async () => {
      await Promise.all([
        register("tray-toggle-telegram", () => {
          onToggleTelegramRef.current().catch((error) => console.error("Tray Telegram toggle error:", error));
        }),
        register("tray-toggle-auto-voice", () => onToggleAutoVoiceRef.current()),
      ]);
    };

    attachTrayHandlers().catch((error) => console.error("Tray handler setup error:", error));

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    invoke("update_tray_menu_state", {
      telegramRunning,
      autoVoice,
    }).catch((error) => console.error("Tray menu state update error:", error));
  }, [settingsLoaded, telegramRunning, autoVoice]);
}
