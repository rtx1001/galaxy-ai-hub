import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TelegramGuest } from "../appCore";

export function useTelegramGuests({
  initialGuests,
  settingsLoaded,
  telegramRunning,
}: {
  initialGuests: TelegramGuest[];
  settingsLoaded: boolean;
  telegramRunning: boolean;
}) {
  const [telegramGuests, setTelegramGuests] = useState<TelegramGuest[]>(initialGuests);
  const [telegramGuestDraft, setTelegramGuestDraft] = useState<TelegramGuest | null>(null);

  const refreshTelegramGuests = useCallback(async () => {
    try {
      const guests = await invoke<TelegramGuest[]>("list_telegram_guests");
      setTelegramGuests(Array.isArray(guests) ? guests : []);
    } catch (error) {
      console.error("Telegram guest refresh error:", error);
    }
  }, []);

  const addTelegramGuest = useCallback(() => {
    const id = telegramGuestDraft?.id.trim() ?? "";
    if (!id) return;
    const name = telegramGuestDraft?.name.trim() || id;
    setTelegramGuests((prev) => {
      if (prev.some((guest) => guest.id === id)) {
        return prev.map((guest) => (guest.id === id ? { id, name } : guest));
      }
      return [...prev, { id, name }];
    });
    setTelegramGuestDraft(null);
  }, [telegramGuestDraft]);

  const removeTelegramGuest = useCallback((id: string) => {
    setTelegramGuests((prev) => prev.filter((guest) => guest.id !== id));
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !telegramRunning) return;
    refreshTelegramGuests();
    const handle = window.setInterval(refreshTelegramGuests, 5000);
    return () => window.clearInterval(handle);
  }, [settingsLoaded, telegramRunning, refreshTelegramGuests]);

  return {
    telegramGuests,
    setTelegramGuests,
    telegramGuestDraft,
    setTelegramGuestDraft,
    addTelegramGuest,
    removeTelegramGuest,
  };
}
