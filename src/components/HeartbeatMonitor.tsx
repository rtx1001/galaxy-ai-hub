import { useEffect, useMemo, useState } from "react";

type HeartbeatMonitorProps = {
  accent: string;
  soft: string;
  active?: boolean;
  mode?: "idle" | "voice" | "image";
};

const WIDTH = 320;
const HEIGHT = 84;
const BASELINE = 42;
const SAMPLES = 128;
const CYCLE_MS = 1900;
const PULSE_CENTER = WIDTH * 0.48;

const gaussian = (x: number, center: number, width: number, amplitude: number) =>
  amplitude * Math.exp(-(((x - center) / width) ** 2));

const toPath = (points: Array<{ x: number; y: number }>) =>
  points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

export function HeartbeatMonitor({ accent, soft, active = false, mode }: HeartbeatMonitorProps) {
  const [timeMs, setTimeMs] = useState(() => performance.now());
  const displayMode = mode ?? (active ? "voice" : "idle");
  const voiceActive = displayMode === "voice";
  const imageActive = displayMode === "image";

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTimeMs(performance.now());
    }, 33);
    return () => window.clearInterval(interval);
  }, []);

  const { waveformPath, intensity, pulseGlowOpacity } = useMemo(() => {
    const t = timeMs;
    const cycleProgress = (t % CYCLE_MS) / CYCLE_MS;
    const beatEnvelope =
      cycleProgress < 0.12
        ? Math.sin((cycleProgress / 0.12) * Math.PI)
        : 0;
    let strongestAmount = 14 * beatEnvelope;
    const points = Array.from({ length: SAMPLES }, (_, index) => {
      const x = (index / (SAMPLES - 1)) * WIDTH;
      const n = x / WIDTH;
      const baselineWiggle =
        Math.sin(x * 0.07 + t * 0.002) * 0.72 +
        Math.sin(x * 0.14 - t * 0.0015) * 0.34;
      const heartbeat =
        !voiceActive && !imageActive
          ? (gaussian(x, PULSE_CENTER - 48, 12, 4.8) +
              gaussian(x, PULSE_CENTER - 26, 6.8, -16) +
              gaussian(x, PULSE_CENTER - 12, 4.6, 12) +
              gaussian(x, PULSE_CENTER - 2.5, 2.3, 58) +
              gaussian(x, PULSE_CENTER + 7.5, 2.7, -52) +
              gaussian(x, PULSE_CENTER + 23, 8, 10) +
              gaussian(x, PULSE_CENTER + 41, 12, 3.6)) *
            beatEnvelope
          : 0;
      const voiceActivity =
        0.78 +
        0.2 * Math.sin(t * 0.009) +
        0.13 * Math.sin(t * 0.017 + 1.7);
      const wordGate =
        voiceActive
          ? Math.max(
              0.1,
              Math.sin(t * 0.0076) > -0.36 ? 1 : 0.18,
            ) *
            Math.max(
              0.18,
              Math.sin(t * 0.012 + 1.1) > -0.58 ? 1 : 0.24,
            )
          : 0;
      const voiceEnvelope =
        voiceActive
          ? 0.42 +
            gaussian(n, 0.18 + 0.05 * Math.sin(t * 0.003), 0.1, 0.5) +
            gaussian(n, 0.44 + 0.08 * Math.sin(t * 0.0024 + 1.3), 0.13, 0.66) +
            gaussian(n, 0.72 + 0.04 * Math.sin(t * 0.0036 + 2.1), 0.11, 0.46)
          : 0;
      const voiceCarrier =
        Math.sin(x * 0.32 - t * 0.032) * 13.5 +
        Math.sin(x * 0.56 + t * 0.045) * 8.5 +
        Math.sin(x * 0.91 - t * 0.063) * 4.8 +
        Math.sin(x * 1.34 + t * 0.081) * 2.7;
      const voice = voiceActive ? voiceActivity * wordGate * voiceEnvelope * voiceCarrier : 0;
      const imageWave = imageActive
        ? Math.sin(x * 0.07 - t * 0.004) * 7 +
          Math.sin(x * 0.13 - t * 0.0028 + 1.4) * 3.2
        : 0;
      const amount = baselineWiggle + heartbeat + voice + imageWave;
      const strength = Math.abs(amount);
      if (voiceActive) {
        strongestAmount = Math.max(strongestAmount, Math.abs(voice));
      } else if (imageActive) {
        strongestAmount = Math.max(strongestAmount, Math.abs(imageWave));
      } else if (strength > strongestAmount) {
        strongestAmount = strength;
      }

      return {
        x,
        y: BASELINE - amount,
      };
    });

    return {
      waveformPath: toPath(points),
      intensity: Math.min(1, strongestAmount / (voiceActive ? 28 : imageActive ? 14 : 26)),
      pulseGlowOpacity: voiceActive ? 0 : imageActive ? 0.14 : Math.max(0, beatEnvelope - 0.08) * 0.18,
    };
  }, [imageActive, timeMs, voiceActive]);

  const lineOpacity = voiceActive ? 0.9 : imageActive ? 0.82 : 0.72;

  return (
    <div
      className="relative h-[84px] overflow-hidden rounded-xl border border-[#2f3134] bg-[#101113]"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
        backgroundSize: "18px 18px",
        boxShadow: `inset 0 0 28px color-mix(in srgb, ${accent} 10%, transparent)`,
      }}
    >
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <path
          d={`M0 ${BASELINE} L${WIDTH} ${BASELINE}`}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d={waveformPath}
          fill="none"
          stroke={accent}
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={voiceActive ? 0.08 + intensity * 0.08 : pulseGlowOpacity}
          style={{ filter: `blur(4px) drop-shadow(0 0 12px ${accent})` }}
        />
        <path
          d={waveformPath}
          fill="none"
          stroke={accent}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={lineOpacity}
          style={{ filter: `drop-shadow(0 0 8px ${accent})` }}
        />
        <path
          d={waveformPath}
          fill="none"
          stroke={soft}
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.38 + intensity * 0.16}
        />
      </svg>
    </div>
  );
}
