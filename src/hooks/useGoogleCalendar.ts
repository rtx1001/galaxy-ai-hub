import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  GoogleCalendarEvent,
  GoogleConnectionStatus,
  buildGoogleMonthRange,
  normalizeCalendarEventForDisplay,
} from "../appCore";

const GOOGLE_RECONNECT_NOTICE = "Google needs sign-in again.";
const GOOGLE_REDIRECT_URI = "http://127.0.0.1:8765/google/callback";

function googleErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("invalid_grant") ||
    message.toLowerCase().includes("expired or revoked") ||
    message.toLowerCase().includes("needs sign-in again")
  ) {
    return GOOGLE_RECONNECT_NOTICE;
  }
  if (message.toLowerCase().includes("not connected")) {
    return "Google is not connected.";
  }
  return "Google connection failed. Please try again.";
}

function googleNeedsReconnect(error: unknown) {
  return googleErrorMessage(error) === GOOGLE_RECONNECT_NOTICE;
}

export function useGoogleCalendar({
  automationMonth,
  initialClientId,
  initialClientSecret,
  initialRedirectUri,
}: {
  automationMonth: Date;
  initialClientId: string;
  initialClientSecret: string;
  initialRedirectUri: string;
}) {
  const [googleClientId, setGoogleClientId] = useState(initialClientId);
  const [googleClientSecret, setGoogleClientSecret] = useState(initialClientSecret);
  const [googleRedirectUri, setGoogleRedirectUri] = useState(initialRedirectUri);
  const [googleStatus, setGoogleStatus] = useState<GoogleConnectionStatus>({
    connected: false,
    email: null,
    expires_at: null,
  });
  const [googleCalendarEvents, setGoogleCalendarEvents] = useState<
    GoogleCalendarEvent[]
  >([]);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleNotice, setGoogleNotice] = useState("");
  const [selectedGoogleEvent, setSelectedGoogleEvent] =
    useState<GoogleCalendarEvent | null>(null);
  const [googleDeleteTarget, setGoogleDeleteTarget] =
    useState<GoogleCalendarEvent | null>(null);

  const refreshGoogleStatus = async () => {
    try {
      const status = await invoke<GoogleConnectionStatus>(
        "get_google_connection_status",
      );
      setGoogleStatus(status);
      return status;
    } catch (error) {
      console.error("Google status error:", error);
      setGoogleNotice(googleErrorMessage(error));
      return null;
    }
  };

  const refreshGoogleCalendarEvents = async (
    monthOverride = automationMonth,
    statusOverride = googleStatus,
  ) => {
    if (
      !statusOverride.connected ||
      !googleClientId.trim() ||
      !googleClientSecret.trim()
    ) {
      setGoogleCalendarEvents([]);
      return;
    }

    try {
      const { timeMin, timeMax } = buildGoogleMonthRange(monthOverride);
      const events = await invoke<GoogleCalendarEvent[]>(
        "list_google_calendar_events",
        {
          clientId: googleClientId,
          clientSecret: googleClientSecret,
          timeMin,
          timeMax,
        },
      );
      setGoogleCalendarEvents(events);
      setGoogleNotice(
        events.length
          ? `Loaded ${events.length} Google Calendar event${events.length === 1 ? "" : "s"}.`
          : "Google Calendar is connected. No events this month.",
      );
    } catch (error) {
      console.error("Google Calendar load error:", error);
      if (googleNeedsReconnect(error)) {
        setGoogleStatus((current) => ({ ...current, connected: false }));
        setGoogleCalendarEvents([]);
      }
      setGoogleNotice(googleErrorMessage(error));
    }
  };

  const connectGoogle = async () => {
    if (!googleClientId.trim() || !googleClientSecret.trim()) {
      setGoogleNotice("Add your Google OAuth Client ID and Secret first.");
      return;
    }

    setGoogleBusy(true);
    setGoogleNotice("Opening Google sign-in...");
    try {
      const status = await invoke<GoogleConnectionStatus>(
        "connect_google_calendar",
        {
          clientId: googleClientId,
          clientSecret: googleClientSecret,
          redirectUri: GOOGLE_REDIRECT_URI,
        },
      );
      setGoogleStatus(status);
      setGoogleNotice(
        status.email ? `Connected as ${status.email}.` : "Google Calendar connected.",
      );
      await refreshGoogleCalendarEvents(automationMonth, status);
    } catch (error) {
      console.error("Google connect error:", error);
      setGoogleNotice(googleErrorMessage(error));
    } finally {
      setGoogleBusy(false);
    }
  };

  const disconnectGoogle = async () => {
    setGoogleBusy(true);
    try {
      const status = await invoke<GoogleConnectionStatus>(
        "disconnect_google_calendar",
      );
      setGoogleStatus(status);
      setGoogleCalendarEvents([]);
      setGoogleNotice("Google Calendar disconnected.");
    } catch (error) {
      console.error("Google disconnect error:", error);
      setGoogleNotice(googleErrorMessage(error));
    } finally {
      setGoogleBusy(false);
    }
  };

  const deleteGoogleEvent = async (id: string) => {
    setGoogleBusy(true);
    try {
      await invoke("delete_google_calendar_event", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        id,
      });
      refreshGoogleCalendarEvents();
    } catch (error) {
      console.error("Delete failed:", error);
      setGoogleNotice("Delete failed. Please check connection.");
    } finally {
      setGoogleBusy(false);
    }
  };

  const openDeleteGoogleEventConfirm = (event: GoogleCalendarEvent) => {
    setSelectedGoogleEvent(null);
    setGoogleDeleteTarget(normalizeCalendarEventForDisplay(event));
  };

  return {
    googleClientId,
    setGoogleClientId,
    googleClientSecret,
    setGoogleClientSecret,
    googleRedirectUri,
    setGoogleRedirectUri,
    googleStatus,
    setGoogleStatus,
    googleCalendarEvents,
    setGoogleCalendarEvents,
    googleBusy,
    googleNotice,
    selectedGoogleEvent,
    setSelectedGoogleEvent,
    googleDeleteTarget,
    setGoogleDeleteTarget,
    refreshGoogleStatus,
    refreshGoogleCalendarEvents,
    connectGoogle,
    disconnectGoogle,
    deleteGoogleEvent,
    openDeleteGoogleEventConfirm,
  };
}
