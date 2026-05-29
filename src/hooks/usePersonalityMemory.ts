import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../types";
import {
  MemoryItem,
  compactMemoryWithBrain,
  formatStructuredMemoryForPrompt,
  mergeTurnIntoMemoryLocally,
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
  const rawPersonalityMemoryShadowRef = useRef<Record<string, string>>({});
  const memoryUpdateSeqRef = useRef(0);

  const saveRawMemory = async (
    personalityId: string,
    rawMemory: string,
    source: string,
  ) => {
    await invoke<MemoryItem>("remember_local_memory", {
      kind: personalityMemoryKind(personalityId),
      key: "compact_style_memory",
      value: rawMemory,
      source,
      confidence: 0.92,
    });
  };

  const applyRawMemory = (personalityId: string, rawMemory: string) => {
    const promptMemory = formatStructuredMemoryForPrompt(rawMemory);
    rawPersonalityMemoryShadowRef.current[personalityId] = rawMemory;
    personalityMemoryShadowRef.current[personalityId] = promptMemory;
    setPersonalityMemory(promptMemory);
  };

  const updatePersonalityMemoryAfterTurn = (userText: string, answerText: string) => {
    if (!selectedPersonalityId) return;
    const personalityId = selectedPersonalityId;
    const currentRaw = rawPersonalityMemoryShadowRef.current[personalityId] ?? "";
    const localRaw = mergeTurnIntoMemoryLocally(currentRaw, userText, answerText);
    if (localRaw === currentRaw) return;
    const updateSeq = memoryUpdateSeqRef.current + 1;
    memoryUpdateSeqRef.current = updateSeq;
    applyRawMemory(personalityId, localRaw);
    saveRawMemory(personalityId, localRaw, "auto_compact_local").catch((error) =>
      console.error("Personality memory save error:", error),
    );

    void compactMemoryWithBrain(localRaw, userText, answerText)
      .then((brainRaw) => {
        if (memoryUpdateSeqRef.current !== updateSeq) return;
        applyRawMemory(personalityId, brainRaw);
        return saveRawMemory(personalityId, brainRaw, "auto_compact_brain");
      })
      .catch((error) => {
        console.error("Personality memory compaction error:", error);
      });
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
      personalityMemoryShadowRef.current[selectedPersonalityId] = "";
      rawPersonalityMemoryShadowRef.current[selectedPersonalityId] = "";
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
        const rawMemory = items.find((item) => item.key === "compact_style_memory")?.value || "";
        applyRawMemory(selectedPersonalityId, rawMemory);
      })
      .catch((error) => {
        console.error("Personality memory load error:", error);
        setPersonalityMemory("");
        personalityMemoryShadowRef.current[selectedPersonalityId] = "";
        rawPersonalityMemoryShadowRef.current[selectedPersonalityId] = "";
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
        const nextRawMemory = items.find((item) => item.key === "compact_style_memory")?.value || "";
        if ((rawPersonalityMemoryShadowRef.current[selectedPersonalityId] ?? "") === nextRawMemory) {
          return;
        }
        applyRawMemory(selectedPersonalityId, nextRawMemory);
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
