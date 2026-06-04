import React from "react";
import { CloseIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon, StopIcon } from "./Icons";
import { useAudioPlaybackRegistry } from "./AudioPlaybackContext";

export function FloatingAudioControl({ scrollRef }: { scrollRef: React.RefObject<HTMLElement | null> }) {
  const { tracks, currentTrack, isPlaying, toggleCurrent, stopCurrent, playPrevious, playNext } = useAudioPlaybackRegistry();
  const [isTrackOutsideView, setIsTrackOutsideView] = React.useState(false);
  const [dismissedTrackId, setDismissedTrackId] = React.useState<string | null>(null);
  const [showIdleControl, setShowIdleControl] = React.useState(false);
  const currentTrackId = currentTrack?.id ?? null;
  const currentIndex = currentTrackId ? tracks.findIndex((track) => track.id === currentTrackId) : -1;
  const canPlayPrevious = currentIndex > 0;
  const canPlayNext = currentIndex >= 0 && currentIndex < tracks.length - 1;

  React.useEffect(() => {
    let frame = 0;
    const container = scrollRef.current;
    const update = () => {
      frame = 0;
      if (!container || !currentTrack) {
        setIsTrackOutsideView(false);
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const trackRect = currentTrack.viewElement.getBoundingClientRect();
      const nextIsOutsideView =
        trackRect.bottom < containerRect.top + 8 || trackRect.top > containerRect.bottom - 8;
      setIsTrackOutsideView(nextIsOutsideView);
      if (!nextIsOutsideView) {
        setDismissedTrackId((dismissed) => (dismissed === currentTrack.id ? null : dismissed));
      }
    };
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    container?.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      container?.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [currentTrack, isPlaying, scrollRef]);

  React.useEffect(() => {
    setDismissedTrackId((dismissed) => (dismissed && dismissed !== currentTrackId ? null : dismissed));
  }, [currentTrackId]);

  React.useEffect(() => {
    if (!currentTrack || !isTrackOutsideView || dismissedTrackId === currentTrack.id) {
      setShowIdleControl(false);
      return;
    }
    if (isPlaying) {
      setShowIdleControl(true);
      return;
    }
    setShowIdleControl(true);
    const timeout = window.setTimeout(() => setShowIdleControl(false), 5000);
    return () => window.clearTimeout(timeout);
  }, [currentTrack, dismissedTrackId, isPlaying, isTrackOutsideView]);

  if (!currentTrack || !isTrackOutsideView || !showIdleControl || dismissedTrackId === currentTrack.id) {
    return null;
  }

  const controlClass =
    "flex h-10 w-10 items-center justify-center rounded-full text-[var(--accent-color)] transition hover:bg-[var(--accent-soft)] hover:text-[#f8fafd] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--accent-color)]";

  return (
    <div className="pointer-events-none sticky top-3 z-40 flex h-0 justify-center">
      <div
        className="pointer-events-auto flex min-h-[52px] max-w-[min(540px,calc(100vw-3rem))] items-center gap-1 rounded-full border px-1.5 py-1.5 text-[#e3e3e3] backdrop-blur-xl"
        style={{
          borderColor: "var(--accent-soft-strong)",
          backgroundColor: "color-mix(in srgb, var(--accent-color) 12%, #171819 88%)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.38), 0 0 28px var(--accent-soft)",
        }}
      >
        <button type="button" title="Previous audio" onClick={playPrevious} disabled={!canPlayPrevious} className={controlClass}>
          <PreviousIcon className="h-3.5 w-3.5" />
        </button>
        <button type="button" title={isPlaying ? "Pause" : "Play"} onClick={toggleCurrent} className={controlClass}>
          {isPlaying ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
        </button>
        <button type="button" title="Next audio" onClick={playNext} disabled={!canPlayNext} className={controlClass}>
          <NextIcon className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="Stop audio" onClick={stopCurrent} className={controlClass}>
          <StopIcon className="h-3.5 w-3.5" />
        </button>
        <div className="mx-1 h-6 w-px bg-[var(--accent-soft-strong)]" />
        <div className="max-w-[220px] truncate text-xs font-semibold text-[#f1f3f4]" title={currentTrack.title}>
          {currentTrack.title}
        </div>
        <button type="button" title="Close floating control" onClick={() => setDismissedTrackId(currentTrack.id)} className={controlClass}>
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
