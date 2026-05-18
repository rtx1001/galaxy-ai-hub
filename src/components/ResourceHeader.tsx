import { memo, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ResourceBarStatus, SystemResourceStatus } from "../types";
import { ResourceBar } from "./UI";

const EMPTY_RESOURCE_STATUS: SystemResourceStatus = {
  vram: { label: "VRAM", available: false, percent: 0, summary: "Unavailable" },
  gpu_temp: { label: "GPU TEMP", available: false, percent: 0, summary: "Unavailable" },
  ram: { label: "RAM", available: false, percent: 0, summary: "Unavailable" },
  cpu: { label: "CPU", available: false, percent: 0, summary: "Unavailable" },
  cpu_temp: { label: "CPU TEMP", available: false, percent: 0, summary: "Unavailable" },
};

type ResourceHeaderProps = {
  activeTaskType: "none" | "llm" | "voice" | "image";
  brainStatus: "Idle" | "Loading" | "Ready" | "Thinking" | "Error";
  modelState: string;
  isGeneratingImage: boolean;
  isAudioPlaying: boolean;
  isVoiceBusy: boolean;
};

export const ResourceHeader = memo(function ResourceHeader({
  activeTaskType,
  brainStatus,
  modelState,
  isGeneratingImage,
  isAudioPlaying,
  isVoiceBusy,
}: ResourceHeaderProps) {
  const [resourceStatus, setResourceStatus] = useState<SystemResourceStatus>(EMPTY_RESOURCE_STATUS);
  const fingerprintRef = useRef("");
  const inFlightRef = useRef(false);

  const fastRefresh =
    activeTaskType !== "none" ||
    brainStatus === "Loading" ||
    brainStatus === "Thinking" ||
    modelState === "loading" ||
    modelState === "starting" ||
    isGeneratingImage ||
    isAudioPlaying ||
    isVoiceBusy;
  const brainLoaded =
    activeTaskType === "llm" ||
    brainStatus === "Ready" ||
    brainStatus === "Thinking" ||
    modelState === "ready" ||
    modelState === "loading" ||
    modelState === "starting";
  const activeVramWorkloadLabel = (() => {
    if (brainLoaded && isVoiceBusy) return "Brain + Voice";
    if (brainLoaded && isGeneratingImage) return "Brain + Image";
    if (isGeneratingImage || activeTaskType === "image") return "Image";
    if (isVoiceBusy || activeTaskType === "voice") return "Voice";
    if (brainLoaded) return "Brain";
    return "Idle";
  })();

  useEffect(() => {
    let active = true;
    const intervalMs = fastRefresh ? 1000 : 2000;

    const syncResources = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const status = await invoke<SystemResourceStatus>("get_system_resource_status");
        if (!active) return;
        const nextFingerprint = JSON.stringify(status);
        if (fingerprintRef.current !== nextFingerprint) {
          fingerprintRef.current = nextFingerprint;
          setResourceStatus(status);
        }
      } catch (error) {
        console.error("Resource status error:", error);
      } finally {
        inFlightRef.current = false;
      }
    };

    syncResources();
    const handle = window.setInterval(syncResources, intervalMs);
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, [fastRefresh]);

  const resourceMetrics: ResourceBarStatus[] = [
    resourceStatus.vram,
    resourceStatus.gpu_temp,
    resourceStatus.cpu,
    resourceStatus.ram,
  ];

  return (
    <div className="grid min-w-0 grid-cols-4 items-end gap-4 overflow-hidden">
      {resourceMetrics.map((metric) => (
        <ResourceBar
          key={metric.label}
          metric={metric}
          detail={metric.label === "VRAM" ? activeVramWorkloadLabel : undefined}
        />
      ))}
    </div>
  );
});
