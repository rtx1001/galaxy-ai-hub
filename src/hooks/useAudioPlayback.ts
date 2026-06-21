import { useCallback, useEffect, useRef, useState } from "react";
import { activateAudioVisualizer, deactivateAudioVisualizer } from "../audioVisualizer";
import { setInternalMediaPlayback } from "../internalMediaState";

export function useAudioPlayback() {
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioUrlRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioPlaybackUnlockedRef = useRef(false);

  const stopActiveAudio = useCallback(() => {
    setIsAudioPlaying(false);
    const activeSource = activeAudioSourceRef.current;
    if (activeSource) {
      activeAudioSourceRef.current = null;
      activeSource.onended = null;
      try {
        activeSource.stop();
      } catch {
        // no-op
      }
      try {
        activeSource.disconnect();
      } catch {
        // no-op
      }
    }

    const activeAudio = activeAudioRef.current;
    if (activeAudio) {
      activeAudioRef.current = null;
      deactivateAudioVisualizer(activeAudio);
      setInternalMediaPlayback("speech", false);
      activeAudio.pause();
      activeAudio.dispatchEvent(new Event("ended"));
      activeAudio.src = "";
    }

    if (activeAudioUrlRef.current) {
      URL.revokeObjectURL(activeAudioUrlRef.current);
      activeAudioUrlRef.current = null;
    }
  }, []);

  const ensureAudioPlaybackUnlocked = useCallback(async () => {
    if (typeof window === "undefined") return null;
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) return null;

    const context = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = context;

    if (context.state === "suspended") {
      await context.resume();
    }

    if (!audioPlaybackUnlockedRef.current) {
      const buffer = context.createBuffer(
        1,
        1,
        Math.max(8_000, context.sampleRate),
      );
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(0);
      source.disconnect();
      audioPlaybackUnlockedRef.current = true;
    }

    return context;
  }, []);

  const playAudioBase64 = useCallback(
    async (audioBase64: string, mimeType: string, onStarted?: () => void) => {
      const binaryString = atob(audioBase64);
      const bytes = Uint8Array.from(binaryString, (char) =>
        char.charCodeAt(0),
      );
      stopActiveAudio();
      await ensureAudioPlaybackUnlocked().catch(() => null);

      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);
      activeAudioUrlRef.current = url;

      try {
        const audio = new Audio(url);
        audio.preload = "auto";
        activeAudioRef.current = audio;
        await new Promise<void>(async (resolve, reject) => {
          const cleanup = () => {
            audio.onended = null;
            audio.onerror = null;
          };
          audio.onended = () => {
            setIsAudioPlaying(false);
            setInternalMediaPlayback("speech", false);
            cleanup();
            resolve();
          };
          audio.onerror = () => {
            setIsAudioPlaying(false);
            setInternalMediaPlayback("speech", false);
            cleanup();
            reject(new Error("Playback failed."));
          };
          try {
            setIsAudioPlaying(true);
            setInternalMediaPlayback("speech", true);
            await activateAudioVisualizer(audio);
            await audio.play();
            onStarted?.();
          } catch (error) {
            setIsAudioPlaying(false);
            setInternalMediaPlayback("speech", false);
            cleanup();
            reject(
              error instanceof Error
                ? error
                : new Error("Playback could not start."),
            );
          }
        });
      } finally {
        setIsAudioPlaying(false);
        deactivateAudioVisualizer(activeAudioRef.current);
        setInternalMediaPlayback("speech", false);
        if (activeAudioRef.current?.src === url) {
          activeAudioRef.current = null;
        }
        if (activeAudioUrlRef.current === url) {
          URL.revokeObjectURL(url);
          activeAudioUrlRef.current = null;
        }
      }
    },
    [ensureAudioPlaybackUnlocked, stopActiveAudio],
  );

  useEffect(() => {
    return () => {
      stopActiveAudio();
      const context = audioContextRef.current;
      audioContextRef.current = null;
      activeAudioSourceRef.current = null;
      if (context) {
        context.close().catch(() => undefined);
      }
    };
  }, [stopActiveAudio]);

  return {
    isAudioPlaying,
    ensureAudioPlaybackUnlocked,
    playAudioBase64,
    stopActiveAudio,
  };
}
