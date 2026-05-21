import { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SetupCatalog, SetupInstallProgress, SetupInstallResult, SetupTier, SystemInfo } from "../appCore";

type UseSetupInstallActionsOptions = {
  activeSetupTier: SetupTier;
  ensureConversationStartsAtBottom: () => void;
  ensureRuntimeEngineReady: () => Promise<boolean>;
  prepareVoiceHelpers: (force: boolean) => Promise<unknown>;
  scanModelLibrary: (folder: string, selectedPath: string, silent?: boolean) => Promise<void>;
  setLeftPanelOpen: Dispatch<SetStateAction<boolean>>;
  setModelFolder: Dispatch<SetStateAction<string>>;
  setPendingAutoLoadPath: Dispatch<SetStateAction<string | null>>;
  setRightPanelOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedModelPath: Dispatch<SetStateAction<string>>;
  setSetupCatalog: Dispatch<SetStateAction<SetupCatalog | null>>;
  setSetupCompleted: Dispatch<SetStateAction<boolean>>;
  setSetupInstalling: Dispatch<SetStateAction<boolean>>;
  setSetupNotice: Dispatch<SetStateAction<string>>;
  setSetupProgress: Dispatch<SetStateAction<SetupInstallProgress | null>>;
  setSetupScreenOpen: Dispatch<SetStateAction<boolean>>;
  setupCatalog: SetupCatalog | null;
  setupInstalling: boolean;
  systemInfo: SystemInfo | null;
};

export function useSetupInstallActions(options: UseSetupInstallActionsOptions) {
  const handleInstallSetupBundle = async () => {
    if (options.setupInstalling) return;
    options.setSetupInstalling(true);
    options.setSetupProgress({
      stage: "starting",
      part_key: "",
      label: "",
      file_index: 0,
      file_count: options.setupCatalog?.parts.reduce((count, part) => count + part.files.length, 0) || 0,
      percent: 0,
      message: "Preparing local model folders...",
    });
    options.setSetupNotice("Downloading local AI parts. This can take a long time on the first run...");
    try {
      const result = await invoke<SetupInstallResult>("install_setup_bundle", {
        tier: options.activeSetupTier,
        hasNvidiaGpu: options.systemInfo?.has_nvidia_gpu ?? false,
      });
      options.setSetupCatalog(result.catalog);
      options.setModelFolder(result.catalog.brain_model_folder);
      options.setSelectedModelPath(result.catalog.selected_brain_model_path);
      options.setSetupCompleted(true);
      options.setLeftPanelOpen(true);
      options.setRightPanelOpen(true);
      options.setSetupNotice("Models downloaded. Preparing the app for first use...");
      await options.ensureRuntimeEngineReady();
      await options.scanModelLibrary(
        result.catalog.brain_model_folder,
        result.catalog.selected_brain_model_path,
        true,
      );
      options.setPendingAutoLoadPath(result.catalog.selected_brain_model_path);
      await options.prepareVoiceHelpers(true);
      options.setSetupNotice(result.message);
      options.setSetupScreenOpen(false);
      window.setTimeout(() => options.ensureConversationStartsAtBottom(), 0);
    } catch (error) {
      console.error("Setup install error:", error);
      options.setSetupNotice(error instanceof Error ? error.message : String(error));
    } finally {
      options.setSetupInstalling(false);
    }
  };

  const closeSetupScreen = () => {
    options.setSetupCompleted(true);
    options.setSetupScreenOpen(false);
    options.setLeftPanelOpen(true);
    options.setRightPanelOpen(true);
    window.setTimeout(() => options.ensureConversationStartsAtBottom(), 0);
  };

  return {
    closeSetupScreen,
    handleInstallSetupBundle,
  };
}
