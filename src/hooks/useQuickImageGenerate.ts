import { Dispatch, MutableRefObject, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SendOptions } from "../appCore";
import { imageToolDisplayName, normalizeImageMode } from "../components/ImageModeDropdown";

type GeneratedImageResult = {
  image_base64: string;
  mime_type: string;
  file_path: string;
};

type UseQuickImageGenerateOptions = {
  appLog: (message: string) => void;
  handleSend: (options?: SendOptions) => Promise<void>;
  imageHeight: number;
  imageWidth: number;
  quickImageMode: string;
  isGeneratingImage: boolean;
  quickImagePrompt: string;
  assistantAvatar: string;
  userAvatar: string;
  recordClientToolRun: (
    name: string,
    input: Record<string, unknown>,
    output: string,
    ok: boolean,
    startedAt: number,
  ) => Promise<void>;
  setComposerNotice: Dispatch<SetStateAction<string>>;
  activeTaskTypeRef: MutableRefObject<"none" | "llm" | "voice" | "image">;
  setActiveTaskType: Dispatch<SetStateAction<"none" | "llm" | "voice" | "image">>;
  setIsGeneratingImage: Dispatch<SetStateAction<boolean>>;
  setQuickImagePrompt: Dispatch<SetStateAction<string>>;
  unloadLlmForTask: (taskType: "voice" | "image") => Promise<void>;
};

export function useQuickImageGenerate(options: UseQuickImageGenerateOptions) {
  const handleQuickImageGenerate = async () => {
    const prompt = options.quickImagePrompt.trim();
    if (!prompt || options.isGeneratingImage) {
      return;
    }

    options.setIsGeneratingImage(true);
    options.setComposerNotice("Generating image...");
    const imageTaskStartedAt = performance.now();
    const mode = normalizeImageMode(options.quickImageMode || "text_image");
    const initImageDataUrls = (() => {
      if (mode === "bot_image") {
        return options.assistantAvatar ? [options.assistantAvatar] : [];
      }
      if (mode === "user_image") {
        return options.userAvatar ? [options.userAvatar] : [];
      }
      if (mode === "user_bot_image") {
        return [options.userAvatar, options.assistantAvatar].filter((value): value is string => Boolean(value));
      }
      return [];
    })();
    const needsReferenceImage = mode !== "text_image";
    if (needsReferenceImage && initImageDataUrls.length === 0) {
      options.setIsGeneratingImage(false);
      options.setComposerNotice("This image mode needs a profile avatar first.");
      return;
    }
    if (mode === "user_bot_image" && initImageDataUrls.length < 2) {
      options.setIsGeneratingImage(false);
      options.setComposerNotice("This image mode needs both the user avatar and assistant avatar first.");
      return;
    }
    const imageRunInput = {
      mode,
      prompt,
      width: options.imageWidth,
      height: options.imageHeight,
      source: "image_studio",
    };

    try {
      await options.unloadLlmForTask("image");
      await invoke("stop_omnivoice_engine").catch(() => undefined);
      options.appLog(
        `image-trace quick request prompt=${JSON.stringify(prompt).slice(0, 800)} size=${options.imageWidth}x${options.imageHeight}`,
      );
      const result = await invoke<GeneratedImageResult>("generate_image", {
        prompt,
        initImageDataUrl: initImageDataUrls[0] || null,
        initImageDataUrls,
        maskPrompt: null,
        width: options.imageWidth,
        height: options.imageHeight,
      });
      const imageUrl = `data:${result.mime_type};base64,${result.image_base64}`;
      options.appLog(`image-trace quick response mime=${result.mime_type} bytes_b64=${result.image_base64.length} file=${result.file_path || "<unknown>"}`);
      options.setQuickImagePrompt("");
      options.setComposerNotice("");
      options.setIsGeneratingImage(false);
      options.recordClientToolRun(
        imageToolDisplayName(mode),
        imageRunInput,
        result.file_path ? `Generated image: ${result.file_path}` : "Generated image.",
        true,
        imageTaskStartedAt,
      ).catch(() => undefined);
      await options.handleSend({
        text: prompt,
        imageDataUrl: imageUrl,
        imagePath: result.file_path,
        sourceLabel: "Image Studio",
        skipLocalIntent: true,
      });
    } catch (error) {
      console.error("Quick image generation error:", error);
      options.recordClientToolRun(
        imageToolDisplayName(mode),
        imageRunInput,
        error instanceof Error ? error.message : String(error),
        false,
        imageTaskStartedAt,
      ).catch(() => undefined);
      options.setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      options.setIsGeneratingImage(false);
      if (options.activeTaskTypeRef.current === "image") {
        options.activeTaskTypeRef.current = "none";
        options.setActiveTaskType("none");
      }
    }
  };

  return { handleQuickImageGenerate };
}
