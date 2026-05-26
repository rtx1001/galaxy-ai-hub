import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  SetupCatalog,
  SetupInstallProgress,
  SetupPreflightReport,
  SetupTier,
  SystemInfo,
  setupTierFromSystem,
} from "../appCore";

const installedSetupTierFromModel = (path: string | null): SetupTier | null => {
  const normalized = (path || "").replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("gemma-4-e2b")) return "light";
  if (normalized.includes("gemma-4-e4b") && normalized.includes("q8")) return "high";
  if (normalized.includes("gemma-4-e4b")) return "balanced";
  return null;
};

export function useSetupFlow({
  initialSetupCompleted,
  settingsLoaded,
  selectedModelPath,
  systemInfo,
}: {
  initialSetupCompleted: boolean;
  settingsLoaded: boolean;
  selectedModelPath: string;
  systemInfo: SystemInfo | null;
}) {
  const [setupCompleted, setSetupCompleted] = useState(initialSetupCompleted);
  const [setupScreenOpen, setSetupScreenOpen] = useState(false);
  const [setupTierOverride, setSetupTierOverride] = useState<SetupTier | null>(null);
  const [setupCatalog, setSetupCatalog] = useState<SetupCatalog | null>(null);
  const [setupInstalling, setSetupInstalling] = useState(false);
  const [setupNotice, setSetupNotice] = useState("");
  const [setupPreflight, setSetupPreflight] = useState<SetupPreflightReport | null>(null);
  const [setupProgress, setSetupProgress] =
    useState<SetupInstallProgress | null>(null);
  const setupRepairPromptedRef = useRef(false);

  const detectedSetupTier = setupTierFromSystem(systemInfo);
  const activeSetupTier =
    setupTierOverride ?? installedSetupTierFromModel(selectedModelPath) ?? detectedSetupTier;
  const setupHasMissingFiles = Boolean(
    setupCatalog?.parts.some((part) => !part.installed),
  );
  const hasWorkingBrainModel = Boolean(selectedModelPath);
  const firstStartupSetupNeeded = !setupCompleted && !hasWorkingBrainModel;
  const activeSetupPartKey = setupProgress?.part_key || "";

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listen<SetupInstallProgress>("setup-install-progress", (event) => {
      if (disposed) return;
      setSetupProgress(event.payload);
      setSetupNotice(event.payload.message);
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unlisten = cleanup;
      })
      .catch((error) => console.error("Setup progress listener error:", error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    invoke<SetupCatalog>("get_setup_catalog", {
      tier: activeSetupTier,
      hasNvidiaGpu: systemInfo?.has_nvidia_gpu ?? false,
    })
      .then(setSetupCatalog)
      .catch((error) => {
        console.error("Setup catalog error:", error);
        setSetupNotice(error instanceof Error ? error.message : String(error));
      });
    invoke<SetupPreflightReport>("get_setup_preflight", {
      tier: activeSetupTier,
      hasNvidiaGpu: systemInfo?.has_nvidia_gpu ?? false,
    })
      .then(setSetupPreflight)
      .catch((error) => console.error("Setup preflight error:", error));
  }, [settingsLoaded, activeSetupTier, systemInfo]);

  useEffect(() => {
    if (
      !settingsLoaded ||
      !setupCompleted ||
      setupScreenOpen ||
      !setupCatalog ||
      !setupHasMissingFiles ||
      hasWorkingBrainModel ||
      setupRepairPromptedRef.current
    ) {
      return;
    }
    setupRepairPromptedRef.current = true;
    setSetupNotice(
      "Some local AI files are missing. Galaxy can download only the missing parts and keep existing files.",
    );
    setSetupScreenOpen(true);
  }, [
    settingsLoaded,
    setupCompleted,
    setupScreenOpen,
    setupCatalog,
    setupHasMissingFiles,
    hasWorkingBrainModel,
  ]);

  const chooseSetupTier = (tier: SetupTier) => {
    setSetupTierOverride(tier);
    setSetupNotice(
      `Selected ${tier} setup. Galaxy will use this tier when its files are installed.`,
    );
  };

  return {
    setupCompleted,
    setSetupCompleted,
    setupScreenOpen,
    setSetupScreenOpen,
    setupTierOverride,
    setupCatalog,
    setSetupCatalog,
    setupInstalling,
    setSetupInstalling,
    setupNotice,
    setSetupNotice,
    setupPreflight,
    setSetupPreflight,
    setupProgress,
    setSetupProgress,
    activeSetupTier,
    detectedSetupTier,
    setupHasMissingFiles,
    firstStartupSetupNeeded,
    activeSetupPartKey,
    chooseSetupTier,
  };
}
