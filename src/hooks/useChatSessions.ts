import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, ChatSessions } from "../types";
import {
  cleanAssistantDisplayText,
  compactChatSessionForStorage,
  compactSessionFingerprint,
  parseProfileRefId,
  parseStoredChatSession,
} from "../appCore";

type UseChatSessionsOptions = {
  settingsLoaded: boolean;
  selectedPersonalityId: string;
  selectedUserProfileId: string;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  lastMessageCountRef: MutableRefObject<number>;
  ensureConversationStartsAtBottom: () => void;
  telegramRunning: boolean;
  isStreaming: boolean;
  sendInFlightRef: MutableRefObject<boolean>;
  lastComposerInputAtRef: MutableRefObject<number>;
};

type ChatSessionLoadState = {
  exists: boolean;
  messages_json: string;
};

type ChatPairContext = {
  userProfileId: string;
  personalityId: string;
};

const chatPairSessionIdFor = (leftId: string, rightId: string) => {
  const left = canonicalProfileId(leftId, "user");
  const right = canonicalProfileId(rightId, "personality");
  if (!left || !right) return left || right;
  if (left === right) return `pair:${left}`;
  return `pair:${[left, right].sort((a, b) => a.localeCompare(b)).join("::")}`;
};

const canonicalProfileId = (value: string, fallbackKind: "user" | "personality") => {
  if (!value) return "";
  const ref = parseProfileRefId(value, fallbackKind);
  return `${ref.kind}:${ref.id}`;
};

const chatPairContextFor = (userProfileId: string, personalityId: string): ChatPairContext => ({
  userProfileId: canonicalProfileId(userProfileId, "user"),
  personalityId: canonicalProfileId(personalityId, "personality"),
});

const speakerIdForRole = (role: ChatMessage["role"], context: ChatPairContext) =>
  role === "user" ? context.userProfileId : context.personalityId;

const withSpeakerIds = (session: ChatMessage[], context: ChatPairContext) =>
  session.map((message) => {
    const fallbackSpeakerId = speakerIdForRole(message.role, context);
    return {
      ...message,
      speaker_id: message.speaker_id
        ? canonicalProfileId(message.speaker_id, message.role === "user" ? "user" : "personality")
        : fallbackSpeakerId,
    };
  });

const displaySessionForControlledSpeaker = (session: ChatMessage[], context: ChatPairContext) =>
  withSpeakerIds(session, context).map((message) => ({
    ...message,
    role: message.speaker_id === context.userProfileId ? "user" as const : "assistant" as const,
  }));

const cleanStoredAssistantContent = (content: ChatMessage["content"]): ChatMessage["content"] => {
  if (typeof content === "string") return cleanAssistantDisplayText(content);
  return content.map((part) =>
    part.type === "text"
      ? { ...part, text: cleanAssistantDisplayText(part.text) }
      : part,
  );
};

const cleanStoredAssistantMessages = (session: ChatMessage[]) =>
  session.map((message) =>
    message.role === "assistant"
      ? { ...message, content: cleanStoredAssistantContent(message.content) }
      : message,
  );

export function useChatSessions({
  settingsLoaded,
  selectedPersonalityId,
  selectedUserProfileId,
  messages,
  setMessages,
  lastMessageCountRef,
  ensureConversationStartsAtBottom,
  telegramRunning,
  isStreaming,
  sendInFlightRef,
  lastComposerInputAtRef,
}: UseChatSessionsOptions) {
  const [, setChatSessions] = useState<ChatSessions>({});
  const chatSessionsRef = useRef<ChatSessions>({});
  const liveMessagesRef = useRef<ChatMessage[]>(messages);
  const loadedChatSessionIdsRef = useRef<Set<string>>(new Set());
  const sessionShadowRef = useRef<Record<string, string>>({});
  const lastSessionMutationAtRef = useRef<Record<string, number>>({});
  const activeChatSessionIdRef = useRef("");
  const lastMessagesObjectRef = useRef<ChatMessage[]>(messages);
  const persistSessionTimersRef = useRef<Record<string, number>>({});
  const sessionPairContextsRef = useRef<Record<string, ChatPairContext>>({});
  liveMessagesRef.current = messages;

  const chatSessionIdFor = (personalityId = selectedPersonalityId, userProfileId = selectedUserProfileId) =>
    chatPairSessionIdFor(userProfileId, personalityId);

  const activeChatSessionId = chatSessionIdFor(selectedPersonalityId, selectedUserProfileId);
  activeChatSessionIdRef.current = activeChatSessionId;
  sessionPairContextsRef.current[activeChatSessionId] = chatPairContextFor(selectedUserProfileId, selectedPersonalityId);

  const schedulePersistChatSession = (sessionId: string, session: ChatMessage[], context = sessionPairContextsRef.current[sessionId]) => {
    if (!settingsLoaded || !sessionId || !loadedChatSessionIdsRef.current.has(sessionId)) return;
    if (persistSessionTimersRef.current[sessionId]) {
      window.clearTimeout(persistSessionTimersRef.current[sessionId]);
    }
    const sessionForStorage = context ? withSpeakerIds(session, context) : session;
    const sessionJson = JSON.stringify(compactChatSessionForStorage(sessionForStorage));
    sessionShadowRef.current[sessionId] = sessionJson;
    lastSessionMutationAtRef.current[sessionId] = Date.now();
    persistSessionTimersRef.current[sessionId] = window.setTimeout(() => {
      delete persistSessionTimersRef.current[sessionId];
      invoke("save_personality_chat_session", {
        personalityId: sessionId,
        messagesJson: sessionJson,
      }).catch((error) => console.error("Chat session save error:", error));
    }, 900);
  };

  const updateChatSessionMessages = (
    sessionId: string,
    updater: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[]),
    context = sessionPairContextsRef.current[sessionId],
  ) => {
    if (!sessionId) return;
    if (context) {
      sessionPairContextsRef.current[sessionId] = context;
    }
    const apply = (current: ChatMessage[]) => typeof updater === "function"
      ? (updater as (messages: ChatMessage[]) => ChatMessage[])(current)
      : updater;
    if (activeChatSessionIdRef.current === sessionId) {
      setMessages((prev) => {
        const next = context ? withSpeakerIds(apply(prev), context) : apply(prev);
        const displayNext = context
          ? displaySessionForControlledSpeaker(next, chatPairContextFor(selectedUserProfileId, selectedPersonalityId))
          : next;
        chatSessionsRef.current = { ...chatSessionsRef.current, [sessionId]: displayNext };
        schedulePersistChatSession(sessionId, next, context);
        return displayNext;
      });
      return;
    }
    const current = chatSessionsRef.current[sessionId] ?? [];
    const next = context ? withSpeakerIds(apply(current), context) : apply(current);
    chatSessionsRef.current = { ...chatSessionsRef.current, [sessionId]: next };
    setChatSessions((prev) => ({ ...prev, [sessionId]: next }));
    schedulePersistChatSession(sessionId, next, context);
  };

  const saveActiveChatSession = (
    personalityId = selectedPersonalityId,
    session = messages,
    userProfileId = selectedUserProfileId,
  ) => {
    const canonicalContext = chatPairContextFor(userProfileId, personalityId);
    const sessionId = chatSessionIdFor(personalityId, userProfileId);
    if (!sessionId) return;
    sessionPairContextsRef.current[sessionId] = canonicalContext;
    const sessionForStorage = withSpeakerIds(session, canonicalContext);
    chatSessionsRef.current = {
      ...chatSessionsRef.current,
      [sessionId]: sessionForStorage,
    };
    setChatSessions((prev) =>
      prev[sessionId] === sessionForStorage ? prev : { ...prev, [sessionId]: sessionForStorage },
    );
  };

  const loadChatSessionForPersonality = (personalityId: string, userProfileId = selectedUserProfileId) => {
    const canonicalContext = chatPairContextFor(userProfileId, personalityId);
    const sessionId = chatSessionIdFor(personalityId, userProfileId);
    sessionPairContextsRef.current[sessionId] = canonicalContext;
    const session = displaySessionForControlledSpeaker(chatSessionsRef.current[sessionId] ?? [], canonicalContext);
    setMessages(session);
    lastMessageCountRef.current = session.length;
    ensureConversationStartsAtBottom();
  };

  const registerEmptyChatSession = (personalityId: string, userProfileId = selectedUserProfileId) => {
    const canonicalContext = chatPairContextFor(userProfileId, personalityId);
    const sessionId = chatSessionIdFor(personalityId, userProfileId);
    const empty: ChatMessage[] = [];
    sessionPairContextsRef.current[sessionId] = canonicalContext;
    loadedChatSessionIdsRef.current.add(sessionId);
    chatSessionsRef.current = { ...chatSessionsRef.current, [sessionId]: empty };
    setChatSessions((prev) => ({ ...prev, [sessionId]: empty }));
    sessionShadowRef.current[sessionId] = compactSessionFingerprint(empty);
    lastSessionMutationAtRef.current[sessionId] = Date.now();
  };

  const removeChatSession = (personalityId: string) => {
    const suffix = `::${personalityId}`;
    const remainingSessions = Object.fromEntries(
      Object.entries(chatSessionsRef.current).filter(([sessionId]) => sessionId !== personalityId && !sessionId.endsWith(suffix)),
    );
    for (const sessionId of Object.keys(chatSessionsRef.current)) {
      if (sessionId === personalityId || sessionId.endsWith(suffix)) {
        loadedChatSessionIdsRef.current.delete(sessionId);
        delete sessionShadowRef.current[sessionId];
        delete lastSessionMutationAtRef.current[sessionId];
      }
    }
    chatSessionsRef.current = remainingSessions;
    setChatSessions(remainingSessions);
    return remainingSessions;
  };

  const clearActiveChatSession = () => {
    setMessages([]);
    if (activeChatSessionId) {
      const empty: ChatMessage[] = [];
      chatSessionsRef.current = {
        ...chatSessionsRef.current,
        [activeChatSessionId]: empty,
      };
      setChatSessions((prev) => ({ ...prev, [activeChatSessionId]: empty }));
      sessionShadowRef.current[activeChatSessionId] = compactSessionFingerprint(empty);
      lastSessionMutationAtRef.current[activeChatSessionId] = Date.now();
      invoke("delete_pair_chat_sessions", {
        firstId: selectedUserProfileId,
        secondId: selectedPersonalityId,
      })
        .then(() => invoke("save_personality_chat_session", {
          personalityId: activeChatSessionId,
          messagesJson: "[]",
        }))
        .catch((error) => console.error("Chat session clear error:", error));
    }
  };

  useEffect(() => {
    if (!activeChatSessionId) return;
    if (lastMessagesObjectRef.current === messages) return;
    lastMessagesObjectRef.current = messages;
    const context = sessionPairContextsRef.current[activeChatSessionId] ?? chatPairContextFor(selectedUserProfileId, selectedPersonalityId);
    const session = withSpeakerIds(messages, context);
    setChatSessions((prev) =>
      prev[activeChatSessionId] === session
        ? prev
        : { ...prev, [activeChatSessionId]: session },
    );
    chatSessionsRef.current = {
      ...chatSessionsRef.current,
      [activeChatSessionId]: session,
    };
  }, [messages, activeChatSessionId, selectedUserProfileId, selectedPersonalityId]);

  useEffect(() => {
    if (!settingsLoaded || !activeChatSessionId || loadedChatSessionIdsRef.current.has(activeChatSessionId)) {
      return;
    }

    let active = true;
    const context = chatPairContextFor(selectedUserProfileId, selectedPersonalityId);
    sessionPairContextsRef.current[activeChatSessionId] = context;
    invoke<ChatSessionLoadState>("load_personality_chat_session_state", { personalityId: activeChatSessionId })
      .then(async (state) => {
        if (!active) return;
        let session = parseStoredChatSession(state.messages_json);
        if ((!state.exists || session.length < 1) && activeChatSessionId.includes("::")) {
          const oldPairKeys = [
            `${selectedUserProfileId}::${selectedPersonalityId}`,
            `${selectedPersonalityId}::${selectedUserProfileId}`,
            `${canonicalProfileId(selectedUserProfileId, "user")}::${canonicalProfileId(selectedPersonalityId, "personality")}`,
            `${canonicalProfileId(selectedPersonalityId, "personality")}::${canonicalProfileId(selectedUserProfileId, "user")}`,
          ];
          try {
            for (const oldPairKey of oldPairKeys) {
              const oldPairState = await invoke<ChatSessionLoadState>("load_personality_chat_session_state", {
                personalityId: oldPairKey,
              });
              const oldPairSession = parseStoredChatSession(oldPairState.messages_json);
              if (oldPairState.exists && oldPairSession.length > 0) {
                session = oldPairSession;
                break;
              }
            }
            if (session.length < 1) {
              const legacyState = await invoke<ChatSessionLoadState>("load_personality_chat_session_state", {
                personalityId: selectedPersonalityId,
              });
              const legacySession = parseStoredChatSession(legacyState.messages_json);
              if (legacyState.exists && legacySession.length > 0) {
                session = legacySession;
              }
            }
            if (session.length > 0) {
              const migrated = withSpeakerIds(session, context);
              const migratedJson = JSON.stringify(compactChatSessionForStorage(migrated));
              await invoke("save_personality_chat_session", {
                personalityId: activeChatSessionId,
                messagesJson: migratedJson,
              });
              session = migrated;
            }
          } catch (error) {
            console.error("Legacy chat session import error:", error);
          }
        }
        session = cleanStoredAssistantMessages(withSpeakerIds(session, context));
        const displaySession = displaySessionForControlledSpeaker(session, context);
        loadedChatSessionIdsRef.current.add(activeChatSessionId);
        chatSessionsRef.current = { ...chatSessionsRef.current, [activeChatSessionId]: displaySession };
        setChatSessions((prev) => ({ ...prev, [activeChatSessionId]: displaySession }));
        setMessages(displaySession);
        lastMessagesObjectRef.current = displaySession;
        lastMessageCountRef.current = displaySession.length;
        sessionShadowRef.current[activeChatSessionId] = compactSessionFingerprint(session);
        lastSessionMutationAtRef.current[activeChatSessionId] = Date.now();
      })
      .catch((error) => {
        console.error("Chat session load error:", error);
        loadedChatSessionIdsRef.current.add(activeChatSessionId);
      });

    return () => {
      active = false;
    };
  }, [settingsLoaded, selectedPersonalityId, selectedUserProfileId, activeChatSessionId, setMessages, lastMessageCountRef]);

  useEffect(() => {
    if (!settingsLoaded) return;
    ensureConversationStartsAtBottom();
  }, [settingsLoaded, activeChatSessionId, messages.length, ensureConversationStartsAtBottom]);

  useEffect(() => {
    if (!settingsLoaded || !activeChatSessionId || !loadedChatSessionIdsRef.current.has(activeChatSessionId)) {
      return;
    }
    const context = sessionPairContextsRef.current[activeChatSessionId] ?? chatPairContextFor(selectedUserProfileId, selectedPersonalityId);
    const session = compactChatSessionForStorage(withSpeakerIds(messages, context));
    const sessionJson = JSON.stringify(session);
    sessionShadowRef.current[activeChatSessionId] = sessionJson;
    lastSessionMutationAtRef.current[activeChatSessionId] = Date.now();
    const handle = window.setTimeout(() => {
      invoke("save_personality_chat_session", {
        personalityId: activeChatSessionId,
        messagesJson: sessionJson,
      }).catch((error) => console.error("Chat session save error:", error));
    }, 900);
    return () => window.clearTimeout(handle);
  }, [settingsLoaded, activeChatSessionId, selectedUserProfileId, selectedPersonalityId, messages]);

  useEffect(() => {
    if (!settingsLoaded || !activeChatSessionId || !loadedChatSessionIdsRef.current.has(activeChatSessionId)) {
      return;
    }

    let active = true;
    const syncSession = async () => {
      if (sendInFlightRef.current || isStreaming) return;
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;
      const lastMutation = lastSessionMutationAtRef.current[activeChatSessionId] ?? 0;
      if (Date.now() - lastMutation < 1800) return;
      try {
        const context = sessionPairContextsRef.current[activeChatSessionId] ?? chatPairContextFor(selectedUserProfileId, selectedPersonalityId);
        const raw = await invoke<string>("load_personality_chat_session", {
          personalityId: activeChatSessionId,
        });
        if (!active) return;
        const remoteSession = cleanStoredAssistantMessages(withSpeakerIds(parseStoredChatSession(raw), context));
        const remoteFingerprint = compactSessionFingerprint(remoteSession);
        const localSession = withSpeakerIds(liveMessagesRef.current, context);
        const localFingerprint = compactSessionFingerprint(localSession);
        if (localFingerprint !== remoteFingerprint && localSession.length > remoteSession.length) {
          sessionShadowRef.current[activeChatSessionId] = localFingerprint;
          chatSessionsRef.current = {
            ...chatSessionsRef.current,
            [activeChatSessionId]: localSession,
          };
          return;
        }
        const currentFingerprint =
          sessionShadowRef.current[activeChatSessionId] ??
          compactSessionFingerprint(chatSessionsRef.current[activeChatSessionId] ?? []);
        if (remoteFingerprint === currentFingerprint) return;
        sessionShadowRef.current[activeChatSessionId] = remoteFingerprint;
        const displayRemoteSession = displaySessionForControlledSpeaker(remoteSession, context);
        chatSessionsRef.current = {
          ...chatSessionsRef.current,
          [activeChatSessionId]: displayRemoteSession,
        };
        setChatSessions((prev) => ({ ...prev, [activeChatSessionId]: displayRemoteSession }));
        setMessages(displayRemoteSession);
        lastMessagesObjectRef.current = displayRemoteSession;
        lastMessageCountRef.current = displayRemoteSession.length;
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
    activeChatSessionId,
    selectedUserProfileId,
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
    activeChatSessionId,
    updateChatSessionMessages,
  };
}
