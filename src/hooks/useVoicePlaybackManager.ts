import { useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../types";
import {
  AudioSynthesisResult,
  OmniVoiceVramEstimate,
  SPEECH_CACHE_LIMIT,
  VoiceSample,
  VramMemoryStatus,
  detectVoicePreviewText,
  extractMessageText,
  isGpuFitError,
  sanitizeTextForSpeech,
} from "../appCore";

type ActiveTaskType = "none" | "llm" | "voice" | "image";

type UseVoicePlaybackManagerOptions = {
  activeTaskTypeRef: MutableRefObject<ActiveTaskType>;
  autoSpeechEligibleAssistantIdsRef: MutableRefObject<Set<string>>;
  brainStatus: "Idle" | "Loading" | "Ready" | "Thinking" | "Error";
  ensureAudioPlaybackUnlocked: () => Promise<unknown>;
  isStreaming: boolean;
  lastAutoSpokenAssistantIdRef: MutableRefObject<string | null>;
  messages: ChatMessage[];
  playAudioBase64: (audioBase64: string, mimeType: string) => Promise<void>;
  previewingVoicePath: string | null;
  recordClientToolRun: (
    name: string,
    input: Record<string, unknown>,
    result: string,
    success: boolean,
    startedAt: number,
  ) => Promise<void>;
  selectedUserVoicePath: string;
  selectedVoicePath: string;
  sendInFlightRef: MutableRefObject<boolean>;
  setActiveTaskType: Dispatch<SetStateAction<ActiveTaskType>>;
  setBrainStatus: Dispatch<SetStateAction<"Idle" | "Loading" | "Ready" | "Thinking" | "Error">>;
  setComposerNotice: Dispatch<SetStateAction<string>>;
  setPreviewingVoicePath: Dispatch<SetStateAction<string | null>>;
  setSpeakingMessageId: Dispatch<SetStateAction<string | null>>;
  stopActiveAudio: () => void;
  unloadLlmForTask: (taskType: "voice" | "image") => Promise<void>;
  voicePlaybackRequestRef: MutableRefObject<number>;
  appLog: (message: string) => void;
};

export function useVoicePlaybackManager({
  activeTaskTypeRef,
  autoSpeechEligibleAssistantIdsRef,
  brainStatus,
  ensureAudioPlaybackUnlocked,
  isStreaming,
  lastAutoSpokenAssistantIdRef,
  messages,
  playAudioBase64,
  previewingVoicePath,
  recordClientToolRun,
  selectedUserVoicePath,
  selectedVoicePath,
  sendInFlightRef,
  setActiveTaskType,
  setBrainStatus,
  setComposerNotice,
  setPreviewingVoicePath,
  setSpeakingMessageId,
  stopActiveAudio,
  unloadLlmForTask,
  voicePlaybackRequestRef,
  appLog,
}: UseVoicePlaybackManagerOptions) {
  const speechCacheRef = useRef<Map<string, AudioSynthesisResult>>(new Map());

  const chooseVoiceVramMode = async () => {
    const llmIsLoaded =
      activeTaskTypeRef.current === "llm" ||
      brainStatus === "Ready" ||
      brainStatus === "Thinking";

    if (!llmIsLoaded) {
      activeTaskTypeRef.current = "voice";
      setActiveTaskType("voice");
      return "voice-only" as const;
    }

    try {
      const [vram, estimate] = await Promise.all([
        invoke<VramMemoryStatus>("get_vram_memory_status"),
        invoke<OmniVoiceVramEstimate>("estimate_omnivoice_vram_need"),
      ]);
      appLog(
        `voice vram check free=${vram.free_mb}MB used=${vram.used_mb}MB total=${vram.total_mb}MB need=${estimate.required_mb}MB`,
      );

      if (vram.available && vram.free_mb >= estimate.required_mb) {
        setComposerNotice("Loading voice...");
        return "shared" as const;
      }
    } catch (error) {
      console.error("Voice VRAM check error:", error);
      appLog(`voice vram check failed ${error instanceof Error ? error.message : String(error)}`);
    }

    await unloadLlmForTask("voice");
    return "swapped" as const;
  };

  const rememberSpeech = (key: string, value: AudioSynthesisResult) => {
    const cache = speechCacheRef.current;
    cache.delete(key);
    cache.set(key, value);

    while (cache.size > SPEECH_CACHE_LIMIT) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) break;
      cache.delete(oldestKey);
    }
  };

  const synthesizeAndPlaySpeech = async (
    text: string,
    voiceSamplePath: string,
    requestId: number,
    manageVram = true,
  ) => {
    const speechText = sanitizeTextForSpeech(text);
    if (!speechText) {
      return;
    }

    stopActiveAudio();
    const cleanText = speechText.trim();
    const cacheKey = JSON.stringify([voiceSamplePath || "", cleanText]);
    const cached = speechCacheRef.current.get(cacheKey);
    const voiceTaskStartedAt = performance.now();
    const voiceInput = {
      voice_sample: voiceSamplePath ? voiceSamplePath.split(/[/\\]/).pop() : "default",
      text: cleanText.slice(0, 220),
      manage_vram: manageVram,
    };

    if (cached) {
      if (requestId !== voicePlaybackRequestRef.current) return;
      recordClientToolRun(
        "voice_cached",
        { ...voiceInput, cached: true },
        "Played cached voice audio.",
        true,
        voiceTaskStartedAt,
      ).catch(() => undefined);
      await playAudioBase64(cached.audio_base64, cached.mime_type);
      return;
    }

    let voiceMode: "shared" | "swapped" | "voice-only" | "none" = "none";
    let result: AudioSynthesisResult;
    try {
      if (manageVram) {
        voiceMode = await chooseVoiceVramMode();
      }

      setComposerNotice("Loading voice...");
      appLog(`voice synth start sample=${voiceSamplePath || "<design>"} request=${requestId} manageVram=${manageVram} mode=${voiceMode}`);
      await invoke("prepare_omnivoice_engine").catch(() => undefined);
      appLog(`voice synth engine ready sample=${voiceSamplePath || "<design>"} request=${requestId}`);
      result = await invoke<AudioSynthesisResult>("synthesize_speech", {
        text: cleanText,
        voiceSamplePath: voiceSamplePath || null,
        useSidecar: false,
      });
    } catch (error) {
      if (manageVram && voiceMode === "shared" && isGpuFitError(error)) {
        appLog("voice synth shared mode failed from GPU memory, retrying with LLM unloaded");
        await unloadLlmForTask("voice");
        try {
          result = await invoke<AudioSynthesisResult>("synthesize_speech", {
            text: cleanText,
            voiceSamplePath: voiceSamplePath || null,
            useSidecar: false,
          });
        } catch (retryError) {
          recordClientToolRun(
            "voice_speech",
            { ...voiceInput, mode: "swapped" },
            retryError instanceof Error ? retryError.message : String(retryError),
            false,
            voiceTaskStartedAt,
          ).catch(() => undefined);
          throw retryError;
        }
      } else {
        recordClientToolRun(
          "voice_speech",
          { ...voiceInput, mode: voiceMode },
          error instanceof Error ? error.message : String(error),
          false,
          voiceTaskStartedAt,
        ).catch(() => undefined);
        throw error;
      }
    }
    appLog(`voice synth received audio bytes_b64=${result.audio_base64.length} request=${requestId}`);
    rememberSpeech(cacheKey, result);
    if (requestId !== voicePlaybackRequestRef.current) return;
    recordClientToolRun(
      "voice_speech",
      { ...voiceInput, mode: voiceMode },
      "Generated voice audio.",
      true,
      voiceTaskStartedAt,
    ).catch(() => undefined);
    await playAudioBase64(result.audio_base64, result.mime_type);
    appLog(`voice synth playback started request=${requestId}`);
  };

  const speakMessageText = async (
    messageId: string,
    text: string,
    role: "user" | "assistant",
  ) => {
    const speechText = sanitizeTextForSpeech(text);
    if (!speechText.trim()) {
      return;
    }

    setSpeakingMessageId(messageId);
    const requestId = ++voicePlaybackRequestRef.current;
    const voicePath = role === "user" ? selectedUserVoicePath : selectedVoicePath;
    try {
      await synthesizeAndPlaySpeech(speechText, voicePath, requestId);
      setComposerNotice("");
    } catch (error) {
      console.error("Speech error:", error);
      setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === voicePlaybackRequestRef.current) {
        setSpeakingMessageId(null);
      }
      if (activeTaskTypeRef.current === "voice") {
        activeTaskTypeRef.current = "none";
        setActiveTaskType("none");
      }
      if (!sendInFlightRef.current && !isStreaming) {
        setBrainStatus(activeTaskTypeRef.current === "llm" ? "Ready" : "Idle");
      }
    }
  };

  const playAutoSpeechQueue = async (queue: string[], requestId: number) => {
    for (const messageId of queue) {
      if (requestId !== voicePlaybackRequestRef.current) return;
      const message = messages.find((item) => item.id === messageId && item.role === "assistant");
      const speechText = sanitizeTextForSpeech(message ? extractMessageText(message.content) : "");
      if (!speechText.trim()) {
        autoSpeechEligibleAssistantIdsRef.current.delete(messageId);
        continue;
      }

      autoSpeechEligibleAssistantIdsRef.current.delete(messageId);
      lastAutoSpokenAssistantIdRef.current = messageId;
      setSpeakingMessageId(messageId);
      try {
        await synthesizeAndPlaySpeech(speechText, selectedVoicePath, requestId);
      } catch (error) {
        console.error("Live speech error:", error);
        appLog(`live speech failed message=${messageId} error=${error instanceof Error ? error.message : String(error)}`);
        setComposerNotice(error instanceof Error ? error.message : String(error));
        return;
      } finally {
        if (requestId === voicePlaybackRequestRef.current) {
          setSpeakingMessageId(null);
        }
        if (activeTaskTypeRef.current === "voice") {
          activeTaskTypeRef.current = "none";
          setActiveTaskType("none");
        }
      }
    }
    if (requestId === voicePlaybackRequestRef.current) {
      setComposerNotice("");
      if (!sendInFlightRef.current && !isStreaming) {
        setBrainStatus(activeTaskTypeRef.current === "llm" ? "Ready" : "Idle");
      }
    }
  };

  const previewVoiceSample = async (sample: VoiceSample) => {
    if (previewingVoicePath === sample.path) {
      voicePlaybackRequestRef.current += 1;
      stopActiveAudio();
      setPreviewingVoicePath(null);
      return;
    }

    voicePlaybackRequestRef.current += 1;
    stopActiveAudio();
    const requestId = voicePlaybackRequestRef.current;
    setPreviewingVoicePath(sample.path);
    try {
      await ensureAudioPlaybackUnlocked().catch(() => null);
      await synthesizeAndPlaySpeech(
        detectVoicePreviewText(sample),
        sample.path,
        requestId,
      );
      setComposerNotice("");
    } catch (error) {
      console.error("Voice preview error:", error);
      setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === voicePlaybackRequestRef.current) {
        setPreviewingVoicePath(null);
      }
      if (activeTaskTypeRef.current === "voice") {
        activeTaskTypeRef.current = "none";
        setActiveTaskType("none");
      }
    }
  };

  return {
    playAutoSpeechQueue,
    previewVoiceSample,
    speakMessageText,
  };
}
