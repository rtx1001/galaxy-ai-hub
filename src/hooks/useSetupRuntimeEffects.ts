import { useEffect } from "react";

type UseSetupRuntimeEffectsOptions = Record<string, any>;

export function useSetupRuntimeEffects(options: UseSetupRuntimeEffectsOptions) {
  useEffect(() => {
    if (!options.settingsLoaded || !options.setupScreenOpen || !options.setupCatalog || options.setupCatalog.tier !== options.activeSetupTier) {
      return;
    }
    const brainPart = options.setupCatalog.parts.find((part: { key: string; installed?: boolean }) => part.key === "brain");
    if (!brainPart?.installed) {
      return;
    }
    const nextFolder = options.setupCatalog.brain_model_folder;
    const nextModel = options.setupCatalog.selected_brain_model_path;
    if (!nextModel || options.selectedModelPath === nextModel) {
      return;
    }
    options.setModelFolder(nextFolder);
    options.setSelectedModelPath(nextModel);
    options.scanModelLibrary(nextFolder, nextModel, true).catch((error: unknown) =>
      console.error("Setup tier model switch error:", error),
    );
    if (options.engineStatus === "ready") {
      options.loadModelPath(nextModel).catch((error: unknown) => console.error("Setup tier load error:", error));
    } else {
      options.setPendingAutoLoadPath(nextModel);
    }
  }, [
    options.settingsLoaded,
    options.setupScreenOpen,
    options.setupCatalog,
    options.activeSetupTier,
    options.selectedModelPath,
    options.engineStatus,
  ]);

  useEffect(() => {
    if (!options.settingsLoaded || !options.setupCompleted || options.firstStartupSetupNeeded) {
      return;
    }
    if (options.voiceSetupStatus.ready && options.omniVoiceStatus.ready) {
      return;
    }
    void options.prepareVoiceHelpers(false);
  }, [
    options.settingsLoaded,
    options.setupCompleted,
    options.firstStartupSetupNeeded,
    options.voiceSetupStatus.ready,
    options.omniVoiceStatus.ready,
  ]);
}
