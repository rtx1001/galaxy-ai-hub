import { open } from "@tauri-apps/plugin-dialog";

type UseVoiceFolderActionsOptions = {
  setVoiceFolder: (folder: string) => void;
  updateActiveCharacterVoicePath: (voicePath: string) => void;
  voiceFolder: string;
};

export function useVoiceFolderActions(options: UseVoiceFolderActionsOptions) {
  const handleChooseVoiceFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose voice samples folder",
      defaultPath: options.voiceFolder || undefined,
    });

    if (typeof selected !== "string") {
      return;
    }

    options.setVoiceFolder(selected);
    options.updateActiveCharacterVoicePath("");
  };

  return { handleChooseVoiceFolder };
}
