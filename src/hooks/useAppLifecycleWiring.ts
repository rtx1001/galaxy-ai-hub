import { MutableRefObject, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAutoSpeechQueue } from "./useAutoSpeechQueue";
import { useStoredImageHydration } from "./useStoredImageHydration";
import { useAppSettingsSave } from "./useAppSettingsSave";
import { useAppBackgroundRefresh } from "./useAppBackgroundRefresh";
import { useAppSettingsLoad } from "./useAppSettingsLoad";
import { useDropdownDismiss } from "./useDropdownDismiss";
import { useMissingTooltips } from "./useMissingTooltips";
import { useTrayControls } from "./useTrayControls";
import { NEW_MESSAGE_BOTTOM_ROOM } from "./useConversationScroll";

type UseAppLifecycleWiringOptions = Record<string, any> & {
  autoSpeechEligibleAssistantIdsRef: MutableRefObject<Set<string>>;
  liveConversationRef: MutableRefObject<boolean>;
  telegramAutoStartAttemptedRef: MutableRefObject<boolean>;
};

export function useAppLifecycleWiring(options: UseAppLifecycleWiringOptions) {
  const lastAutoScrollKeyRef = useRef("");

  useAppSettingsLoad({
    compressAvatarDataUrl: options.compressAvatarDataUrl,
    setAutomationOpen: options.setAutomationOpen,
    setCalendarOpen: options.setCalendarOpen,
    setCreativity: options.setCreativity,
    setGoogleClientId: options.setGoogleClientId,
    setGoogleClientSecret: options.setGoogleClientSecret,
    setGooglePanelOpen: options.setGooglePanelOpen,
    setGoogleRedirectUri: options.setGoogleRedirectUri,
    setImageHeight: options.setImageHeight,
    setImageStudioOpen: options.setImageStudioOpen,
    setImageWidth: options.setImageWidth,
    setIntelligenceQuality: options.setIntelligenceQuality,
    setLeftPanelOpen: options.setLeftPanelOpen,
    setLinkedFolders: options.setLinkedFolders,
    setLiveConversation: options.setLiveConversation,
    setMemorySize: options.setMemorySize,
    setMinP: options.setMinP,
    setModelFolder: options.setModelFolder,
    setPersonality: options.setPersonality,
    setPersonalityAvatar: options.setPersonalityAvatar,
    setPersonalityNameDraft: options.setPersonalityNameDraft,
    setPersonalityPresets: options.setPersonalityPresets,
    setRepeatLastN: options.setRepeatLastN,
    setRepeatPenalty: options.setRepeatPenalty,
    setReplyLength: options.setReplyLength,
    setRightPanelOpen: options.setRightPanelOpen,
    setSamplingOpen: options.setSamplingOpen,
    setSamplingTemperature: options.setSamplingTemperature,
    setSelectedModelPath: options.setSelectedModelPath,
    setSelectedPersonalityId: options.setSelectedPersonalityId,
    setSelectedUserProfileId: options.setSelectedUserProfileId,
    setSelectedVoicePath: options.setSelectedVoicePath,
    setSettingsLoadError: options.setSettingsLoadError,
    setSettingsLoaded: options.setSettingsLoaded,
    setSettingsReadyForSave: options.setSettingsReadyForSave,
    setSetupCompleted: options.setSetupCompleted,
    setTelegramBotToken: options.setTelegramBotToken,
    setTelegramGuests: options.setTelegramGuests,
    setTelegramOwnerId: options.setTelegramOwnerId,
    setTelegramPanelOpen: options.setTelegramPanelOpen,
    setThemeSwatchId: options.setThemeSwatchId,
    setThinkingEnabled: options.setThinkingEnabled,
    setToolRunsOpen: options.setToolRunsOpen,
    setTopK: options.setTopK,
    setTopP: options.setTopP,
    setUserAvatar: options.setUserAvatar,
    setUserDescription: options.setUserDescription,
    setUserLatitude: options.setUserLatitude,
    setUserLocationLabel: options.setUserLocationLabel,
    setUserLongitude: options.setUserLongitude,
    setUserName: options.setUserName,
    setUserProfiles: options.setUserProfiles,
    setVoiceFolder: options.setVoiceFolder,
    setWorkspaceOpen: options.setWorkspaceOpen,
    settingsHydratedAtRef: options.settingsHydratedAtRef,
    themeSwatches: options.themeSwatches,
    minChatContextSize: options.minChatContextSize,
  });

  useEffect(() => {
    options.liveConversationRef.current = options.liveConversation;
    if (!options.liveConversation) {
      options.autoSpeechEligibleAssistantIdsRef.current.clear();
      invoke("stop_omnivoice_engine").catch(() => undefined);
    }
  }, [options.liveConversation]);

  useEffect(() => {
    if (!options.settingsLoaded || options.telegramAutoStartAttemptedRef.current) return;
    options.telegramAutoStartAttemptedRef.current = true;
    if (!options.telegramBotToken.trim()) return;
    options.handleStartTelegram().catch((error: unknown) => console.error("Telegram auto-start error:", error));
  }, [options.settingsLoaded, options.telegramBotToken]);

  useTrayControls({
    settingsLoaded: options.settingsLoaded,
    telegramRunning: options.telegramRunning,
    autoVoice: options.liveConversation,
    onToggleTelegram: () => (options.telegramRunning ? options.handleStopTelegram() : options.handleStartTelegram()),
    onToggleAutoVoice: () => options.setAutoVoiceMode(!options.liveConversation),
  });

  useEffect(() => {
    if (!options.settingsLoaded || !options.selectedUserProfileId) return;
    options.updateActiveUserProfile({
      name: options.userName,
      avatar: options.userAvatar,
      description: options.userDescription,
      location_label: options.userLocationLabel,
      latitude: options.userLatitude,
      longitude: options.userLongitude,
      auto_speech: options.selectedUserProfile?.auto_speech ?? true,
    });
  }, [
    options.settingsLoaded,
    options.selectedUserProfileId,
    options.userName,
    options.userAvatar,
    options.userDescription,
    options.userLocationLabel,
    options.userLatitude,
    options.userLongitude,
    options.selectedUserProfile?.auto_speech,
  ]);

  useMissingTooltips();

  useAppSettingsSave({
    automationOpen: options.automationOpen,
    calendarOpen: options.calendarOpen,
    creativity: options.creativity,
    googleClientId: options.googleClientId,
    googleClientSecret: options.googleClientSecret,
    googlePanelOpen: options.googlePanelOpen,
    googleRedirectUri: options.googleRedirectUri,
    imageHeight: options.imageHeight,
    imageStudioOpen: options.imageStudioOpen,
    imageWidth: options.imageWidth,
    intelligenceQuality: options.intelligenceQuality,
    leftPanelOpen: options.leftPanelOpen,
    linkedFolders: options.linkedFolders,
    liveConversation: options.liveConversation,
    memorySize: options.memorySize,
    minP: options.minP,
    modelFolder: options.modelFolder,
    personality: options.personality,
    personalityPresets: options.personalityPresets,
    repeatLastN: options.repeatLastN,
    repeatPenalty: options.repeatPenalty,
    replyLength: options.replyLength,
    rightPanelOpen: options.rightPanelOpen,
    samplingOpen: options.samplingOpen,
    samplingTemperature: options.samplingTemperature,
    selectedModelPath: options.selectedModelPath,
    selectedPersonalityId: options.selectedPersonalityId,
    selectedUserProfileId: options.selectedUserProfileId,
    selectedVoicePath: options.selectedVoicePath,
    settingsHydratedAtRef: options.settingsHydratedAtRef,
    settingsLoaded: options.settingsLoaded,
    settingsReadyForSave: options.settingsReadyForSave,
    setupCompleted: options.setupCompleted,
    telegramBotToken: options.telegramBotToken,
    telegramGuests: options.telegramGuests,
    telegramOwnerId: options.telegramOwnerId,
    telegramPanelOpen: options.telegramPanelOpen,
    themeSwatchId: options.themeSwatchId,
    thinkingEnabled: options.thinkingEnabled,
    toolRunsOpen: options.toolRunsOpen,
    topK: options.topK,
    topP: options.topP,
    userName: options.userName,
    userAvatar: options.userAvatar,
    userDescription: options.userDescription,
    userLatitude: options.userLatitude,
    userLocationLabel: options.userLocationLabel,
    userLongitude: options.userLongitude,
    userProfiles: options.userProfiles,
    voiceFolder: options.voiceFolder,
    workspaceOpen: options.workspaceOpen,
  });

  useStoredImageHydration({
    settingsLoaded: options.settingsLoaded,
    messages: options.messages,
    setMessages: options.setMessages,
  });

  useAppBackgroundRefresh({
    automationMonth: options.automationMonth,
    googleClientId: options.googleClientId,
    googleClientSecret: options.googleClientSecret,
    googleConnected: options.googleStatus.connected,
    linkedFolders: options.linkedFolders,
    refreshAutomationJobs: options.refreshAutomationJobs,
    refreshGoogleCalendarEvents: options.refreshGoogleCalendarEvents,
    refreshGoogleStatus: options.refreshGoogleStatus,
    refreshPendingShellActions: options.refreshPendingShellActions,
    refreshToolRuns: options.refreshToolRuns,
    selectedVoicePath: options.selectedVoicePath,
    settingsLoaded: options.settingsLoaded,
    settingsReadyForSave: options.settingsReadyForSave,
    updateActiveCharacterVoicePath: options.updateActiveCharacterVoicePath,
    voiceSamples: options.voiceSamples,
  });

  useEffect(() => {
    const lastMessage = options.messages[options.messages.length - 1];
    const lastMessageHasVisibleContent =
      typeof lastMessage?.content === "string"
        ? lastMessage.content.trim().length > 0
        : Array.isArray(lastMessage?.content) && lastMessage.content.length > 0;
    if (lastMessage?.role === "assistant" && !lastMessageHasVisibleContent) {
      return;
    }
    const contentSize =
      typeof lastMessage?.content === "string"
        ? lastMessage.content.length
        : Array.isArray(lastMessage?.content)
          ? JSON.stringify(lastMessage.content).length
          : 0;
    const scrollKey = `${options.messages.length}:${lastMessage?.id ?? ""}:${contentSize}`;
    if (scrollKey === lastAutoScrollKeyRef.current) {
      return;
    }
    lastAutoScrollKeyRef.current = scrollKey;
    options.lastMessageCountRef.current = options.messages.length;
    window.requestAnimationFrame(() => {
      const container = options.conversationScrollRef.current;
      if (!container) return;

      container.scrollTo({ top: Math.max(0, container.scrollHeight - NEW_MESSAGE_BOTTOM_ROOM), behavior: "smooth" });
    });
  }, [options.messages]);

  useAutoSpeechQueue({
    settingsLoaded: options.settingsLoaded,
    messages: options.messages,
    liveConversation: options.liveConversation,
    isStreaming: options.isStreaming,
    isGeneratingImage: options.isGeneratingImage,
    isTranscribing: options.isTranscribing,
    speakingMessageId: options.speakingMessageId,
    selectedVoicePath: options.selectedVoicePath,
    autoSpeechEligibleAssistantIdsRef: options.autoSpeechEligibleAssistantIdsRef,
    lastAutoSpokenAssistantIdRef: options.lastAutoSpokenAssistantIdRef,
    voicePlaybackRequestRef: options.voicePlaybackRequestRef,
    ensureAudioPlaybackUnlocked: options.ensureAudioPlaybackUnlocked,
    playAutoSpeechQueue: options.playAutoSpeechQueue,
  });

  useDropdownDismiss(() => {
    options.setModelMenuOpen(false);
    options.setQuickModelMenuOpen(false);
    options.setThemePickerOpen(false);
    options.setUserProfileMenuOpen(false);
    options.setPersonalityMenuOpen(false);
    options.setAutomationTimeMenuOpen(false);
    options.setAutomationDateMenuOpen(false);
    options.setAutomationMonthMenuOpen(false);
    options.setAutomationEveryUnitMenuOpen(false);
  });

  useEffect(() => {
    if (!options.settingsLoaded || !options.modelFolder) {
      return;
    }

    options.scanModelLibrary(options.modelFolder, options.selectedModelPath, true).catch((error: unknown) =>
      console.error("Initial model scan error:", error),
    );
  }, [options.settingsLoaded, options.modelFolder]);

  useEffect(() => {
    if (options.engineStatus !== "ready" || !options.pendingAutoLoadPath) {
      return;
    }

    options.loadModelPath(options.pendingAutoLoadPath).catch((error: unknown) =>
      console.error("Deferred model load error:", error),
    );
  }, [options.engineStatus, options.pendingAutoLoadPath]);
}
