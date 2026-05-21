import { useEffect, useRef, type MutableRefObject } from "react";
import type { ChatMessage } from "../types";
import { extractMessageText } from "../appCore";

type UseAutoSpeechQueueOptions = {
  settingsLoaded: boolean;
  messages: ChatMessage[];
  liveConversation: boolean;
  isStreaming: boolean;
  isGeneratingImage: boolean;
  isTranscribing: boolean;
  speakingMessageId: string | null;
  selectedVoicePath: string;
  autoSpeechEligibleAssistantIdsRef: MutableRefObject<Set<string>>;
  lastAutoSpokenAssistantIdRef: MutableRefObject<string | null>;
  voicePlaybackRequestRef: MutableRefObject<number>;
  ensureAudioPlaybackUnlocked: () => Promise<unknown>;
  playAutoSpeechQueue: (queue: string[], requestId: number) => Promise<void>;
};

export function useAutoSpeechQueue({
  settingsLoaded,
  messages,
  liveConversation,
  isStreaming,
  isGeneratingImage,
  isTranscribing,
  speakingMessageId,
  selectedVoicePath,
  autoSpeechEligibleAssistantIdsRef,
  lastAutoSpokenAssistantIdRef,
  voicePlaybackRequestRef,
  ensureAudioPlaybackUnlocked,
  playAutoSpeechQueue,
}: UseAutoSpeechQueueOptions) {
  const ensureAudioPlaybackUnlockedRef = useRef(ensureAudioPlaybackUnlocked);
  const playAutoSpeechQueueRef = useRef(playAutoSpeechQueue);
  ensureAudioPlaybackUnlockedRef.current = ensureAudioPlaybackUnlocked;
  playAutoSpeechQueueRef.current = playAutoSpeechQueue;

  useEffect(() => {
    if (!settingsLoaded || !liveConversation || isStreaming || isGeneratingImage || isTranscribing || speakingMessageId) {
      return;
    }

    const queue = messages
      .filter((message) => message.role === "assistant" && autoSpeechEligibleAssistantIdsRef.current.has(message.id))
      .map((message) => message.id);
    if (!queue.length) {
      return;
    }

    const firstMessage = messages.find((message) => message.id === queue[0]);
    const firstText = firstMessage ? extractMessageText(firstMessage.content).trim() : "";
    if (!firstText || firstText.startsWith("[Error") || firstText === "[Stopped]") {
      autoSpeechEligibleAssistantIdsRef.current.delete(queue[0]);
      return;
    }

    if (lastAutoSpokenAssistantIdRef.current === queue[0]) {
      return;
    }

    ensureAudioPlaybackUnlockedRef.current().catch(() => null);
    const requestId = ++voicePlaybackRequestRef.current;
    playAutoSpeechQueueRef.current(queue, requestId).catch((error) => {
      console.error("Live speech queue error:", error);
    });
  }, [
    settingsLoaded,
    messages,
    liveConversation,
    isStreaming,
    isGeneratingImage,
    isTranscribing,
    speakingMessageId,
    selectedVoicePath,
  ]);
}
