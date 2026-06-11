import { Dispatch, MutableRefObject, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatMessage } from "../types";
import { DisplayLanguage, createMessageId, findRecentChatImageContext } from "../appCore";
import { imageToolDisplayName, normalizeImageMode } from "../components/ImageModeDropdown";
import { localAssetUrl } from "../utils";

type GeneratedImageResult = {
  image_base64: string;
  mime_type: string;
  file_path: string;
};

type UseImageGenerationOptions = {
  appLog: (message: string) => void;
  assistantAvatar: string;
  autoSpeechEligibleAssistantIdsRef: MutableRefObject<Set<string>>;
  clearImage: () => void;
  chatDisplayLanguage: DisplayLanguage;
  composerInputRef: MutableRefObject<HTMLTextAreaElement | null>;
  generateNaturalImageCompletionReply: (prompt: string, mode: string, imageDataUrl: string) => Promise<string>;
  image: string | null;
  imageHeight: number;
  imageWidth: number;
  input: string;
  isGeneratingImage: boolean;
  liveConversationRef: MutableRefObject<boolean>;
  messages: ChatMessage[];
  recordClientToolRun: (
    name: string,
    input: Record<string, unknown>,
    output: string,
    ok: boolean,
    startedAt: number,
  ) => Promise<void>;
  setComposerNotice: Dispatch<SetStateAction<string>>;
  setComposerText: (value: string) => void;
  activeTaskTypeRef: MutableRefObject<"none" | "llm" | "voice" | "image">;
  setActiveTaskType: Dispatch<SetStateAction<"none" | "llm" | "voice" | "image">>;
  setIsGeneratingImage: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  unloadLlmForTask: (taskType: "voice" | "image") => Promise<void>;
  updateAssistantMessageById: (messageId: string, updater: (message: ChatMessage) => ChatMessage) => void;
  updateLastAssistantMessage: (updater: (message: ChatMessage) => ChatMessage) => void;
  userAvatar: string;
  userName: string;
};

const normalizeReferenceSources = (sources?: string[] | null) =>
  Array.isArray(sources)
    ? sources
        .map((source) => source.trim().toLowerCase().replace(/[-\s]+/g, "_"))
        .filter((source, index, items) =>
          ["chat_image", "user_avatar", "bot_avatar"].includes(source) && items.indexOf(source) === index,
        )
    : [];

const compactImageRefs = (refs: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  return refs.filter((value): value is string => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

const imageSendingStatusText = (language: DisplayLanguage) =>
  language === "vi" ? "\u0110ang g\u1eedi \u1ea3nh..." : "Sending image...";

export function useImageGeneration(options: UseImageGenerationOptions) {
  const handleGenerateImage = async (
    promptOverride?: string,
    mode = "text_image",
    maskPrompt?: string | null,
    extraReferenceImages: string[] = [],
    referenceSources?: string[],
  ) => {
    const normalizedMode = normalizeImageMode(mode);
    const prompt = (promptOverride ?? options.composerInputRef.current?.value ?? options.input).trim();
    if (!prompt || options.isGeneratingImage) {
      return;
    }
    const latestChatImageContext = findRecentChatImageContext(options.messages);
    const latestChatImagePath = latestChatImageContext?.path ?? null;
    const initImageDataUrls = (() => {
      const referenceSourcesProvided = Array.isArray(referenceSources);
      const selectedReferenceSources = normalizeReferenceSources(referenceSources);
      if (normalizedMode === "bot_image") return options.assistantAvatar ? [options.assistantAvatar] : [];
      if (normalizedMode === "user_image") return options.userAvatar ? [options.userAvatar] : [];
      if (normalizedMode === "user_bot_image") {
        return compactImageRefs([options.userAvatar, options.assistantAvatar]);
      }
      const shouldUseChatImage =
        normalizedMode === "image_image" &&
        (!referenceSourcesProvided || selectedReferenceSources.includes("chat_image"));
      const source = options.image || (shouldUseChatImage ? latestChatImagePath : null);
      const userProfileRef =
        normalizedMode === "image_image" && selectedReferenceSources.includes("user_avatar")
          ? options.userAvatar
          : null;
      const botProfileRef =
        normalizedMode === "image_image" && selectedReferenceSources.includes("bot_avatar")
          ? options.assistantAvatar
          : null;
      return compactImageRefs([source, userProfileRef, botProfileRef, ...extraReferenceImages]);
    })();
    const needsReferenceImage =
      normalizedMode === "bot_image" ||
      normalizedMode === "user_image" ||
      normalizedMode === "user_bot_image" ||
      normalizedMode === "image_image";
    const needsBothAvatars = normalizedMode === "user_bot_image";
    if (needsBothAvatars && initImageDataUrls.length < 2) {
      options.setComposerNotice("This image mode needs both the user avatar and assistant avatar first.");
      return;
    }
    if (needsReferenceImage && initImageDataUrls.length === 0) {
      options.setComposerNotice("This image mode needs a profile or attached image first.");
      return;
    }

    const assistantMessageId = createMessageId();
    options.setIsGeneratingImage(true);
    const imageTaskStartedAt = performance.now();
    options.setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: "assistant",
        content: imageSendingStatusText(options.chatDisplayLanguage),
        created_at: Date.now(),
      },
    ]);
    options.setComposerText("");
    const imageRunInput = {
      mode: normalizedMode,
      prompt,
      mask_prompt: maskPrompt || "",
      width: options.imageWidth,
      height: options.imageHeight,
      reference_images: initImageDataUrls.length,
    };

    try {
      await options.unloadLlmForTask("image");
      await invoke("stop_omnivoice_engine").catch(() => undefined);
      options.appLog(
        `image-trace request prompt=${JSON.stringify(prompt).slice(0, 800)} size=${options.imageWidth}x${options.imageHeight}`,
      );
      const result = await invoke<GeneratedImageResult>("generate_image", {
        prompt,
        initImageDataUrl: initImageDataUrls[0] || null,
        initImageDataUrls,
        maskPrompt: maskPrompt || null,
        width: options.imageWidth,
        height: options.imageHeight,
      });
      const imageUrl = `data:${result.mime_type};base64,${result.image_base64}`;
      const displayImageUrl = localAssetUrl(result.file_path) || imageUrl;
      options.appLog(`image-trace response mime=${result.mime_type} bytes_b64=${result.image_base64.length} file=${result.file_path || "<unknown>"}`);
      options.setIsGeneratingImage(false);
      options.updateAssistantMessageById(assistantMessageId, (last) => ({
        ...last,
        content: [
          { type: "image_url", image_url: { url: displayImageUrl, local_path: result.file_path } },
        ],
        completed_at: Date.now(),
        duration_ms: Math.max(0, Math.round(performance.now() - imageTaskStartedAt)),
      }));
      options.clearImage();
      options.setComposerNotice("");
      options.recordClientToolRun(
        imageToolDisplayName(mode),
        imageRunInput,
        result.file_path ? `Generated image: ${result.file_path}` : "Generated image.",
        true,
        imageTaskStartedAt,
      ).catch(() => undefined);
      void options.generateNaturalImageCompletionReply(prompt, normalizedMode, imageUrl)
        .then((naturalReply) => {
          const text = naturalReply.trim();
          if (!text) return;
          options.updateAssistantMessageById(assistantMessageId, (last) => ({
            ...last,
            content: [
              { type: "text", text },
              { type: "image_url", image_url: { url: displayImageUrl, local_path: result.file_path } },
            ],
          }));
          if (options.liveConversationRef.current) {
            options.autoSpeechEligibleAssistantIdsRef.current.add(assistantMessageId);
          }
        })
        .catch((error) => {
          options.appLog(`image completion reply skipped error=${error instanceof Error ? error.message : String(error)}`);
        });
    } catch (error) {
      options.recordClientToolRun(
        imageToolDisplayName(mode),
        imageRunInput,
        error instanceof Error ? error.message : String(error),
        false,
        imageTaskStartedAt,
      ).catch(() => undefined);
      options.updateLastAssistantMessage((last) => ({
        ...last,
        content: error instanceof Error ? error.message : String(error),
        completed_at: Date.now(),
        duration_ms: Math.max(0, Math.round(performance.now() - imageTaskStartedAt)),
      }));
    } finally {
      options.setIsGeneratingImage(false);
      if (options.activeTaskTypeRef.current === "image") {
        options.activeTaskTypeRef.current = "none";
        options.setActiveTaskType("none");
      }
    }
  };

  return { handleGenerateImage };
}
