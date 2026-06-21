import type { RefObject } from "react";
import { createPortal } from "react-dom";
import type { PersonalityPreset, UserProfilePreset, VoiceSample } from "../appCore";
import {
  CharacterProfileModal,
  ClearMemoryConfirmModal,
  DeleteProfileConfirmModal,
  UserProfileModal,
} from "./ProfileModals";

export function ProfileModalLayer({
  clearMemoryOpen,
  characterName,
  clearSessionToo,
  memoryPartnerId,
  memoryPartnerName,
  userProfileOpen,
  userName,
  userAvatar,
  userDescription,
  userProfileCount,
  selectedUserProfile,
  selectedUserVoicePath,
  selectedUserVoiceSample,
  deleteUserProfileConfirmOpen,
  personalityProfileOpen,
  selectedPersonalityPreset,
  personalityAvatar,
  personalityNameDraft,
  personality,
  personalityProfileCount,
  memorySize,
  replyLength,
  minContextSize,
  selectedVoicePath,
  selectedVoiceSample,
  deletePersonalityConfirmOpen,
  voiceFolder,
  voiceSamples,
  previewingVoicePath,
  selectedUserVoiceRowRef,
  selectedVoiceRowRef,
  onToggleClearSession,
  onConfirmClearMemory,
  onCancelClearMemory,
  onCloseUserProfile,
  onChooseUserAvatar,
  onUserNameChange,
  onUserDescriptionChange,
  onChooseVoiceFolder,
  onPreviewUserVoice,
  onSelectUserVoice,
  onToggleUserAutoSpeech,
  onRequestDeleteUser,
  onSaveUserProfile,
  onConfirmDeleteUser,
  onCancelDeleteUser,
  onClosePersonalityProfile,
  onChoosePersonalityAvatar,
  onPersonalityNameChange,
  onPersonalityChange,
  onPreviewCharacterVoice,
  onSelectCharacterVoice,
  onMemorySizeChange,
  onReplyLengthChange,
  onRequestDeletePersonality,
  onRequestClearPersonalityMemory,
  onSavePersonality,
  onConfirmDeletePersonality,
  onCancelDeletePersonality,
}: {
  clearMemoryOpen: boolean;
  characterName: string;
  clearSessionToo: boolean;
  memoryPartnerId: string;
  memoryPartnerName: string;
  userProfileOpen: boolean;
  userName: string;
  userAvatar: string;
  userDescription: string;
  userProfileCount: number;
  selectedUserProfile?: UserProfilePreset;
  selectedUserVoicePath: string;
  selectedUserVoiceSample?: VoiceSample | null;
  deleteUserProfileConfirmOpen: boolean;
  personalityProfileOpen: boolean;
  selectedPersonalityPreset?: PersonalityPreset;
  personalityAvatar: string;
  personalityNameDraft: string;
  personality: string;
  personalityProfileCount: number;
  memorySize: number;
  replyLength: number;
  minContextSize: number;
  selectedVoicePath: string;
  selectedVoiceSample?: VoiceSample | null;
  deletePersonalityConfirmOpen: boolean;
  voiceFolder: string;
  voiceSamples: VoiceSample[];
  previewingVoicePath: string | null;
  selectedUserVoiceRowRef: RefObject<HTMLDivElement | null>;
  selectedVoiceRowRef: RefObject<HTMLDivElement | null>;
  onToggleClearSession: (value: boolean) => void;
  onConfirmClearMemory: () => void;
  onCancelClearMemory: () => void;
  onCloseUserProfile: () => void;
  onChooseUserAvatar: () => void;
  onUserNameChange: (value: string) => void;
  onUserDescriptionChange: (value: string) => void;
  onChooseVoiceFolder: () => void;
  onPreviewUserVoice: (sample: VoiceSample) => void;
  onSelectUserVoice: (path: string) => void;
  onToggleUserAutoSpeech: () => void;
  onRequestDeleteUser: () => void;
  onSaveUserProfile: () => void;
  onConfirmDeleteUser: () => void;
  onCancelDeleteUser: () => void;
  onClosePersonalityProfile: () => void;
  onChoosePersonalityAvatar: () => void;
  onPersonalityNameChange: (value: string) => void;
  onPersonalityChange: (value: string) => void;
  onPreviewCharacterVoice: (sample: VoiceSample) => void;
  onSelectCharacterVoice: (path: string) => void;
  onMemorySizeChange: (value: number) => void;
  onReplyLengthChange: (value: number) => void;
  onRequestDeletePersonality: () => void;
  onRequestClearPersonalityMemory: () => void;
  onSavePersonality: () => void;
  onConfirmDeletePersonality: () => void;
  onCancelDeletePersonality: () => void;
}) {
  const layer = (
    <>
      <ClearMemoryConfirmModal
        open={clearMemoryOpen}
        characterName={characterName}
        clearSessionToo={clearSessionToo}
        onToggleClearSession={onToggleClearSession}
        onConfirm={onConfirmClearMemory}
        onCancel={onCancelClearMemory}
      />
      <UserProfileModal
        open={userProfileOpen}
        userName={userName}
        userAvatar={userAvatar}
        userDescription={userDescription}
        profileCount={userProfileCount}
        selectedProfile={selectedUserProfile}
        selectedVoicePath={selectedUserVoicePath}
        selectedVoiceSample={selectedUserVoiceSample}
        voiceFolder={voiceFolder}
        voiceSamples={voiceSamples}
        previewingVoicePath={previewingVoicePath}
        selectedVoiceRowRef={selectedUserVoiceRowRef}
        onClose={onCloseUserProfile}
        onChooseAvatar={onChooseUserAvatar}
        onUserNameChange={onUserNameChange}
        onUserDescriptionChange={onUserDescriptionChange}
        onChooseVoiceFolder={onChooseVoiceFolder}
        onPreviewVoice={onPreviewUserVoice}
        onSelectVoice={onSelectUserVoice}
        onToggleAutoSpeech={onToggleUserAutoSpeech}
        onRequestDelete={onRequestDeleteUser}
        onSave={onSaveUserProfile}
      />
      <DeleteProfileConfirmModal
        open={deleteUserProfileConfirmOpen}
        title="Delete User Profile"
        name={userName.trim() || "This profile"}
        body="This will delete this saved user profile. Chat history and assistant profiles stay untouched."
        disabled={userProfileCount <= 1}
        onConfirm={onConfirmDeleteUser}
        onCancel={onCancelDeleteUser}
      />
      <CharacterProfileModal
        open={personalityProfileOpen}
        preset={selectedPersonalityPreset}
        fallbackAvatar={personalityAvatar}
        nameDraft={personalityNameDraft}
        personality={personality}
        memoryPartnerId={memoryPartnerId}
        memoryPartnerName={memoryPartnerName}
        profileCount={personalityProfileCount}
        memorySize={memorySize}
        replyLength={replyLength}
        minContextSize={minContextSize}
        selectedVoicePath={selectedVoicePath}
        selectedVoiceSample={selectedVoiceSample}
        voiceFolder={voiceFolder}
        voiceSamples={voiceSamples}
        previewingVoicePath={previewingVoicePath}
        selectedVoiceRowRef={selectedVoiceRowRef}
        onClose={onClosePersonalityProfile}
        onChooseAvatar={onChoosePersonalityAvatar}
        onNameChange={onPersonalityNameChange}
        onPersonalityChange={onPersonalityChange}
        onChooseVoiceFolder={onChooseVoiceFolder}
        onPreviewVoice={onPreviewCharacterVoice}
        onSelectVoice={onSelectCharacterVoice}
        onMemorySizeChange={onMemorySizeChange}
        onReplyLengthChange={onReplyLengthChange}
        onRequestDelete={onRequestDeletePersonality}
        onRequestClearMemory={onRequestClearPersonalityMemory}
        onSave={onSavePersonality}
      />
      <DeleteProfileConfirmModal
        open={deletePersonalityConfirmOpen}
        title="Delete Character"
        name={characterName}
        body="This will delete this character profile, its learned memory, and its saved chat history."
        disabled={personalityProfileCount <= 1}
        onConfirm={onConfirmDeletePersonality}
        onCancel={onCancelDeletePersonality}
      />
    </>
  );

  if (typeof document === "undefined") {
    return layer;
  }
  return createPortal(layer, document.body);
}
