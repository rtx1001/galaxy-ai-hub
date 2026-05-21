import { useCallback, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ModelLibraryEntry } from "../appCore";

type EngineStatus = "initializing" | "downloading" | "ready" | "error";

type UseModelLibraryActionsOptions = {
  modelFolder: string;
  engineStatus: EngineStatus;
  setAvailableModels: Dispatch<SetStateAction<ModelLibraryEntry[]>>;
  setSelectedModelPath: Dispatch<SetStateAction<string>>;
  setSelectedModel: Dispatch<SetStateAction<string | null>>;
  setModelFolder: Dispatch<SetStateAction<string>>;
  setPendingAutoLoadPath: Dispatch<SetStateAction<string | null>>;
  setComposerNotice: Dispatch<SetStateAction<string>>;
  loadModelPath: (modelPath: string) => Promise<void>;
};

export function useModelLibraryActions({
  modelFolder,
  engineStatus,
  setAvailableModels,
  setSelectedModelPath,
  setSelectedModel,
  setModelFolder,
  setPendingAutoLoadPath,
  setComposerNotice,
  loadModelPath,
}: UseModelLibraryActionsOptions) {
  const scanModelLibrary = useCallback(async (
    folderPath: string,
    preferredPath?: string,
    autoLoad?: boolean,
  ) => {
    if (!folderPath) {
      setAvailableModels([]);
      setSelectedModelPath("");
      setSelectedModel(null);
      return;
    }

    try {
      const models = await invoke<ModelLibraryEntry[]>("scan_model_folder", {
        folderPath,
      });
      setAvailableModels(models);

      if (models.length === 0) {
        setComposerNotice("No GGUF brains were found in that folder.");
        setSelectedModelPath("");
        return;
      }

      const targetPath =
        preferredPath && models.some((model) => model.path === preferredPath)
          ? preferredPath
          : models[0].path;
      setSelectedModelPath(targetPath);
      setComposerNotice("");

      if (autoLoad) {
        if (engineStatus === "ready") {
          await loadModelPath(targetPath);
        } else {
          setPendingAutoLoadPath(targetPath);
        }
      }
    } catch (error) {
      console.error("Model library scan error:", error);
      setComposerNotice(error instanceof Error ? error.message : String(error));
    }
  }, [
    engineStatus,
    loadModelPath,
    setAvailableModels,
    setComposerNotice,
    setPendingAutoLoadPath,
    setSelectedModel,
    setSelectedModelPath,
  ]);

  const handleChooseModelFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose your GGUF library folder",
      defaultPath: modelFolder || undefined,
    });

    if (typeof selected !== "string") {
      return;
    }

    setModelFolder(selected);
    await scanModelLibrary(selected, "", false);
  }, [modelFolder, scanModelLibrary, setModelFolder]);

  return {
    scanModelLibrary,
    handleChooseModelFolder,
  };
}
