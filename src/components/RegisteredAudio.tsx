import React from "react";
import { pauseOtherMediaElements } from "../utils";
import { useAudioPlaybackRegistry } from "./AudioPlaybackContext";
import { PauseIcon, PlayIcon, SpeakerIcon, SpeakerMutedIcon } from "./Icons";

const formatAudioTime = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export function RegisteredAudio({
  id,
  title,
  src,
  className,
}: {
  id: string;
  title: string;
  src: string;
  className?: string;
}) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const viewRef = React.useRef<HTMLDivElement | null>(null);
  const { currentTrack, isPlaying: globalIsPlaying, registerTrack, markPlaying, markPaused } = useAudioPlaybackRegistry();
  const [duration, setDuration] = React.useState(0);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [isLocalPlaying, setIsLocalPlaying] = React.useState(false);
  const [volume, setVolume] = React.useState(1);
  const [isMuted, setIsMuted] = React.useState(false);
  const [showVolume, setShowVolume] = React.useState(false);
  const isCurrentTrack = currentTrack?.id === id;
  const isPlaying = isCurrentTrack && globalIsPlaying && isLocalPlaying;

  React.useEffect(() => {
    const audioElement = audioRef.current;
    const viewElement = viewRef.current;
    if (!audioElement || !viewElement) return;
    return registerTrack({ id, title, audioElement, viewElement });
  }, [id, title, registerTrack]);

  const play = () => {
    audioRef.current?.play().catch(console.error);
  };

  const pause = () => {
    audioRef.current?.pause();
  };

  const seek = (value: string) => {
    const nextTime = Number(value);
    const element = audioRef.current;
    if (!element || !Number.isFinite(nextTime)) return;
    element.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const updateVolume = (value: string) => {
    const nextVolume = Math.min(1, Math.max(0, Number(value)));
    const element = audioRef.current;
    if (!element || !Number.isFinite(nextVolume)) return;
    element.volume = nextVolume;
    element.muted = nextVolume <= 0;
    setVolume(nextVolume);
    setIsMuted(element.muted);
  };

  const toggleMute = () => {
    const element = audioRef.current;
    if (!element) return;
    element.muted = !element.muted;
    setIsMuted(element.muted);
  };

  const controlClass =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--accent-color)] transition hover:bg-[var(--accent-soft)] hover:text-[#f8fafd]";
  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const volumeProgress = (isMuted ? 0 : volume) * 100;

  return (
    <div ref={viewRef} className={className}>
      <audio
        ref={audioRef}
        data-chat-audio-id={id}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
          setCurrentTime(event.currentTarget.currentTime || 0);
        }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        onPlay={(event) => {
          pauseOtherMediaElements(event.currentTarget);
          setIsLocalPlaying(true);
          markPlaying(id);
        }}
        onPause={() => {
          setIsLocalPlaying(false);
          markPaused(id);
        }}
        onEnded={() => {
          setIsLocalPlaying(false);
          markPaused(id);
        }}
        className="hidden"
      />
      <div
        className="flex h-[56px] w-full items-center gap-3 rounded-full border px-3 py-2 text-[#e3e3e3] backdrop-blur-xl"
        style={{
          borderColor: "var(--accent-soft-strong)",
          backgroundColor: "color-mix(in srgb, var(--accent-color) 12%, #171819 88%)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.28), 0 0 22px var(--accent-soft)",
        }}
      >
        <button type="button" title={isPlaying ? "Pause" : "Play"} onClick={isPlaying ? pause : play} className={controlClass}>
          {isPlaying ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
        </button>
        <div className="w-[76px] shrink-0 text-left text-xs font-semibold leading-none tabular-nums text-[#f1f3f4]">
          {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
        </div>
        <div className="flex min-w-0 flex-1 items-center">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(currentTime, duration || currentTime)}
            onChange={(event) => seek(event.currentTarget.value)}
            className="chat-audio-slider h-[6px] w-full cursor-pointer appearance-none rounded-full bg-[#0f1011] accent-[var(--accent-color)] outline-none"
            style={{
              background: `linear-gradient(to right, var(--accent-color) 0%, var(--accent-color) ${progress}%, #0f1011 ${progress}%, #0f1011 100%)`,
            }}
          />
        </div>
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
          <button
            type="button"
            title={isMuted || volume <= 0 ? "Unmute" : "Volume"}
            onClick={toggleMute}
            onFocus={() => setShowVolume(true)}
            onBlur={() => setShowVolume(false)}
            className={controlClass}
          >
            {isMuted || volume <= 0 ? <SpeakerMutedIcon className="h-4 w-4" /> : <SpeakerIcon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
