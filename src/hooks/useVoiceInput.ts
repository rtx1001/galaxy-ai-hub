import { useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { VoiceSetupStatus } from "../types";

export function useVoiceInput({
  composerInputRef,
  input,
  setComposerNotice,
  setComposerText,
  unloadLlmForTask,
  voiceSetupStatus,
}: {
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  setComposerNotice: (notice: string) => void;
  setComposerText: (text: string) => void;
  unloadLlmForTask: (taskType: "voice" | "image") => Promise<void>;
  voiceSetupStatus: VoiceSetupStatus;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const handleMicToggle = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (!voiceSetupStatus.ready) {
      setComposerNotice(
        voiceSetupStatus.state === "error"
          ? voiceSetupStatus.message
          : voiceSetupStatus.state === "idle"
            ? "Preparing voice listening now. Click the microphone again when it says ready."
            : "The voice helper is still getting ready. Please wait a moment.",
      );
      if (voiceSetupStatus.state === "idle") {
        await invoke("start_voice_setup");
      }
      return;
    }

    try {
      await unloadLlmForTask("voice");
      if (navigator.permissions?.query) {
        try {
          const permission = await navigator.permissions.query({
            name: "microphone" as PermissionName,
          });
          if (permission.state === "denied") {
            setComposerNotice(
              "Microphone permission is blocked. Allow microphone access in the browser or app settings first.",
            );
            return;
          }
        } catch {
          // Some environments do not expose microphone permission queries.
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      recordedChunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        setIsRecording(false);

        if (blob.size === 0) {
          return;
        }

        setIsTranscribing(true);
        try {
          const reader = new FileReader();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error("Could not read the recording."));
            reader.readAsDataURL(blob);
          });

          const result = await invoke<{
            text: string;
            language: string;
            language_probability: number;
          }>("transcribe_audio", {
            audioDataUrl: dataUrl,
          });

          const currentText = composerInputRef.current?.value ?? input;
          setComposerText(
            currentText ? `${currentText} ${result.text}`.trim() : result.text,
          );
          setComposerNotice("");
        } catch (error) {
          console.error("Transcription error:", error);
          setComposerNotice(error instanceof Error ? error.message : String(error));
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      setComposerNotice("");
      setIsRecording(true);
    } catch (error) {
      console.error("Microphone error:", error);
      setComposerNotice(
        "Microphone access was not granted. Allow microphone access and try again.",
      );
    }
  };

  return {
    isRecording,
    isTranscribing,
    handleMicToggle,
  };
}
