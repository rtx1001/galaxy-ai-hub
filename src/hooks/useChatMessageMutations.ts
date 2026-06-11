import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, FilePreviewResult } from "../types";
import { splitAssistantMessageForChat } from "../appCore";

type UseChatMessageMutationsOptions = {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setCollapsedImageParts: Dispatch<SetStateAction<Record<string, boolean>>>;
  autoSpeechEligibleAssistantIdsRef: MutableRefObject<Set<string>>;
  lastAutoSpokenAssistantIdRef: MutableRefObject<string | null>;
  voicePlaybackRequestRef: MutableRefObject<number>;
  speakingMessageId: string | null;
  setSpeakingMessageId: Dispatch<SetStateAction<string | null>>;
  stopActiveAudio: () => void;
  voiceSetupReady: boolean;
};

const transcriptWords = (text: string) =>
  text
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const transcriptLooksUseful = (text: string, preview: FilePreviewResult) => {
  const words = transcriptWords(text);
  if (words.length < 8) return false;
  const uniqueWords = new Set(words.map((word) => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""))).size;
  if (uniqueWords < Math.min(6, words.length)) return false;
  if (preview.size_bytes > 3 * 1024 * 1024 && words.length < 40) return false;
  return true;
};

export function useChatMessageMutations({
  setMessages,
  setCollapsedImageParts,
  autoSpeechEligibleAssistantIdsRef,
  lastAutoSpokenAssistantIdRef,
  voicePlaybackRequestRef,
  speakingMessageId,
  setSpeakingMessageId,
  stopActiveAudio,
  voiceSetupReady,
}: UseChatMessageMutationsOptions) {
  const updateLastAssistantMessage = (
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last.role !== "assistant") return prev;
      updated[updated.length - 1] = updater(last);
      return updated;
    });
  };

  const updateAssistantMessageById = (
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId && message.role === "assistant" ? updater(message) : message,
      ),
    );
  };

  const finalizeAssistantMessageById = (
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    let splitIds: string[] = [];
    setMessages((prev) => {
      const index = prev.findIndex((message) => message.id === messageId && message.role === "assistant");
      if (index < 0) return prev;
      const next = [...prev];
      const updated = updater(next[index]);
      const splitMessages = splitAssistantMessageForChat(updated);
      splitIds = splitMessages.map((message) => message.id);
      next.splice(index, 1, ...splitMessages);
      return next;
    });
    return splitIds.length ? splitIds : [messageId];
  };

  const deleteImageFromChatMessage = (messageId: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId && Array.isArray(message.content)
          ? {
              ...message,
              content: [{ type: "text", text: "Image deleted." }],
              thinking: undefined,
            }
          : message,
      ),
    );
    setCollapsedImageParts((prev) => {
      const next: Record<string, boolean> = {};
      Object.entries(prev).forEach(([key, value]) => {
        if (!key.startsWith(`${messageId}:`)) {
          next[key] = value;
        }
      });
      return next;
    });
    autoSpeechEligibleAssistantIdsRef.current.delete(messageId);
    if (lastAutoSpokenAssistantIdRef.current === messageId) {
      lastAutoSpokenAssistantIdRef.current = null;
    }
    if (speakingMessageId === messageId) {
      voicePlaybackRequestRef.current += 1;
      stopActiveAudio();
      setSpeakingMessageId(null);
    }
  };

  const enrichPreviewPerception = async (messageId: string, preview: FilePreviewResult) => {
    const mime = preview.mime_type.toLowerCase();
    if (!preview.data_url || !mime.startsWith("audio/") || preview.perception) {
      return;
    }
    if (!voiceSetupReady || preview.size_bytes > 30 * 1024 * 1024) {
      return;
    }

    try {
      const result = await invoke<{ text: string; language: string; language_probability: number }>("transcribe_audio", {
        audioDataUrl: preview.data_url,
      });
      const text = result.text.trim();
      if (!text || !transcriptLooksUseful(text, preview)) {
        return;
      }
      const perception = `Transcript (${result.language || "unknown"}): ${text}`;
      updateAssistantMessageById(messageId, (message) => {
        if (!Array.isArray(message.content)) return message;
        return {
          ...message,
          content: message.content.map((part) =>
            part.type === "file_preview" && part.file_preview.path === preview.path
              ? { ...part, file_preview: { ...part.file_preview, perception } }
              : part,
          ),
        };
      });
    } catch (error) {
      console.error("Preview transcription error:", error);
    }
  };

  return {
    updateLastAssistantMessage,
    updateAssistantMessageById,
    finalizeAssistantMessageById,
    deleteImageFromChatMessage,
    enrichPreviewPerception,
  };
}
