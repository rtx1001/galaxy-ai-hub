import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { activateAudioVisualizer, canUseAudioVisualizerForSrc, deactivateAudioVisualizer } from "../audioVisualizer";
import { setInternalMediaPlayback } from "../internalMediaState";
import { loadMediaVolume, MEDIA_VOLUME_EVENT, pauseOtherMediaElements, saveMediaVolume } from "../utils";
import {
  Forward10Icon,
  FullscreenIcon,
  FolderOpenIcon,
  PauseIcon,
  PlayIcon,
  Rewind10Icon,
  SpeakerIcon,
  SpeakerMutedIcon,
  StopIcon,
} from "./Icons";

const formatMediaTime = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export function RegisteredVideo({
  title,
  src,
  className,
  path,
  linkedFolders = [],
}: {
  title: string;
  src: string;
  className?: string;
  path?: string;
  linkedFolders?: string[];
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  const [duration, setDuration] = React.useState(0);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [volume, setVolume] = React.useState(() => loadMediaVolume());
  const [isMuted, setIsMuted] = React.useState(() => loadMediaVolume() <= 0);
  const [showVolume, setShowVolume] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [isPointerActive, setIsPointerActive] = React.useState(false);
  const [controlsVisible, setControlsVisible] = React.useState(true);
  const [codecIssue, setCodecIssue] = React.useState(false);
  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const volumeProgress = (isMuted ? 0 : volume) * 100;
  const isTextEditingTarget = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    if (!element) return false;
    return Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
  };
  const shouldHandleDocumentHotkey = (target: EventTarget | null) => {
    if (isTextEditingTarget(target)) return false;
    const shell = shellRef.current;
    if (!shell) return false;
    const activeElement = document.activeElement;
    return (
      isFullscreen ||
      isPlaying ||
      isPointerActive ||
      shell.contains(activeElement) ||
      shell.contains(target as Node | null)
    );
  };

  const play = () => videoRef.current?.play().catch(console.error);
  const pause = () => videoRef.current?.pause();
  const stop = () => {
    const element = videoRef.current;
    if (!element) return;
    element.pause();
    element.currentTime = 0;
    setCurrentTime(0);
  };
  const seek = (value: string) => {
    const nextTime = Number(value);
    const element = videoRef.current;
    if (!element || !Number.isFinite(nextTime)) return;
    element.currentTime = nextTime;
    setCurrentTime(nextTime);
  };
  const nudge = (seconds: number) => {
    const element = videoRef.current;
    if (!element) return;
    element.currentTime = Math.min(duration || element.duration || 0, Math.max(0, element.currentTime + seconds));
    setCurrentTime(element.currentTime);
  };
  const updateVolume = (value: string) => {
    const nextVolume = saveMediaVolume(Number(value));
    const element = videoRef.current;
    if (!element || !Number.isFinite(nextVolume)) return;
    element.volume = nextVolume;
    element.muted = nextVolume <= 0;
    setVolume(nextVolume);
    setIsMuted(element.muted);
  };
  const toggleMute = () => {
    const element = videoRef.current;
    if (!element) return;
    element.muted = !element.muted;
    setIsMuted(element.muted);
  };
  const adjustVolume = (delta: number) => {
    const element = videoRef.current;
    const currentVolume = element ? (element.muted ? 0 : element.volume) : volume;
    const nextVolume = saveMediaVolume(currentVolume + delta);
    if (element) {
      element.volume = nextVolume;
      element.muted = nextVolume <= 0;
    }
    setVolume(nextVolume);
    setIsMuted(nextVolume <= 0);
  };
  const enterFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(console.error);
      return;
    }
    shellRef.current?.requestFullscreen?.().catch(console.error);
  };
  const openDefaultPlayer = () => {
    if (!path) return;
    invoke("open_with_default_app", { path, folders: linkedFolders }).catch(console.error);
  };
  const togglePlayback = () => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) {
      element.play().catch(console.error);
    } else {
      element.pause();
    }
  };
  const handleVideoKeyDown = (event: React.KeyboardEvent<HTMLDivElement> | KeyboardEvent) => {
    if (isTextEditingTarget(event.target)) return;
    if (event.key === " " || event.key.toLowerCase() === "k") {
      event.preventDefault();
      togglePlayback();
      wakeControls();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      nudge(-10);
      wakeControls();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      nudge(10);
      wakeControls();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      adjustVolume(0.05);
      wakeControls();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      adjustVolume(-0.05);
      wakeControls();
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      enterFullscreen();
      wakeControls();
    } else if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      toggleMute();
      wakeControls();
    }
  };

  React.useEffect(() => {
    const updateFullscreen = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  React.useEffect(() => {
    const mediaId = `video:${src}`;
    return () => setInternalMediaPlayback(mediaId, false);
  }, [src]);

  React.useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.volume = volume;
    element.muted = volume <= 0;
  }, []);

  React.useEffect(() => {
    const onVolumeChange = (event: Event) => {
      const nextVolume = (event as CustomEvent<{ volume?: number }>).detail?.volume;
      if (typeof nextVolume !== "number") return;
      const element = videoRef.current;
      if (element) {
        element.volume = nextVolume;
        element.muted = nextVolume <= 0;
      }
      setVolume(nextVolume);
      setIsMuted(nextVolume <= 0);
    };
    window.addEventListener(MEDIA_VOLUME_EVENT, onVolumeChange);
    return () => window.removeEventListener(MEDIA_VOLUME_EVENT, onVolumeChange);
  }, []);

  React.useEffect(() => {
    if (!controlsVisible || showVolume) return;
    if (!isFullscreen && isPointerActive) return;
    const timeout = window.setTimeout(() => setControlsVisible(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [controlsVisible, isFullscreen, isPointerActive, showVolume]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleDocumentHotkey(event.target)) return;
      handleVideoKeyDown(event);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [currentTime, duration, isFullscreen, isMuted, isPlaying, isPointerActive, volume]);

  const wakeControls = () => {
    setIsPointerActive(true);
    setControlsVisible(true);
  };

  const controlClass =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--accent-color)] transition hover:bg-[var(--accent-soft)] hover:text-[#f8fafd]";

  return (
    <div
      ref={shellRef}
      tabIndex={0}
      className={`group relative overflow-hidden rounded-[18px] bg-black outline-none ring-1 ring-[#282a2c] fullscreen:flex fullscreen:h-screen fullscreen:w-screen fullscreen:items-center fullscreen:justify-center fullscreen:rounded-none fullscreen:ring-0 ${className || ""}`}
      onClick={() => shellRef.current?.focus()}
      onKeyDown={handleVideoKeyDown}
      onMouseEnter={wakeControls}
      onMouseMove={wakeControls}
      onMouseLeave={() => {
        setIsPointerActive(false);
        setControlsVisible(true);
      }}
      onFocusCapture={wakeControls}
    >
      <video
        ref={videoRef}
        src={src}
        preload="metadata"
        playsInline
        onClick={togglePlayback}
        onDoubleClick={enterFullscreen}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
          setCurrentTime(event.currentTarget.currentTime || 0);
        }}
        onLoadedData={(event) => {
          const element = event.currentTarget;
          setCodecIssue(element.videoWidth <= 0 || element.videoHeight <= 0);
        }}
        onError={() => setCodecIssue(true)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        onPlay={(event) => {
          pauseOtherMediaElements(event.currentTarget);
          event.currentTarget.volume = volume;
          event.currentTarget.muted = volume <= 0;
          if (canUseAudioVisualizerForSrc(src)) {
            activateAudioVisualizer(event.currentTarget).catch(() => undefined);
          }
          setInternalMediaPlayback(`video:${src}`, true);
          setIsPlaying(true);
        }}
        onPause={(event) => {
          deactivateAudioVisualizer(event.currentTarget);
          setIsPlaying(false);
        }}
        onEnded={(event) => {
          deactivateAudioVisualizer(event.currentTarget);
          setInternalMediaPlayback(`video:${src}`, false);
          setIsPlaying(false);
        }}
        className={`block w-full bg-black object-contain ${
          isFullscreen
            ? "h-screen max-h-none min-h-0"
            : "aspect-video max-h-[520px] min-h-[220px]"
        }`}
      />
      {codecIssue && path && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-5">
          <div className="pointer-events-auto flex max-w-[320px] flex-col items-center rounded-3xl bg-[#171819]/92 px-5 py-4 text-center text-sm text-[#dfe3ea] shadow-[0_18px_44px_rgba(0,0,0,0.42)] backdrop-blur-xl ring-1 ring-white/10">
            <div className="text-sm font-semibold text-[#f1f3f4]">This video needs your default media player.</div>
            <div className="mt-1 text-xs leading-5 text-[#c4c7c5]">The file is available, but the in-app preview cannot decode this codec.</div>
            <button
              type="button"
              onClick={openDefaultPlayer}
              className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-full bg-[var(--accent-color)] px-4 text-xs font-bold text-[#101112] transition hover:brightness-110"
            >
              <FolderOpenIcon className="h-3.5 w-3.5" />
              Open video
            </button>
          </div>
        </div>
      )}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-3 pt-14 transition-opacity duration-300 fullscreen:pb-5 ${
          !controlsVisible ? "opacity-0" : "opacity-100"
        }`}
      >
        <div
          className={`pointer-events-auto mb-2 flex items-center gap-3 px-1 transition-all duration-200 ${
            isPointerActive || showVolume
              ? "translate-y-0 opacity-100"
              : "-translate-y-1 opacity-0 pointer-events-none"
          }`}
        >
          <div className="w-[72px] shrink-0 text-xs font-semibold tabular-nums text-[#f1f3f4]">
            {formatMediaTime(currentTime)}
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(currentTime, duration || currentTime)}
            onChange={(event) => seek(event.currentTarget.value)}
            className="chat-audio-slider h-[6px] min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-[#0f1011] accent-[var(--accent-color)] outline-none"
            style={{
              background: `linear-gradient(to right, var(--accent-color) 0%, var(--accent-color) ${progress}%, rgba(255,255,255,0.28) ${progress}%, rgba(255,255,255,0.28) 100%)`,
            }}
          />
          <div className="w-[72px] shrink-0 text-right text-xs font-semibold tabular-nums text-[#f1f3f4]">
            {formatMediaTime(duration)}
          </div>
        </div>
        <div
          className="pointer-events-auto flex min-h-[52px] w-full items-center gap-1.5 rounded-full border px-2 py-1.5 text-[#e3e3e3] backdrop-blur-xl"
          style={{
            borderColor: "var(--accent-soft-strong)",
            backgroundColor: "color-mix(in srgb, var(--accent-color) 12%, #171819 88%)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.28), 0 0 22px var(--accent-soft)",
          }}
        >
          <button type="button" title={isPlaying ? "Pause" : "Play"} onClick={isPlaying ? pause : play} className={controlClass}>
            {isPlaying ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
          </button>
          <button type="button" title="Back 10 seconds" onClick={() => nudge(-10)} className={controlClass}>
            <Rewind10Icon className="h-4 w-4" />
          </button>
          <button type="button" title="Forward 10 seconds" onClick={() => nudge(10)} className={controlClass}>
            <Forward10Icon className="h-4 w-4" />
          </button>
          <button type="button" title="Stop" onClick={stop} className={controlClass}>
            <StopIcon className="h-3.5 w-3.5" />
          </button>
          <div className="min-w-0 flex-1 truncate px-2 text-xs font-semibold text-[#f1f3f4]">
            {title}
          </div>
          {path && (
            <button type="button" title="Open in default player" onClick={openDefaultPlayer} className={controlClass}>
              <FolderOpenIcon className="h-4 w-4" />
            </button>
          )}
          <div
            className="relative shrink-0"
            onMouseEnter={() => setShowVolume(true)}
            onMouseLeave={() => setShowVolume(false)}
          >
            {showVolume && (
              <>
                <div className="absolute bottom-full left-1/2 z-10 h-3 w-12 -translate-x-1/2" />
                <div
                  className="absolute bottom-full left-1/2 z-20 mb-2 flex h-28 w-10 -translate-x-1/2 items-center justify-center rounded-full border px-2 py-3 backdrop-blur-xl"
                  style={{
                    borderColor: "var(--accent-soft-strong)",
                    backgroundColor: "color-mix(in srgb, var(--accent-color) 12%, #171819 88%)",
                    boxShadow: "0 14px 36px rgba(0,0,0,0.36), 0 0 20px var(--accent-soft)",
                  }}
                >
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={isMuted ? 0 : volume}
                    onChange={(event) => updateVolume(event.currentTarget.value)}
                    className="chat-volume-slider h-20 w-2 cursor-pointer appearance-none rounded-full bg-[#0f1011] accent-[var(--accent-color)] outline-none"
                    style={{
                      background: `linear-gradient(to top, var(--accent-color) 0%, var(--accent-color) ${volumeProgress}%, #0f1011 ${volumeProgress}%, #0f1011 100%)`,
                      writingMode: "vertical-lr",
                      direction: "rtl",
                    }}
                  />
                </div>
              </>
            )}
            <button type="button" title={isMuted || volume <= 0 ? "Unmute" : "Volume"} onClick={toggleMute} className={controlClass}>
              {isMuted || volume <= 0 ? <SpeakerMutedIcon className="h-4 w-4" /> : <SpeakerIcon className="h-4 w-4" />}
            </button>
          </div>
          <button type="button" title={isFullscreen ? "Back to chat preview" : "Fullscreen"} onClick={enterFullscreen} className={controlClass}>
            <FullscreenIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
