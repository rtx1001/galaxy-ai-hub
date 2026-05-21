import { useEffect, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  PersonalityPreset,
  TelegramGuest,
  UserProfilePreset,
} from "../appCore";

type UseAppSettingsSaveOptions = {
  automationOpen: boolean;
  calendarOpen: boolean;
  creativity: number;
  googleClientId: string;
  googleClientSecret: string;
  googlePanelOpen: boolean;
  googleRedirectUri: string;
  imageHeight: number;
  imageStudioOpen: boolean;
  imageWidth: number;
  intelligenceQuality: number;
  leftPanelOpen: boolean;
  linkedFolders: string[];
  liveConversation: boolean;
  memorySize: number;
  minP: number;
  modelFolder: string;
  personality: string;
  personalityPresets: PersonalityPreset[];
  repeatLastN: number;
  repeatPenalty: number;
  replyLength: number;
  rightPanelOpen: boolean;
  samplingOpen: boolean;
  samplingTemperature: number;
  selectedModelPath: string;
  selectedPersonalityId: string;
  selectedUserProfileId: string;
  selectedVoicePath: string;
  settingsHydratedAtRef: MutableRefObject<number>;
  settingsLoaded: boolean;
  settingsReadyForSave: boolean;
  setupCompleted: boolean;
  telegramBotToken: string;
  telegramGuests: TelegramGuest[];
  telegramOwnerId: string;
  telegramPanelOpen: boolean;
  themeSwatchId: string;
  thinkingEnabled: boolean;
  toolRunsOpen: boolean;
  topK: number;
  topP: number;
  userAvatar: string;
  userDescription: string;
  userLatitude: number | null;
  userLocationLabel: string;
  userLongitude: number | null;
  userName: string;
  userProfiles: UserProfilePreset[];
  voiceFolder: string;
  workspaceOpen: boolean;
};

export function useAppSettingsSave({
  automationOpen,
  calendarOpen,
  creativity,
  googleClientId,
  googleClientSecret,
  googlePanelOpen,
  googleRedirectUri,
  imageHeight,
  imageStudioOpen,
  imageWidth,
  intelligenceQuality,
  leftPanelOpen,
  linkedFolders,
  liveConversation,
  memorySize,
  minP,
  modelFolder,
  personality,
  personalityPresets,
  repeatLastN,
  repeatPenalty,
  replyLength,
  rightPanelOpen,
  samplingOpen,
  samplingTemperature,
  selectedModelPath,
  selectedPersonalityId,
  selectedUserProfileId,
  selectedVoicePath,
  settingsHydratedAtRef,
  settingsLoaded,
  settingsReadyForSave,
  setupCompleted,
  telegramBotToken,
  telegramGuests,
  telegramOwnerId,
  telegramPanelOpen,
  themeSwatchId,
  thinkingEnabled,
  toolRunsOpen,
  topK,
  topP,
  userAvatar,
  userDescription,
  userLatitude,
  userLocationLabel,
  userLongitude,
  userName,
  userProfiles,
  voiceFolder,
  workspaceOpen,
}: UseAppSettingsSaveOptions) {
  useEffect(() => {
    if (!settingsLoaded || !settingsReadyForSave) {
      return;
    }
    if (Date.now() - settingsHydratedAtRef.current < 1500) {
      const handle = window.setTimeout(() => {
        settingsHydratedAtRef.current = 0;
      }, 1500);
      return () => window.clearTimeout(handle);
    }

    const handle = setTimeout(() => {
      invoke("save_app_settings", {
        settings: {
          live_conversation: liveConversation,
          setup_completed: setupCompleted,
          user_name: userName,
          user_avatar: userAvatar,
          user_description: userDescription,
          user_location_label: userLocationLabel,
          user_latitude: userLatitude,
          user_longitude: userLongitude,
          theme_swatch_id: themeSwatchId,
          telegram_bot_token: telegramBotToken,
          telegram_owner_id: telegramOwnerId,
          telegram_guests: telegramGuests,
          thinking_enabled: thinkingEnabled,
          google_client_id: googleClientId,
          google_client_secret: googleClientSecret,
          google_redirect_uri: googleRedirectUri,
          image_width: imageWidth,
          image_height: imageHeight,
          voice_folder: voiceFolder,
          selected_voice_path: selectedVoicePath,
          creativity,
          sampling_temperature: samplingTemperature,
          top_k: topK,
          top_p: topP,
          min_p: minP,
          repeat_last_n: repeatLastN,
          repeat_penalty: repeatPenalty,
          memory_size: memorySize,
          reply_length: replyLength,
          intelligence_quality: intelligenceQuality,
          personality,
          personality_presets: personalityPresets,
          selected_personality_id: selectedPersonalityId,
          user_profiles: userProfiles,
          selected_user_profile_id: selectedUserProfileId,
          model_folder: modelFolder,
          selected_model_path: selectedModelPath,
          linked_folders: linkedFolders,
          ui_left_panel_open: leftPanelOpen,
          ui_right_panel_open: rightPanelOpen,
          ui_workspace_open: workspaceOpen,
          ui_image_studio_open: imageStudioOpen,
          ui_calendar_open: calendarOpen,
          ui_automation_open: automationOpen,
          ui_telegram_open: telegramPanelOpen,
          ui_google_open: googlePanelOpen,
          ui_tool_activity_open: toolRunsOpen,
          ui_sampling_open: samplingOpen,
        } satisfies AppSettings,
      }).catch((error) => console.error("Settings save error:", error));
    }, 800);

    return () => clearTimeout(handle);
  }, [
    settingsLoaded,
    settingsReadyForSave,
    setupCompleted,
    userName,
    userAvatar,
    userDescription,
    userProfiles,
    selectedUserProfileId,
    userLocationLabel,
    userLatitude,
    userLongitude,
    themeSwatchId,
    liveConversation,
    telegramBotToken,
    telegramOwnerId,
    telegramGuests,
    thinkingEnabled,
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
    imageWidth,
    imageHeight,
    voiceFolder,
    selectedVoicePath,
    creativity,
    samplingTemperature,
    topK,
    topP,
    minP,
    repeatLastN,
    repeatPenalty,
    memorySize,
    replyLength,
    intelligenceQuality,
    personality,
    personalityPresets,
    selectedPersonalityId,
    modelFolder,
    selectedModelPath,
    linkedFolders,
    leftPanelOpen,
    rightPanelOpen,
    workspaceOpen,
    imageStudioOpen,
    calendarOpen,
    automationOpen,
    telegramPanelOpen,
    googlePanelOpen,
    toolRunsOpen,
    samplingOpen,
  ]);
}
