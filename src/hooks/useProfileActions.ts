import { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_SETTINGS,
  PersonalityPreset,
  UserProfilePreset,
  createMessageId,
  parseProfileRefId,
  personalityFromUserProfile,
  profileRefId,
  userProfileFromPersonality,
} from "../appCore";
import { ChatMessage } from "../types";

type ChatSessions = Record<string, ChatMessage[]>;

type CharacterFilePayload = {
  name: string;
  prompt: string;
  avatar: string;
  voice_path: string;
  soul: string;
};

type UseProfileActionsOptions = {
  characterSoul: string;
  clearImage: () => void;
  deletePersonalityMemory: (personalityId: string, personalityName?: string) => Promise<void>;
  loadChatSessionForPersonality: (personalityId: string, userProfileId?: string) => void;
  personality: string;
  personalityAvatar: string;
  personalityNameDraft: string;
  personalityPresets: PersonalityPreset[];
  registerEmptyChatSession: (personalityId: string, userProfileId?: string) => void;
  removeChatSession: (personalityId: string) => ChatSessions;
  saveActiveCharacterFiles: (payload: CharacterFilePayload) => Promise<unknown>;
  saveActiveChatSession: () => void;
  selectedPersonalityId: string;
  selectedPersonalityPreset?: PersonalityPreset;
  selectedUserProfile?: UserProfilePreset;
  selectedUserProfileId: string;
  selectedUserVoicePath: string;
  selectedVoicePath: string;
  setComposerNotice: Dispatch<SetStateAction<string>>;
  setComposerText: (value: string) => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setPersonality: Dispatch<SetStateAction<string>>;
  setPersonalityAvatar: Dispatch<SetStateAction<string>>;
  setPersonalityNameDraft: Dispatch<SetStateAction<string>>;
  setPersonalityPresets: Dispatch<SetStateAction<PersonalityPreset[]>>;
  setPersonalityProfileOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedPersonalityId: Dispatch<SetStateAction<string>>;
  setSelectedUserProfileId: Dispatch<SetStateAction<string>>;
  setSelectedVoicePath: Dispatch<SetStateAction<string>>;
  setUserAvatar: Dispatch<SetStateAction<string>>;
  setUserDescription: Dispatch<SetStateAction<string>>;
  setUserLatitude: Dispatch<SetStateAction<number | null>>;
  setUserLocationLabel: Dispatch<SetStateAction<string>>;
  setUserLongitude: Dispatch<SetStateAction<number | null>>;
  setUserName: Dispatch<SetStateAction<string>>;
  setUserProfileMenuOpen: Dispatch<SetStateAction<boolean>>;
  setUserProfileOpen: Dispatch<SetStateAction<boolean>>;
  setUserProfiles: Dispatch<SetStateAction<UserProfilePreset[]>>;
  userAvatar: string;
  userDescription: string;
  userLatitude: number | null;
  userLocationLabel: string;
  userLongitude: number | null;
  userName: string;
  userProfiles: UserProfilePreset[];
};

const applyUserProfile = (
  profile: UserProfilePreset,
  setters: Pick<
    UseProfileActionsOptions,
    | "setSelectedUserProfileId"
    | "setUserName"
    | "setUserAvatar"
    | "setUserDescription"
    | "setUserLocationLabel"
    | "setUserLatitude"
    | "setUserLongitude"
  >,
) => {
  setters.setSelectedUserProfileId(profile.id);
  setters.setUserName(profile.name || "You");
  setters.setUserAvatar(profile.avatar || "");
  setters.setUserDescription(profile.description || "");
  setters.setUserLocationLabel(profile.location_label || "");
  setters.setUserLatitude(typeof profile.latitude === "number" && Number.isFinite(profile.latitude) ? profile.latitude : null);
  setters.setUserLongitude(typeof profile.longitude === "number" && Number.isFinite(profile.longitude) ? profile.longitude : null);
};

const sameProfileEntity = (
  first: ReturnType<typeof parseProfileRefId>,
  second: ReturnType<typeof parseProfileRefId>,
) => first.kind === second.kind && first.id === second.id;

export function useProfileActions(options: UseProfileActionsOptions) {
  const resolvePersonalityPreset = (presetId: string) => {
    const ref = parseProfileRefId(presetId, "personality");
    return ref.kind === "user"
      ? options.userProfiles.find((item) => item.id === ref.id)
        ? personalityFromUserProfile(options.userProfiles.find((item) => item.id === ref.id)!)
        : undefined
      : options.personalityPresets.find((item) => item.id === ref.id);
  };

  const resolveUserProfile = (profileId: string) => {
    const ref = parseProfileRefId(profileId, "user");
    return ref.kind === "personality"
      ? options.personalityPresets.find((item) => item.id === ref.id)
        ? userProfileFromPersonality(options.personalityPresets.find((item) => item.id === ref.id)!)
        : undefined
      : options.userProfiles.find((item) => item.id === ref.id);
  };

  const rightPanelIdFromRef = (ref: ReturnType<typeof parseProfileRefId>) =>
    ref.kind === "user" ? profileRefId("user", ref.id) : ref.id;

  const leftPanelIdFromRef = (ref: ReturnType<typeof parseProfileRefId>) =>
    ref.kind === "personality" ? profileRefId("personality", ref.id) : ref.id;

  const applyPersonalityPreset = (preset: PersonalityPreset) => {
    options.setSelectedPersonalityId(preset.id);
    options.setPersonalityNameDraft(preset.name || "Assistant");
    options.setPersonality(preset.prompt);
    options.setPersonalityAvatar(preset.avatar || "");
    options.setSelectedVoicePath(preset.voice_path || "");
  };

  const updateActiveUserProfile = (patch: Partial<UserProfilePreset>) => {
    const selectedRef = parseProfileRefId(options.selectedUserProfileId, "user");
    if (selectedRef.kind === "personality") {
      options.setPersonalityPresets((prev) =>
        prev.map((preset) =>
          preset.id === selectedRef.id
            ? {
                ...preset,
                name: patch.name ?? preset.name,
                prompt: patch.description ?? preset.prompt,
                avatar: patch.avatar ?? preset.avatar,
                voice_path: patch.voice_path ?? preset.voice_path,
              }
            : preset,
        ),
      );
      return;
    }
    options.setUserProfiles((prev) =>
      prev.map((profile) =>
        profile.id === selectedRef.id ? { ...profile, ...patch } : profile,
      ),
    );
  };

  const updateActiveUserVoicePath = (voicePath: string) => {
    updateActiveUserProfile({ voice_path: voicePath });
  };

  const selectPersonalityPreset = (presetId: string) => {
    const ref = parseProfileRefId(presetId, "personality");
    const preset = resolvePersonalityPreset(presetId);
    if (!preset) return;
    options.saveActiveChatSession();
    const activeUserRef = parseProfileRefId(options.selectedUserProfileId, "user");
    const activeAssistantRef = parseProfileRefId(options.selectedPersonalityId, "personality");
    let nextUserId = options.selectedUserProfileId;
    if (sameProfileEntity(ref, activeUserRef)) {
      const swappedUserId = leftPanelIdFromRef(activeAssistantRef);
      const nextUserProfile = resolveUserProfile(swappedUserId);
      if (nextUserProfile) {
        applyUserProfile(nextUserProfile, options);
        nextUserId = nextUserProfile.id;
      }
    }
    applyPersonalityPreset(preset);
    options.loadChatSessionForPersonality(preset.id, nextUserId);
    options.setComposerText("");
    options.clearImage();
    options.setComposerNotice("");
  };

  const selectUserProfile = (profileId: string) => {
    const ref = parseProfileRefId(profileId, "user");
    const profile = resolveUserProfile(profileId);
    if (!profile) return;
    options.saveActiveChatSession();
    const activeUserRef = parseProfileRefId(options.selectedUserProfileId, "user");
    const activeAssistantRef = parseProfileRefId(options.selectedPersonalityId, "personality");
    let nextAssistantId = options.selectedPersonalityId;
    if (sameProfileEntity(ref, activeAssistantRef)) {
      const swappedAssistantId = rightPanelIdFromRef(activeUserRef);
      const nextPreset = resolvePersonalityPreset(swappedAssistantId);
      if (nextPreset) {
        applyPersonalityPreset(nextPreset);
        nextAssistantId = nextPreset.id;
      }
    }
    applyUserProfile(profile, options);
    options.loadChatSessionForPersonality(nextAssistantId, profile.id);
    options.clearImage();
    options.setComposerNotice("");
    options.setComposerText("");
    options.setUserProfileMenuOpen(false);
  };

  const createUserProfile = () => {
    const profile: UserProfilePreset = {
      id: createMessageId(),
      name: "New user",
      description: "",
      avatar: "",
      voice_path: "",
      location_label: "",
      latitude: null,
      longitude: null,
      auto_speech: true,
    };
    options.setUserProfiles((prev) => [...prev, profile]);
    applyUserProfile(profile, options);
    options.loadChatSessionForPersonality(options.selectedPersonalityId, profile.id);
    options.setUserProfileMenuOpen(false);
    options.setUserProfileOpen(true);
  };

  const openUserProfile = () => {
    options.setUserProfileMenuOpen(false);
    options.setUserProfileOpen(true);
  };

  const saveActiveUserProfile = () => {
    const nextName = options.userName.trim() || options.selectedUserProfile?.name || "You";
    options.setUserName(nextName);
    updateActiveUserProfile({
      name: nextName,
      avatar: options.userAvatar,
      description: options.userDescription,
      voice_path: options.selectedUserVoicePath,
      location_label: options.userLocationLabel,
      latitude: options.userLatitude,
      longitude: options.userLongitude,
      auto_speech: options.selectedUserProfile?.auto_speech ?? true,
    });
    options.setUserProfileOpen(false);
  };

  const deleteSelectedUserProfile = () => {
    const selectedRef = parseProfileRefId(options.selectedUserProfileId, "user");
    if (selectedRef.kind === "personality") return;
    if (options.userProfiles.length <= 1) return;
    options.setUserProfiles((prev) => {
      const next = prev.filter((profile) => profile.id !== selectedRef.id);
      const fallback = next[0] ?? DEFAULT_SETTINGS.user_profiles[0];
      applyUserProfile(fallback, options);
      return next.length ? next : DEFAULT_SETTINGS.user_profiles;
    });
    options.setUserProfileOpen(false);
  };

  const openPersonalityProfile = () => {
    options.setPersonalityNameDraft(options.selectedPersonalityPreset?.name || "Assistant");
    options.setPersonalityProfileOpen(true);
  };

  const saveCurrentPersonalityPreset = () => {
    const name = "New assistant";
    const preset: PersonalityPreset = {
      id: createMessageId(),
      name,
      prompt: "You are a helpful assistant.",
      avatar: "",
      voice_path: "",
    };
    options.saveActiveChatSession();
    options.setPersonalityPresets((prev) => [...prev, preset]);
    options.setSelectedPersonalityId(preset.id);
    options.setPersonality(preset.prompt);
    options.setPersonalityAvatar("");
    options.setSelectedVoicePath("");
    options.setPersonalityNameDraft(name);
    options.setMessages([]);
    options.registerEmptyChatSession(preset.id);
    options.setPersonalityProfileOpen(true);
  };

  const updateSelectedPersonalityPreset = async () => {
    const nextName = options.personalityNameDraft.trim() || options.selectedPersonalityPreset?.name || "Assistant";
    const selectedRef = parseProfileRefId(options.selectedPersonalityId, "personality");
    if (selectedRef.kind === "user") {
      options.setUserProfiles((prev) =>
        prev.map((profile) =>
          profile.id === selectedRef.id
            ? {
                ...profile,
                name: nextName,
                description: options.personality,
                avatar: options.personalityAvatar,
                voice_path: options.selectedVoicePath,
              }
            : profile,
        ),
      );
      options.setPersonalityNameDraft(nextName);
      return;
    }
    options.setPersonalityPresets((prev) =>
      prev.map((preset) =>
        preset.id === options.selectedPersonalityId
          ? {
              ...preset,
              name: nextName,
              prompt: options.personality,
              avatar: options.personalityAvatar,
              voice_path: options.selectedVoicePath,
            }
          : preset,
      ),
    );
    options.setPersonalityNameDraft(nextName);
    await options.saveActiveCharacterFiles({
      name: nextName,
      prompt: options.personality,
      avatar: options.personalityAvatar,
      voice_path: options.selectedVoicePath,
      soul: options.characterSoul,
    });
  };

  const deleteSelectedPersonalityPreset = () => {
    const selectedRef = parseProfileRefId(options.selectedPersonalityId, "personality");
    if (selectedRef.kind === "user") return;
    if (options.personalityPresets.length <= 1) return;
    const deletedPersonalityId = selectedRef.id;
    const deletedPersonalityName = options.selectedPersonalityPreset?.name || "";
    options.deletePersonalityMemory(deletedPersonalityId, deletedPersonalityName).catch((error) =>
      console.error("Personality memory delete error:", error),
    );
    invoke("delete_personality_chat_session", { personalityId: deletedPersonalityId }).catch((error) =>
      console.error("Personality chat session delete error:", error),
    );
    invoke("delete_character_files", {
      id: deletedPersonalityId,
      name: deletedPersonalityName,
    }).catch((error) => console.error("Character folder delete error:", error));
    options.setPersonalityPresets((prev) => {
      const next = prev.filter((preset) => preset.id !== selectedRef.id);
      const fallback = next[0] ?? DEFAULT_SETTINGS.personality_presets[0];
      options.removeChatSession(deletedPersonalityId);
      options.setSelectedPersonalityId(fallback.id);
      options.setPersonalityNameDraft(fallback.name || "Assistant");
      options.setPersonality(fallback.prompt);
      options.setPersonalityAvatar(fallback.avatar || "");
      options.setSelectedVoicePath(fallback.voice_path || "");
      options.setMessages([]);
      return next.length ? next : DEFAULT_SETTINGS.personality_presets;
    });
  };

  return {
    createUserProfile,
    deleteSelectedPersonalityPreset,
    deleteSelectedUserProfile,
    openPersonalityProfile,
    openUserProfile,
    saveActiveUserProfile,
    saveCurrentPersonalityPreset,
    selectPersonalityPreset,
    selectUserProfile,
    updateActiveUserProfile,
    updateActiveUserVoicePath,
    updateSelectedPersonalityPreset,
  };
}
