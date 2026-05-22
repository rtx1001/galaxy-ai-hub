import { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SetupCatalog, SetupInstallProgress, SetupInstallResult, SetupPartKey, SetupTier, SystemInfo } from "../appCore";

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
  const finishSuccessfulSetupInstall = async (result: SetupInstallResult) => {
    options.setSetupCatalog(result.catalog);
    options.setModelFolder(result.catalog.brain_model_folder);
    options.setSelectedModelPath(result.catalog.selected_brain_model_path);
    options.setSetupCompleted(true);
    options.setSetupNotice("Files are ready. Preparing the app...");
    await options.ensureRuntimeEngineReady();
    await options.scanModelLibrary(
      result.catalog.brain_model_folder,
      result.catalog.selected_brain_model_path,
      true,
    );
    options.setPendingAutoLoadPath(result.catalog.selected_brain_model_path);
    await options.prepareVoiceHelpers(true);
    options.setSetupNotice(result.message);
  };

  const beginSetupInstall = (fileCount: number, message: string) => {
    options.setSetupInstalling(true);
    options.setSetupProgress({
      stage: "starting",
      part_key: "",
      label: "",
      file_index: 0,
      file_count: fileCount,
      percent: 0,
      message,
    });
    options.setSetupNotice("Downloading local AI parts. This can take a long time on the first run...");
  };

  const handleInstallSetupBundle = async () => {
    if (options.setupInstalling) return;
    beginSetupInstall(
      options.setupCatalog?.parts.reduce((count, part) => count + part.files.length, 0) || 0,
      "Preparing local model folders...",
    );
    try {
      const result = await invoke<SetupInstallResult>("install_setup_bundle", {
        tier: options.activeSetupTier,
        hasNvidiaGpu: options.systemInfo?.has_nvidia_gpu ?? false,
      });
      await finishSuccessfulSetupInstall(result);
      options.setLeftPanelOpen(true);
      options.setRightPanelOpen(true);
      options.setSetupScreenOpen(false);
      window.setTimeout(() => options.ensureConversationStartsAtBottom(), 0);
    } catch (error) {
      console.error("Setup install error:", error);
      options.setSetupNotice(error instanceof Error ? error.message : String(error));
    } finally {
      options.setSetupInstalling(false);
    }
  };

  const handleInstallSetupPart = async (partKey: SetupPartKey) => {
    if (options.setupInstalling) return;
    const part = options.setupCatalog?.parts.find((item) => item.key === partKey);
    beginSetupInstall(part?.files.length || 0, `Preparing ${part?.title || partKey} files...`);
    try {
      const result = await invoke<SetupInstallResult>("install_setup_part", {
        tier: options.activeSetupTier,
        partKey,
        hasNvidiaGpu: options.systemInfo?.has_nvidia_gpu ?? false,
      });
      options.setSetupCatalog(result.catalog);
      options.setSetupNotice(result.message);
      if (partKey === "brain") {
        options.setModelFolder(result.catalog.brain_model_folder);
        options.setSelectedModelPath(result.catalog.selected_brain_model_path);
        await options.scanModelLibrary(
          result.catalog.brain_model_folder,
          result.catalog.selected_brain_model_path,
          true,
        );
        options.setPendingAutoLoadPath(result.catalog.selected_brain_model_path);
      }
      if (partKey === "voice") {
        await options.prepareVoiceHelpers(true);
      }
      if (result.catalog.parts.every((item) => item.installed)) {
        options.setSetupCompleted(true);
      }
    } catch (error) {
      console.error("Setup part install error:", error);
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
    handleInstallSetupPart,
  };
}
