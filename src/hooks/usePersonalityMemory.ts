import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../types";
import {
  MemoryItem,
  compactMemoryWithBrain,
  formatLongTermMemoryForPrompt,
  memoryEventKey,
  mergeMemoryEventsIntoSummary,
  parseMemoryEvent,
  serializeMemoryEvent,
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
  const pendingMemoryEventsRef = useRef<Record<string, MemoryItem[]>>({});
  const memoryUpdateSeqRef = useRef(0);
  const memoryCompactTimerRef = useRef<number | null>(null);

  const eventItemsForPrompt = (items: MemoryItem[]) =>
    items
      .map((item) => parseMemoryEvent(item.value))
      .filter((event): event is NonNullable<typeof event> => Boolean(event));

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

  const applyRawMemory = (personalityId: string, rawMemory: string, eventItems = pendingMemoryEventsRef.current[personalityId] ?? []) => {
    const promptMemory = formatLongTermMemoryForPrompt(rawMemory, eventItemsForPrompt(eventItems));
    rawPersonalityMemoryShadowRef.current[personalityId] = rawMemory;
    personalityMemoryShadowRef.current[personalityId] = promptMemory;
    pendingMemoryEventsRef.current[personalityId] = eventItems;
    setPersonalityMemory(promptMemory);
  };

  const loadMemoryItems = async (personalityId: string) => {
    const items = await invoke<MemoryItem[]>("list_local_memory", {
      kind: personalityMemoryKind(personalityId),
      limit: 500,
    });
    const rawMemory = items.find((item) => item.key === "compact_style_memory")?.value || "";
    const events = items
      .filter((item) => item.key.startsWith("event:"))
      .sort((a, b) => a.created_at - b.created_at);
    return { rawMemory, events };
  };

  const compactPendingMemoryEvents = async (personalityId: string, reason: string) => {
    const events = pendingMemoryEventsRef.current[personalityId] ?? [];
    if (events.length < 1) return;
    const updateSeq = memoryUpdateSeqRef.current + 1;
    memoryUpdateSeqRef.current = updateSeq;
    const rawMemory = rawPersonalityMemoryShadowRef.current[personalityId] ?? "";
    const parsedEvents = eventItemsForPrompt(events);
    let nextRaw = mergeMemoryEventsIntoSummary(rawMemory, parsedEvents);
    try {
      nextRaw = await compactMemoryWithBrain(nextRaw, "", "", parsedEvents);
    } catch (error) {
      console.error("Personality memory compaction error:", error);
    }
    if (memoryUpdateSeqRef.current !== updateSeq) return;
    await saveRawMemory(personalityId, nextRaw, reason);
    await Promise.all(events.map((item) => invoke<boolean>("forget_local_memory", { id: item.id })));
    applyRawMemory(personalityId, nextRaw, []);
  };

  const scheduleMemoryCompaction = (personalityId: string) => {
    if (memoryCompactTimerRef.current) {
      window.clearTimeout(memoryCompactTimerRef.current);
    }
    const events = pendingMemoryEventsRef.current[personalityId] ?? [];
    const oldest = events[0]?.created_at ? events[0].created_at * 1000 : Date.now();
    const shouldCompactSoon = events.length >= 8 || Date.now() - oldest > 15 * 60 * 1000;
    const delay = shouldCompactSoon ? 4000 : 45_000;
    memoryCompactTimerRef.current = window.setTimeout(() => {
      compactPendingMemoryEvents(personalityId, shouldCompactSoon ? "auto_compact_threshold" : "auto_compact_idle").catch((error) =>
        console.error("Personality memory compaction error:", error),
      );
    }, delay);
  };

  const updatePersonalityMemoryAfterTurn = (userText: string, answerText: string) => {
    if (!selectedPersonalityId) return;
    const personalityId = selectedPersonalityId;
    const cleanUser = userText.trim();
    const cleanAnswer = answerText.trim();
    if (!cleanUser && !cleanAnswer) return;
    const createdAt = Date.now();
    const value = serializeMemoryEvent(cleanUser, cleanAnswer, createdAt);
    const tempItem: MemoryItem = {
      id: -createdAt,
      kind: personalityMemoryKind(personalityId),
      key: memoryEventKey(createdAt),
      value,
      source: "memory_event",
      confidence: 0.86,
      created_at: Math.floor(createdAt / 1000),
      updated_at: Math.floor(createdAt / 1000),
    };
    const currentRaw = rawPersonalityMemoryShadowRef.current[personalityId] ?? "";
    const nextEvents = [...(pendingMemoryEventsRef.current[personalityId] ?? []), tempItem].slice(-80);
    applyRawMemory(personalityId, currentRaw, nextEvents);
    invoke<MemoryItem>("remember_local_memory", {
      kind: personalityMemoryKind(personalityId),
      key: tempItem.key,
      value,
      source: "memory_event",
      confidence: 0.86,
    })
      .then((saved) => {
        const events = pendingMemoryEventsRef.current[personalityId] ?? [];
        pendingMemoryEventsRef.current[personalityId] = events.map((item) => (item.key === tempItem.key ? saved : item));
        scheduleMemoryCompaction(personalityId);
      })
      .catch((error) =>
      console.error("Personality memory save error:", error),
    );
    scheduleMemoryCompaction(personalityId);
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
      pendingMemoryEventsRef.current[selectedPersonalityId] = [];
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
    loadMemoryItems(selectedPersonalityId)
      .then(({ rawMemory, events }) => {
        applyRawMemory(selectedPersonalityId, rawMemory, events);
        if (events.length >= 8) scheduleMemoryCompaction(selectedPersonalityId);
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
        const { rawMemory: nextRawMemory, events } = await loadMemoryItems(selectedPersonalityId);
        if (!active) return;
        const eventFingerprint = events.map((item) => `${item.id}:${item.updated_at}`).join("|");
        const currentEventFingerprint = (pendingMemoryEventsRef.current[selectedPersonalityId] ?? [])
          .map((item) => `${item.id}:${item.updated_at}`)
          .join("|");
        if (
          (rawPersonalityMemoryShadowRef.current[selectedPersonalityId] ?? "") === nextRawMemory &&
          eventFingerprint === currentEventFingerprint
        ) {
          return;
        }
        applyRawMemory(selectedPersonalityId, nextRawMemory, events);
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

  useEffect(() => {
    return () => {
      if (memoryCompactTimerRef.current) {
        window.clearTimeout(memoryCompactTimerRef.current);
      }
    };
  }, []);

  return {
    personalityMemory,
    updatePersonalityMemoryAfterTurn,
    deletePersonalityMemory,
    handleClearPersonalityMemory,
  };
}
