import { Dispatch, MutableRefObject, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatMessage } from "../types";
import { createMessageId } from "../appCore";
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
  setIsGeneratingImage: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  unloadLlmForTask: (taskType: "voice" | "image") => Promise<void>;
  updateAssistantMessageById: (messageId: string, updater: (message: ChatMessage) => ChatMessage) => void;
  updateLastAssistantMessage: (updater: (message: ChatMessage) => ChatMessage) => void;
  userAvatar: string;
};

export function useImageGeneration(options: UseImageGenerationOptions) {
  const handleGenerateImage = async (promptOverride?: string, mode = "text_to_image", maskPrompt?: string | null) => {
    const prompt = (promptOverride ?? options.composerInputRef.current?.value ?? options.input).trim();
    if (!prompt || options.isGeneratingImage) {
      return;
    }
    const latestChatImage = [...options.messages]
      .reverse()
      .find((message) =>
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === "image_url"),
      )
      ?.content;
    const latestChatImageUrl = Array.isArray(latestChatImage)
      ? latestChatImage.find((part) => part.type === "image_url")?.image_url.url
      : null;
    const latestChatImagePath = Array.isArray(latestChatImage)
      ? latestChatImage.find((part) => part.type === "image_url")?.image_url.local_path
      : null;
    const initImageDataUrls = (() => {
      if (mode === "avatar_image") return options.assistantAvatar ? [options.assistantAvatar] : [];
      if (mode === "user_avatar_image" || mode === "avatar_user_image") return options.userAvatar ? [options.userAvatar] : [];
      if (mode === "user_character_image" || mode === "user_and_character_image" || mode === "both_avatars_image") {
        return [options.userAvatar, options.assistantAvatar].filter((value): value is string => Boolean(value));
      }
      const source = options.image || (mode === "image_to_image" ? latestChatImagePath || (latestChatImageUrl?.startsWith("data:image/") ? latestChatImageUrl : null) : null);
      return source ? [source] : [];
    })();
    const needsReferenceImage =
      mode === "avatar_image" ||
      mode === "user_avatar_image" ||
      mode === "avatar_user_image" ||
      mode === "user_character_image" ||
      mode === "user_and_character_image" ||
      mode === "both_avatars_image" ||
      mode === "image_to_image";
    const needsBothAvatars =
      mode === "user_character_image" || mode === "user_and_character_image" || mode === "both_avatars_image";
    if (needsBothAvatars && initImageDataUrls.length < 2) {
      options.setComposerNotice("This image mode needs both the user avatar and character avatar first.");
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
        content: "Sending image...",
        created_at: Date.now(),
      },
    ]);
    options.setComposerText("");
    const imageRunInput = {
      mode,
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
      const naturalReply = await options.generateNaturalImageCompletionReply(prompt, mode, imageUrl);
      options.updateAssistantMessageById(assistantMessageId, (last) => ({
        ...last,
        content: [
          { type: "text", text: naturalReply || "" },
          { type: "image_url", image_url: { url: displayImageUrl, local_path: result.file_path } },
        ],
        completed_at: Date.now(),
        duration_ms: Math.max(0, Math.round(performance.now() - imageTaskStartedAt)),
      }));
      if (options.liveConversationRef.current && naturalReply.trim()) {
        options.autoSpeechEligibleAssistantIdsRef.current.add(assistantMessageId);
      }
      options.clearImage();
      options.setComposerNotice("");
      options.recordClientToolRun(
        "generate_image",
        imageRunInput,
        result.file_path ? `Generated image: ${result.file_path}` : "Generated image.",
        true,
        imageTaskStartedAt,
      ).catch(() => undefined);
    } catch (error) {
      options.recordClientToolRun(
        "generate_image",
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
    }
  };

  return { handleGenerateImage };
}
