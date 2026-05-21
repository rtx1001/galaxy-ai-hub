import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../types";
import {
  MemoryItem,
  includesAnyPhrase,
  normalizeIntentText,
} from "../appCore";

type UsePersonalityMemoryOptions = {
  settingsLoaded: boolean;
  selectedPersonalityId: string;
  telegramRunning: boolean;
  isStreaming: boolean;
  clearSessionToo: boolean;
  lastComposerInputAtRef: MutableRefObject<number>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setClearMemoryConfirmOpen: Dispatch<SetStateAction<boolean>>;
  setClearSessionToo: Dispatch<SetStateAction<boolean>>;
};

const personalityMemoryKind = (id: string) => `personality:${id}`;

const compactPersonalityMemory = (memory: string, feedback: string) => {
  const cleanFeedback = feedback.replace(/\s+/g, " ").trim();
  if (!cleanFeedback) return memory.trim();
  const bullet = `- ${cleanFeedback}`;
  const existing = memory
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== bullet);
  const next = [...existing, bullet].slice(-14).join("\n");
  return next.length > 2200 ? next.slice(next.length - 2200).replace(/^[^\n]*\n?/, "") : next;
};

const isPersonalityTrainingFeedback = (text: string) => {
  const lower = normalizeIntentText(text);
  return includesAnyPhrase(lower, [
    "remember",
    "learn",
    "from now on",
    "answer like",
    "dont answer",
    "do not answer",
    "bad answer",
    "good answer",
    "format like",
    "style like",
    "sai",
  ]);
};

export function usePersonalityMemory({
  settingsLoaded,
  selectedPersonalityId,
  telegramRunning,
  isStreaming,
  clearSessionToo,
  lastComposerInputAtRef,
  setMessages,
  setClearMemoryConfirmOpen,
  setClearSessionToo,
}: UsePersonalityMemoryOptions) {
  const [personalityMemory, setPersonalityMemory] = useState("");
  const personalityMemoryShadowRef = useRef<Record<string, string>>({});

  const updatePersonalityMemoryAfterTurn = async (userText: string, answerText: string) => {
    if (!selectedPersonalityId || !isPersonalityTrainingFeedback(userText)) return;
    const feedback = `User feedback: ${userText}${answerText.trim() ? ` | Last answer summary: ${answerText.trim().slice(0, 220)}` : ""}`;
    const nextMemory = compactPersonalityMemory(personalityMemory, feedback);
    setPersonalityMemory(nextMemory);
    personalityMemoryShadowRef.current[selectedPersonalityId] = nextMemory;
    try {
      await invoke<MemoryItem>("remember_local_memory", {
        kind: personalityMemoryKind(selectedPersonalityId),
        key: "compact_style_memory",
        value: nextMemory,
        source: "personality_training",
        confidence: 0.9,
      });
    } catch (error) {
      console.error("Personality memory save error:", error);
    }
  };

  const deletePersonalityMemory = async (personalityId: string) => {
    try {
      const items = await invoke<MemoryItem[]>("list_local_memory", {
        kind: personalityMemoryKind(personalityId),
        limit: 100,
      });
      await Promise.all(items.map((item) => invoke<boolean>("forget_local_memory", { id: item.id })));
    } catch (error) {
      console.error("Personality memory delete error:", error);
    }
  };

  const handleClearPersonalityMemory = async () => {
    if (!selectedPersonalityId) return;
    try {
      await deletePersonalityMemory(selectedPersonalityId);
      setPersonalityMemory("");
      if (clearSessionToo) {
        await invoke<boolean>("delete_personality_chat_session", { personalityId: selectedPersonalityId });
        setMessages([]);
      }
    } catch (error) {
      console.error("Clear memory error:", error);
    } finally {
      setClearMemoryConfirmOpen(false);
      setClearSessionToo(false);
    }
  };

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId) return;
    invoke<MemoryItem[]>("list_local_memory", {
      kind: personalityMemoryKind(selectedPersonalityId),
      limit: 20,
    })
      .then((items) => {
        const memory = items.find((item) => item.key === "compact_style_memory")?.value || "";
        setPersonalityMemory(memory);
        personalityMemoryShadowRef.current[selectedPersonalityId] = memory;
      })
      .catch((error) => {
        console.error("Personality memory load error:", error);
        setPersonalityMemory("");
        personalityMemoryShadowRef.current[selectedPersonalityId] = "";
      });
  }, [settingsLoaded, selectedPersonalityId]);

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId) return;

    let active = true;
    const syncMemory = async () => {
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;
      try {
        const items = await invoke<MemoryItem[]>("list_local_memory", {
          kind: personalityMemoryKind(selectedPersonalityId),
          limit: 20,
        });
        if (!active) return;
        const nextMemory = items.find((item) => item.key === "compact_style_memory")?.value || "";
        if ((personalityMemoryShadowRef.current[selectedPersonalityId] ?? "") === nextMemory) {
          return;
        }
        personalityMemoryShadowRef.current[selectedPersonalityId] = nextMemory;
        setPersonalityMemory(nextMemory);
      } catch (error) {
        console.error("Personality memory sync error:", error);
      }
    };

    const handle = window.setInterval(() => {
      syncMemory().catch((error) => console.error("Personality memory sync error:", error));
    }, telegramRunning ? 2500 : 5000);

    syncMemory().catch((error) => console.error("Personality memory sync error:", error));
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, [settingsLoaded, selectedPersonalityId, telegramRunning, isStreaming]);

  return {
    personalityMemory,
    updatePersonalityMemoryAfterTurn,
    deletePersonalityMemory,
    handleClearPersonalityMemory,
  };
}
