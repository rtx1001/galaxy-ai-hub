import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  CharacterFiles,
  CharacterSettings,
  PersonalityPreset,
} from "../appCore";
import { syncSoulCoreIdentity } from "../appCore";

type UseCharacterFilesOptions = {
  settingsLoaded: boolean;
  settingsReadyForSave: boolean;
  selectedPersonalityId: string;
  selectedVoicePath: string;
  personality: string;
  personalityAvatar: string;
  personalityPresets: PersonalityPreset[];
  setPersonalityPresets: Dispatch<SetStateAction<PersonalityPreset[]>>;
  setSelectedVoicePath: Dispatch<SetStateAction<string>>;
};

export function useCharacterFiles({
  settingsLoaded,
  settingsReadyForSave,
  selectedPersonalityId,
  selectedVoicePath,
  personality,
  personalityAvatar,
  personalityPresets,
  setPersonalityPresets,
  setSelectedVoicePath,
}: UseCharacterFilesOptions) {
  const [characterSoul, setCharacterSoul] = useState("");
  const [characterFolder, setCharacterFolder] = useState("");

  const saveActiveCharacterFiles = async (
    override?: Partial<CharacterSettings> & { name?: string; soul?: string },
  ) => {
    const activePersonality =
      personalityPresets.find((preset) => preset.id === selectedPersonalityId) ?? personalityPresets[0];
    if (!activePersonality) return null;
    const nextName = override?.name ?? activePersonality.name;
    const nextPrompt = override?.prompt ?? personality;
    const settings: CharacterSettings = {
      voice_path: override?.voice_path ?? selectedVoicePath ?? "",
      avatar: override?.avatar ?? personalityAvatar ?? "",
      prompt: nextPrompt,
      greeting: "",
      notes: "",
    };
    const nextSoul = syncSoulCoreIdentity(override?.soul ?? characterSoul, nextName, nextPrompt);
    const saved = await invoke<CharacterFiles>("save_character_files", {
      id: activePersonality.id,
      name: nextName,
      settings,
      soul: nextSoul,
    });
    setCharacterSoul(saved.soul);
    setCharacterFolder(saved.folder);
    return saved;
  };

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId) return;
    const activePersonality =
      personalityPresets.find((preset) => preset.id === selectedPersonalityId) ?? personalityPresets[0];
    if (!activePersonality) return;

    let cancelled = false;
    invoke<CharacterFiles>("load_character_files", {
      id: activePersonality.id,
      name: activePersonality.name,
      prompt: activePersonality.prompt || personality || "",
      avatar: activePersonality.avatar || "",
      voicePath: activePersonality.voice_path || selectedVoicePath || "",
    })
      .then((files) => {
        if (cancelled) return;
        setCharacterSoul(files.soul);
        setCharacterFolder(files.folder);
        if (files.settings.voice_path) {
          setSelectedVoicePath(files.settings.voice_path);
        }
        setPersonalityPresets((prev) =>
          prev.map((preset) =>
            preset.id === activePersonality.id
              ? {
                  ...preset,
                  voice_path: files.settings.voice_path || preset.voice_path || "",
                  avatar: preset.avatar || files.settings.avatar || "",
                  prompt: preset.prompt || files.settings.prompt || "",
                }
              : preset,
          ),
        );
      })
      .catch((error) => {
        console.error("Character files load error:", error);
        setCharacterSoul("");
        setCharacterFolder("");
      });

    return () => {
      cancelled = true;
    };
  }, [settingsLoaded, selectedPersonalityId, personalityPresets.length]);

  useEffect(() => {
    if (!settingsLoaded || !settingsReadyForSave || !selectedPersonalityId || !characterSoul.trim()) return;
    const handle = window.setTimeout(() => {
      saveActiveCharacterFiles().catch((error) => console.error("Character files save error:", error));
    }, 900);
    return () => window.clearTimeout(handle);
  }, [settingsLoaded, settingsReadyForSave, selectedPersonalityId, selectedVoicePath, personality, personalityAvatar, characterSoul]);

  return {
    characterSoul,
    characterFolder,
    saveActiveCharacterFiles,
  };
}
