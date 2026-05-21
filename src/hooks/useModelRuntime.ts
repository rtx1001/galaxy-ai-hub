import { Dispatch, MutableRefObject, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ModelLoadStatus } from "../types";
import { ModelLibraryEntry, ModelStatus, isGpuFitError, sleep } from "../appCore";

const MIN_CHAT_CONTEXT_SIZE = 8192;

type SystemInfo = {
  has_nvidia_gpu: boolean;
} | null;

type EngineStatus = "initializing" | "downloading" | "ready" | "error";

type EngineInfo = {
  ready: boolean;
  supports_mmproj: boolean;
};

type UseModelRuntimeOptions = {
  activeTaskTypeRef: MutableRefObject<"none" | "llm" | "voice" | "image">;
  appLog: (message: string) => void;
  availableModels: ModelLibraryEntry[];
  brainStatus: "Idle" | "Loading" | "Ready" | "Thinking" | "Error";
  engineStatus: EngineStatus;
  memorySize: number;
  modelLoadPromiseRef: MutableRefObject<Promise<void> | null>;
  modelLoadStatus: ModelLoadStatus;
  modelLoadTargetRef: MutableRefObject<string>;
  preferredChatGpuLayers: number;
  recommendedThreads: number;
  reducedTaskGpuLayers: number;
  refreshEngineInfo: () => Promise<EngineInfo>;
  selectedModelPath: string;
  setActiveTaskType: Dispatch<SetStateAction<"none" | "llm" | "voice" | "image">>;
  setBrainStatus: Dispatch<SetStateAction<"Idle" | "Loading" | "Ready" | "Thinking" | "Error">>;
  setComposerNotice: Dispatch<SetStateAction<string>>;
  setEngineErrorMsg: Dispatch<SetStateAction<string>>;
  setEngineStatus: Dispatch<SetStateAction<EngineStatus>>;
  setHasVision: Dispatch<SetStateAction<boolean>>;
  setMemorySize: Dispatch<SetStateAction<number>>;
  setModelLoadStatus: Dispatch<SetStateAction<ModelLoadStatus>>;
  setPendingAutoLoadPath: Dispatch<SetStateAction<string | null>>;
  setSelectedModel: Dispatch<SetStateAction<string | null>>;
  setSelectedModelPath: Dispatch<SetStateAction<string>>;
  setSetupNotice: Dispatch<SetStateAction<string>>;
  stopActiveAudio: () => void;
  systemInfo: SystemInfo;
};

export function useModelRuntime(options: UseModelRuntimeOptions) {
  const collectBrainDiagnostics = async () => {
    const parts = [
      `brainStatus=${options.brainStatus}`,
      `engineStatus=${options.engineStatus}`,
      `modelState=${options.modelLoadStatus.state}`,
      `selectedModel=${options.selectedModelPath || "none"}`,
      `activeTask=${options.activeTaskTypeRef.current}`,
    ];
    try {
      const healthStartedAt = performance.now();
      const health = await fetch("http://127.0.0.1:8080/health", { cache: "no-store" });
      parts.push(`health=${health.status}`);
      parts.push(`health_ms=${Math.round(performance.now() - healthStartedAt)}`);
      parts.push(`health_body=${JSON.stringify((await health.text()).slice(0, 300))}`);
    } catch (error) {
      parts.push(`health_error=${JSON.stringify(error instanceof Error ? error.message : String(error))}`);
    }
    try {
      const status = await invoke<ModelLoadStatus>("get_model_load_status");
      parts.push(`load_status=${status.state}`);
      parts.push(`load_progress=${status.progress}`);
      parts.push(`load_message=${JSON.stringify(status.message)}`);
    } catch (error) {
      parts.push(`load_status_error=${JSON.stringify(error instanceof Error ? error.message : String(error))}`);
    }
    return parts.join(" ");
  };

  const unloadLlmForTask = async (taskType: "voice" | "image") => {
    if (options.activeTaskTypeRef.current === taskType) {
      return;
    }

    options.stopActiveAudio();

    if (
      options.activeTaskTypeRef.current === "llm" ||
      options.brainStatus === "Ready" ||
      options.brainStatus === "Thinking"
    ) {
      options.setComposerNotice(taskType === "voice" ? "Preparing voice playback..." : "Preparing image creation...");
      try {
        await invoke<ModelStatus>("stop_model");
      } catch (error) {
        console.error("Model stop error:", error);
      }
      options.setBrainStatus("Idle");
      options.setModelLoadStatus({
        state: "idle",
        message: "No chat brain is loaded.",
        progress: 0,
      });
    }

    options.activeTaskTypeRef.current = taskType;
    options.setActiveTaskType(taskType);
  };

  const waitForModelReady = async (message = "Loading the selected brain...") => {
    const deadline = Date.now() + 10 * 60 * 1000;
    options.setBrainStatus("Loading");

    while (Date.now() < deadline) {
      const status = await invoke<ModelLoadStatus>("get_model_load_status");
      options.setModelLoadStatus(status);

      if (status.state === "ready") {
        options.setBrainStatus("Ready");
        return;
      }

      if (status.state === "error") {
        throw new Error(status.message);
      }

      try {
        const healthRes = await fetch("http://127.0.0.1:8080/health");
        if (healthRes.ok) {
          options.setModelLoadStatus({
            state: "ready",
            message: "Brain loaded and ready.",
            progress: 100,
          });
          options.setBrainStatus("Ready");
          return;
        }
      } catch {
        // keep waiting
      }

      options.setModelLoadStatus((prev) => ({
        state: prev.state || "loading",
        message: prev.message || message,
        progress: Math.max(prev.progress, 8),
      }));
      await sleep(1500);
    }

    throw new Error("Timed out waiting for the brain to become ready.");
  };

  const updateEngineForVision = async () => {
    if (!options.systemInfo) {
      throw new Error("System info is not ready yet.");
    }

    options.setEngineStatus("downloading");
    options.setModelLoadStatus({
      state: "loading",
      message: "Updating the brain engine so it can look at pictures...",
      progress: 5,
    });

    const result = await invoke<{ success: boolean; message: string }>("download_engine", {
      hasNvidiaGpu: options.systemInfo.has_nvidia_gpu,
      forceRefresh: true,
    });

    if (!result.success) {
      options.setEngineStatus("error");
      throw new Error(result.message);
    }

    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      const info = await options.refreshEngineInfo();
      if (info.ready && info.supports_mmproj) {
        options.setEngineStatus("ready");
        options.setEngineErrorMsg("");
        return;
      }
      await sleep(4000);
    }

    throw new Error("Timed out while updating the picture-aware brain engine.");
  };

  const ensureRuntimeEngineReady = async () => {
    const hasNvidiaGpu = options.systemInfo?.has_nvidia_gpu ?? false;
    try {
      const ready = await invoke<boolean>("check_engine_ready");
      if (ready) {
        await options.refreshEngineInfo();
        options.setEngineStatus("ready");
        options.setEngineErrorMsg("");
        return true;
      }
    } catch (error) {
      console.error("Engine ready check error:", error);
    }

    options.setEngineStatus("downloading");
    options.setSetupNotice("Preparing the brain engine for this PC...");
    const result = await invoke<{ success: boolean; message: string }>("download_engine", {
      hasNvidiaGpu,
      forceRefresh: false,
    });
    if (!result.success) {
      options.setEngineStatus("error");
      options.setEngineErrorMsg(result.message);
      throw new Error(result.message);
    }

    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      const ready = await invoke<boolean>("check_engine_ready");
      if (ready) {
        await options.refreshEngineInfo();
        options.setEngineStatus("ready");
        options.setEngineErrorMsg("");
        return true;
      }
      options.setSetupNotice("Downloading and preparing the brain engine...");
      await sleep(3000);
    }

    options.setEngineStatus("error");
    options.setEngineErrorMsg("The brain engine did not become ready in time.");
    throw new Error("The brain engine did not become ready in time.");
  };

  const loadModelPath = async (modelPath: string) => {
    if (!modelPath) {
      return;
    }

    if (options.engineStatus !== "ready") {
      options.setPendingAutoLoadPath(modelPath);
      options.setComposerNotice("The brain engine is still getting ready.");
      return;
    }

    if (options.modelLoadPromiseRef.current) {
      options.appLog(
        `model-load join requested=${modelPath} active=${options.modelLoadTargetRef.current || "unknown"}`,
      );
      await options.modelLoadPromiseRef.current;
      if (options.modelLoadTargetRef.current === modelPath || options.selectedModelPath === modelPath) {
        return;
      }
    }

    options.modelLoadTargetRef.current = modelPath;
    const loadPromise = (async () => {
      options.setSelectedModelPath(modelPath);
      options.setBrainStatus("Loading");
      options.activeTaskTypeRef.current = "llm";
      options.setActiveTaskType("llm");
      options.setModelLoadStatus({
        state: "starting",
        message: "Launching the selected brain...",
        progress: 2,
      });

      try {
        let activeGpuLayers = options.preferredChatGpuLayers;
        const effectiveContextSize = Math.max(options.memorySize, MIN_CHAT_CONTEXT_SIZE);
        if (effectiveContextSize !== options.memorySize) {
          options.setMemorySize(effectiveContextSize);
        }

        let result = await invoke<ModelStatus>("start_model", {
          modelPath,
          contextSize: effectiveContextSize,
          threads: options.recommendedThreads,
          gpuLayers: activeGpuLayers,
          reducedGpuLayers: options.reducedTaskGpuLayers,
        });

        if (result.status === "engine_update_required") {
          options.setModelLoadStatus({
            state: "loading",
            message: result.message,
            progress: 4,
          });
          await updateEngineForVision();
          result = await invoke<ModelStatus>("start_model", {
            modelPath,
            contextSize: effectiveContextSize,
            threads: options.recommendedThreads,
            gpuLayers: activeGpuLayers,
            reducedGpuLayers: options.reducedTaskGpuLayers,
          });
        }

        if (result.status !== "success") {
          throw new Error(result.message);
        }

        options.setSelectedModel(result.model_name);
        options.setHasVision(result.has_vision);
        options.activeTaskTypeRef.current = "llm";
        options.setActiveTaskType("llm");
        {
          const notices: string[] = [];
          if (!result.has_vision) {
            notices.push("This brain can chat, but it cannot look at pictures.");
          }
          if (result.gpu_layers < activeGpuLayers) {
            notices.push("Loaded with automatic memory placement to keep the main brain stable.");
          }
          options.setComposerNotice(notices.join(" "));
        }
        try {
          await waitForModelReady();
        } catch (error) {
          const fallbackGpuLayers = options.reducedTaskGpuLayers || 0;
          if (
            activeGpuLayers > fallbackGpuLayers &&
            fallbackGpuLayers > 0 &&
            isGpuFitError(error)
          ) {
            activeGpuLayers = fallbackGpuLayers;
            options.setModelLoadStatus({
              state: "starting",
              message: "The brain was too large for full graphics power. Trying a safer graphics setting...",
              progress: 2,
            });
            result = await invoke<ModelStatus>("start_model", {
              modelPath,
              contextSize: effectiveContextSize,
              threads: options.recommendedThreads,
              gpuLayers: activeGpuLayers,
              reducedGpuLayers: fallbackGpuLayers,
            });
            if (result.status !== "success") {
              throw new Error(result.message);
            }
            options.setSelectedModel(result.model_name);
            options.setHasVision(result.has_vision);
            options.activeTaskTypeRef.current = "llm";
            options.setActiveTaskType("llm");
            {
              const notices = [
                "Loaded with a safer graphics setting because full graphics power did not fit.",
              ];
              if (!result.has_vision) {
                notices.push("This brain can chat, but it cannot look at pictures.");
              }
              if (result.gpu_layers < activeGpuLayers) {
                notices.push("The engine also trimmed GPU layers automatically.");
              }
              options.setComposerNotice(notices.join(" "));
            }
            await waitForModelReady("Trying a safer graphics setting...");
          } else {
            throw error;
          }
        }
        options.setPendingAutoLoadPath(null);
      } catch (error) {
        console.error("Brain load error:", error);
        options.activeTaskTypeRef.current = "none";
        options.setActiveTaskType("none");
        options.setBrainStatus("Error");
        options.setModelLoadStatus({
          state: "error",
          message: error instanceof Error ? error.message : String(error),
          progress: 100,
        });
      }
    })();
    options.modelLoadPromiseRef.current = loadPromise;
    try {
      await loadPromise;
    } finally {
      if (options.modelLoadPromiseRef.current === loadPromise) {
        options.modelLoadPromiseRef.current = null;
        options.modelLoadTargetRef.current = "";
      }
    }
  };

  const ensureChatModelReady = async () => {
    const targetModelPath = options.selectedModelPath || options.availableModels[0]?.path || "";
    if (!targetModelPath) {
      options.setComposerNotice("Choose a GGUF folder with a brain first.");
      return false;
    }

    if (options.engineStatus !== "ready") {
      options.setPendingAutoLoadPath(targetModelPath);
      options.setComposerNotice("The brain engine is still getting ready.");
      return false;
    }

    let shouldLoadModel =
      options.activeTaskTypeRef.current !== "llm" ||
      options.brainStatus !== "Ready" ||
      options.selectedModelPath !== targetModelPath;

    if (!shouldLoadModel) {
      try {
        const healthRes = await fetch("http://127.0.0.1:8080/health");
        shouldLoadModel = !healthRes.ok;
      } catch {
        shouldLoadModel = true;
      }
    }

    if (shouldLoadModel) {
      options.stopActiveAudio();
      options.setComposerNotice("Loading the chat brain...");
      await invoke("stop_omnivoice_engine").catch(() => undefined);
      await loadModelPath(targetModelPath);
    }

    return true;
  };

  return {
    collectBrainDiagnostics,
    ensureChatModelReady,
    ensureRuntimeEngineReady,
    loadModelPath,
    unloadLlmForTask,
    waitForModelReady,
  };
}
