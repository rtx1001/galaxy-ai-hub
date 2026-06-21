import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../types";
import {
  compactMemoryWithBrain,
  formatLongTermMemoryForPrompt,
  type MemoryEvent,
  mergeMemoryEventsIntoSummary,
} from "../appCore";

type UsePersonalityMemoryOptions = {
  settingsLoaded: boolean;
  selectedPersonalityId: string;
  selectedPersonalityName: string;
  selectedMemoryPartnerId: string;
  selectedMemoryPartnerName: string;
  telegramRunning: boolean;
  isStreaming: boolean;
  clearSessionToo: boolean;
  lastComposerInputAtRef: MutableRefObject<number>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setClearMemoryConfirmOpen: Dispatch<SetStateAction<boolean>>;
  setClearSessionToo: Dispatch<SetStateAction<boolean>>;
};

type MemoryContext = {
  key: string;
  personalityId: string;
  personalityName: string;
  partnerId: string;
  partnerName: string;
};

type RelationshipTranscriptCompactInput = {
  firstId: string;
  firstName: string;
  secondId: string;
  secondName: string;
  transcript: string;
};

const relationshipMemoryKeyFor = (firstId: string, secondId: string) => {
  if (!firstId || !secondId) return firstId || secondId;
  if (firstId === secondId) return `pair:${firstId}`;
  return `pair:${[firstId, secondId].sort((a, b) => a.localeCompare(b)).join("::")}`;
};

export function usePersonalityMemory({
  settingsLoaded,
  selectedPersonalityId,
  selectedPersonalityName,
  selectedMemoryPartnerId,
  selectedMemoryPartnerName,
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
  const pendingMemoryEventsRef = useRef<Record<string, MemoryEvent[]>>({});
  const memoryUpdateSeqRef = useRef(0);
  const memoryCompactTimerRef = useRef<number | null>(null);
  const activeMemoryKey = selectedPersonalityId && selectedMemoryPartnerId
    ? relationshipMemoryKeyFor(selectedMemoryPartnerId, selectedPersonalityId)
    : selectedPersonalityId;
  const activeMemoryContext: MemoryContext | null = activeMemoryKey
    ? {
        key: activeMemoryKey,
        personalityId: selectedPersonalityId,
        personalityName: selectedPersonalityName || "Assistant",
        partnerId: selectedMemoryPartnerId,
        partnerName: selectedMemoryPartnerName || "User",
      }
    : null;

  const characterMemoryLooksDefault = (value: string) => {
    const clean = value.trim();
    if (!clean || clean.includes("Nothing important has been remembered yet.")) return true;
    const bulletLines = clean
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"));
    return bulletLines.length > 0 && bulletLines.every((line) => line === "- None yet.");
  };

  const saveRawMemory = async (
    context: MemoryContext,
    rawMemory: string,
  ) => {
    const saved = context.partnerId
      ? await invoke<string>("save_pair_relationship_memory", {
        firstId: context.partnerId,
        firstName: context.partnerName,
        secondId: context.personalityId,
        secondName: context.personalityName,
        memory: rawMemory,
      })
      : await invoke<string>("save_character_memory", {
      id: context.personalityId,
      name: context.personalityName,
      memory: rawMemory,
    });
    rawPersonalityMemoryShadowRef.current[context.key] = saved;
    return saved;
  };

  const applyRawMemory = (memoryKey: string, rawMemory: string, eventItems = pendingMemoryEventsRef.current[memoryKey] ?? []) => {
    const promptMemory = formatLongTermMemoryForPrompt(rawMemory, eventItems);
    rawPersonalityMemoryShadowRef.current[memoryKey] = rawMemory;
    personalityMemoryShadowRef.current[memoryKey] = promptMemory;
    pendingMemoryEventsRef.current[memoryKey] = eventItems;
    setPersonalityMemory(promptMemory);
  };

  const loadMemoryItems = async (context: MemoryContext) => {
    let rawMemory = "";
    try {
      const fileMemory = context.partnerId
        ? await invoke<string>("load_pair_relationship_memory", {
          firstId: context.partnerId,
          firstName: context.partnerName,
          secondId: context.personalityId,
          secondName: context.personalityName,
        })
        : await invoke<string>("load_character_memory", {
          id: context.personalityId,
          name: context.personalityName,
        });
      if (!characterMemoryLooksDefault(fileMemory)) {
        rawMemory = fileMemory;
      }
    } catch (error) {
      console.error("Character memory load error:", error);
    }
    const events = pendingMemoryEventsRef.current[context.key] ?? [];
    return { rawMemory, events };
  };

  const flushPendingMemoryEventsLocally = async (context: MemoryContext) => {
    const memoryKey = context.key;
    const events = pendingMemoryEventsRef.current[memoryKey] ?? [];
    if (events.length < 1) return;
    const updateSeq = memoryUpdateSeqRef.current + 1;
    memoryUpdateSeqRef.current = updateSeq;
    const rawMemory = rawPersonalityMemoryShadowRef.current[memoryKey] ?? "";
    const nextRaw = mergeMemoryEventsIntoSummary(rawMemory, events);
    if (memoryUpdateSeqRef.current !== updateSeq) return;
    const saved = await saveRawMemory(context, nextRaw);
    applyRawMemory(memoryKey, saved || nextRaw, []);
  };

  const scheduleMemoryCompaction = (context: MemoryContext) => {
    if (memoryCompactTimerRef.current) {
      window.clearTimeout(memoryCompactTimerRef.current);
    }
    const events = pendingMemoryEventsRef.current[context.key] ?? [];
    const oldest = events[0]?.created_at ? events[0].created_at * 1000 : Date.now();
    const shouldCompactSoon = events.length >= 8 || Date.now() - oldest > 15 * 60 * 1000;
    const delay = shouldCompactSoon ? 4000 : 45_000;
    memoryCompactTimerRef.current = window.setTimeout(() => {
      flushPendingMemoryEventsLocally(context).catch((error) =>
        console.error("Personality memory local flush error:", error),
      );
    }, delay);
  };

  const updatePersonalityMemoryAfterTurn = (userText: string, answerText: string) => {
    if (!activeMemoryContext) return;
    const context = activeMemoryContext;
    const memoryKey = context.key;
    const cleanUser = userText.trim();
    const cleanAnswer = answerText.trim();
    if (!cleanUser && !cleanAnswer) return;
    const createdAt = Date.now();
    const tempItem: MemoryEvent = { user: cleanUser, assistant: cleanAnswer, created_at: createdAt };
    const currentRaw = rawPersonalityMemoryShadowRef.current[memoryKey] ?? "";
    const nextEvents = [...(pendingMemoryEventsRef.current[memoryKey] ?? []), tempItem].slice(-80);
    applyRawMemory(memoryKey, currentRaw, nextEvents);
    const immediateRaw = mergeMemoryEventsIntoSummary(currentRaw, [tempItem]);
    saveRawMemory(context, immediateRaw)
      .then((saved) => {
        if (!saved) return;
        const events = pendingMemoryEventsRef.current[memoryKey] ?? [];
        applyRawMemory(memoryKey, saved, events);
      })
      .catch((error) => console.error("Personality memory save error:", error));
    scheduleMemoryCompaction(context);
  };

  const compactRelationshipTranscript = async ({
    firstId,
    firstName,
    secondId,
    secondName,
    transcript,
  }: RelationshipTranscriptCompactInput) => {
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript) return;
    const rawMemory = await invoke<string>("load_pair_relationship_memory", {
      firstId,
      firstName,
      secondId,
      secondName,
    });
    const transcriptEvent: MemoryEvent = {
      user: `Plain text chat transcript before app exit:\n${cleanTranscript.slice(-24_000)}`,
      assistant: "",
      created_at: Date.now(),
    };
    let nextRaw = mergeMemoryEventsIntoSummary(rawMemory, [transcriptEvent]);
    try {
      nextRaw = await compactMemoryWithBrain(nextRaw, "", "", [transcriptEvent]);
    } catch (error) {
      console.error("Relationship transcript compaction error:", error);
    }
    const saved = await invoke<string>("save_pair_relationship_memory", {
      firstId,
      firstName,
      secondId,
      secondName,
      memory: nextRaw,
    });
    const memoryKey = relationshipMemoryKeyFor(firstId, secondId);
    if (memoryKey === activeMemoryKey) {
      applyRawMemory(memoryKey, saved || nextRaw, []);
    }
  };

  const deletePersonalityMemory = async (personalityId: string, personalityName = selectedPersonalityName || "Assistant") => {
    try {
      await invoke<string>("clear_character_memory", {
        id: personalityId,
        name: personalityName || "Assistant",
      }).catch((error) => console.error("Character memory clear error:", error));
      await invoke<number>("clear_character_chat_transcripts", {
        characterId: personalityId,
      }).catch((error) => console.error("Character transcript clear error:", error));
    } catch (error) {
      console.error("Personality memory delete error:", error);
    }
  };

  const handleClearPersonalityMemory = async () => {
    if (!selectedPersonalityId || !activeMemoryKey) return;
    try {
      if (selectedMemoryPartnerId) {
        await invoke<string>("clear_pair_relationship_memory", {
          firstId: selectedMemoryPartnerId,
          firstName: selectedMemoryPartnerName || "User",
          secondId: selectedPersonalityId,
          secondName: selectedPersonalityName || "Assistant",
        }).catch((error) => console.error("Relationship memory clear error:", error));
        await invoke<boolean>("clear_pair_chat_transcript", {
          firstId: selectedMemoryPartnerId,
          secondId: selectedPersonalityId,
        }).catch((error) => console.error("Relationship transcript clear error:", error));
      } else {
        await deletePersonalityMemory(selectedPersonalityId);
      }
      setPersonalityMemory("");
      personalityMemoryShadowRef.current[activeMemoryKey] = "";
      rawPersonalityMemoryShadowRef.current[activeMemoryKey] = "";
      pendingMemoryEventsRef.current[activeMemoryKey] = [];
      if (clearSessionToo) {
        if (selectedMemoryPartnerId) {
          await invoke<number>("delete_pair_chat_sessions", {
            firstId: selectedMemoryPartnerId,
            secondId: selectedPersonalityId,
          });
        } else {
          await invoke<boolean>("delete_personality_chat_session", { personalityId: activeMemoryKey });
        }
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
    if (!settingsLoaded || !activeMemoryContext) return;
    const context = activeMemoryContext;
    let active = true;
    loadMemoryItems(context)
      .then(({ rawMemory, events }) => {
        if (!active || context.key !== activeMemoryKey) return;
        applyRawMemory(context.key, rawMemory, events);
        if (events.length >= 8) scheduleMemoryCompaction(context);
      })
      .catch((error) => {
        console.error("Personality memory load error:", error);
        if (!active || context.key !== activeMemoryKey) return;
        setPersonalityMemory("");
        personalityMemoryShadowRef.current[context.key] = "";
        rawPersonalityMemoryShadowRef.current[context.key] = "";
      });
    return () => {
      active = false;
    };
  }, [settingsLoaded, selectedPersonalityId, selectedPersonalityName, selectedMemoryPartnerId, selectedMemoryPartnerName, activeMemoryKey]);

  useEffect(() => {
    if (!settingsLoaded || !activeMemoryContext) return;

    let active = true;
    const context = activeMemoryContext;
    const syncMemory = async () => {
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;
      try {
        const { rawMemory: nextRawMemory, events } = await loadMemoryItems(context);
        if (!active || context.key !== activeMemoryKey) return;
        const eventFingerprint = events.map((item) => `${item.created_at}:${item.user.length}:${item.assistant.length}`).join("|");
        const currentEventFingerprint = (pendingMemoryEventsRef.current[context.key] ?? [])
          .map((item) => `${item.created_at}:${item.user.length}:${item.assistant.length}`)
          .join("|");
        if (
          (rawPersonalityMemoryShadowRef.current[context.key] ?? "") === nextRawMemory &&
          eventFingerprint === currentEventFingerprint
        ) {
          return;
        }
        applyRawMemory(context.key, nextRawMemory, events);
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
  }, [settingsLoaded, selectedPersonalityId, selectedPersonalityName, selectedMemoryPartnerId, selectedMemoryPartnerName, activeMemoryKey, telegramRunning, isStreaming]);

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
    compactRelationshipTranscript,
    deletePersonalityMemory,
    handleClearPersonalityMemory,
  };
}
