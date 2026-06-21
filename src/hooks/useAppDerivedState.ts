import {
  DEFAULT_SETTINGS,
  ModelLibraryEntry,
  PersonalityPreset,
  UserProfilePreset,
  getDefaultLocalContext,
  googleEventMatchesDate,
  parseProfileRefId,
  personalityFromUserProfile,
  userProfileFromPersonality,
} from "../appCore";

type UseAppDerivedStateOptions = {
  availableModels: ModelLibraryEntry[];
  googleCalendarEvents: any[];
  messagesLength: number;
  personalityAvatar: string;
  personalityPresets: PersonalityPreset[];
  selectedAutomationDate: string;
  selectedModel: string | null;
  selectedModelPath: string;
  selectedPersonalityId: string;
  selectedUserProfileId: string;
  systemInfo: any;
  userProfiles: UserProfilePreset[];
};

export function useAppDerivedState(options: UseAppDerivedStateOptions) {
  const currentModelEntry =
    options.availableModels.find((model) => model.path === options.selectedModelPath) ?? null;
  const currentModelName =
    currentModelEntry?.name || options.selectedModel || (options.selectedModelPath ? "Selected brain" : "No model selected");
  const localContext = getDefaultLocalContext();
  const selectedUserRef = parseProfileRefId(options.selectedUserProfileId, "user");
  const userSidePersonality =
    selectedUserRef.kind === "personality"
      ? options.personalityPresets.find((preset) => preset.id === selectedUserRef.id)
      : undefined;
  const selectedUserProfile =
    selectedUserRef.kind === "personality"
      ? userSidePersonality
        ? userProfileFromPersonality(userSidePersonality)
        : undefined
      : options.userProfiles.find((profile) => profile.id === selectedUserRef.id);
  const selectedPersonalityRef = parseProfileRefId(options.selectedPersonalityId, "personality");
  const botSideUser =
    selectedPersonalityRef.kind === "user"
      ? options.userProfiles.find((profile) => profile.id === selectedPersonalityRef.id)
      : undefined;
  const selectedPersonalityPreset =
    selectedPersonalityRef.kind === "user"
      ? botSideUser
        ? personalityFromUserProfile(botSideUser)
        : options.personalityPresets[0]
      : options.personalityPresets.find((preset) => preset.id === selectedPersonalityRef.id) ??
        options.personalityPresets[0];
  const activeUserProfile = selectedUserProfile ?? options.userProfiles[0] ?? DEFAULT_SETTINGS.user_profiles[0];
  const assistantAvatar = selectedPersonalityPreset?.avatar || options.personalityAvatar || "";
  const selectedGoogleEvents = options.googleCalendarEvents.filter((event) =>
    googleEventMatchesDate(event, options.selectedAutomationDate),
  );
  const hardwareGpuLabel = options.systemInfo?.gpu_details.replace(/\s*\(([\d.]+\s*GB)\s+VRAM\)\s*$/, " - $1") ?? "";
  const hardwareRamLabel = options.systemInfo ? `${(options.systemInfo.total_ram_mb / 1024).toFixed(1)} GB` : "Unknown";
  const conversationLogoClass = options.messagesLength === 0
    ? "hidden"
    : "pointer-events-none absolute left-1/2 top-1/2 z-0 w-[min(52vw,360px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.045]";

  return {
    assistantAvatar,
    conversationLogoClass,
    currentModelEntry,
    currentModelName,
    hardwareGpuLabel,
    hardwareRamLabel,
    localContext,
    selectedGoogleEvents,
    selectedPersonalityPreset,
    selectedUserProfile: activeUserProfile,
  };
}
