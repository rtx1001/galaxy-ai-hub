import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AppSettings,
  DEFAULT_SETTINGS,
  PersonalityPreset,
  TelegramGuest,
  ThemeSwatch,
  UserProfilePreset,
  parseProfileRefId,
  personalityFromUserProfile,
  userProfileFromPersonality,
} from "../appCore";
import { clampNumber } from "../utils";

type UseAppSettingsLoadOptions = {
  compressAvatarDataUrl: (dataUrl: string) => Promise<string>;
  setAutomationOpen: Dispatch<SetStateAction<boolean>>;
  setCalendarOpen: Dispatch<SetStateAction<boolean>>;
  setCreativity: Dispatch<SetStateAction<number>>;
  setGoogleClientId: Dispatch<SetStateAction<string>>;
  setGoogleClientSecret: Dispatch<SetStateAction<string>>;
  setGooglePanelOpen: Dispatch<SetStateAction<boolean>>;
  setGoogleRedirectUri: Dispatch<SetStateAction<string>>;
  setMediaPlayerPanelOpen: Dispatch<SetStateAction<boolean>>;
  setImageHeight: Dispatch<SetStateAction<number>>;
  setImageStudioOpen: Dispatch<SetStateAction<boolean>>;
  setImageWidth: Dispatch<SetStateAction<number>>;
  setIntelligenceQuality: Dispatch<SetStateAction<number>>;
  setLeftPanelOpen: Dispatch<SetStateAction<boolean>>;
  setLinkedFolders: Dispatch<SetStateAction<string[]>>;
  setLiveConversation: Dispatch<SetStateAction<boolean>>;
  setUserAutoPilot: Dispatch<SetStateAction<boolean>>;
  setMemorySize: Dispatch<SetStateAction<number>>;
  setMinP: Dispatch<SetStateAction<number>>;
  setModelFolder: Dispatch<SetStateAction<string>>;
  setPersonality: Dispatch<SetStateAction<string>>;
  setPersonalityAvatar: Dispatch<SetStateAction<string>>;
  setPersonalityNameDraft: Dispatch<SetStateAction<string>>;
  setPersonalityPresets: Dispatch<SetStateAction<PersonalityPreset[]>>;
  setRepeatLastN: Dispatch<SetStateAction<number>>;
  setRepeatPenalty: Dispatch<SetStateAction<number>>;
  setReplyLength: Dispatch<SetStateAction<number>>;
  setRightPanelOpen: Dispatch<SetStateAction<boolean>>;
  setSamplingOpen: Dispatch<SetStateAction<boolean>>;
  setSamplingTemperature: Dispatch<SetStateAction<number>>;
  setSelectedModelPath: Dispatch<SetStateAction<string>>;
  setSelectedPersonalityId: Dispatch<SetStateAction<string>>;
  setSelectedUserProfileId: Dispatch<SetStateAction<string>>;
  setSelectedVoicePath: Dispatch<SetStateAction<string>>;
  setSettingsLoadError: Dispatch<SetStateAction<string | null>>;
  setSettingsLoaded: Dispatch<SetStateAction<boolean>>;
  setSettingsReadyForSave: Dispatch<SetStateAction<boolean>>;
  setSetupCompleted: Dispatch<SetStateAction<boolean>>;
  setTelegramBotToken: Dispatch<SetStateAction<string>>;
  setTelegramGuests: Dispatch<SetStateAction<TelegramGuest[]>>;
  setTelegramOwnerId: Dispatch<SetStateAction<string>>;
  setTelegramPanelOpen: Dispatch<SetStateAction<boolean>>;
  setThemeSwatchId: Dispatch<SetStateAction<string>>;
  setThinkingEnabled: Dispatch<SetStateAction<boolean>>;
  setToolRunsOpen: Dispatch<SetStateAction<boolean>>;
  setTopK: Dispatch<SetStateAction<number>>;
  setTopP: Dispatch<SetStateAction<number>>;
  setUserAvatar: Dispatch<SetStateAction<string>>;
  setUserDescription: Dispatch<SetStateAction<string>>;
  setUserLatitude: Dispatch<SetStateAction<number | null>>;
  setUserLocationLabel: Dispatch<SetStateAction<string>>;
  setUserLongitude: Dispatch<SetStateAction<number | null>>;
  setUserName: Dispatch<SetStateAction<string>>;
  setUserProfiles: Dispatch<SetStateAction<UserProfilePreset[]>>;
  setVoiceFolder: Dispatch<SetStateAction<string>>;
  setWorkspaceOpen: Dispatch<SetStateAction<boolean>>;
  settingsHydratedAtRef: MutableRefObject<number>;
  themeSwatches: ThemeSwatch[];
  minChatContextSize: number;
};

export function useAppSettingsLoad({
  compressAvatarDataUrl,
  setAutomationOpen,
  setCalendarOpen,
  setCreativity,
  setGoogleClientId,
  setGoogleClientSecret,
  setGooglePanelOpen,
  setGoogleRedirectUri,
  setMediaPlayerPanelOpen,
  setImageHeight,
  setImageStudioOpen,
  setImageWidth,
  setIntelligenceQuality,
  setLeftPanelOpen,
  setLinkedFolders,
  setLiveConversation,
  setUserAutoPilot,
  setMemorySize,
  setMinP,
  setModelFolder,
  setPersonality,
  setPersonalityAvatar,
  setPersonalityNameDraft,
  setPersonalityPresets,
  setRepeatLastN,
  setRepeatPenalty,
  setReplyLength,
  setRightPanelOpen,
  setSamplingOpen,
  setSamplingTemperature,
  setSelectedModelPath,
  setSelectedPersonalityId,
  setSelectedUserProfileId,
  setSelectedVoicePath,
  setSettingsLoadError,
  setSettingsLoaded,
  setSettingsReadyForSave,
  setSetupCompleted,
  setTelegramBotToken,
  setTelegramGuests,
  setTelegramOwnerId,
  setTelegramPanelOpen,
  setThemeSwatchId,
  setThinkingEnabled,
  setToolRunsOpen,
  setTopK,
  setTopP,
  setUserAvatar,
  setUserDescription,
  setUserLatitude,
  setUserLocationLabel,
  setUserLongitude,
  setUserName,
  setUserProfiles,
  setVoiceFolder,
  setWorkspaceOpen,
  settingsHydratedAtRef,
  themeSwatches,
  minChatContextSize,
}: UseAppSettingsLoadOptions) {
  useEffect(() => {
    let active = true;

    const loadSettings = async () => {
      try {
        const [stored, defaultVoiceFolder] = await Promise.all([
          invoke<AppSettings>("load_app_settings"),
          invoke<string>("default_voice_samples_folder").catch(() => ""),
        ]);
        if (!active) return;

        const nextUserAvatar = await compressAvatarDataUrl(stored.user_avatar || "");
        setSetupCompleted(Boolean(stored.setup_completed));
        const sourceUserProfiles = stored.user_profiles?.length
          ? stored.user_profiles
          : [{
              id: stored.selected_user_profile_id || "default_user",
              name: stored.user_name || DEFAULT_SETTINGS.user_name,
              description: stored.user_description || "",
              avatar: stored.user_avatar || "",
              voice_path: "",
              location_label: stored.user_location_label || "",
              latitude: typeof stored.user_latitude === "number" ? stored.user_latitude : null,
              longitude: typeof stored.user_longitude === "number" ? stored.user_longitude : null,
            }];
        const normalizedUserProfiles = await Promise.all(
          sourceUserProfiles.map(async (profile) => ({
            ...profile,
            avatar: await compressAvatarDataUrl(profile.avatar || ""),
            description: profile.description || "",
            voice_path: profile.voice_path || "",
            location_label: profile.location_label || "",
            latitude: typeof profile.latitude === "number" && Number.isFinite(profile.latitude) ? profile.latitude : null,
            longitude: typeof profile.longitude === "number" && Number.isFinite(profile.longitude) ? profile.longitude : null,
            auto_speech: profile.auto_speech ?? true,
          })),
        );
        const sourcePresets = stored.personality_presets?.length
          ? stored.personality_presets
          : DEFAULT_SETTINGS.personality_presets;
        const normalizedPresets = await Promise.all(
          sourcePresets.map(async (preset) => ({
            ...preset,
            avatar: await compressAvatarDataUrl(preset.avatar || ""),
          })),
        );
        if (!active) return;

        const nextUserProfileId = stored.selected_user_profile_id || normalizedUserProfiles[0]?.id || DEFAULT_SETTINGS.selected_user_profile_id;
        const nextUserRef = parseProfileRefId(nextUserProfileId, "user");
        const activeUserProfile =
          nextUserRef.kind === "personality"
            ? normalizedPresets.find((preset) => preset.id === nextUserRef.id)
              ? userProfileFromPersonality(normalizedPresets.find((preset) => preset.id === nextUserRef.id)!)
              : normalizedUserProfiles[0] ?? DEFAULT_SETTINGS.user_profiles[0]
            : normalizedUserProfiles.find((profile) => profile.id === nextUserRef.id) ??
              normalizedUserProfiles[0] ??
              DEFAULT_SETTINGS.user_profiles[0];
        setUserProfiles(normalizedUserProfiles);
        setSelectedUserProfileId(nextUserProfileId);
        setUserName(activeUserProfile.name || DEFAULT_SETTINGS.user_name);
        setUserAvatar(activeUserProfile.avatar || nextUserAvatar);
        setUserDescription(activeUserProfile.description || "");
        setUserLocationLabel(activeUserProfile.location_label || "");
        setUserLatitude(typeof activeUserProfile.latitude === "number" && Number.isFinite(activeUserProfile.latitude) ? activeUserProfile.latitude : null);
        setUserLongitude(typeof activeUserProfile.longitude === "number" && Number.isFinite(activeUserProfile.longitude) ? activeUserProfile.longitude : null);
        setThemeSwatchId(
          themeSwatches.some((swatch) => swatch.id === stored.theme_swatch_id)
            ? stored.theme_swatch_id
            : DEFAULT_SETTINGS.theme_swatch_id,
        );
        setLiveConversation(stored.live_conversation);
        setUserAutoPilot(Boolean(stored.user_auto_pilot));
        setTelegramBotToken(stored.telegram_bot_token || "");
        setTelegramOwnerId(stored.telegram_owner_id || "");
        setTelegramGuests(Array.isArray(stored.telegram_guests) ? stored.telegram_guests : []);
        setThinkingEnabled(Boolean(stored.thinking_enabled));
        setGoogleClientId(stored.google_client_id || "");
        setGoogleClientSecret(stored.google_client_secret || "");
        setGoogleRedirectUri(stored.google_redirect_uri || DEFAULT_SETTINGS.google_redirect_uri);
        setImageWidth(clampNumber(stored.image_width ?? DEFAULT_SETTINGS.image_width, 256, 2048));
        setImageHeight(clampNumber(stored.image_height ?? DEFAULT_SETTINGS.image_height, 256, 2048));
        setVoiceFolder(stored.voice_folder || defaultVoiceFolder || "");
        setSelectedVoicePath(stored.selected_voice_path || "");
        setCreativity(clampNumber(stored.creativity, 0, 100));
        setSamplingTemperature(clampNumber(stored.sampling_temperature ?? DEFAULT_SETTINGS.sampling_temperature, 0, 2));
        setTopK(clampNumber(stored.top_k ?? DEFAULT_SETTINGS.top_k, 0, 200));
        setTopP(clampNumber(stored.top_p ?? DEFAULT_SETTINGS.top_p, 0, 1));
        setMinP(clampNumber(stored.min_p ?? DEFAULT_SETTINGS.min_p, 0, 1));
        setRepeatLastN(clampNumber(stored.repeat_last_n ?? DEFAULT_SETTINGS.repeat_last_n, -1, 4096));
        setRepeatPenalty(clampNumber(stored.repeat_penalty ?? DEFAULT_SETTINGS.repeat_penalty, 0.8, 2));
        setMemorySize(clampNumber(stored.memory_size, minChatContextSize, 32768));
        setReplyLength(clampNumber(stored.reply_length, 64, 4096));
        setIntelligenceQuality(clampNumber(stored.intelligence_quality, 0, 100));
        setPersonality(stored.personality || DEFAULT_SETTINGS.personality);
        setPersonalityPresets(normalizedPresets);
        const nextPersonalityId = stored.selected_personality_id || DEFAULT_SETTINGS.selected_personality_id;
        const nextPersonalityRef = parseProfileRefId(nextPersonalityId, "personality");
        const activePersonalityPreset =
          nextPersonalityRef.kind === "user"
            ? normalizedUserProfiles.find((profile) => profile.id === nextPersonalityRef.id)
              ? personalityFromUserProfile(normalizedUserProfiles.find((profile) => profile.id === nextPersonalityRef.id)!)
              : normalizedPresets[0]
            : normalizedPresets.find((preset) => preset.id === nextPersonalityRef.id) ?? normalizedPresets[0];
        setSelectedPersonalityId(nextPersonalityId);
        setPersonalityNameDraft(activePersonalityPreset?.name || "Assistant");
        setPersonalityAvatar(
          activePersonalityPreset?.avatar || "",
        );
        setModelFolder(stored.model_folder || "");
        setLinkedFolders(stored.linked_folders || []);
        setSelectedModelPath(stored.selected_model_path || "");
        setLeftPanelOpen(stored.ui_left_panel_open ?? DEFAULT_SETTINGS.ui_left_panel_open);
        setRightPanelOpen(stored.ui_right_panel_open ?? DEFAULT_SETTINGS.ui_right_panel_open);
        setWorkspaceOpen(stored.ui_workspace_open ?? DEFAULT_SETTINGS.ui_workspace_open);
        setImageStudioOpen(stored.ui_image_studio_open ?? DEFAULT_SETTINGS.ui_image_studio_open);
        setCalendarOpen(stored.ui_calendar_open ?? stored.ui_automation_open ?? DEFAULT_SETTINGS.ui_calendar_open);
        setAutomationOpen(stored.ui_automation_open ?? DEFAULT_SETTINGS.ui_automation_open);
        setTelegramPanelOpen(stored.ui_telegram_open ?? DEFAULT_SETTINGS.ui_telegram_open);
        setGooglePanelOpen(stored.ui_google_open ?? DEFAULT_SETTINGS.ui_google_open);
        setMediaPlayerPanelOpen(stored.ui_media_player_open ?? DEFAULT_SETTINGS.ui_media_player_open);
        setToolRunsOpen(stored.ui_tool_activity_open ?? DEFAULT_SETTINGS.ui_tool_activity_open);
        setSamplingOpen(stored.ui_sampling_open ?? DEFAULT_SETTINGS.ui_sampling_open);
        invoke("migrate_character_folders").catch((error) =>
          console.error("Character folder migration error:", error),
        );
        setSettingsLoadError(null);
        settingsHydratedAtRef.current = Date.now();
        setSettingsReadyForSave(true);
        setSettingsLoaded(true);
      } catch (error) {
        console.error("Settings load error:", error);
        setSettingsLoadError(error instanceof Error ? error.message : String(error));
        setSettingsReadyForSave(false);
        setSettingsLoaded(true);
      }
    };

    loadSettings();

    return () => {
      active = false;
    };
  }, []);
}
