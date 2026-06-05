import { useEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { AudioSynthesisResult, PersonalityPreset, UserProfilePreset, VoiceSample } from "../appCore";
import { sanitizeTextForSpeech } from "../appCore";
import { CameraIcon, CloseIcon, DownloadIcon, FolderIcon, PlayIcon, SaveIcon, SpeakerIcon, StopIcon, TrashIcon } from "./Icons";
import { AvatarImage, IconButton, NumberStepper } from "./UI";

function VoiceSampleList({
  samples,
  selectedPath,
  selectedSample,
  previewingPath,
  selectedRowRef,
  onPreview,
  onSelect,
}: {
  samples: VoiceSample[];
  selectedPath: string;
  selectedSample?: VoiceSample | null;
  previewingPath: string | null;
  selectedRowRef: RefObject<HTMLDivElement | null>;
  onPreview: (sample: VoiceSample) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-[#c4c7c5]">Selected voice sample</span>
        {selectedSample && <span className="max-w-[160px] truncate text-[var(--accent-color)]">{selectedSample.label}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden border-t border-[var(--accent-soft-strong)] pt-1">
        <div className="profile-voice-list h-full space-y-1.5 overflow-y-auto pr-3" data-voice-menu>
          {samples.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#282a2c] px-3 py-8 text-center text-sm text-[#c4c7c5]">No voice samples found.</div>
          ) : (
            samples.map((sample) => {
              const selected = selectedPath === sample.path;
              const previewing = previewingPath === sample.path;
              return (
                <div
                  key={sample.path}
                  ref={selected ? selectedRowRef : undefined}
                  data-selected-voice={selected ? "true" : undefined}
                  className={`flex items-center gap-2 rounded-xl px-2 py-1.5 transition ${selected ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent-soft-strong)]" : "hover:bg-[#1e1f20]"}`}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPreview(sample);
                    }}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#282a2c] bg-[#1e1f20] text-[var(--accent-color)] transition hover:bg-[#282a2c]"
                    title={`Preview ${sample.label}`}
                  >
                    {previewing ? <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-color)]" /> : <PlayIcon />}
                  </button>
                  <button type="button" onClick={() => onSelect(sample.path)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[13px] font-semibold text-[#e3e3e3]">{sample.label}</div>
                    <div className="truncate text-[10px] leading-4 text-[#9aa0a6]">Preview</div>
                  </button>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${selected ? "bg-[var(--accent-color)]" : "bg-[#3a3b3d]"}`} />
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

function VoicePanel({
  title,
  voiceFolder,
  samples,
  selectedPath,
  selectedSample,
  previewingPath,
  selectedRowRef,
  onChooseFolder,
  onPreview,
  onSelect,
}: {
  title: string;
  voiceFolder: string;
  samples: VoiceSample[];
  selectedPath: string;
  selectedSample?: VoiceSample | null;
  previewingPath: string | null;
  selectedRowRef: RefObject<HTMLDivElement | null>;
  onChooseFolder: () => void;
  onPreview: (sample: VoiceSample) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col rounded-2xl border border-[#282a2c] bg-[#0f1011] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-[#e3e3e3]">{title}</div>
        <div className="shrink-0 text-xs font-semibold text-[#c4c7c5]">{samples.length} samples</div>
      </div>
      <div className="mb-3 flex items-center gap-2 rounded-2xl border border-[#282a2c] bg-[#131314] px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9aa0a6]">Voice folder</div>
          <div className="mt-1 truncate text-xs text-[#c4c7c5]">
            {voiceFolder || "Default voices folder"}
          </div>
        </div>
        <IconButton title="Choose voice samples folder" onClick={onChooseFolder} size="sm">
          <FolderIcon className="h-4 w-4" />
        </IconButton>
      </div>
      <VoiceSampleList
        samples={samples}
        selectedPath={selectedPath}
        selectedSample={selectedSample}
        previewingPath={previewingPath}
        selectedRowRef={selectedRowRef}
        onPreview={onPreview}
        onSelect={onSelect}
      />
    </div>
  );
}

function audioResultToBlob(result: AudioSynthesisResult) {
  const binary = atob(result.audio_base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: result.mime_type || "audio/wav" });
}

function safeVoiceDownloadName(name: string) {
  const clean = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${clean || "voice-test"}.wav`;
}

function isInterruptedPlayError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

type VoiceTestCacheResult = {
  path: string;
  audio_base64: string;
  mime_type: string;
};

const VOICE_TEST_DRAFT_STORAGE_PREFIX = "galaxy.voiceTestDraft";

function CharacterVoiceTestBlock({
  characterName,
  selectedVoicePath,
  storageKey,
}: {
  characterName: string;
  selectedVoicePath: string;
  storageKey: string;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [rendering, setRendering] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [cachedPath, setCachedPath] = useState("");
  const [cachedKey, setCachedKey] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");
  const currentKey = JSON.stringify([selectedVoicePath || "", sanitizeTextForSpeech(text)]);
  const draftStorageKey = `${VOICE_TEST_DRAFT_STORAGE_PREFIX}.${storageKey || "default"}`;

  useEffect(() => () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
  }, []);

  useEffect(() => {
    try {
      setText(localStorage.getItem(draftStorageKey) || "");
    } catch {
      setText("");
    }
    setStatus("");
    setCachedPath("");
    setCachedKey("");
  }, [draftStorageKey]);

  useEffect(() => {
    try {
      if (text) {
        localStorage.setItem(draftStorageKey, text);
      } else {
        localStorage.removeItem(draftStorageKey);
      }
    } catch {
      // localStorage can be unavailable in restricted environments.
    }
  }, [draftStorageKey, text]);

  const stopPreviousAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlaying(false);
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
      setAudioUrl("");
    }
  };

  const loadAudioResult = async (result: AudioSynthesisResult | VoiceTestCacheResult, path: string) => {
    const nextUrl = URL.createObjectURL(audioResultToBlob(result));
    stopPreviousAudio();
    audioUrlRef.current = nextUrl;
    setAudioUrl(nextUrl);
    setCachedPath(path);
    setCachedKey(currentKey);
    const audio = new Audio(nextUrl);
    audioRef.current = audio;
    audio.addEventListener("ended", () => setPlaying(false));
    audio.addEventListener("pause", () => setPlaying(false));
    audio.addEventListener("play", () => setPlaying(true));
    await audio.play().catch((error) => {
      if (!isInterruptedPlayError(error)) throw error;
    });
    setStatus("Voice ready");
  };

  const renderAndPlay = async () => {
    const speechText = sanitizeTextForSpeech(text);
    if (!speechText.trim() || rendering) return;
    if (playing) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setPlaying(false);
      return;
    }
    setRendering(true);
    try {
      if (audioRef.current && audioUrl && cachedKey === currentKey) {
        audioRef.current.currentTime = 0;
        await audioRef.current.play().catch((error) => {
          if (!isInterruptedPlayError(error)) throw error;
        });
        setStatus("Voice ready");
        return;
      }
      setStatus("Checking cache...");
      const cached = await invoke<VoiceTestCacheResult | null>("get_cached_voice_test_speech", {
        text: speechText,
        voiceSamplePath: selectedVoicePath || null,
      });
      if (cached) {
        await loadAudioResult(cached, cached.path);
        return;
      }
      setStatus("Rendering voice...");
      await invoke("prepare_omnivoice_engine").catch(() => undefined);
      const result = await invoke<AudioSynthesisResult>("synthesize_speech", {
        text: speechText,
        voiceSamplePath: selectedVoicePath || null,
        useSidecar: false,
      });
      const saved = await invoke<VoiceTestCacheResult>("save_voice_test_speech", {
        text: speechText,
        voiceSamplePath: selectedVoicePath || null,
        audioBase64: result.audio_base64,
      });
      await loadAudioResult(saved, saved.path);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setRendering(false);
    }
  };

  const downloadRenderedVoice = async () => {
    if (!cachedPath || cachedKey !== currentKey) return;
    const destination = await save({
      defaultPath: safeVoiceDownloadName(`${characterName || "character"} voice test`),
      filters: [{ name: "WAV audio", extensions: ["wav"] }],
    });
    if (!destination) return;
    try {
      await invoke("copy_voice_test_speech", {
        sourcePath: cachedPath,
        destinationPath: destination,
      });
      setStatus("WAV saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const cachedAudioReady = Boolean(cachedPath && cachedKey === currentKey);

  return (
    <div className="flex min-h-[132px] flex-col">
      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setStatus("");
        }}
        className="min-h-0 flex-1 resize-none rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-2.5 text-sm leading-5 text-[#e3e3e3] outline-none transition placeholder:text-[#6f767d] focus:border-[var(--accent-color)]"
        placeholder={`Type or paste text for ${characterName || "this character"}...`}
      />
      <div className="mt-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#c4c7c5]">Test voice</div>
          {status && <div className="truncate text-[10px] font-semibold text-[#9aa0a6]">{status}</div>}
        </div>
        <button
          type="button"
          onClick={() => void renderAndPlay()}
          disabled={!text.trim() || rendering}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-2xl bg-[var(--accent-color)] px-4 text-xs font-bold text-[#131314] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {playing ? <StopIcon className="h-4 w-4" /> : <SpeakerIcon className="h-4 w-4" />}
          {playing ? "Stop" : rendering ? "Rendering" : "Speak"}
        </button>
        <button
          type="button"
          onClick={() => void downloadRenderedVoice()}
          disabled={!cachedAudioReady}
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition ${
            cachedAudioReady
              ? "bg-[var(--accent-soft)] text-[var(--accent-color)] hover:bg-[var(--accent-soft-strong)]"
              : "cursor-not-allowed bg-[#131314] text-[#5f666d] opacity-55"
          }`}
          title={cachedAudioReady ? "Download rendered WAV" : "Render speech first"}
        >
          <DownloadIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function UserProfileModal({
  open,
  userName,
  userAvatar,
  userDescription,
  profileCount,
  selectedProfile,
  selectedVoicePath,
  selectedVoiceSample,
  voiceFolder,
  voiceSamples,
  previewingVoicePath,
  selectedVoiceRowRef,
  onClose,
  onChooseAvatar,
  onUserNameChange,
  onUserDescriptionChange,
  onChooseVoiceFolder,
  onPreviewVoice,
  onSelectVoice,
  onToggleAutoSpeech,
  onRequestDelete,
  onSave,
}: {
  open: boolean;
  userName: string;
  userAvatar: string;
  userDescription: string;
  profileCount: number;
  selectedProfile?: UserProfilePreset;
  selectedVoicePath: string;
  selectedVoiceSample?: VoiceSample | null;
  voiceFolder: string;
  voiceSamples: VoiceSample[];
  previewingVoicePath: string | null;
  selectedVoiceRowRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onChooseAvatar: () => void;
  onUserNameChange: (value: string) => void;
  onUserDescriptionChange: (value: string) => void;
  onChooseVoiceFolder: () => void;
  onPreviewVoice: (sample: VoiceSample) => void;
  onSelectVoice: (path: string) => void;
  onToggleAutoSpeech: () => void;
  onRequestDelete: () => void;
  onSave: () => void;
}) {
  if (!open) return null;
  const autoSpeech = selectedProfile?.auto_speech ?? true;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4 py-3 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[calc(100vh-32px)] w-full max-w-[780px] flex-col overflow-hidden rounded-[24px] border border-[#282a2c] bg-[#1e1f20] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#282a2c] px-5 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--accent-color)" }}>User Profile</div>
            <div className="mt-1 truncate text-lg font-bold text-[#f1f3f4]">{userName.trim() || "You"}</div>
          </div>
          <IconButton title="Close profile editor" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-4 py-3 md:h-[560px] md:grid-cols-[minmax(0,0.88fr)_minmax(320px,1fr)] md:overflow-hidden">
          <div className="grid min-h-0 grid-rows-[auto_auto_minmax(132px,1fr)_minmax(132px,1fr)] gap-2.5 overflow-y-auto overflow-x-hidden rounded-2xl border border-[#282a2c] bg-[#1b1c1e] p-3 [scrollbar-gutter:stable]">
            <div className="flex justify-center">
              <button type="button" onClick={onChooseAvatar} className="group relative h-32 w-32 shrink-0 overflow-hidden rounded-[18px] ring-1 ring-[#282a2c]" title="Change avatar">
                <AvatarImage src={userAvatar} fallback={userName || "You"} className="h-full w-full rounded-[18px]" />
                <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-[#e3e3e3] group-hover:flex">
                  <CameraIcon className="h-6 w-6" />
                </span>
              </button>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-[#c4c7c5]">Profile name</span>
              <input value={userName} onChange={(event) => onUserNameChange(event.target.value)} className="h-10 w-full rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 text-sm font-semibold text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]" placeholder="Your name" />
            </label>
            <label className="flex min-h-0 flex-col">
              <span className="mb-1.5 block text-xs font-semibold text-[#c4c7c5]">About you</span>
              <textarea value={userDescription} onChange={(event) => onUserDescriptionChange(event.target.value)} rows={7} className="min-h-0 flex-1 resize-none rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-2.5 text-sm leading-5 text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]" placeholder="Details the assistant should remember about you." />
            </label>
            <CharacterVoiceTestBlock
              characterName={userName.trim() || "you"}
              selectedVoicePath={selectedVoicePath}
              storageKey={`user.${selectedProfile?.id || "active"}`}
            />
          </div>
          <VoicePanel
            title="User voice"
            voiceFolder={voiceFolder}
            samples={voiceSamples}
            selectedPath={selectedVoicePath}
            selectedSample={selectedVoiceSample}
            previewingPath={previewingVoicePath}
            selectedRowRef={selectedVoiceRowRef}
            onChooseFolder={onChooseVoiceFolder}
            onPreview={onPreviewVoice}
            onSelect={onSelectVoice}
          />
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#282a2c] px-5 py-2">
          <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#c4c7c5]">
            <button type="button" onClick={onToggleAutoSpeech} className={`relative h-5 w-9 shrink-0 rounded-full transition ${autoSpeech ? "bg-[var(--accent-color)]" : "bg-[#3a3b3d]"}`} aria-pressed={autoSpeech}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[#0f1011] transition ${autoSpeech ? "left-[18px]" : "left-0.5"}`} />
            </button>
            <span className="truncate">Auto speech</span>
          </label>
          <div className="flex items-center justify-end gap-2">
            <button type="button" disabled={profileCount <= 1} onClick={onRequestDelete} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#282a2c] bg-[#131314] text-rose-200 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-40" title="Delete user profile">
              <TrashIcon className="h-4 w-4" />
            </button>
            <button type="button" onClick={onSave} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--accent-color)] bg-[var(--accent-color)] text-[#131314] transition hover:brightness-110" title="Save user profile">
              <SaveIcon className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} className="h-10 rounded-2xl border border-[#282a2c] bg-[#131314] px-4 text-xs font-bold text-[#e3e3e3] transition hover:bg-[#282a2c]">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CharacterProfileModal({
  open,
  preset,
  fallbackAvatar,
  nameDraft,
  personality,
  profileCount,
  memorySize,
  replyLength,
  minContextSize,
  selectedVoicePath,
  selectedVoiceSample,
  voiceFolder,
  voiceSamples,
  previewingVoicePath,
  selectedVoiceRowRef,
  onClose,
  onChooseAvatar,
  onNameChange,
  onPersonalityChange,
  onChooseVoiceFolder,
  onPreviewVoice,
  onSelectVoice,
  onMemorySizeChange,
  onReplyLengthChange,
  onRequestDelete,
  onRequestClearMemory,
  onSave,
}: {
  open: boolean;
  preset?: PersonalityPreset;
  fallbackAvatar: string;
  nameDraft: string;
  personality: string;
  profileCount: number;
  memorySize: number;
  replyLength: number;
  minContextSize: number;
  selectedVoicePath: string;
  selectedVoiceSample?: VoiceSample | null;
  voiceFolder: string;
  voiceSamples: VoiceSample[];
  previewingVoicePath: string | null;
  selectedVoiceRowRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onChooseAvatar: () => void;
  onNameChange: (value: string) => void;
  onPersonalityChange: (value: string) => void;
  onChooseVoiceFolder: () => void;
  onPreviewVoice: (sample: VoiceSample) => void;
  onSelectVoice: (path: string) => void;
  onMemorySizeChange: (value: number) => void;
  onReplyLengthChange: (value: number) => void;
  onRequestDelete: () => void;
  onRequestClearMemory: () => void;
  onSave: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4 py-3 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[calc(100vh-32px)] w-full max-w-[780px] flex-col overflow-hidden rounded-[24px] border border-[#282a2c] bg-[#1e1f20] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#282a2c] px-5 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--accent-color)" }}>Assistant Profile</div>
            <div className="mt-1 truncate text-lg font-bold text-[#f1f3f4]">{preset?.name || "Assistant"}</div>
          </div>
          <IconButton title="Close profile editor" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto overflow-x-hidden px-4 py-3 md:h-[560px] md:grid-cols-[minmax(0,0.88fr)_minmax(320px,1fr)] md:overflow-hidden">
          <div className="grid min-h-0 grid-rows-[auto_auto_minmax(132px,1fr)_minmax(132px,1fr)] gap-2.5 overflow-y-auto overflow-x-hidden rounded-2xl border border-[#282a2c] bg-[#1b1c1e] p-3 [scrollbar-gutter:stable]">
            <div className="flex shrink-0 justify-center">
              <button type="button" onClick={onChooseAvatar} className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-[16px] ring-1 ring-[#282a2c] sm:h-28 sm:w-28 sm:rounded-[17px] [@media(min-height:760px)]:md:h-32 [@media(min-height:760px)]:md:w-32 [@media(min-height:760px)]:md:rounded-[18px]" title="Change avatar">
                <AvatarImage src={preset?.avatar || fallbackAvatar} fallback={preset?.name || "AI"} className="h-full w-full rounded-[16px] sm:rounded-[17px] [@media(min-height:760px)]:md:rounded-[18px]" />
                <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-[#e3e3e3] group-hover:flex">
                  <CameraIcon className="h-6 w-6" />
                </span>
              </button>
            </div>
            <label className="block shrink-0">
              <span className="mb-1.5 block text-xs font-semibold text-[#c4c7c5]">Character name</span>
              <input value={nameDraft} onChange={(event) => onNameChange(event.target.value)} className="h-10 w-full rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 text-sm font-semibold text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]" placeholder="Assistant name" />
            </label>
            <label className="flex min-h-0 flex-col">
              <span className="mb-1.5 block text-xs font-semibold text-[#c4c7c5]">Personality</span>
              <textarea value={personality} onChange={(event) => onPersonalityChange(event.target.value)} rows={7} className="min-h-0 flex-1 resize-none rounded-2xl border border-[#282a2c] bg-[#0f1011] px-3 py-2.5 text-sm leading-5 text-[#e3e3e3] outline-none transition focus:border-[var(--accent-color)]" placeholder="Describe how this assistant should think, speak, and behave." />
            </label>
            <CharacterVoiceTestBlock
              characterName={nameDraft || preset?.name || "this character"}
              selectedVoicePath={selectedVoicePath}
              storageKey={`character.${preset?.id || "active"}`}
            />
          </div>
          <VoicePanel
            title="Character voice"
            voiceFolder={voiceFolder}
            samples={voiceSamples}
            selectedPath={selectedVoicePath}
            selectedSample={selectedVoiceSample}
            previewingPath={previewingVoicePath}
            selectedRowRef={selectedVoiceRowRef}
            onChooseFolder={onChooseVoiceFolder}
            onPreview={onPreviewVoice}
            onSelect={onSelectVoice}
          />
        </div>

        <div className="flex shrink-0 items-end justify-between gap-4 border-t border-[#282a2c] px-5 py-2">
          <div className="flex min-w-0 items-end gap-3">
            <label className="block w-[132px] shrink-0">
              <div className="mb-1 text-[11px] font-semibold text-[#c4c7c5]">Context size</div>
              <NumberStepper value={memorySize} min={minContextSize} max={32768} step={512} onChange={onMemorySizeChange} className="w-[132px]" />
            </label>
            <label className="block w-[132px] shrink-0">
              <div className="mb-1 text-[11px] font-semibold text-[#c4c7c5]">Reply size</div>
              <NumberStepper value={replyLength} min={64} max={4096} step={64} onChange={onReplyLengthChange} className="w-[132px]" />
            </label>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" disabled={profileCount <= 1} onClick={onRequestDelete} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#282a2c] bg-[#131314] text-rose-200 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-40" title="Delete profile">
              <TrashIcon className="h-4 w-4" />
            </button>
            <button type="button" onClick={onRequestClearMemory} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#282a2c] bg-[#131314] text-amber-300 transition hover:bg-amber-500/15" title="Clear learned memory">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
            </button>
            <button type="button" onClick={onSave} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--accent-color)] bg-[var(--accent-color)] text-[#131314] transition hover:brightness-110" title="Save profile">
              <SaveIcon className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} className="h-10 rounded-2xl border border-[#282a2c] bg-[#131314] px-4 text-xs font-bold text-[#e3e3e3] transition hover:bg-[#282a2c]">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ClearMemoryConfirmModal({
  open,
  characterName,
  clearSessionToo,
  onToggleClearSession,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  characterName: string;
  clearSessionToo: boolean;
  onToggleClearSession: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4 py-3 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-sm max-h-[calc(100vh-32px)] overflow-y-auto rounded-[24px] border border-[#282a2c] bg-[#1e1f20] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          </span>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-300">Clear Memory</div>
            <div className="text-sm font-bold text-[#f1f3f4]">Clear Memory</div>
            <div className="text-xs text-[#9aa0a6]">{characterName}</div>
          </div>
        </div>
        <p className="mb-4 text-sm leading-6 text-[#c4c7c5]">
          This will erase everything this character has learned about your preferences and style. The character description itself stays untouched.
        </p>
        <label className="mb-5 flex cursor-pointer items-center gap-2.5 rounded-xl bg-[#131314] px-3 py-2.5 ring-1 ring-[#282a2c]">
          <input type="checkbox" checked={clearSessionToo} onChange={(event) => onToggleClearSession(event.target.checked)} className="h-4 w-4 rounded accent-[var(--accent-color)]" />
          <span className="text-xs text-[#c4c7c5]">Also clear chat history for this character</span>
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onConfirm} className="flex-1 rounded-2xl border py-2.5 text-xs font-bold transition hover:brightness-110" style={{ borderColor: "#8a6722", backgroundColor: "#4d3a16", color: "#f3d274", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>
            Clear Memory
          </button>
          <button type="button" onClick={onCancel} className="flex-1 rounded-2xl border border-[#282a2c] bg-[#131314] py-2.5 text-xs font-bold text-[#e3e3e3] transition hover:bg-[#282a2c]">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeleteProfileConfirmModal({
  open,
  title,
  name,
  body,
  disabled,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  name: string;
  body: string;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[205] flex items-center justify-center bg-black/60 px-4 py-3 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-sm max-h-[calc(100vh-32px)] overflow-y-auto rounded-[24px] border border-[#282a2c] bg-[#1e1f20] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-200">
            <TrashIcon className="h-5 w-5" />
          </span>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-300">{title}</div>
            <div className="text-sm font-bold text-[#f1f3f4]">{name}</div>
          </div>
        </div>
        <p className="mb-5 text-sm leading-6 text-[#c4c7c5]">{body}</p>
        <div className="flex gap-2">
          <button type="button" disabled={disabled} onClick={onConfirm} className="flex-1 rounded-2xl border border-rose-500/30 bg-rose-500/15 py-2.5 text-xs font-bold text-rose-100 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40">
            Delete
          </button>
          <button type="button" onClick={onCancel} className="flex-1 rounded-2xl border border-[#282a2c] bg-[#131314] py-2.5 text-xs font-bold text-[#e3e3e3] transition hover:bg-[#282a2c]">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
