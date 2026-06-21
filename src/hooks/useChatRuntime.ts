import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { ChatContentPart, ChatMessage, FilePreviewResult } from "../types";
import {
  AgentReactResult,
  BrainMessage,
  LocalImageDataUrl,
  SendOptions,
  buildBrainMessages,
  buildConversationIdentityBlock,
  buildRecentImageContextBlock,
  cleanAssistantDisplayText,
  buildToolAgentMessages,
  createMessageId,
  estimateTokens,
  extractChatResponseText,
  extractMessageText,
  findRecentChatImageContext,
  findPendingActionProposal,
  findPendingImageProposal,
  formatReactThinking,
  hasUnexpectedHanDrift,
  isExplicitApprovalText,
  modelAwareReplySampling,
  splitAssistantMessageForChat,
  stripThinkBlocks,
} from "../appCore";
import { localAssetUrl } from "../utils";

type UseChatRuntimeOptions = Record<string, any>;
const IMAGE_PREVIEW_COMMENT_TIMEOUT_MS = 18_000;

const buildOlderConversationMemory = (chatMessages: ChatMessage[]) => {
  const olderMessages = chatMessages.slice(-50, -18);
  if (!olderMessages.length) return "";
  return olderMessages
    .map((message) => {
      const text = extractMessageText(message.content).replace(/\s+/g, " ").trim();
      if (!text) return "";
      const speaker = message.role === "user" ? "User" : "Assistant";
      return `${speaker}: ${text.slice(0, 220)}`;
    })
    .filter(Boolean)
    .join("\n")
    .slice(-3500);
};

const naturalChatStartDelay = () =>
  new Promise<void>((resolve) => {
    const delayMs = 1000 + Math.floor(Math.random() * 1001);
    window.setTimeout(resolve, delayMs);
  });

const filePreviewToChatPart = (preview: FilePreviewResult): ChatContentPart => {
  const mime = preview.mime_type.toLowerCase();
  if (mime.startsWith("image/")) {
    return {
      type: "image_url",
      image_url: {
        url: localAssetUrl(preview.path) || preview.data_url || "",
        local_path: preview.path,
      },
    };
  }
  return {
    type: "file_preview",
    file_preview: {
      ...preview,
      data_url: null,
    },
  };
};

const materializeVisionMessageImages = async (
  messages: BrainMessage[],
  appLog: (message: string) => void,
): Promise<BrainMessage[]> => {
  let converted = 0;
  const nextMessages = await Promise.all(
    messages.map(async (message) => {
      if (!Array.isArray(message.content)) return message;
      const content = await Promise.all(
        message.content.map(async (part) => {
          if (part.type !== "image_url") return part;
          const localPath = part.image_url.local_path;
          if (!localPath) return part;
          try {
            const image = await invoke<LocalImageDataUrl>("read_local_image_data_url", {
              path: localPath,
            });
            converted += 1;
            return {
              type: "image_url" as const,
              image_url: {
                url: image.data_url,
                local_path: image.path,
              },
            };
          } catch (error) {
            appLog(`vision image materialize failed path=${localPath} error=${error instanceof Error ? error.message : String(error)}`);
            return part;
          }
        }),
      );
      return { ...message, content };
    }),
  );
  if (converted > 0) {
    appLog(`vision image materialized count=${converted}`);
  }
  return nextMessages;
};

const imagePreviewDataUrl = async (
  preview: FilePreviewResult,
  appLog: (message: string) => void,
): Promise<string> => {
  if (preview.data_url?.trim()) return preview.data_url;
  const image = await invoke<LocalImageDataUrl>("read_local_image_data_url", {
    path: preview.path,
  });
  appLog(`image preview perception materialized path=${preview.path}`);
  return image.data_url;
};

export function useChatRuntime(options: UseChatRuntimeOptions) {
  const {
    activeChatAbortRef,
    activeChatRequestRef,
    appLog,
    approveActionProposal,
    autoSpeechEligibleAssistantIdsRef,
    buildSystemContextBlock,
    characterSoul,
    clearImage,
    collectBrainDiagnostics,
    composerInputRef,
    ensureAudioPlaybackUnlocked,
    ensureChatModelReady,
    enrichPreviewPerception,
    executeActionProposal,
    extractSseEventText,
    googleClientId,
    googleClientSecret,
    handleGenerateImage,
    handleShellToolRequest,
    hasVision,
    image,
    imagePath,
    input,
    isStreaming,
    linkedFolders,
    liveConversation,
    liveConversationRef,
    messages,
    minP,
    naturalizeSystemResult,
    personality,
    personalityMemory,
    personalityPresets,
    refreshToolRuns,
    repeatLastN,
    repeatPenalty,
    replyLength,
    samplingTemperature,
    selectedModelPath,
    selectedPersonalityId,
    selectedUserProfile,
    selectedUserProfileId,
    sendInFlightRef,
    setBrainStatus,
    setComposerNotice,
    setComposerText,
    setIsStreaming,
    setLastContextTokens,
    setLastTokenSpeed,
    setMessages,
    speakMessageText,
    thinkingEnabled,
    topK,
    topP,
    updatePersonalityMemoryAfterTurn,
    userDescription,
    userName,
    activeChatSessionId,
    updateChatSessionMessages,
    waitForConversationAudioIdle,
    waitForMessageSpeechStart,
    waitForFinalSpeechChunkStart,
  } = options;
  const linkedFoldersRef = useRef<string[]>(Array.isArray(linkedFolders) ? linkedFolders : []);

  useEffect(() => {
    linkedFoldersRef.current = Array.isArray(linkedFolders)
      ? linkedFolders.filter((folder: unknown): folder is string => typeof folder === "string" && folder.trim().length > 0)
      : [];
  }, [linkedFolders]);

  const handleSend = async (sendOptions: SendOptions = {}) => {
    const editTarget = sendOptions.editMessageId
      ? messages.find((message: ChatMessage) => message.id === sendOptions.editMessageId && message.role === "user")
      : null;
    const editTargetIndex = editTarget
      ? messages.findIndex((message: ChatMessage) => message.id === editTarget.id)
      : -1;
    const promptText = sendOptions.text ?? composerInputRef.current?.value ?? input;
    const editImageParts = editTarget && Array.isArray(editTarget.content)
      ? editTarget.content.filter((part: ChatContentPart): part is Extract<ChatContentPart, { type: "image_url" }> => part.type === "image_url")
      : [];
    const attachedImage = sendOptions.imageDataUrl ?? (sendOptions.text || sendOptions.editMessageId ? null : image);
    const hiddenBrainText =
      sendOptions.brainText?.trim() ||
      (attachedImage && !promptText.trim()
        ? "The user sent this image without text. Look at the image itself and respond naturally with your honest opinion, in the current conversation language. Do not call image generation unless the user explicitly asks for another image or an edit."
        : "");
    const shouldHideVisibleImageText =
      Boolean(hiddenBrainText) && Boolean(attachedImage) && !promptText.trim();
    const shouldSkipImageToolPlanning =
      Boolean(sendOptions.skipLocalIntent) || (Boolean(attachedImage) && !promptText.trim());
    let attachedImagePath = sendOptions.imagePath ?? imagePath;
    if ((!promptText.trim() && !attachedImage) || isStreaming) {
      return;
    }
    if (sendOptions.editMessageId && (!editTarget || editTargetIndex < 0)) {
      appLog(`Edit request ignored because message was not found: ${sendOptions.editMessageId}`);
      return;
    }

    if (sendInFlightRef.current) {
      appLog("Blocked a duplicate send event while another chat request was already running.");
      return;
    }

    if (liveConversation) {
      ensureAudioPlaybackUnlocked().catch(() => null);
    }

    sendInFlightRef.current = true;
    const requestChatSessionId = activeChatSessionId;
    const requestPairContext = {
      userProfileId: selectedUserProfileId,
      personalityId: selectedPersonalityId,
    };
    const setRequestMessages = (updater: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[])) => {
      if (typeof updateChatSessionMessages === "function" && requestChatSessionId) {
        updateChatSessionMessages(requestChatSessionId, updater, requestPairContext);
      } else {
        setMessages(updater as any);
      }
    };
    const updateRequestLastAssistantMessage = (updater: (message: ChatMessage) => ChatMessage) => {
      setRequestMessages((prev: ChatMessage[]) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role !== "assistant") return prev;
        updated[updated.length - 1] = updater(last);
        return updated;
      });
    };
    const finalizeRequestAssistantMessageById = (messageId: string, updater: (message: ChatMessage) => ChatMessage) => {
      let splitIds: string[] = [];
      setRequestMessages((prev: ChatMessage[]) => {
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
    const requestStartedAt = performance.now();
    const messageCreatedAt = Date.now();
    const requestId = activeChatRequestRef.current + 1;
    activeChatRequestRef.current = requestId;
    const isRequestStale = () => activeChatRequestRef.current !== requestId;
    const replyTiming = () => ({
      completed_at: Date.now(),
      duration_ms: Math.max(0, Math.round(performance.now() - requestStartedAt)),
    });

    let content: string | ChatContentPart[] = promptText;
    if (editImageParts.length) {
      content = [
        { type: "text", text: promptText || "Describe this image." },
        ...editImageParts,
      ];
    } else if (attachedImage) {
      const displayImageUrl = attachedImagePath ? localAssetUrl(attachedImagePath) || attachedImage : attachedImage;
      content = shouldHideVisibleImageText
        ? [{ type: "image_url", image_url: { url: displayImageUrl, local_path: attachedImagePath ?? undefined } }]
        : [
            { type: "text", text: promptText || "Describe this image." },
            { type: "image_url", image_url: { url: displayImageUrl, local_path: attachedImagePath ?? undefined } },
          ];
    }

    const preInsertedUserMessageId = sendOptions.preInsertedUserMessageId?.trim();
    const userMessageAlreadyVisible = Boolean(preInsertedUserMessageId && !sendOptions.editMessageId);
    const userMessage: ChatMessage = {
      id: editTarget?.id ?? preInsertedUserMessageId ?? createMessageId(),
      role: "user",
      speaker_id: selectedUserProfileId,
      content,
      created_at: messageCreatedAt,
    };
    const assistantMessageId = createMessageId();

    if (sendOptions.editMessageId && editTargetIndex >= 0) {
      setRequestMessages((prev: ChatMessage[]) => [
        ...prev.slice(0, editTargetIndex),
        userMessage,
        { id: assistantMessageId, role: "assistant", speaker_id: selectedPersonalityId, content: "", created_at: Date.now() },
      ]);
    } else if (!sendOptions.silentUser && !userMessageAlreadyVisible) {
      setRequestMessages((prev: ChatMessage[]) => [...prev, userMessage]);
    }
    if (!sendOptions.text) {
      setComposerText("");
    }
    if (sendOptions.deferUntilAudioIdle && typeof waitForConversationAudioIdle === "function") {
      const waitedMs = await waitForConversationAudioIdle();
      if (waitedMs > 250) {
        appLog(`chat waited for conversation audio idle ms=${waitedMs}`);
      }
    }
    let userSpeechPromise: Promise<void> | null = null;
    if (!sendOptions.silentUser && liveConversationRef.current && selectedUserProfile?.auto_speech !== false && typeof content === "string" && content.trim()) {
      const startedSpeechPromise = speakMessageText(userMessage.id, content, "user", {
        queued: sendOptions.queueSpeechAfterCurrent,
      });
      userSpeechPromise = startedSpeechPromise;
      void startedSpeechPromise.catch((error: unknown) => {
        console.error("Live user speech error:", error);
      });
    }
    if (
      sendOptions.waitForUserSpeechStart &&
      userSpeechPromise &&
      typeof waitForMessageSpeechStart === "function"
    ) {
      const speechPromise = userSpeechPromise;
      const waitedMs = await waitForMessageSpeechStart(userMessage.id);
      if (waitedMs > 250) {
        appLog(`chat waited for user speech start message=${userMessage.id} ms=${waitedMs}`);
      }
      void speechPromise.catch(() => undefined);
    }
    if (
      sendOptions.waitForUserFinalSpeechChunkStart &&
      userSpeechPromise &&
      typeof waitForFinalSpeechChunkStart === "function"
    ) {
      const waitedMs = await waitForFinalSpeechChunkStart(userMessage.id);
      if (waitedMs > 250) {
        appLog(`chat waited for user final speech chunk message=${userMessage.id} ms=${waitedMs}`);
      }
    }

    if (!sendOptions.editMessageId && !attachedImage && typeof content === "string" && isExplicitApprovalText(content)) {
      const pendingImageProposal = findPendingImageProposal(messages);
      if (pendingImageProposal) {
        void handleGenerateImage(
          pendingImageProposal.proposal.prompt,
          pendingImageProposal.proposal.mode,
          pendingImageProposal.proposal.mask_prompt,
          [],
          pendingImageProposal.proposal.reference_sources || [],
        );
        sendInFlightRef.current = false;
        return;
      }
      const pendingActionProposal = findPendingActionProposal(messages);
      if (pendingActionProposal) {
        void approveActionProposal(
          pendingActionProposal.messageId,
          pendingActionProposal.partIndex,
          pendingActionProposal.proposal,
        );
        sendInFlightRef.current = false;
        return;
      }
    }

    setComposerNotice("");
    let newMessages: ChatMessage[] = sendOptions.editMessageId && editTargetIndex >= 0
      ? [...messages.slice(0, editTargetIndex), userMessage]
      : [...messages, userMessage];
    if (!sendOptions.editMessageId) {
      setRequestMessages((prev: ChatMessage[]) => [
        ...prev,
        { id: assistantMessageId, role: "assistant", speaker_id: selectedPersonalityId, content: "", created_at: Date.now() },
      ]);
    }
    if (attachedImage && !attachedImagePath && /^data:image\//i.test(attachedImage)) {
      try {
        const saved = await invoke<LocalImageDataUrl>("save_chat_input_image_data_url", {
          dataUrl: attachedImage,
        });
        attachedImagePath = saved.path;
        const displayImageUrl = saved.data_url;
        const persistedUserMessage: ChatMessage = {
          ...userMessage,
          content: shouldHideVisibleImageText
            ? [{ type: "image_url", image_url: { url: displayImageUrl, local_path: saved.path } }]
            : [
                { type: "text", text: promptText || "Describe this image." },
                { type: "image_url", image_url: { url: displayImageUrl, local_path: saved.path } },
              ],
        };
        newMessages = sendOptions.editMessageId && editTargetIndex >= 0
          ? [...messages.slice(0, editTargetIndex), persistedUserMessage]
          : [...messages, persistedUserMessage];
        setRequestMessages((prev: ChatMessage[]) =>
          prev.map((message) => message.id === userMessage.id ? persistedUserMessage : message),
        );
        appLog(`chat input image persisted path=${saved.path}`);
      } catch (error) {
        appLog(`chat input image persist failed; using data URL fallback: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (attachedImage && !sendOptions.imageDataUrl) {
      clearImage();
    }
    const brainUserMessage: ChatMessage =
      attachedImage && hiddenBrainText
        ? {
            ...userMessage,
            content: [
              { type: "text", text: hiddenBrainText },
              ...(Array.isArray(userMessage.content)
                ? userMessage.content.filter(
                    (part): part is Extract<ChatContentPart, { type: "image_url" }> => part.type === "image_url",
                  )
                : []),
            ],
          }
        : userMessage;
    const requestMessages =
      brainUserMessage === userMessage
        ? newMessages
        : [...newMessages.slice(0, -1), brainUserMessage];
    const memoryPromptText = promptText.trim() || hiddenBrainText;
    setIsStreaming(true);
    setBrainStatus("Loading");

    const replySampling = modelAwareReplySampling({
      modelPath: selectedModelPath,
      temperature: samplingTemperature,
      topK,
      topP,
      minP,
      repeatPenalty,
      thinkingEnabled,
    });
    const temperature = replySampling.temperature;
    const effectiveTopK = replySampling.topK;
    const effectiveTopP = replySampling.topP;
    const effectiveMinP = replySampling.minP;
    const effectiveRepeatPenalty = replySampling.repeatPenalty;
    let generatedText = "";
    let fallbackGeneratedText = "";
    let generatedThinking = "";
    let failed = false;
    let lastUiFlush = 0;
    const naturalizeFailureReply = async (technicalMessage: string) => {
      const result = [
        "The app could not complete the user's request.",
        `Technical reason: ${technicalMessage}`,
        "Explain this naturally as the current character, in the current conversation language.",
        "Final answer only. Do not include thinking, analysis, drafts, plans, or labels.",
        "Do not claim the action succeeded. Do not expose raw backend wording unless the user needs it.",
      ].join("\n");
      const natural = await naturalizeSystemResult(promptText, result);
      return natural.trim() || "I could not complete that yet.";
    };
    const repairMixedScriptDrift = async (rawText: string) => {
      const trimmed = rawText.trim();
      if (!trimmed) return "";
      if (!hasUnexpectedHanDrift(trimmed)) return cleanAssistantDisplayText(trimmed);
      try {
        const recentContext = requestMessages
          .slice(-10)
          .map((message) => {
            const text = extractMessageText(message.content).replace(/\s+/g, " ").trim();
            if (!text) return "";
            return `${message.role === "user" ? "User" : "Assistant"}: ${text.slice(0, 260)}`;
          })
          .filter(Boolean)
          .join("\n");
        const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stream: false,
            temperature: 0.25,
            top_k: Math.max(20, Math.min(effectiveTopK || 40, 40)),
            top_p: Math.min(effectiveTopP || 0.9, 0.9),
            min_p: effectiveMinP,
            repeat_last_n: Math.max(repeatLastN, 128),
            repeat_penalty: Math.max(effectiveRepeatPenalty, 1.1),
            max_tokens: Math.min(Math.max(160, estimateTokens(trimmed) + 80), Math.max(180, replyLength)),
            chat_template_kwargs: {
              enable_thinking: false,
              thinking: false,
            },
            messages: [
              {
                role: "system",
                content: [
                  "Repair a mixed-script model drift in one assistant message.",
                  "Rewrite the message in the main language of the conversation.",
                  "Translate any unexpected foreign-script fragments into that language.",
                  "Preserve the original meaning, tone, names, intimacy level, and relationship style.",
                  "Do not add new events, facts, explanations, labels, or analysis.",
                  "Output only the repaired message.",
                ].join("\n"),
              },
              {
                role: "user",
                content: [
                  recentContext ? `Recent conversation:\n${recentContext}` : "",
                  `Message to repair:\n${trimmed}`,
                ].filter(Boolean).join("\n\n"),
              },
            ],
          }),
        });
        if (!response.ok) return cleanAssistantDisplayText(trimmed);
        const repaired = cleanAssistantDisplayText(extractChatResponseText(await response.json()));
        if (repaired && !hasUnexpectedHanDrift(repaired)) {
          appLog("chat repaired mixed-script drift in assistant reply");
          return repaired;
        }
      } catch (error) {
        appLog(`chat mixed-script repair failed ${error instanceof Error ? error.message : String(error)}`);
      }
      return cleanAssistantDisplayText(trimmed);
    };
    const looksLikeBoringSystemFailure = (text: string) =>
      /^\s*(?:\[?Error:|I could not complete that action because|The chat brain returned|Model error:|Connection to the brain failed)/i.test(text);
    const resolveRuntimeLinkedFolders = async () => {
      const folders = linkedFoldersRef.current;
      appLog(`chat workspace live folders count=${folders.length}`);
      return folders;
    };
    const flushStreamedText = (force = false) => {
      if (isRequestStale()) return;
      const now = Date.now();
      if (!force && now - lastUiFlush < 45) {
        return;
      }
      lastUiFlush = now;
      updateRequestLastAssistantMessage((last: ChatMessage) => ({
        ...last,
        content: generatedText,
      }));
    };

    try {
      if (!sendOptions.silentUser) {
        await naturalChatStartDelay();
      }
      if (isRequestStale()) return;
      const ready = await ensureChatModelReady();
      if (!ready) {
        throw new Error("The chat brain is not ready yet.");
      }

      if (attachedImage && !hasVision) {
        throw new Error("This brain cannot look at pictures yet.");
      }

      setBrainStatus("Thinking");
      const runtimeLinkedFolders = await resolveRuntimeLinkedFolders();
      const activePersonality =
        personalityPresets.find((preset: { id: string }) => preset.id === selectedPersonalityId) ?? personalityPresets[0];
      const assistantName = activePersonality?.name || "Assistant";
      const activeUserName = userName.trim() || "User";
      const profilePrompt = [
        buildConversationIdentityBlock({
          assistantName,
          userName: activeUserName,
          userDescription,
        }),
        "",
        `Assistant profile:
Name: ${assistantName}
Instructions:
${personality || activePersonality?.prompt || "You are a helpful assistant."}`,
        characterSoul.trim() ? `\nAdditional character context:\n${characterSoul.trim()}` : "",
        personalityMemory.trim()
          ? `\nConversation memory:
${personalityMemory.trim()}`
          : "",
        activeUserName || userDescription.trim()
          ? `\nUser profile:\nName: ${activeUserName}\nAbout user: ${userDescription.trim() || ""}`
          : "",
        runtimeLinkedFolders.length
          ? `\nPermitted workspace folders:\n${runtimeLinkedFolders.join("\n")}`
          : "\nPermitted workspace folders: none selected.",
        `\nCurrent date: ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`,
      ].join("");
      const olderConversationMemory = buildOlderConversationMemory(requestMessages);
      const effectiveProfilePrompt = olderConversationMemory
        ? `${profilePrompt}\n\nEarlier conversation memory:\n${olderConversationMemory}`
        : profilePrompt;
      const effectiveRequestMessages = buildBrainMessages(effectiveProfilePrompt, requestMessages, hasVision);
      const toolAgentMessages = buildToolAgentMessages(requestMessages);
      const appendPreviewVisionComment = async (preview: FilePreviewResult, parentMessageId: string) => {
        if (!hasVision || !preview.mime_type.toLowerCase().startsWith("image/") || isRequestStale()) {
          return;
        }
        const startedAt = performance.now();
        try {
          const dataUrl = await imagePreviewDataUrl(preview, appLog);
          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), IMAGE_PREVIEW_COMMENT_TIMEOUT_MS);
          const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [
                {
                  role: "system",
                  content: [
                    effectiveProfilePrompt,
                    "Task: The assistant just displayed a real image preview card in chat. Look at the attached image and write one short, natural follow-up comment as the character.",
                    "Match the current conversation language and relationship tone. Do not mention tools, file paths, prompts, vision, analysis, or metadata. Do not ask a generic follow-up.",
                  ].join("\n\n"),
                },
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: `Latest user request: ${promptText || "The user asked to preview this image."}\nPreviewed file name: ${preview.name}`,
                    },
                    { type: "image_url", image_url: { url: dataUrl } },
                  ],
                },
              ],
              temperature: Math.min(1.0, Math.max(0.45, temperature)),
              top_k: effectiveTopK,
              top_p: effectiveTopP,
              min_p: effectiveMinP,
              repeat_last_n: repeatLastN,
              repeat_penalty: effectiveRepeatPenalty,
              max_tokens: 80,
              stream: false,
              chat_template_kwargs: {
                enable_thinking: false,
                thinking: false,
              },
            }),
          }).finally(() => window.clearTimeout(timeoutId));
          if (!response.ok || isRequestStale()) {
            appLog(`image preview perception skipped status=${response.status}`);
            return;
          }
          const comment = await repairMixedScriptDrift(stripThinkBlocks(extractChatResponseText(await response.json()))
            .replace(/\s+/g, " ")
            .replace(/[\uFFFD\u25A1\u25A0]/g, "")
            .trim());
          if (!comment) return;
          const now = Date.now();
          const commentMessage: ChatMessage = {
            id: createMessageId(),
            role: "assistant",
            speaker_id: selectedPersonalityId,
            content: comment,
            created_at: now,
            completed_at: now,
            duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
          };
          setRequestMessages((prev: ChatMessage[]) => {
            const parentIndex = prev.findIndex((message) => message.id === parentMessageId);
            if (parentIndex < 0) return [...prev, commentMessage];
            return [
              ...prev.slice(0, parentIndex + 1),
              commentMessage,
              ...prev.slice(parentIndex + 1),
            ];
          });
          if (liveConversationRef.current) {
            autoSpeechEligibleAssistantIdsRef.current.add(commentMessage.id);
          }
        } catch (error) {
          appLog(`image preview perception failed error=${error instanceof Error ? error.message : String(error)}`);
        }
      };
      const recentImageContextBlock = buildRecentImageContextBlock(
        findRecentChatImageContext(requestMessages, { skipLatestUserImage: !attachedImage }),
      );
      setLastContextTokens(
        [
          ...effectiveRequestMessages.filter((message) => message.role === "system"),
          ...toolAgentMessages,
        ].reduce((total, message) => {
          const messageContent = Array.isArray(message.content)
            ? extractMessageText(message.content)
            : message.content;
          return total + estimateTokens(messageContent);
        }, 0),
      );
      const generationStartedAt = performance.now();

      if (!attachedImage) {
        setComposerNotice("Thinking with tools...");
        appLog(
          `chat-trace request model=${selectedModelPath || "none"} thinking=${thinkingEnabled} folders=${runtimeLinkedFolders.length} messages=${toolAgentMessages.length}/${newMessages.length} user=${JSON.stringify(promptText).slice(0, 600)}`,
        );
        collectBrainDiagnostics()
          .then((diagnostics: string) => appLog(`chat-diagnostics before_agent ${diagnostics}`))
          .catch(() => {});
        const reactResult = await invoke<AgentReactResult>("agent_jan_chat", {
          runtimePrompt: effectiveProfilePrompt,
          contextBlock: [
            buildSystemContextBlock(),
            `Workspace folders for this request: ${runtimeLinkedFolders.length ? runtimeLinkedFolders.join("; ") : "none"}`,
            recentImageContextBlock,
          ].join(" | "),
          messages: toolAgentMessages,
          folders: runtimeLinkedFolders,
          googleClientId,
          googleClientSecret,
          temperature,
          topK: effectiveTopK,
          topP: effectiveTopP,
          minP: effectiveMinP,
          repeatLastN,
          repeatPenalty: effectiveRepeatPenalty,
          maxTokens: replyLength,
          thinkingEnabled,
          requestElapsedMs: Math.max(0, Math.round(performance.now() - requestStartedAt)),
        });
        if (isRequestStale()) {
          return;
        }
        if (reactResult.tool_trace?.length) {
          refreshToolRuns().catch((error: unknown) => console.error("Tool activity refresh error:", error));
        }
        generatedText = await repairMixedScriptDrift(reactResult.answer);
        if (looksLikeBoringSystemFailure(generatedText)) {
          generatedText = await repairMixedScriptDrift(await naturalizeFailureReply(generatedText));
        }
        generatedThinking = thinkingEnabled ? formatReactThinking(reactResult) : "";
        appLog(
          `chat-trace response tool=${reactResult.tool_used || "none"} answer=${JSON.stringify(reactResult.answer || "").slice(0, 800)} thinking=${generatedThinking ? "yes" : "no"}`,
        );
        if (sendOptions.autoApproveActions && reactResult.action_proposal) {
          const rawResult = await executeActionProposal(reactResult.action_proposal);
          generatedText = await repairMixedScriptDrift(await naturalizeSystemResult(promptText, rawResult));
          const finalizedAssistantIds = finalizeRequestAssistantMessageById(assistantMessageId, (last: ChatMessage) => ({
            ...last,
            content: generatedText,
            thinking: thinkingEnabled ? generatedThinking || last.thinking : undefined,
            ...replyTiming(),
          }));
          const elapsedSeconds = Math.max(0.1, (performance.now() - generationStartedAt) / 1000);
          setLastTokenSpeed(estimateTokens(generatedText) / elapsedSeconds);
          setBrainStatus("Ready");
          setComposerNotice("");
          await updatePersonalityMemoryAfterTurn(memoryPromptText, generatedText);
          if (liveConversationRef.current) {
            finalizedAssistantIds.forEach((id: string) => autoSpeechEligibleAssistantIdsRef.current.add(id));
          }
          return;
        }
        const structuredParts: ChatContentPart[] = [{ type: "text", text: generatedText }];
        if (reactResult.cards?.length) {
          structuredParts.push({ type: "tool_result_cards", cards: reactResult.cards });
        }
        if (reactResult.file_preview) {
          structuredParts.push(filePreviewToChatPart(reactResult.file_preview));
        }
        if (reactResult.image_proposal) {
          structuredParts.push({ type: "image_proposal", image_proposal: reactResult.image_proposal });
        }
        if (reactResult.action_proposal) {
          structuredParts.push({ type: "action_proposal", action_proposal: reactResult.action_proposal });
        }
        const finalizedAssistantIds = finalizeRequestAssistantMessageById(assistantMessageId, (last: ChatMessage) => ({
          ...last,
          content: structuredParts.length > 1 ? structuredParts : generatedText,
          thinking: thinkingEnabled ? generatedThinking || last.thinking : undefined,
          ...replyTiming(),
        }));
        if (reactResult.file_preview) {
          enrichPreviewPerception(finalizedAssistantIds[0] ?? assistantMessageId, reactResult.file_preview).catch((error: unknown) =>
            console.error("Preview perception enrichment error:", error),
          );
          appendPreviewVisionComment(reactResult.file_preview, finalizedAssistantIds[0] ?? assistantMessageId).catch((error: unknown) =>
            console.error("Preview vision comment error:", error),
          );
        }
        const elapsedSeconds = Math.max(0.1, (performance.now() - generationStartedAt) / 1000);
        setLastTokenSpeed(estimateTokens(generatedText) / elapsedSeconds);
        setBrainStatus("Ready");
        setComposerNotice("");
        await updatePersonalityMemoryAfterTurn(memoryPromptText, generatedText);
        if (liveConversationRef.current) {
          finalizedAssistantIds.forEach((id: string) => autoSpeechEligibleAssistantIdsRef.current.add(id));
        }
        return;
      }

      setComposerNotice("Thinking with tools...");
      appLog(
        `chat-trace image request model=${selectedModelPath || "none"} thinking=${thinkingEnabled} folders=${runtimeLinkedFolders.length} messages=${toolAgentMessages.length}/${newMessages.length} user=${JSON.stringify(promptText).slice(0, 600)}`,
      );
      let imageReactResult: AgentReactResult | null = null;
      if (!shouldSkipImageToolPlanning) {
        try {
          imageReactResult = await invoke<AgentReactResult>("agent_jan_chat", {
            runtimePrompt: effectiveProfilePrompt,
            contextBlock: [
              buildSystemContextBlock(),
              `Workspace folders for this request: ${runtimeLinkedFolders.length ? runtimeLinkedFolders.join("; ") : "none"}`,
              recentImageContextBlock,
              "The latest user message includes an attached image. Use image_image if the user asks to edit, transform, redraw, or generate from that image.",
            ].join(" | "),
            messages: toolAgentMessages,
            folders: runtimeLinkedFolders,
            googleClientId,
            googleClientSecret,
            temperature,
            topK: effectiveTopK,
            topP: effectiveTopP,
            minP: effectiveMinP,
            repeatLastN,
            repeatPenalty: effectiveRepeatPenalty,
            maxTokens: replyLength,
            thinkingEnabled,
            requestElapsedMs: Math.max(0, Math.round(performance.now() - requestStartedAt)),
          });
        } catch (error) {
          appLog(`chat-trace image planner failed; falling back to vision chat: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (isRequestStale()) {
        return;
      }
      if (imageReactResult?.tool_trace?.length) {
        refreshToolRuns().catch((error: unknown) => console.error("Tool activity refresh error:", error));
      }
      const imageReactHasStructuredResult = Boolean(
        imageReactResult?.image_proposal ||
        imageReactResult?.action_proposal ||
        imageReactResult?.file_preview ||
        imageReactResult?.cards?.length,
      );
      if (imageReactResult && imageReactHasStructuredResult) {
        generatedText = await repairMixedScriptDrift(imageReactResult.answer);
        if (looksLikeBoringSystemFailure(generatedText)) {
          generatedText = await repairMixedScriptDrift(await naturalizeFailureReply(generatedText));
        }
        generatedThinking = thinkingEnabled ? formatReactThinking(imageReactResult) : "";
        appLog(
          `chat-trace image response tool=${imageReactResult.tool_used || "none"} answer=${JSON.stringify(imageReactResult.answer || "").slice(0, 800)} thinking=${generatedThinking ? "yes" : "no"}`,
        );
        const structuredParts: ChatContentPart[] = [{ type: "text", text: generatedText }];
        if (imageReactResult.cards?.length) {
          structuredParts.push({ type: "tool_result_cards", cards: imageReactResult.cards });
        }
        if (imageReactResult.file_preview) {
          structuredParts.push(filePreviewToChatPart(imageReactResult.file_preview));
        }
        if (imageReactResult.image_proposal) {
          structuredParts.push({ type: "image_proposal", image_proposal: imageReactResult.image_proposal });
        }
        if (imageReactResult.action_proposal) {
          structuredParts.push({ type: "action_proposal", action_proposal: imageReactResult.action_proposal });
        }
        const finalizedAssistantIds = finalizeRequestAssistantMessageById(assistantMessageId, (last: ChatMessage) => ({
          ...last,
          content: structuredParts.length > 1 ? structuredParts : generatedText,
          thinking: thinkingEnabled ? generatedThinking || last.thinking : undefined,
          ...replyTiming(),
        }));
        if (imageReactResult.file_preview) {
          enrichPreviewPerception(finalizedAssistantIds[0] ?? assistantMessageId, imageReactResult.file_preview).catch((error: unknown) =>
            console.error("Preview perception enrichment error:", error),
          );
          appendPreviewVisionComment(imageReactResult.file_preview, finalizedAssistantIds[0] ?? assistantMessageId).catch((error: unknown) =>
            console.error("Preview vision comment error:", error),
          );
        }
        const elapsedSeconds = Math.max(0.1, (performance.now() - generationStartedAt) / 1000);
        setLastTokenSpeed(estimateTokens(generatedText) / elapsedSeconds);
        setBrainStatus("Ready");
        setComposerNotice("");
        await updatePersonalityMemoryAfterTurn(memoryPromptText, generatedText);
        if (liveConversationRef.current) {
          finalizedAssistantIds.forEach((id: string) => autoSpeechEligibleAssistantIdsRef.current.add(id));
        }
        return;
      }
      if (imageReactResult) {
        appLog(
          `chat-trace image planner fallback answer=${JSON.stringify(imageReactResult.answer || "").slice(0, 500)} tool=${imageReactResult.tool_used || "none"}`,
        );
      }

      const visionRequestMessages = await materializeVisionMessageImages(effectiveRequestMessages, appLog);
      const chatPayload = {
        messages: visionRequestMessages,
        temperature,
        top_k: effectiveTopK,
        top_p: effectiveTopP,
        min_p: effectiveMinP,
        repeat_last_n: repeatLastN,
        repeat_penalty: effectiveRepeatPenalty,
        max_tokens: replyLength,
        chat_template_kwargs: {
          enable_thinking: thinkingEnabled && !shouldSkipImageToolPlanning,
          thinking: thinkingEnabled && !shouldSkipImageToolPlanning,
        },
      };

      const abortController = new AbortController();
      activeChatAbortRef.current = abortController;
      const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          ...chatPayload,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`Chat request failed with status ${response.status}. ${errorBody}`.trim());
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let pendingChunk = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (isRequestStale()) break;

        pendingChunk += decoder.decode(value, { stream: true });
        const events = pendingChunk.split(/\r?\n\r?\n/);
        pendingChunk = events.pop() ?? "";

        for (const eventChunk of events) {
          if (isRequestStale()) break;
          const eventText = extractSseEventText(eventChunk);
          generatedText += eventText.visibleText;
          fallbackGeneratedText += eventText.fallbackText;
          if (thinkingEnabled) {
            generatedThinking += eventText.fallbackText;
          }
          const elapsedSeconds = Math.max(0.1, (performance.now() - generationStartedAt) / 1000);
          setLastTokenSpeed(estimateTokens(generatedText) / elapsedSeconds);
          flushStreamedText();
        }
      }

      if (pendingChunk.trim()) {
        if (isRequestStale()) return;
        const eventText = extractSseEventText(pendingChunk.trim());
        generatedText += eventText.visibleText;
        fallbackGeneratedText += eventText.fallbackText;
        if (thinkingEnabled) {
          generatedThinking += eventText.fallbackText;
        }
        const elapsedSeconds = Math.max(0.1, (performance.now() - generationStartedAt) / 1000);
        setLastTokenSpeed(estimateTokens(generatedText) / elapsedSeconds);
      }

      if (!generatedText.trim()) {
        if (fallbackGeneratedText.trim()) {
          const answerResponse = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abortController.signal,
            body: JSON.stringify({
              messages: [
                ...effectiveRequestMessages,
                {
                  role: "assistant",
                  content: fallbackGeneratedText.trim(),
                },
                {
                  role: "user",
                  content: "Now give the final answer only. Do not include hidden thinking.",
                },
              ],
              temperature,
              top_k: effectiveTopK,
              top_p: effectiveTopP,
              min_p: effectiveMinP,
              repeat_last_n: repeatLastN,
              repeat_penalty: effectiveRepeatPenalty,
              max_tokens: replyLength,
              stream: false,
              chat_template_kwargs: {
                enable_thinking: false,
                thinking: false,
              },
            }),
          });

          if (answerResponse.ok) {
            generatedText = await repairMixedScriptDrift(extractChatResponseText(await answerResponse.json()));
          }
          if (!generatedText.trim()) {
          generatedText = await repairMixedScriptDrift(fallbackGeneratedText.trim());
          }
        } else {
          const retryResponse = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abortController.signal,
            body: JSON.stringify({ ...chatPayload, stream: false }),
          });

          if (!retryResponse.ok) {
            throw new Error(`Chat retry failed with status ${retryResponse.status}`);
          }

          const retryData = await retryResponse.json();
          generatedText = await repairMixedScriptDrift(extractChatResponseText(retryData));
        }
      }

      if (!generatedText.trim()) {
        appLog(
          `Chat returned no text after stream and retry. model=${selectedModelPath || "none"} messages=${newMessages.length}`,
        );
        throw new Error("The brain returned no text.");
      }
      if (thinkingEnabled && generatedThinking.trim()) {
        updateRequestLastAssistantMessage((last: ChatMessage) => ({
          ...last,
          thinking: generatedThinking.trim(),
        }));
      }
      if (isRequestStale()) return;
      generatedText = await repairMixedScriptDrift(await handleShellToolRequest(assistantMessageId, generatedText));
      flushStreamedText(true);
      const finalizedAssistantIds = finalizeRequestAssistantMessageById(assistantMessageId, (last: ChatMessage) => ({
        ...last,
        content: generatedText,
        thinking: thinkingEnabled ? generatedThinking.trim() || last.thinking : undefined,
        ...replyTiming(),
      }));
      setComposerNotice("");
      setBrainStatus("Ready");
      await updatePersonalityMemoryAfterTurn(memoryPromptText, generatedText);
      if (liveConversationRef.current) {
        finalizedAssistantIds.forEach((id: string) => autoSpeechEligibleAssistantIdsRef.current.add(id));
      }

    } catch (error) {
      if (isRequestStale()) {
        return;
      }
      console.error("Chat error:", error);
      collectBrainDiagnostics()
        .then((diagnostics: string) =>
          appLog(
            `chat-error message=${JSON.stringify(error instanceof Error ? error.message : String(error))} ${diagnostics}`,
          ),
        )
        .catch(() => {});
      if (error instanceof Error && error.name === "AbortError") {
        updateRequestLastAssistantMessage((last: ChatMessage) =>
          last.content === "" ? { ...last, content: "[Stopped]", ...replyTiming() } : { ...last, ...replyTiming() },
        );
        setComposerNotice("Stopped.");
        setBrainStatus("Ready");
        return;
      }
      const partialReply = generatedText.trim();
      if (partialReply) {
        finalizeRequestAssistantMessageById(assistantMessageId, (last: ChatMessage) => ({
          ...last,
          content: partialReply,
          ...replyTiming(),
        }));
        setComposerNotice(
          error instanceof Error
            ? `The reply stopped early: ${error.message}`
            : "The reply stopped early.",
        );
        setBrainStatus("Ready");
      } else {
        const technicalMessage = error instanceof Error ? error.message : String(error || "Connection to the brain failed.");
        const naturalError = await naturalizeFailureReply(technicalMessage);
        updateRequestLastAssistantMessage((last: ChatMessage) => ({
          ...last,
          content: naturalError,
          ...replyTiming(),
        }));
        setBrainStatus("Error");
        failed = true;
      }
    } finally {
      if (!isRequestStale()) {
        setIsStreaming(false);
        sendInFlightRef.current = false;
        if (!failed && !liveConversation) {
          setBrainStatus("Ready");
        }
      }
      activeChatAbortRef.current = null;
    }
  };

  return { handleSend };
}
