import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SETTINGS, SystemInfo } from "../appCore";
import { EngineInfo } from "../types";
import { clampNumber } from "../utils";

export function useEngineBootstrap({
  minContextSize,
  setMemorySize,
}: {
  minContextSize: number;
  setMemorySize: Dispatch<SetStateAction<number>>;
}) {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [engineStatus, setEngineStatus] = useState<
    "initializing" | "downloading" | "ready" | "error"
  >("initializing");
  const [engineErrorMsg, setEngineErrorMsg] = useState("");
  const [, setEngineInfo] = useState<EngineInfo | null>(null);
  const systemDefaultsAppliedRef = useRef(false);

  const refreshEngineInfo = async () => {
    const info = await invoke<EngineInfo>("get_engine_info");
    setEngineInfo(info);
    return info;
  };

  useEffect(() => {
    let isActive = true;
    let pollHandle: ReturnType<typeof setInterval> | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const initializeEngine = async () => {
      try {
        const info = await invoke<SystemInfo>("check_system");
        if (!isActive) return;
        setSystemInfo(info);

        if (!systemDefaultsAppliedRef.current) {
          setMemorySize((prev) =>
            prev === DEFAULT_SETTINGS.memory_size
              ? Math.max(prev, info.recommended_context_size, minContextSize)
              : prev,
          );
          systemDefaultsAppliedRef.current = true;
        }

        const ready = await invoke<boolean>("check_engine_ready");
        if (!isActive) return;
        if (ready) {
          await refreshEngineInfo();
          setEngineErrorMsg("");
          setEngineStatus("ready");
          return;
        }

        setEngineStatus("downloading");
        const result = await invoke<{ success: boolean; message: string }>(
          "download_engine",
          {
            hasNvidiaGpu: info.has_nvidia_gpu,
            forceRefresh: false,
          },
        );
        if (!isActive) return;

        if (!result.success) {
          setEngineErrorMsg(result.message);
          setEngineStatus("error");
          return;
        }

        pollHandle = setInterval(async () => {
          try {
            const isReady = await invoke<boolean>("check_engine_ready");
            if (!isActive) return;

            if (isReady && pollHandle) {
              clearInterval(pollHandle);
              if (timeoutHandle) clearTimeout(timeoutHandle);
              await refreshEngineInfo();
              setEngineErrorMsg("");
              setEngineStatus("ready");
            }
          } catch (error) {
            console.error("Engine poll error:", error);
          }
        }, 3000);

        timeoutHandle = setTimeout(() => {
          if (!isActive) return;
          if (pollHandle) clearInterval(pollHandle);
          setEngineStatus("error");
          setEngineErrorMsg(
            "The brain download took too long. Please try again.",
          );
        }, 20 * 60 * 1000);
      } catch (error) {
        if (!isActive) return;
        console.error(error);
        setEngineErrorMsg(error instanceof Error ? error.message : String(error));
        setEngineStatus("error");
      }
    };

    initializeEngine();

    return () => {
      isActive = false;
      if (pollHandle) clearInterval(pollHandle);
      if (timeoutHandle) clearTimeout(timeoutHandle);
    };
  }, [minContextSize, setMemorySize]);

  const recommendedThreads = systemInfo
    ? clampNumber(Math.min(systemInfo.cpu_threads, 8), 2, Math.max(2, systemInfo.cpu_threads))
    : 4;

  return {
    systemInfo,
    engineStatus,
    setEngineStatus,
    engineErrorMsg,
    setEngineErrorMsg,
    recommendedThreads,
    refreshEngineInfo,
  };
}
