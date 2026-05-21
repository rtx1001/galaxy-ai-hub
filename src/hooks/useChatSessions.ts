import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, ChatSessions } from "../types";
import {
  compactChatSessionForStorage,
  compactSessionFingerprint,
  parseStoredChatSession,
} from "../appCore";

type UseChatSessionsOptions = {
  settingsLoaded: boolean;
  selectedPersonalityId: string;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  lastMessageCountRef: MutableRefObject<number>;
  ensureConversationStartsAtBottom: () => void;
  telegramRunning: boolean;
  isStreaming: boolean;
  sendInFlightRef: MutableRefObject<boolean>;
  lastComposerInputAtRef: MutableRefObject<number>;
};

export function useChatSessions({
  settingsLoaded,
  selectedPersonalityId,
  messages,
  setMessages,
  lastMessageCountRef,
  ensureConversationStartsAtBottom,
  telegramRunning,
  isStreaming,
  sendInFlightRef,
  lastComposerInputAtRef,
}: UseChatSessionsOptions) {
  const [chatSessions, setChatSessions] = useState<ChatSessions>({});
  const chatSessionsRef = useRef<ChatSessions>({});
  const loadedChatSessionIdsRef = useRef<Set<string>>(new Set());
  const sessionShadowRef = useRef<Record<string, string>>({});
  const lastSessionMutationAtRef = useRef<Record<string, number>>({});

  const saveActiveChatSession = (
    personalityId = selectedPersonalityId,
    session = messages,
  ) => {
    if (!personalityId) return;
    chatSessionsRef.current = {
      ...chatSessionsRef.current,
      [personalityId]: session,
    };
    setChatSessions((prev) =>
      prev[personalityId] === session ? prev : { ...prev, [personalityId]: session },
    );
  };

  const loadChatSessionForPersonality = (personalityId: string) => {
    const session = chatSessionsRef.current[personalityId] ?? [];
    setMessages(session);
    lastMessageCountRef.current = session.length;
    ensureConversationStartsAtBottom();
  };

  const registerEmptyChatSession = (personalityId: string) => {
    const empty: ChatMessage[] = [];
    loadedChatSessionIdsRef.current.add(personalityId);
    chatSessionsRef.current = { ...chatSessionsRef.current, [personalityId]: empty };
    setChatSessions((prev) => ({ ...prev, [personalityId]: empty }));
    sessionShadowRef.current[personalityId] = compactSessionFingerprint(empty);
    lastSessionMutationAtRef.current[personalityId] = Date.now();
  };

  const removeChatSession = (personalityId: string) => {
    const { [personalityId]: _deletedSession, ...remainingSessions } = chatSessionsRef.current;
    loadedChatSessionIdsRef.current.delete(personalityId);
    delete sessionShadowRef.current[personalityId];
    delete lastSessionMutationAtRef.current[personalityId];
    chatSessionsRef.current = remainingSessions;
    setChatSessions(remainingSessions);
    return remainingSessions;
  };

  const clearActiveChatSession = () => {
    setMessages([]);
    if (selectedPersonalityId) {
      const empty: ChatMessage[] = [];
      chatSessionsRef.current = {
        ...chatSessionsRef.current,
        [selectedPersonalityId]: empty,
      };
      setChatSessions((prev) => ({ ...prev, [selectedPersonalityId]: empty }));
      sessionShadowRef.current[selectedPersonalityId] = compactSessionFingerprint(empty);
      lastSessionMutationAtRef.current[selectedPersonalityId] = Date.now();
    }
  };

  useEffect(() => {
    chatSessionsRef.current = chatSessions;
  }, [chatSessions]);

  useEffect(() => {
    setChatSessions((prev) =>
      prev[selectedPersonalityId] === messages
        ? prev
        : { ...prev, [selectedPersonalityId]: messages },
    );
  }, [messages, selectedPersonalityId]);

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId || loadedChatSessionIdsRef.current.has(selectedPersonalityId)) {
      return;
    }

    let active = true;
    invoke<string>("load_personality_chat_session", { personalityId: selectedPersonalityId })
      .then((raw) => {
        if (!active) return;
        const session = parseStoredChatSession(raw);
        loadedChatSessionIdsRef.current.add(selectedPersonalityId);
        chatSessionsRef.current = { ...chatSessionsRef.current, [selectedPersonalityId]: session };
        setChatSessions((prev) => ({ ...prev, [selectedPersonalityId]: session }));
        setMessages(session);
        lastMessageCountRef.current = session.length;
        sessionShadowRef.current[selectedPersonalityId] = compactSessionFingerprint(session);
        lastSessionMutationAtRef.current[selectedPersonalityId] = Date.now();
      })
      .catch((error) => {
        console.error("Chat session load error:", error);
        loadedChatSessionIdsRef.current.add(selectedPersonalityId);
      });

    return () => {
      active = false;
    };
  }, [settingsLoaded, selectedPersonalityId, setMessages, lastMessageCountRef]);

  useEffect(() => {
    if (!settingsLoaded) return;
    ensureConversationStartsAtBottom();
  }, [settingsLoaded, selectedPersonalityId, messages.length, ensureConversationStartsAtBottom]);

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId || !loadedChatSessionIdsRef.current.has(selectedPersonalityId)) {
      return;
    }
    const session = compactChatSessionForStorage(messages);
    const sessionJson = JSON.stringify(session);
    sessionShadowRef.current[selectedPersonalityId] = sessionJson;
    lastSessionMutationAtRef.current[selectedPersonalityId] = Date.now();
    const handle = window.setTimeout(() => {
      invoke("save_personality_chat_session", {
        personalityId: selectedPersonalityId,
        messagesJson: sessionJson,
      }).catch((error) => console.error("Chat session save error:", error));
    }, 900);
    return () => window.clearTimeout(handle);
  }, [settingsLoaded, selectedPersonalityId, messages]);

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId || !loadedChatSessionIdsRef.current.has(selectedPersonalityId)) {
      return;
    }

    let active = true;
    const syncSession = async () => {
      if (sendInFlightRef.current || isStreaming) return;
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;
      const lastMutation = lastSessionMutationAtRef.current[selectedPersonalityId] ?? 0;
      if (Date.now() - lastMutation < 1800) return;
      try {
        const raw = await invoke<string>("load_personality_chat_session", {
          personalityId: selectedPersonalityId,
        });
        if (!active) return;
        const remoteSession = parseStoredChatSession(raw);
        const remoteFingerprint = compactSessionFingerprint(remoteSession);
        const currentFingerprint =
          sessionShadowRef.current[selectedPersonalityId] ??
          compactSessionFingerprint(chatSessionsRef.current[selectedPersonalityId] ?? []);
        if (remoteFingerprint === currentFingerprint) return;
        sessionShadowRef.current[selectedPersonalityId] = remoteFingerprint;
        chatSessionsRef.current = {
          ...chatSessionsRef.current,
          [selectedPersonalityId]: remoteSession,
        };
        setChatSessions((prev) => ({ ...prev, [selectedPersonalityId]: remoteSession }));
        setMessages(remoteSession);
        lastMessageCountRef.current = remoteSession.length;
      } catch (error) {
        console.error("Chat session sync error:", error);
      }
    };

    const handle = window.setInterval(() => {
      syncSession().catch((error) => console.error("Chat session sync error:", error));
    }, telegramRunning ? 2500 : 5000);

    syncSession().catch((error) => console.error("Chat session sync error:", error));
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, [
    settingsLoaded,
    selectedPersonalityId,
    telegramRunning,
    isStreaming,
    sendInFlightRef,
    lastComposerInputAtRef,
    setMessages,
    lastMessageCountRef,
  ]);

  return {
    saveActiveChatSession,
    loadChatSessionForPersonality,
    registerEmptyChatSession,
    removeChatSession,
    clearActiveChatSession,
  };
}
