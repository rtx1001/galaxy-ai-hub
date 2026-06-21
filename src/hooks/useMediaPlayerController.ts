import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MediaPlayerStatus } from "../appCore";
import { INTERNAL_MEDIA_STATE_EVENT, InternalMediaState } from "../internalMediaState";

const emptyMediaPlayerStatus: MediaPlayerStatus = {
  app_open: false,
  connected: true,
  playing: false,
  account_name: null,
  active_app: null,
  track: null,
  message: "Windows media keys are ready.",
};

function mediaPlayerErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes("windows")) return message;
  return "Media control failed.";
}

export function useMediaPlayerController({
  settingsLoaded,
}: {
  settingsLoaded: boolean;
}) {
  const [mediaPlayerStatus, setMediaPlayerStatus] = useState<MediaPlayerStatus>(emptyMediaPlayerStatus);
  const [mediaPlayerBusy, setMediaPlayerBusy] = useState(false);
  const internalMediaActiveRef = useRef(false);
  const mediaPlayerCommandInFlightRef = useRef(false);
  const mediaPlayerOptimisticPlayingRef = useRef<{ playing: boolean; until: number } | null>(null);

  const applyMediaPlayerStatus = (status: MediaPlayerStatus) => {
    const withInternalMedia = internalMediaActiveRef.current
      ? { ...status, app_open: true, active_app: "Galaxy" }
      : status;
    const optimistic = mediaPlayerOptimisticPlayingRef.current;
    if (optimistic && Date.now() < optimistic.until) {
      return { ...withInternalMedia, playing: optimistic.playing };
    }
    mediaPlayerOptimisticPlayingRef.current = null;
    return withInternalMedia;
  };

  const refreshMediaPlayerStatus = async () => {
    try {
      const status = await invoke<MediaPlayerStatus>("get_media_player_status", {
        clientId: "",
      });
      setMediaPlayerStatus(applyMediaPlayerStatus(status));
      return status;
    } catch (error) {
      console.error("Media player status error:", error);
      console.error(mediaPlayerErrorMessage(error));
      return null;
    }
  };

  const controlMediaPlayer = async (command: "media_player_play" | "media_player_pause" | "media_player_next" | "media_player_previous") => {
    if (mediaPlayerCommandInFlightRef.current) return;
    mediaPlayerCommandInFlightRef.current = true;
    setMediaPlayerBusy(true);
    const optimisticPlaying =
      command === "media_player_play" ? true : command === "media_player_pause" ? false : null;
    if (optimisticPlaying !== null) {
      mediaPlayerOptimisticPlayingRef.current = {
        playing: optimisticPlaying,
        until: Date.now() + 8000,
      };
    }
    try {
      const status = await invoke<MediaPlayerStatus>(command, {
        clientId: "",
      });
      setMediaPlayerStatus(applyMediaPlayerStatus(status));
      window.setTimeout(() => {
        refreshMediaPlayerStatus().catch(() => undefined);
      }, 350);
    } catch (error) {
      console.error("Media player control error:", error);
      console.error(mediaPlayerErrorMessage(error));
      refreshMediaPlayerStatus().catch(() => undefined);
    } finally {
      mediaPlayerCommandInFlightRef.current = false;
      setMediaPlayerBusy(false);
    }
  };

  useEffect(() => {
    if (!settingsLoaded) return;
    refreshMediaPlayerStatus();
    const handle = window.setInterval(refreshMediaPlayerStatus, 5000);
    return () => window.clearInterval(handle);
  }, [settingsLoaded]);

  useEffect(() => {
    const onInternalMediaState = (event: Event) => {
      internalMediaActiveRef.current = Boolean((event as CustomEvent<InternalMediaState>).detail?.active);
      setMediaPlayerStatus((status) => applyMediaPlayerStatus(status));
    };
    window.addEventListener(INTERNAL_MEDIA_STATE_EVENT, onInternalMediaState);
    return () => window.removeEventListener(INTERNAL_MEDIA_STATE_EVENT, onInternalMediaState);
  }, []);

  return {
    mediaPlayerStatus,
    mediaPlayerBusy,
    refreshMediaPlayerStatus,
    mediaPlayerPlay: () => controlMediaPlayer("media_player_play"),
    mediaPlayerPause: () => controlMediaPlayer("media_player_pause"),
    mediaPlayerNext: () => controlMediaPlayer("media_player_next"),
    mediaPlayerPrevious: () => controlMediaPlayer("media_player_previous"),
  };
}
