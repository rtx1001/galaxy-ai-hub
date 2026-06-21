export type AudioVisualizerFrame = {
  at: number;
  energy: number;
  bass: number;
  mid: number;
  treble: number;
  waveform: number[];
};

export const AUDIO_VISUALIZER_FRAME_EVENT = "galaxy-audio-visualizer-frame";

let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let frameHandle = 0;
let activeElement: HTMLMediaElement | null = null;
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
const timeData = new Uint8Array(512);
const freqData = new Uint8Array(256);

export const canUseAudioVisualizerForSrc = (src?: string | null) => {
  const value = src?.trim().toLowerCase() || "";
  return value.startsWith("blob:") || value.startsWith("data:");
};

const getAudioContext = () => {
  if (typeof window === "undefined") return null;
  const AudioContextCtor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext) {
    audioContext = new AudioContextCtor();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    analyser.connect(audioContext.destination);
  }
  return audioContext;
};

const dispatchSilentFrame = () => {
  window.dispatchEvent(
    new CustomEvent<AudioVisualizerFrame>(AUDIO_VISUALIZER_FRAME_EVENT, {
      detail: { at: performance.now(), energy: 0, bass: 0, mid: 0, treble: 0, waveform: [] },
    }),
  );
};

const bandAverage = (start: number, end: number) => {
  let total = 0;
  const safeEnd = Math.min(freqData.length, end);
  for (let index = start; index < safeEnd; index += 1) total += freqData[index];
  return safeEnd > start ? total / ((safeEnd - start) * 255) : 0;
};

const tick = () => {
  if (!activeElement || activeElement.paused || activeElement.ended || !analyser) {
    frameHandle = 0;
    dispatchSilentFrame();
    return;
  }

  analyser.getByteTimeDomainData(timeData);
  analyser.getByteFrequencyData(freqData);

  let sum = 0;
  for (let index = 0; index < timeData.length; index += 1) {
    const centered = (timeData[index] - 128) / 128;
    sum += centered * centered;
  }

  const bucketCount = 64;
  const bucketSize = Math.max(1, Math.floor(timeData.length / bucketCount));
  const waveform = Array.from({ length: bucketCount }, (_, bucket) => {
    const start = bucket * bucketSize;
    let total = 0;
    for (let offset = 0; offset < bucketSize; offset += 1) {
      total += (timeData[Math.min(timeData.length - 1, start + offset)] - 128) / 128;
    }
    return total / bucketSize;
  });

  window.dispatchEvent(
    new CustomEvent<AudioVisualizerFrame>(AUDIO_VISUALIZER_FRAME_EVENT, {
      detail: {
        at: performance.now(),
        energy: Math.min(1, Math.sqrt(sum / timeData.length) * 2.2),
        bass: bandAverage(1, 12),
        mid: bandAverage(12, 58),
        treble: bandAverage(58, 128),
        waveform,
      },
    }),
  );

  frameHandle = window.requestAnimationFrame(tick);
};

export const activateAudioVisualizer = async (element: HTMLMediaElement) => {
  const context = getAudioContext();
  if (!context || !analyser) return;
  if (context.state === "suspended") await context.resume().catch(() => undefined);

  if (!sources.has(element)) {
    try {
      const source = context.createMediaElementSource(element);
      source.connect(analyser);
      sources.set(element, source);
    } catch {
      return;
    }
  }

  activeElement = element;
  if (!frameHandle) frameHandle = window.requestAnimationFrame(tick);
};

export const deactivateAudioVisualizer = (element?: HTMLMediaElement | null) => {
  if (element && activeElement !== element) return;
  activeElement = null;
  if (frameHandle) {
    window.cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  }
  dispatchSilentFrame();
};
