import React from "react";

export type ChatAudioTrack = {
  id: string;
  title: string;
  audioElement: HTMLAudioElement;
  viewElement: HTMLElement;
};

type AudioPlaybackContextValue = {
  tracks: ChatAudioTrack[];
  currentTrack: ChatAudioTrack | null;
  isPlaying: boolean;
  registerTrack: (track: ChatAudioTrack) => () => void;
  markPlaying: (id: string) => void;
  markPaused: (id: string) => void;
  playTrack: (id: string) => void;
  toggleCurrent: () => void;
  stopCurrent: () => void;
  playPrevious: () => void;
  playNext: () => void;
};

const AudioPlaybackContext = React.createContext<AudioPlaybackContextValue | null>(null);

const sortTracksByDomPosition = (tracks: ChatAudioTrack[]) =>
  [...tracks].sort((left, right) => {
    const position = left.viewElement.compareDocumentPosition(right.viewElement);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

export function AudioPlaybackProvider({ children }: { children: React.ReactNode }) {
  const tracksRef = React.useRef(new Map<string, ChatAudioTrack>());
  const [tracks, setTracks] = React.useState<ChatAudioTrack[]>([]);
  const [currentTrackId, setCurrentTrackId] = React.useState<string | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);

  const refreshTracks = React.useCallback(() => {
    setTracks(sortTracksByDomPosition(Array.from(tracksRef.current.values())));
  }, []);

  const registerTrack = React.useCallback(
    (track: ChatAudioTrack) => {
      tracksRef.current.set(track.id, track);
      refreshTracks();
      return () => {
        tracksRef.current.delete(track.id);
        refreshTracks();
        setCurrentTrackId((current) => (current === track.id ? null : current));
      };
    },
    [refreshTracks],
  );

  const markPlaying = React.useCallback((id: string) => {
    const track = tracksRef.current.get(id);
    if (!track) return;
    tracksRef.current.forEach((candidate) => {
      if (candidate.id !== id && !candidate.audioElement.paused) {
        candidate.audioElement.pause();
      }
    });
    setCurrentTrackId(id);
    setIsPlaying(true);
  }, []);

  const markPaused = React.useCallback((id: string) => {
    setIsPlaying((playing) => (currentTrackId === id ? false : playing));
  }, [currentTrackId]);

  const playTrack = React.useCallback((id: string) => {
    const track = tracksRef.current.get(id);
    if (!track) return;
    track.audioElement.play().catch(console.error);
  }, []);

  const toggleCurrent = React.useCallback(() => {
    if (!currentTrackId) return;
    const track = tracksRef.current.get(currentTrackId);
    if (!track) return;
    if (track.audioElement.paused) {
      track.audioElement.play().catch(console.error);
    } else {
      track.audioElement.pause();
    }
  }, [currentTrackId]);

  const stopCurrent = React.useCallback(() => {
    if (!currentTrackId) return;
    const track = tracksRef.current.get(currentTrackId);
    if (!track) return;
    track.audioElement.pause();
    track.audioElement.currentTime = 0;
    setIsPlaying(false);
  }, [currentTrackId]);

  const playNeighbor = React.useCallback(
    (offset: number) => {
      if (!currentTrackId) return;
      const orderedTracks = sortTracksByDomPosition(Array.from(tracksRef.current.values()));
      const currentIndex = orderedTracks.findIndex((track) => track.id === currentTrackId);
      const nextTrack = orderedTracks[currentIndex + offset];
      if (!nextTrack) return;
      nextTrack.audioElement.currentTime = 0;
      nextTrack.audioElement.play().catch(console.error);
    },
    [currentTrackId],
  );

  const currentTrack = currentTrackId ? tracksRef.current.get(currentTrackId) ?? null : null;

  return (
    <AudioPlaybackContext.Provider
      value={{
        tracks,
        currentTrack,
        isPlaying,
        registerTrack,
        markPlaying,
        markPaused,
        playTrack,
        toggleCurrent,
        stopCurrent,
        playPrevious: () => playNeighbor(-1),
        playNext: () => playNeighbor(1),
      }}
    >
      {children}
    </AudioPlaybackContext.Provider>
  );
}

export function useAudioPlaybackRegistry() {
  const context = React.useContext(AudioPlaybackContext);
  if (!context) {
    throw new Error("useAudioPlaybackRegistry must be used inside AudioPlaybackProvider");
  }
  return context;
}
