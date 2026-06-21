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
  splitTextForSpeechPlayback,
} from "../appCore";

type ActiveTaskType = "none" | "llm" | "voice" | "image";
type SpeechQueueItem = { id: string; role: "user" | "assistant"; text: string };
type SpeechChunkQueueItem = SpeechQueueItem & { chunk: string; chunkIndex: number; chunkCount: number };
type LastSpeechChunkPlayback = { messageId: string; at: number; requestId: number };

type UseVoicePlaybackManagerOptions = {
  activeTaskTypeRef: MutableRefObject<ActiveTaskType>;
  autoSpeechEligibleAssistantIdsRef: MutableRefObject<Set<string>>;
  brainStatus: "Idle" | "Loading" | "Ready" | "Thinking" | "Error";
  ensureAudioPlaybackUnlocked: () => Promise<unknown>;
  isStreaming: boolean;
  liveConversation: boolean;
  lastAutoSpokenAssistantIdRef: MutableRefObject<string | null>;
  lastSpeechChunkPlaybackStartedRef: MutableRefObject<LastSpeechChunkPlayback | null>;
  messages: ChatMessage[];
  playAudioBase64: (audioBase64: string, mimeType: string, onStarted?: () => void) => Promise<void>;
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
  speakingMessageIdRef: MutableRefObject<string | null>;
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
  liveConversation,
  lastAutoSpokenAssistantIdRef,
  lastSpeechChunkPlaybackStartedRef,
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
  speakingMessageIdRef,
  setSpeakingMessageId,
  stopActiveAudio,
  unloadLlmForTask,
  voicePlaybackRequestRef,
  appLog,
}: UseVoicePlaybackManagerOptions) {
  const speechCacheRef = useRef<Map<string, AudioSynthesisResult>>(new Map());
  const speechSequenceDoneRef = useRef<Promise<void>>(Promise.resolve());

  const markSpeakingMessage = (messageId: string) => {
    speakingMessageIdRef.current = messageId;
    setSpeakingMessageId(messageId);
  };

  const clearSpeakingMessageForSequence = (sequenceIds: Set<string>) => {
    if (!sequenceIds.has(speakingMessageIdRef.current || "")) {
      return;
    }
    speakingMessageIdRef.current = null;
    setSpeakingMessageId(null);
  };

  const chooseVoiceVramMode = async () => {
    if (liveConversation) {
      activeTaskTypeRef.current = "voice";
      setActiveTaskType("voice");
      setComposerNotice("Loading voice...");
      appLog("voice vram live conversation prefers shared mode to keep LLM warm");
      return "shared" as const;
    }

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

  const synthesizeSpeechAudio = async (
    text: string,
    voiceSamplePath: string,
    requestId: number,
    manageVram = true,
  ): Promise<AudioSynthesisResult | null> => {
    const speechText = sanitizeTextForSpeech(text);
    if (!speechText) {
      return null;
    }

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
      if (requestId !== voicePlaybackRequestRef.current) return null;
      recordClientToolRun(
        "voice_cached",
        { ...voiceInput, cached: true },
        "Played cached voice audio.",
        true,
        voiceTaskStartedAt,
      ).catch(() => undefined);
      return cached;
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
    if (requestId !== voicePlaybackRequestRef.current) return null;
    recordClientToolRun(
      "voice_speech",
      { ...voiceInput, mode: voiceMode },
      "Generated voice audio.",
      true,
      voiceTaskStartedAt,
    ).catch(() => undefined);
    return result;
  };

  const speechChunksForItem = (item: SpeechQueueItem): SpeechChunkQueueItem[] => {
    const chunks = splitTextForSpeechPlayback(item.text);
    return chunks.map((chunk, index) => ({
      ...item,
      chunk,
      chunkIndex: index,
      chunkCount: chunks.length,
    }));
  };

  const playSpeechAudio = async (
    result: AudioSynthesisResult | null,
    requestId: number,
    onStarted?: () => void,
  ) => {
    if (!result || requestId !== voicePlaybackRequestRef.current) return;
    await playAudioBase64(result.audio_base64, result.mime_type, onStarted);
    appLog(`voice synth playback started request=${requestId}`);
  };

  const synthesizeAndPlaySpeech = async (
    text: string,
    voiceSamplePath: string,
    requestId: number,
    manageVram = true,
  ) => {
    activeTaskTypeRef.current = "voice";
    setActiveTaskType("voice");
    stopActiveAudio();
    const result = await synthesizeSpeechAudio(text, voiceSamplePath, requestId, manageVram);
    await playSpeechAudio(result, requestId);
  };

  const voicePathForRole = (role: "user" | "assistant") =>
    role === "user" ? selectedUserVoicePath : selectedVoicePath;

  const playSpeechSequence = async (
    sequence: SpeechQueueItem[],
    requestId: number,
    options: { interruptCurrent?: boolean } = {},
  ) => {
    if (!sequence.length) return;
    const interruptCurrent = options.interruptCurrent !== false;
    const previousSequenceDone = speechSequenceDoneRef.current;
    let resolveCurrentSequence: () => void = () => undefined;
    speechSequenceDoneRef.current = new Promise<void>((resolve) => {
      resolveCurrentSequence = resolve;
    });
    activeTaskTypeRef.current = "voice";
    setActiveTaskType("voice");
    try {
      if (lastSpeechChunkPlaybackStartedRef.current) {
        const sequenceIds = new Set(sequence.map((item) => item.id));
        if (sequenceIds.has(lastSpeechChunkPlaybackStartedRef.current.messageId)) {
          lastSpeechChunkPlaybackStartedRef.current = null;
        }
      }
      if (interruptCurrent) {
        stopActiveAudio();
      }
      const chunks = sequence.flatMap(speechChunksForItem);
      if (chunks.length) {
        await invoke("clear_omnivoice_output_cache").catch((error) => {
          console.warn("Could not clear old OmniVoice debug files:", error);
        });
      }
      let nextAudioPromise: Promise<AudioSynthesisResult | null> | null = null;
      for (let index = 0; index < chunks.length; index += 1) {
        if (requestId !== voicePlaybackRequestRef.current) return;
        const item = chunks[index];
        const currentAudioPromise =
          nextAudioPromise ??
          synthesizeSpeechAudio(item.chunk, voicePathForRole(item.role), requestId, index === 0);
        const nextItem = chunks[index + 1];
        const result = await currentAudioPromise;
        if (requestId !== voicePlaybackRequestRef.current) return;
        nextAudioPromise = nextItem
          ? synthesizeSpeechAudio(nextItem.chunk, voicePathForRole(nextItem.role), requestId, false)
          : null;
        if (!interruptCurrent && index === 0) {
          await previousSequenceDone;
        }
        if (requestId !== voicePlaybackRequestRef.current) return;
        markSpeakingMessage(item.id);
        await playSpeechAudio(result, requestId, !nextItem ? () => {
          lastSpeechChunkPlaybackStartedRef.current = {
            messageId: item.id,
            at: performance.now(),
            requestId,
          };
          appLog(`voice final chunk playback started message=${item.id} request=${requestId}`);
        } : undefined);
      }
    } finally {
      resolveCurrentSequence();
    }
  };

  const speakMessageText = async (
    messageId: string,
    text: string,
    role: "user" | "assistant",
    options: { queued?: boolean } = {},
  ) => {
    const firstSpeechText = sanitizeTextForSpeech(text);
    if (!firstSpeechText.trim()) {
      return;
    }

    const requestId = options.queued
      ? voicePlaybackRequestRef.current
      : ++voicePlaybackRequestRef.current;
    const startIndex = liveConversation
      ? messages.findIndex((message) => message.id === messageId)
      : -1;
    const sequence =
      liveConversation && startIndex >= 0
        ? messages
            .slice(startIndex)
            .map((message, index) => ({
              id: message.id,
              role: message.role,
              text: index === 0 ? text : extractMessageText(message.content),
            }))
            .filter((message): message is { id: string; role: "user" | "assistant"; text: string } => {
              if (message.role !== "user" && message.role !== "assistant") return false;
              const cleaned = sanitizeTextForSpeech(message.text).trim();
              return Boolean(cleaned) && !cleaned.startsWith("error") && cleaned !== "stopped";
            })
        : [{ id: messageId, role, text }];
    const sequenceIds = new Set(sequence.map((item) => item.id));
    try {
      await playSpeechSequence(sequence, requestId, { interruptCurrent: !options.queued });
      setComposerNotice("");
    } catch (error) {
      console.error("Speech error:", error);
      setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === voicePlaybackRequestRef.current) {
        clearSpeakingMessageForSequence(sequenceIds);
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

  const playAutoSpeechQueue = async (
    queue: string[],
    requestId: number,
    options: { queued?: boolean } = {},
  ) => {
    const sequence = queue
      .map((messageId): SpeechQueueItem | null => {
        const message = messages.find((item) => item.id === messageId && item.role === "assistant");
        return message
          ? { id: messageId, role: "assistant", text: extractMessageText(message.content) }
          : null;
      })
      .filter((item): item is SpeechQueueItem => {
        if (!item) return false;
        const speechText = sanitizeTextForSpeech(item.text);
        if (!speechText.trim()) {
          autoSpeechEligibleAssistantIdsRef.current.delete(item.id);
          return false;
        }
        if (speechText === "stopped" || speechText.startsWith("error")) {
          autoSpeechEligibleAssistantIdsRef.current.delete(item.id);
          return false;
        }
        return true;
      });

    for (const item of sequence) {
      if (requestId !== voicePlaybackRequestRef.current) return;
      lastAutoSpokenAssistantIdRef.current = item.id;
    }

    const sequenceIds = new Set(sequence.map((item) => item.id));
    try {
      await playSpeechSequence(sequence, requestId, { interruptCurrent: !options.queued });
    } catch (error) {
      const failedId = sequence.find((item) => item.id === lastAutoSpokenAssistantIdRef.current)?.id ?? sequence[0]?.id ?? "";
      console.error("Live speech error:", error);
      appLog(`live speech failed message=${failedId} error=${error instanceof Error ? error.message : String(error)}`);
      setComposerNotice(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      try {
        if (requestId === voicePlaybackRequestRef.current) {
          clearSpeakingMessageForSequence(sequenceIds);
        }
        sequence.forEach((item) => autoSpeechEligibleAssistantIdsRef.current.delete(item.id));
        if (activeTaskTypeRef.current === "voice") {
          activeTaskTypeRef.current = "none";
          setActiveTaskType("none");
        }
      } catch {
        // no-op
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
