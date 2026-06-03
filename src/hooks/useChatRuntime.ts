import { invoke } from "@tauri-apps/api/core";
import { ChatContentPart, ChatMessage } from "../types";
import {
  AgentReactResult,
  SendOptions,
  buildBrainMessages,
  buildToolAgentMessages,
  createMessageId,
  estimateTokens,
  extractChatResponseText,
  extractMessageText,
  findPendingActionProposal,
  findPendingImageProposal,
  formatReactThinking,
  isExplicitApprovalText,
} from "../appCore";
import { localAssetUrl } from "../utils";

type UseChatRuntimeOptions = Record<string, any>;

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
    finalizeAssistantMessageById,
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
    updateLastAssistantMessage,
    updatePersonalityMemoryAfterTurn,
    userDescription,
    userName,
  } = options;

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
    const attachedImagePath = sendOptions.imagePath ?? imagePath;
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
      content = [
        { type: "text", text: promptText || "Describe this image." },
        { type: "image_url", image_url: { url: displayImageUrl, local_path: attachedImagePath ?? undefined } },
      ];
    }

    const userMessage: ChatMessage = {
      id: editTarget?.id ?? createMessageId(),
      role: "user",
      content,
      created_at: messageCreatedAt,
    };
    const assistantMessageId = createMessageId();

    if (sendOptions.editMessageId && editTargetIndex >= 0) {
      setMessages((prev: ChatMessage[]) => [
        ...prev.slice(0, editTargetIndex),
        userMessage,
        { id: assistantMessageId, role: "assistant", content: "", created_at: Date.now() },
      ]);
    } else if (!sendOptions.silentUser) {
      setMessages((prev: ChatMessage[]) => [...prev, userMessage]);
    }
    if (!sendOptions.text) {
      setComposerText("");
    }
    if (!sendOptions.silentUser && liveConversationRef.current && selectedUserProfile?.auto_speech !== false && typeof content === "string" && content.trim()) {
      void speakMessageText(userMessage.id, content, "user").catch((error: unknown) => {
        console.error("Live user speech error:", error);
      });
    }

    if (!sendOptions.editMessageId && !attachedImage && typeof content === "string" && isExplicitApprovalText(content)) {
      const pendingImageProposal = findPendingImageProposal(messages);
      if (pendingImageProposal) {
        void handleGenerateImage(
          pendingImageProposal.proposal.prompt,
          pendingImageProposal.proposal.mode,
          pendingImageProposal.proposal.mask_prompt,
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
    const newMessages: ChatMessage[] = sendOptions.editMessageId && editTargetIndex >= 0
      ? [...messages.slice(0, editTargetIndex), userMessage]
      : [...messages, userMessage];
    if (!sendOptions.editMessageId) {
      setMessages((prev: ChatMessage[]) => [
        ...prev,
        { id: assistantMessageId, role: "assistant", content: "", created_at: Date.now() },
      ]);
    }
    if (attachedImage && !sendOptions.imageDataUrl) {
      clearImage();
    }
    setIsStreaming(true);
    setBrainStatus("Loading");

    const temperature = samplingTemperature;
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
    const looksLikeBoringSystemFailure = (text: string) =>
      /^\s*(?:\[?Error:|I could not complete that action because|The chat brain returned|Model error:|Connection to the brain failed)/i.test(text);
    const resolveRuntimeLinkedFolders = async () => {
      if (Array.isArray(linkedFolders) && linkedFolders.length) {
        return linkedFolders;
      }
      try {
        const stored = await invoke<{ linked_folders?: string[] }>("load_app_settings");
        const savedFolders = Array.isArray(stored.linked_folders)
          ? stored.linked_folders.filter((folder) => typeof folder === "string" && folder.trim())
          : [];
        if (savedFolders.length) {
          appLog(`chat workspace fallback loaded ${savedFolders.length} saved folder(s) for this request.`);
          return savedFolders;
        }
      } catch (error) {
        appLog(`chat workspace fallback failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return [];
    };
    const flushStreamedText = (force = false) => {
      if (isRequestStale()) return;
      const now = Date.now();
      if (!force && now - lastUiFlush < 45) {
        return;
      }
      lastUiFlush = now;
      updateLastAssistantMessage((last: ChatMessage) => ({
        ...last,
        content: generatedText,
      }));
    };

    try {
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
      const profilePrompt = [
        `Assistant profile:
Name: ${activePersonality?.name || "Assistant"}
Instructions:
${personality || activePersonality?.prompt || "You are a helpful assistant."}`,
        characterSoul.trim() ? `\nAdditional character context:\n${characterSoul.trim()}` : "",
        personalityMemory.trim()
          ? `\nConversation memory:
${personalityMemory.trim()}`
          : "",
        userName.trim() || userDescription.trim()
          ? `\nUser profile:\nName: ${userName.trim() || "User"}\nAbout user: ${userDescription.trim() || ""}`
          : "",
        runtimeLinkedFolders.length
          ? `\nPermitted workspace folders:\n${runtimeLinkedFolders.join("\n")}`
          : "\nPermitted workspace folders: none selected.",
        `\nCurrent date: ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`,
      ].join("");
      const olderConversationMemory = buildOlderConversationMemory(newMessages);
      const effectiveProfilePrompt = olderConversationMemory
        ? `${profilePrompt}\n\nEarlier conversation memory:\n${olderConversationMemory}`
        : profilePrompt;
      const effectiveRequestMessages = buildBrainMessages(effectiveProfilePrompt, newMessages, hasVision);
      const toolAgentMessages = buildToolAgentMessages(newMessages);
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
          ].join(" | "),
          messages: toolAgentMessages,
          folders: runtimeLinkedFolders,
          googleClientId,
          googleClientSecret,
          temperature,
          topK,
          topP,
          minP,
          repeatLastN,
          repeatPenalty,
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
        generatedText = reactResult.answer;
        if (looksLikeBoringSystemFailure(generatedText)) {
          generatedText = await naturalizeFailureReply(generatedText);
        }
        generatedThinking = thinkingEnabled ? formatReactThinking(reactResult) : "";
        appLog(
          `chat-trace response tool=${reactResult.tool_used || "none"} answer=${JSON.stringify(reactResult.answer || "").slice(0, 800)} thinking=${generatedThinking ? "yes" : "no"}`,
        );
        if (sendOptions.autoApproveActions && reactResult.action_proposal) {
          const rawResult = await executeActionProposal(reactResult.action_proposal);
          generatedText = await naturalizeSystemResult(promptText, rawResult);
          const finalizedAssistantIds = finalizeAssistantMessageById(assistantMessageId, (last: ChatMessage) => ({
            ...last,
            content: generatedText,
            thinking: thinkingEnabled ? generatedThinking || last.thinking : undefined,
            ...replyTiming(),
          }));
          const elapsedSeconds = Math.max(0.1, (performance.now() - generationStartedAt) / 1000);
          setLastTokenSpeed(estimateTokens(generatedText) / elapsedSeconds);
          setBrainStatus("Ready");
          setComposerNotice("");
          await updatePersonalityMemoryAfterTurn(promptText, generatedText);
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
          structuredParts.push({
            type: "file_preview",
            file_preview: {
              ...reactResult.file_preview,
              data_url: null,
            },
          });
        }
        if (reactResult.image_proposal) {
          structuredParts.push({ type: "image_proposal", image_proposal: reactResult.image_proposal });
        }
        if (reactResult.action_proposal) {
          structuredParts.push({ type: "action_proposal", action_proposal: reactResult.action_proposal });
        }
        const finalizedAssistantIds = finalizeAssistantMessageById(assistantMessageId, (last: ChatMessage) => ({
          ...last,
          content: structuredParts.length > 1 ? structuredParts : generatedText,
          thinking: thinkingEnabled ? generatedThinking || last.thinking : undefined,
          ...replyTiming(),
        }));
        if (reactResult.file_preview) {
          enrichPreviewPerception(finalizedAssistantIds[0] ?? assistantMessageId, reactResult.file_preview).catch((error: unknown) =>
            console.error("Preview perception enrichment error:", error),
          );
        }
        const elapsedSeconds = Math.max(0.1, (performance.now() - generationStartedAt) / 1000);
        setLastTokenSpeed(estimateTokens(generatedText) / elapsedSeconds);
        setBrainStatus("Ready");
        setComposerNotice("");
        await updatePersonalityMemoryAfterTurn(promptText, generatedText);
        if (liveConversationRef.current) {
          finalizedAssistantIds.forEach((id: string) => autoSpeechEligibleAssistantIdsRef.current.add(id));
        }
        return;
      }

      const chatPayload = {
        messages: effectiveRequestMessages,
        temperature,
        top_k: topK,
        top_p: topP,
        min_p: minP,
        repeat_last_n: repeatLastN,
        repeat_penalty: repeatPenalty,
        max_tokens: replyLength,
        chat_template_kwargs: {
          enable_thinking: thinkingEnabled,
          thinking: thinkingEnabled,
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
        throw new Error(`Chat request failed with status ${response.status}`);
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
              top_k: topK,
              top_p: topP,
              min_p: minP,
              repeat_last_n: repeatLastN,
              repeat_penalty: repeatPenalty,
              max_tokens: replyLength,
              stream: false,
              chat_template_kwargs: {
                enable_thinking: false,
                thinking: false,
              },
            }),
          });

          if (answerResponse.ok) {
            generatedText = extractChatResponseText(await answerResponse.json());
          }
          if (!generatedText.trim()) {
            generatedText = fallbackGeneratedText.trim();
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
          generatedText = extractChatResponseText(retryData);
        }
      }

      if (!generatedText.trim()) {
        appLog(
          `Chat returned no text after stream and retry. model=${selectedModelPath || "none"} messages=${newMessages.length}`,
        );
        throw new Error("The brain returned no text.");
      }
      if (thinkingEnabled && generatedThinking.trim()) {
        updateLastAssistantMessage((last: ChatMessage) => ({
          ...last,
          thinking: generatedThinking.trim(),
        }));
      }
      if (isRequestStale()) return;
      generatedText = await handleShellToolRequest(assistantMessageId, generatedText);
      flushStreamedText(true);
      const finalizedAssistantIds = finalizeAssistantMessageById(assistantMessageId, (last: ChatMessage) => ({
        ...last,
        content: generatedText,
        thinking: thinkingEnabled ? generatedThinking.trim() || last.thinking : undefined,
        ...replyTiming(),
      }));
      await updatePersonalityMemoryAfterTurn(promptText, generatedText);
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
        updateLastAssistantMessage((last: ChatMessage) =>
          last.content === "" ? { ...last, content: "[Stopped]", ...replyTiming() } : { ...last, ...replyTiming() },
        );
        setComposerNotice("Stopped.");
        setBrainStatus("Ready");
        return;
      }
      const partialReply = generatedText.trim();
      if (partialReply) {
        finalizeAssistantMessageById(assistantMessageId, (last: ChatMessage) => ({
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
        updateLastAssistantMessage((last: ChatMessage) => ({
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
