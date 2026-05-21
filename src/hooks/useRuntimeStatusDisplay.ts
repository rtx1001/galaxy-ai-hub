import { ModelLoadStatus, VoiceSetupStatus } from "../types";

export function useRuntimeStatusDisplay({
  activeTaskType,
  brainStatus,
  composerNotice,
  currentModelName,
  engineStatus,
  isAudioPlaying,
  isGeneratingImage,
  isStreaming,
  isTranscribing,
  modelLoadStatus,
  omniVoiceStatus,
  selectedModelPath,
  voiceSetupStatus,
}: {
  activeTaskType: "none" | "llm" | "voice" | "image";
  brainStatus: "Idle" | "Loading" | "Ready" | "Thinking" | "Error";
  composerNotice: string;
  currentModelName: string;
  engineStatus: "initializing" | "downloading" | "ready" | "error";
  isAudioPlaying: boolean;
  isGeneratingImage: boolean;
  isStreaming: boolean;
  isTranscribing: boolean;
  modelLoadStatus: ModelLoadStatus;
  omniVoiceStatus: VoiceSetupStatus;
  selectedModelPath: string;
  voiceSetupStatus: VoiceSetupStatus;
}) {
  const compactComposerNotice = composerNotice
    .replace(/^Thinking with tools\.\.\.$/, "Chat: thinking with tools")
    .replace(
      /^Waiting for confirmation before using tools\.$/,
      "Chat: waiting for tool confirmation",
    )
    .replace(/^Preparing voice playback\.\.\.$/, "Voice: preparing playback");

  const topStatusText =
    (brainStatus === "Loading"
      ? `Model: ${modelLoadStatus.message || "loading"}`
      : "") ||
    (brainStatus === "Error"
      ? `Model error: ${modelLoadStatus.message || "could not load"}`
      : "") ||
    (isGeneratingImage ? "Image: generating" : "") ||
    (isTranscribing ? "Voice: transcribing" : "") ||
    (isStreaming ? "Chat: generating reply" : "") ||
    compactComposerNotice ||
    (omniVoiceStatus.state !== "idle" && !omniVoiceStatus.ready
      ? "Voice: preparing playback"
      : "") ||
    (voiceSetupStatus.state !== "idle" && !voiceSetupStatus.ready
      ? `Voice input: ${voiceSetupStatus.message || "preparing"}`
      : "") ||
    (engineStatus === "downloading" ? "Engine: preparing model runtime" : "") ||
    (selectedModelPath ? `Ready: ${currentModelName}` : "No model loaded");

  const topProgressPercent =
    brainStatus === "Loading" || brainStatus === "Error"
      ? Math.max(8, modelLoadStatus.progress)
      : omniVoiceStatus.state !== "idle" && !omniVoiceStatus.ready
        ? Math.max(8, omniVoiceStatus.progress)
        : voiceSetupStatus.state !== "idle" && !voiceSetupStatus.ready
          ? Math.max(8, voiceSetupStatus.progress)
          : isGeneratingImage
            ? 65
            : isTranscribing
              ? 45
              : isStreaming
                ? 100
                : engineStatus === "downloading"
                  ? 25
                  : 0;

  const waveformProcessing =
    isGeneratingImage ||
    isStreaming ||
    isTranscribing ||
    brainStatus === "Loading" ||
    brainStatus === "Thinking" ||
    modelLoadStatus.state === "starting" ||
    modelLoadStatus.state === "loading" ||
    modelLoadStatus.state === "updating" ||
    (activeTaskType === "voice" && !isAudioPlaying) ||
    activeTaskType === "image" ||
    (voiceSetupStatus.state !== "idle" && !voiceSetupStatus.ready) ||
    Boolean(
      composerNotice &&
        /(thinking|preparing|loading|generating|sending|transcribing|starting|updating)/i.test(
          composerNotice,
        ),
    );

  return {
    topStatusText,
    topProgressPercent,
    topProgressActive: topProgressPercent > 0,
    imageStudioDrawing: isGeneratingImage,
    waveformProcessing,
  };
}
