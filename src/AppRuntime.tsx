import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatMessage, ModelLoadStatus } from "./types";
import { AppShell } from "./components/AppShell";
import { CURRENT_APP_VERSION, useAvailableUpdate } from "./hooks/useAvailableUpdate";
import { useDateTimeLine } from "./hooks/useDateTimeLine";
import { useTelegramGuests } from "./hooks/useTelegramGuests";
import { useToolRuns } from "./hooks/useToolRuns";
import { useVoiceSamples } from "./hooks/useVoiceSamples";
import { useAudioPlayback } from "./hooks/useAudioPlayback";
import { useImageAttachments } from "./hooks/useImageAttachments";
import { useAutomations } from "./hooks/useAutomations";
import { useGoogleCalendar } from "./hooks/useGoogleCalendar";
import { useSetupFlow } from "./hooks/useSetupFlow";
import { useSamplingSettings } from "./hooks/useSamplingSettings";
import { usePanelState } from "./hooks/usePanelState";
import { useWorkspaceFolders } from "./hooks/useWorkspaceFolders";
import { useImageStudioSettings } from "./hooks/useImageStudioSettings";
import { useCompactLayout } from "./hooks/useCompactLayout";
import { useShellActions } from "./hooks/useShellActions";
import { useConversationScroll } from "./hooks/useConversationScroll";
import { useRuntimeStatusDisplay } from "./hooks/useRuntimeStatusDisplay";
import { useComposerText } from "./hooks/useComposerText";
import { useThemeSelection } from "./hooks/useThemeSelection";
import { useVoiceHelpers } from "./hooks/useVoiceHelpers";
import { useVoiceInput } from "./hooks/useVoiceInput";
import { useEngineBootstrap } from "./hooks/useEngineBootstrap";
import { useChatMessageMutations } from "./hooks/useChatMessageMutations";
import { useModelLibraryActions } from "./hooks/useModelLibraryActions";
import { useAutomationRunner } from "./hooks/useAutomationRunner";
import { useVoicePlaybackManager } from "./hooks/useVoicePlaybackManager";
import { usePersonalityMemory } from "./hooks/usePersonalityMemory";
import { useChatSessions } from "./hooks/useChatSessions";
import { useCharacterFiles } from "./hooks/useCharacterFiles";
import { useProfileActions } from "./hooks/useProfileActions";
import { useActionProposals } from "./hooks/useActionProposals";
import { useImageGeneration } from "./hooks/useImageGeneration";
import { useTelegramControls } from "./hooks/useTelegramControls";
import { useVoiceFolderActions } from "./hooks/useVoiceFolderActions";
import { useSetupInstallActions } from "./hooks/useSetupInstallActions";
import { useQuickImageGenerate } from "./hooks/useQuickImageGenerate";
import { useRuntimePromptBuilders } from "./hooks/useRuntimePromptBuilders";
import { useChatStop } from "./hooks/useChatStop";
import { useModelRuntime } from "./hooks/useModelRuntime";
import { useImageCompletionReply } from "./hooks/useImageCompletionReply";
import { useChatRuntime } from "./hooks/useChatRuntime";
import { useAppPanelContents } from "./hooks/useAppPanelContents";
import { useAppLifecycleWiring } from "./hooks/useAppLifecycleWiring";
import { useAppDerivedState } from "./hooks/useAppDerivedState";
import { useSetupRuntimeEffects } from "./hooks/useSetupRuntimeEffects";
import {
  DEFAULT_SETTINGS,
  DisplayLanguage,
  ModelLibraryEntry,
  PersonalityPreset,
  UserProfilePreset,
  detectDisplayLanguage,
  extractChoiceText,
  extractMessageText,
  extractTextValue,
} from "./appCore";

const MIN_CHAT_CONTEXT_SIZE = 8192;

function App() {
  const [brainStatus, setBrainStatus] = useState<"Idle" | "Loading" | "Ready" | "Thinking" | "Error">("Idle");
  const [modelLoadStatus, setModelLoadStatus] = useState<ModelLoadStatus>({
    state: "idle",
    message: "",
    progress: 0,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatDisplayLanguage: DisplayLanguage = (() => {
    const latestUserText = [...messages]
      .reverse()
      .find((message) => message.role === "user" && extractMessageText(message.content).trim());
    return detectDisplayLanguage(extractMessageText(latestUserText?.content ?? ""));
  })();
  const {
    input,
    composerHasText,
    composerInputRef,
    lastComposerInputAtRef,
    setComposerText,
    handleComposerInput,
  } = useComposerText();
  const [userName, setUserName] = useState(DEFAULT_SETTINGS.user_name);
  const [userAvatar, setUserAvatar] = useState(DEFAULT_SETTINGS.user_avatar);
  const [userDescription, setUserDescription] = useState(DEFAULT_SETTINGS.user_description);
  const [userProfiles, setUserProfiles] = useState<UserProfilePreset[]>(DEFAULT_SETTINGS.user_profiles);
  const [selectedUserProfileId, setSelectedUserProfileId] = useState(DEFAULT_SETTINGS.selected_user_profile_id);
  const [userProfileMenuOpen, setUserProfileMenuOpen] = useState(false);
  const [userProfileOpen, setUserProfileOpen] = useState(false);
  const [deleteUserProfileConfirmOpen, setDeleteUserProfileConfirmOpen] = useState(false);
  const [userLocationLabel, setUserLocationLabel] = useState(DEFAULT_SETTINGS.user_location_label);
  const [userLatitude, setUserLatitude] = useState<number | null>(DEFAULT_SETTINGS.user_latitude);
  const [userLongitude, setUserLongitude] = useState<number | null>(DEFAULT_SETTINGS.user_longitude);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const {
    isAudioPlaying,
    ensureAudioPlaybackUnlocked,
    playAudioBase64,
    stopActiveAudio,
  } = useAudioPlayback();
  const { toolRuns, toolRunsOpen, setToolRunsOpen, refreshToolRuns } = useToolRuns(DEFAULT_SETTINGS.ui_tool_activity_open);
  const {
    automationOpen,
    setAutomationOpen,
    workspaceOpen,
    setWorkspaceOpen,
    imageStudioOpen,
    setImageStudioOpen,
    calendarOpen,
    setCalendarOpen,
    telegramPanelOpen,
    setTelegramPanelOpen,
    googlePanelOpen,
    setGooglePanelOpen,
    samplingOpen,
    setSamplingOpen,
    leftPanelOpen,
    setLeftPanelOpen,
    rightPanelOpen,
    setRightPanelOpen,
  } = usePanelState();
  const [freshChatConfirmOpen, setFreshChatConfirmOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [composerNotice, setComposerNotice] = useState("");
  const {
    pendingShellActions,
    executingShellActionId,
    addPendingShellAction,
    refreshPendingShellActions,
    handleShellToolRequest,
    recordClientToolRun,
    rejectShellAction,
    approveShellAction,
  } = useShellActions({
    refreshToolRuns,
    setComposerNotice,
    setMessages,
  });
  const {
    automationJobs,
    setAutomationJobs,
    automationName,
    setAutomationName,
    automationPrompt,
    setAutomationPrompt,
    automationDate,
    setAutomationDate,
    automationTime,
    setAutomationTime,
    automationRepeat,
    setAutomationRepeat,
    automationEveryAmount,
    setAutomationEveryAmount,
    automationEveryUnit,
    setAutomationEveryUnit,
    automationTimeMenuOpen,
    setAutomationTimeMenuOpen,
    automationDateMenuOpen,
    setAutomationDateMenuOpen,
    automationMonthMenuOpen,
    setAutomationMonthMenuOpen,
    automationEveryUnitMenuOpen,
    setAutomationEveryUnitMenuOpen,
    automationEditorMonth,
    setAutomationEditorMonth,
    automationMonth,
    setAutomationMonth,
    selectedAutomationDate,
    selectedAutomationDateObj,
    selectedAutomationLabel,
    automationEditorOpen,
    setAutomationEditorOpen,
    editingAutomationId,
    setEditingAutomationId,
    automationMonthDays,
    activeAutomationCount,
    recentAutomationJobs,
    refreshAutomationJobs,
    openAutomationEditor,
    saveAutomationJob,
    toggleAutomationJob,
    deleteAutomationJob,
    selectAutomationDate,
  } = useAutomations({ setComposerNotice });
  const {
    image,
    imagePath,
    imageViewer,
    setImageViewer,
    clearImage,
    attachImageFromFile,
    chooseImageForComposer,
    compressAvatarDataUrl,
    readAvatarImage,
    revealImageLocation,
    openImageViewer,
  } = useImageAttachments({ setComposerNotice });
  const {
    themePickerOpen,
    setThemePickerOpen,
    themeSwatchId,
    setThemeSwatchId,
    selectedThemeSwatch,
    themeSwatches,
  } = useThemeSelection();
  const [clearMemoryConfirmOpen, setClearMemoryConfirmOpen] = useState(false);
  const [clearSessionToo, setClearSessionToo] = useState(false);
  const [deletePersonalityConfirmOpen, setDeletePersonalityConfirmOpen] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const availableUpdate = useAvailableUpdate(settingsLoaded);
  const [settingsReadyForSave, setSettingsReadyForSave] = useState(false);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [collapsedImageParts, setCollapsedImageParts] = useState<Record<string, boolean>>({});
  const [liveConversation, setLiveConversation] = useState(DEFAULT_SETTINGS.live_conversation);
  const [telegramBotToken, setTelegramBotToken] = useState(DEFAULT_SETTINGS.telegram_bot_token);
  const [telegramOwnerId, setTelegramOwnerId] = useState(DEFAULT_SETTINGS.telegram_owner_id);
  const [telegramStatus, setTelegramStatus] = useState("");
  const [telegramRunning, setTelegramRunning] = useState(false);
  const {
    telegramGuests,
    setTelegramGuests,
    telegramGuestDraft,
    setTelegramGuestDraft,
    addTelegramGuest,
    removeTelegramGuest,
  } = useTelegramGuests({
    initialGuests: DEFAULT_SETTINGS.telegram_guests,
    settingsLoaded,
    telegramRunning,
  });
  const {
    googleClientId,
    setGoogleClientId,
    googleClientSecret,
    setGoogleClientSecret,
    googleRedirectUri,
    setGoogleRedirectUri,
    googleStatus,
    googleCalendarEvents,
    googleBusy,
    googleNotice,
    selectedGoogleEvent,
    setSelectedGoogleEvent,
    googleDeleteTarget,
    setGoogleDeleteTarget,
    refreshGoogleStatus,
    refreshGoogleCalendarEvents,
    connectGoogle,
    disconnectGoogle,
    deleteGoogleEvent,
    openDeleteGoogleEventConfirm,
  } = useGoogleCalendar({
    automationMonth,
    initialClientId: DEFAULT_SETTINGS.google_client_id,
    initialClientSecret: DEFAULT_SETTINGS.google_client_secret,
    initialRedirectUri: DEFAULT_SETTINGS.google_redirect_uri,
  });
  const {
    imageWidth,
    setImageWidth,
    imageHeight,
    setImageHeight,
    quickImagePrompt,
    setQuickImagePrompt,
  } = useImageStudioSettings();
  const [voiceFolder, setVoiceFolder] = useState(DEFAULT_SETTINGS.voice_folder);
  const [selectedVoicePath, setSelectedVoicePath] = useState(DEFAULT_SETTINGS.selected_voice_path);
  const {
    creativity,
    setCreativity,
    samplingTemperature,
    setSamplingTemperature,
    topK,
    setTopK,
    topP,
    setTopP,
    minP,
    setMinP,
    repeatLastN,
    setRepeatLastN,
    repeatPenalty,
    setRepeatPenalty,
    memorySize,
    setMemorySize,
    replyLength,
    setReplyLength,
    intelligenceQuality,
    setIntelligenceQuality,
    resetSamplingDefaults,
  } = useSamplingSettings();
  const [personality, setPersonality] = useState(DEFAULT_SETTINGS.personality);
  const [personalityAvatar, setPersonalityAvatar] = useState(DEFAULT_SETTINGS.personality_presets[0].avatar ?? "");
  const [personalityPresets, setPersonalityPresets] = useState<PersonalityPreset[]>(DEFAULT_SETTINGS.personality_presets);
  const [selectedPersonalityId, setSelectedPersonalityId] = useState(DEFAULT_SETTINGS.selected_personality_id);
  const {
    characterSoul,
    characterFolder,
    saveActiveCharacterFiles,
  } = useCharacterFiles({
    settingsLoaded,
    settingsReadyForSave,
    selectedPersonalityId,
    selectedVoicePath,
    personality,
    personalityAvatar,
    personalityPresets,
    setPersonalityPresets,
    setSelectedVoicePath,
  });
  const [modelFolder, setModelFolder] = useState(DEFAULT_SETTINGS.model_folder);
  const {
    linkedFolders,
    setLinkedFolders,
    handleAddLinkedFolder,
    handleRemoveLinkedFolder,
  } = useWorkspaceFolders();
  const [availableModels, setAvailableModels] = useState<ModelLibraryEntry[]>([]);
  const [selectedModelPath, setSelectedModelPath] = useState(DEFAULT_SETTINGS.selected_model_path);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [hasVision, setHasVision] = useState(false);
  const [activeTaskType, setActiveTaskType] = useState<"none" | "llm" | "voice" | "image">("none");
  const [pendingAutoLoadPath, setPendingAutoLoadPath] = useState<string | null>(null);
  const {
    systemInfo,
    engineStatus,
    setEngineStatus,
    engineErrorMsg,
    setEngineErrorMsg,
    recommendedThreads,
    refreshEngineInfo,
  } = useEngineBootstrap({
    minContextSize: MIN_CHAT_CONTEXT_SIZE,
    setMemorySize,
  });
  const {
    setupCompleted,
    setSetupCompleted,
    setupScreenOpen,
    setSetupScreenOpen,
    setupTierOverride,
    setupCatalog,
    setSetupCatalog,
    setupInstalling,
    setSetupInstalling,
    setupNotice,
    setSetupNotice,
    setupPreflight,
    setSetupPreflight,
    setupProgress,
    setSetupProgress,
    activeSetupTier,
    detectedSetupTier,
    firstStartupSetupNeeded,
    activeSetupPartKey,
    chooseSetupTier,
  } = useSetupFlow({
    initialSetupCompleted: DEFAULT_SETTINGS.setup_completed,
    settingsLoaded,
    selectedModelPath,
    systemInfo,
  });
  const {
    voiceSetupStatus,
    omniVoiceStatus,
    prepareVoiceHelpers,
  } = useVoiceHelpers({
    lastComposerInputAtRef,
    setSetupNotice,
  });
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [quickModelMenuOpen, setQuickModelMenuOpen] = useState(false);
  const [personalityMenuOpen, setPersonalityMenuOpen] = useState(false);
  const [personalityProfileOpen, setPersonalityProfileOpen] = useState(false);
  const [personalityNameDraft, setPersonalityNameDraft] = useState(DEFAULT_SETTINGS.personality_presets[0].name);
  const dateTimeLine = useDateTimeLine();
  const [, setLastTokenSpeed] = useState(0);
  const [, setLastContextTokens] = useState(0);
  const [previewingVoicePath, setPreviewingVoicePath] = useState<string | null>(null);
  const [thinkingEnabled, setThinkingEnabled] = useState(DEFAULT_SETTINGS.thinking_enabled);
  const isCompactLayout = useCompactLayout({
    setLeftPanelOpen,
    setRightPanelOpen,
  });

  const userAvatarPickerRef = useRef<HTMLInputElement | null>(null);
  const personalityAvatarPickerRef = useRef<HTMLInputElement | null>(null);
  const avatarTargetPersonalityIdRef = useRef<string | null>(null);
  const lastUiInteractionAtRef = useRef(0);
  const voicePlaybackRequestRef = useRef(0);
  const lastAutoSpokenAssistantIdRef = useRef<string | null>(null);
  const autoSpeechEligibleAssistantIdsRef = useRef<Set<string>>(new Set());
  const liveConversationRef = useRef(liveConversation);
  const sendInFlightRef = useRef(false);
  const activeChatAbortRef = useRef<AbortController | null>(null);
  const activeChatRequestRef = useRef(0);
  const activeTaskTypeRef = useRef(activeTaskType);
  const modelLoadPromiseRef = useRef<Promise<void> | null>(null);
  const modelLoadTargetRef = useRef("");
  const automationRunKeysRef = useRef<Set<string>>(new Set());
  const settingsHydratedAtRef = useRef(0);
  const telegramAutoStartAttemptedRef = useRef(false);

  const {
    assistantAvatar,
    conversationLogoClass,
    currentModelEntry,
    currentModelName,
    hardwareGpuLabel,
    hardwareRamLabel,
    localContext,
    selectedGoogleEvents,
    selectedPersonalityPreset,
    selectedUserProfile,
  } = useAppDerivedState({
    availableModels,
    googleCalendarEvents,
    messagesLength: messages.length,
    personalityAvatar,
    personalityPresets,
    selectedAutomationDate,
    selectedModel,
    selectedModelPath,
    selectedPersonalityId,
    selectedUserProfileId,
    systemInfo,
    userProfiles,
  });
  const {
    personalityMemory,
    updatePersonalityMemoryAfterTurn,
    deletePersonalityMemory,
    handleClearPersonalityMemory,
  } = usePersonalityMemory({
    settingsLoaded,
    selectedPersonalityId,
    telegramRunning,
    isStreaming,
    clearSessionToo,
    lastComposerInputAtRef,
    setMessages,
    setClearMemoryConfirmOpen,
    setClearSessionToo,
  });
  const selectedUserVoicePath = selectedUserProfile?.voice_path || "";
  const {
    voiceSamples,
    selectedVoiceRowRef,
    selectedUserVoiceRowRef,
  } = useVoiceSamples({
    settingsLoaded,
    voiceFolder,
    personalityProfileOpen,
    userProfileOpen,
    selectedVoicePath,
    selectedUserVoicePath,
  });
  const selectedVoiceSample =
    voiceSamples.find((sample) => sample.path === selectedVoicePath) ?? null;
  const selectedUserVoiceSample =
    voiceSamples.find((sample) => sample.path === selectedUserVoicePath) ?? null;

  useEffect(() => {
    activeTaskTypeRef.current = activeTaskType;
  }, [activeTaskType]);

  const preferredChatGpuLayers = systemInfo?.has_nvidia_gpu ? 999 : 0;
  const reducedTaskGpuLayers = systemInfo?.has_nvidia_gpu
    ? Math.min(
        preferredChatGpuLayers,
        Math.max(
          4,
          Math.round(
            systemInfo.recommended_task_gpu_layers *
              (0.8 + intelligenceQuality / 100 * 0.15),
          ),
        ),
      )
    : 0;

  const markUiInteraction = () => {
    lastUiInteractionAtRef.current = Date.now();
  };
  const {
    conversationScrollRef,
    conversationEndRef,
    lastMessageCountRef,
    showScrollBottom,
    handleChatScroll,
    scrollToBottom,
    ensureConversationStartsAtBottom,
  } = useConversationScroll({
    markUiInteraction,
    messagesLength: messages.length,
    selectedPersonalityId,
  });
  const {
    saveActiveChatSession,
    loadChatSessionForPersonality,
    registerEmptyChatSession,
    removeChatSession,
    clearActiveChatSession,
  } = useChatSessions({
    settingsLoaded,
    selectedPersonalityId,
    messages,
    setMessages,
    lastMessageCountRef,
    ensureConversationStartsAtBottom,
    telegramRunning,
    isStreaming,
    sendInFlightRef,
    lastComposerInputAtRef,
  });

  const {
    updateLastAssistantMessage,
    updateAssistantMessageById,
    finalizeAssistantMessageById,
    deleteImageFromChatMessage,
    enrichPreviewPerception,
  } = useChatMessageMutations({
    setMessages,
    setCollapsedImageParts,
    autoSpeechEligibleAssistantIdsRef,
    lastAutoSpokenAssistantIdRef,
    voicePlaybackRequestRef,
    speakingMessageId,
    setSpeakingMessageId,
    stopActiveAudio,
    voiceSetupReady: voiceSetupStatus.ready,
  });

  const appLog = (message: string) => {
    console.info(`[Galaxy] ${message}`);
    invoke("append_app_log", { message }).catch(() => {
      // Logging must never affect chat or voice playback.
    });
  };

  const processSseEvent = (eventChunk: string) => {
    let visibleText = "";
    let fallbackText = "";

    for (const line of eventChunk.split(/\r?\n/)) {
      if (!line.startsWith("data:")) {
        continue;
      }

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        continue;
      }

      try {
        const data = JSON.parse(payload);
        const choices = Array.isArray(data.choices) ? data.choices : [];
        for (const choice of choices) {
          const extracted = extractChoiceText(choice);
          visibleText += extracted.visible;
          fallbackText += extracted.fallback;
        }
        if (choices.length === 0) {
          visibleText += extractTextValue(data.content);
          fallbackText += extractTextValue(data.reasoning_content ?? data.reasoning);
        }
      } catch (error) {
        console.error("Failed to parse SSE payload:", error);
      }
    }

    return { visibleText, fallbackText };
  };

  const {
    collectBrainDiagnostics,
    ensureChatModelReady,
    ensureRuntimeEngineReady,
    loadModelPath,
    unloadLlmForTask,
  } = useModelRuntime({
    activeTaskTypeRef,
    appLog,
    availableModels,
    brainStatus,
    engineStatus,
    memorySize,
    modelLoadPromiseRef,
    modelLoadStatus,
    modelLoadTargetRef,
    preferredChatGpuLayers,
    recommendedThreads,
    reducedTaskGpuLayers,
    refreshEngineInfo,
    selectedModelPath,
    setActiveTaskType,
    setBrainStatus,
    setComposerNotice,
    setEngineErrorMsg,
    setEngineStatus,
    setHasVision,
    setMemorySize,
    setModelLoadStatus,
    setPendingAutoLoadPath,
    setSelectedModel,
    setSelectedModelPath,
    setSetupNotice,
    stopActiveAudio,
    systemInfo,
  });
  const {
    isRecording,
    isTranscribing,
    handleMicToggle,
  } = useVoiceInput({
    composerInputRef,
    input,
    setComposerNotice,
    setComposerText,
    unloadLlmForTask,
    voiceSetupStatus,
  });

  const {
    playAutoSpeechQueue,
    previewVoiceSample,
    speakMessageText,
  } = useVoicePlaybackManager({
    activeTaskTypeRef,
    autoSpeechEligibleAssistantIdsRef,
    brainStatus,
    ensureAudioPlaybackUnlocked,
    isStreaming,
    lastAutoSpokenAssistantIdRef,
    messages,
    playAudioBase64,
    previewingVoicePath,
    recordClientToolRun,
    selectedUserVoicePath,
    selectedVoicePath,
    sendInFlightRef,
    setActiveTaskType,
    setBrainStatus,
    setComposerNotice,
    setPreviewingVoicePath,
    setSpeakingMessageId,
    stopActiveAudio,
    unloadLlmForTask,
    voicePlaybackRequestRef,
    appLog,
  });

  const { generateNaturalImageCompletionReply } = useImageCompletionReply({
    appLog,
    characterSoul,
    chatDisplayLanguage,
    ensureChatModelReady,
    hasVision,
    minP,
    personality,
    personalityPresets,
    repeatLastN,
    repeatPenalty,
    samplingTemperature,
    selectedPersonalityId,
    topK,
    topP,
    userDescription,
    userName,
  });

  const {
    scanModelLibrary,
    handleChooseModelFolder,
  } = useModelLibraryActions({
    modelFolder,
    engineStatus,
    setAvailableModels,
    setSelectedModelPath,
    setSelectedModel,
    setModelFolder,
    setPendingAutoLoadPath,
    setComposerNotice,
    loadModelPath,
  });

  const {
    buildAssistantRuntimePrompt,
    buildSystemContextBlock,
  } = useRuntimePromptBuilders({
    characterFolder,
    characterSoul,
    currentModelName,
    googleConnected: googleStatus.connected,
    googleEmail: googleStatus.email ?? undefined,
    linkedFolders,
    localContext,
    omniVoiceReady: omniVoiceStatus.ready,
    personality,
    personalityMemory,
    personalityPresets,
    selectedPersonalityId,
    telegramRunning,
    userDescription,
    userName,
    voiceInputReady: voiceSetupStatus.ready,
  });

  const updateActiveCharacterVoicePath = (voicePath: string) => {
    setSelectedVoicePath(voicePath);
    if (!selectedPersonalityId) return;
    setPersonalityPresets((prev) =>
      prev.map((preset) =>
        preset.id === selectedPersonalityId ? { ...preset, voice_path: voicePath } : preset,
      ),
    );
  };

  const {
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
  } = useProfileActions({
    characterSoul,
    clearImage,
    deletePersonalityMemory,
    loadChatSessionForPersonality,
    personality,
    personalityAvatar,
    personalityNameDraft,
    personalityPresets,
    registerEmptyChatSession,
    removeChatSession,
    saveActiveCharacterFiles,
    saveActiveChatSession,
    selectedPersonalityId,
    selectedPersonalityPreset,
    selectedUserProfile,
    selectedUserProfileId,
    selectedUserVoicePath,
    selectedVoicePath,
    setComposerNotice,
    setComposerText,
    setMessages,
    setPersonality,
    setPersonalityAvatar,
    setPersonalityNameDraft,
    setPersonalityPresets,
    setPersonalityProfileOpen,
    setSelectedPersonalityId,
    setSelectedUserProfileId,
    setSelectedVoicePath,
    setUserAvatar,
    setUserDescription,
    setUserLatitude,
    setUserLocationLabel,
    setUserLongitude,
    setUserName,
    setUserProfileMenuOpen,
    setUserProfileOpen,
    setUserProfiles,
    userAvatar,
    userDescription,
    userLatitude,
    userLocationLabel,
    userLongitude,
    userName,
    userProfiles,
  });

  const { handleChooseVoiceFolder } = useVoiceFolderActions({
    setVoiceFolder,
    updateActiveCharacterVoicePath,
    voiceFolder,
  });

  const {
    handleStartTelegram,
    handleStopTelegram,
    handleTestTelegram,
    setAutoVoiceMode,
  } = useTelegramControls({
    buildAssistantRuntimePrompt,
    ensureAudioPlaybackUnlocked,
    googleClientId,
    googleClientSecret,
    linkedFolders,
    liveConversation,
    minP,
    repeatLastN,
    repeatPenalty,
    replyLength,
    samplingTemperature,
    setLiveConversation,
    setTelegramRunning,
    setTelegramStatus,
    telegramBotToken,
    telegramOwnerId,
    thinkingEnabled,
    topK,
    topP,
  });

  const {
    approveActionProposal,
    dismissChatPart,
    dismissImageProposal,
    executeActionProposal,
    naturalizeSystemResult,
  } = useActionProposals({
    addPendingShellAction,
    ensureChatModelReady,
    googleClientId,
    googleClientSecret,
    linkedFolders,
    messages,
    minP,
    repeatLastN,
    repeatPenalty,
    replyLength,
    samplingTemperature,
    selectedUserProfile,
    setComposerNotice,
    setIsApproving,
    setMessages,
    topK,
    topP,
    userName,
  });

  const { handleGenerateImage } = useImageGeneration({
    appLog,
    assistantAvatar,
    autoSpeechEligibleAssistantIdsRef,
    clearImage,
    composerInputRef,
    generateNaturalImageCompletionReply,
    image,
    imageHeight,
    imageWidth,
    input,
    isGeneratingImage,
    liveConversationRef,
    messages,
    recordClientToolRun,
    setComposerNotice,
    setComposerText,
    setIsGeneratingImage,
    setMessages,
    unloadLlmForTask,
    updateAssistantMessageById,
    updateLastAssistantMessage,
    userAvatar,
  });

  const { handleSend } = useChatRuntime({
    activeChatAbortRef,
    activeChatRequestRef,
    appLog,
    approveActionProposal,
    autoSpeechEligibleAssistantIdsRef,
    buildSystemContextBlock,
    characterSoul,
    clearImage,
    collectBrainDiagnostics,
    composerInputRef,
    ensureAudioPlaybackUnlocked,
    ensureChatModelReady,
    enrichPreviewPerception,
    executeActionProposal,
    extractSseEventText: processSseEvent,
    finalizeAssistantMessageById,
    googleClientId,
    googleClientSecret,
    handleGenerateImage,
    handleShellToolRequest,
    hasVision,
    image,
    imagePath,
    input,
    isStreaming,
    linkedFolders,
    liveConversation,
    liveConversationRef,
    messages,
    minP,
    naturalizeSystemResult,
    personality,
    personalityMemory,
    personalityPresets,
    refreshToolRuns,
    repeatLastN,
    repeatPenalty,
    replyLength,
    samplingTemperature,
    selectedModelPath,
    selectedPersonalityId,
    selectedUserProfile,
    sendInFlightRef,
    setBrainStatus,
    setComposerNotice,
    setComposerText,
    setIsStreaming,
    setLastContextTokens,
    setLastTokenSpeed,
    setMessages,
    speakMessageText,
    thinkingEnabled,
    topK,
    topP,
    updateLastAssistantMessage,
    updatePersonalityMemoryAfterTurn,
    userDescription,
    userName,
  });
  const { stopActiveResponse } = useChatStop({
    activeChatAbortRef,
    activeChatRequestRef,
    sendInFlightRef,
    setBrainStatus,
    setComposerNotice,
    setIsStreaming,
  });

  useAutomationRunner({
    settingsLoaded,
    automationJobs,
    isStreaming,
    engineStatus,
    selectedModelPath,
    sendInFlightRef,
    lastComposerInputAtRef,
    automationRunKeysRef,
    setComposerNotice,
    setAutomationJobs,
    handleSend,
  });

  const { handleQuickImageGenerate } = useQuickImageGenerate({
    appLog,
    handleSend,
    imageHeight,
    imageWidth,
    isGeneratingImage,
    quickImagePrompt,
    recordClientToolRun,
    setComposerNotice,
    setIsGeneratingImage,
    setQuickImagePrompt,
    unloadLlmForTask,
  });

  useAppLifecycleWiring({
    autoSpeechEligibleAssistantIdsRef,
    automationMonth,
    automationOpen,
    calendarOpen,
    compressAvatarDataUrl,
    conversationScrollRef,
    creativity,
    engineStatus,
    ensureAudioPlaybackUnlocked,
    googleClientId,
    googleClientSecret,
    googlePanelOpen,
    googleRedirectUri,
    googleStatus,
    handleStartTelegram,
    handleStopTelegram,
    imageHeight,
    imageStudioOpen,
    imageWidth,
    intelligenceQuality,
    isGeneratingImage,
    isStreaming,
    isTranscribing,
    lastAutoSpokenAssistantIdRef,
    lastMessageCountRef,
    leftPanelOpen,
    linkedFolders,
    liveConversation,
    liveConversationRef,
    loadModelPath,
    memorySize,
    messages,
    minChatContextSize: MIN_CHAT_CONTEXT_SIZE,
    minP,
    modelFolder,
    pendingAutoLoadPath,
    personality,
    personalityPresets,
    playAutoSpeechQueue,
    refreshAutomationJobs,
    refreshGoogleCalendarEvents,
    refreshGoogleStatus,
    refreshPendingShellActions,
    refreshToolRuns,
    repeatLastN,
    repeatPenalty,
    replyLength,
    rightPanelOpen,
    samplingOpen,
    samplingTemperature,
    scanModelLibrary,
    selectedModelPath,
    selectedPersonalityId,
    selectedUserProfile,
    selectedUserProfileId,
    selectedVoicePath,
    setAutomationDateMenuOpen,
    setAutomationEveryUnitMenuOpen,
    setAutomationMonthMenuOpen,
    setAutomationOpen,
    setAutomationTimeMenuOpen,
    setCalendarOpen,
    setCreativity,
    setGoogleClientId,
    setGoogleClientSecret,
    setGooglePanelOpen,
    setGoogleRedirectUri,
    setImageHeight,
    setImageStudioOpen,
    setImageWidth,
    setIntelligenceQuality,
    setLeftPanelOpen,
    setLinkedFolders,
    setLiveConversation,
    setMemorySize,
    setMessages,
    setMinP,
    setModelFolder,
    setModelMenuOpen,
    setPersonality,
    setPersonalityAvatar,
    setPersonalityMenuOpen,
    setPersonalityNameDraft,
    setPersonalityPresets,
    setQuickModelMenuOpen,
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
    setThemePickerOpen,
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
    setUserProfileMenuOpen,
    setUserProfiles,
    setVoiceFolder,
    setWorkspaceOpen,
    settingsHydratedAtRef,
    settingsLoaded,
    settingsReadyForSave,
    setupCompleted,
    speakingMessageId,
    telegramAutoStartAttemptedRef,
    telegramBotToken,
    telegramGuests,
    telegramOwnerId,
    telegramPanelOpen,
    telegramRunning,
    themeSwatches,
    themeSwatchId,
    thinkingEnabled,
    toolRunsOpen,
    topK,
    topP,
    updateActiveCharacterVoicePath,
    updateActiveUserProfile,
    userAvatar,
    userDescription,
    userLatitude,
    userLocationLabel,
    userLongitude,
    userName,
    userProfiles,
    voiceFolder,
    voicePlaybackRequestRef,
    voiceSamples,
    workspaceOpen,
  });
  const {
    topStatusText,
    topProgressPercent,
    topProgressActive,
    imageStudioDrawing,
    waveformProcessing,
  } = useRuntimeStatusDisplay({
    activeTaskType,
    brainStatus,
    composerNotice,
    currentModelName,
    engineStatus,
    isAudioPlaying,
    isGeneratingImage,
    isStreaming,
    isTranscribing,
    modelLoadStatus,
    omniVoiceStatus,
    selectedModelPath,
    voiceSetupStatus,
  });

  useSetupRuntimeEffects({
    activeSetupTier,
    engineStatus,
    firstStartupSetupNeeded,
    loadModelPath,
    omniVoiceStatus,
    prepareVoiceHelpers,
    scanModelLibrary,
    selectedModelPath,
    setModelFolder,
    setPendingAutoLoadPath,
    setSelectedModelPath,
    settingsLoaded,
    setupCatalog,
    setupCompleted,
    setupScreenOpen,
    voiceSetupStatus,
  });

  const { leftPanelContent, rightPanelContent } = useAppPanelContents({
    activeAutomationCount,
    addTelegramGuest,
    automationJobs,
    automationMonth,
    automationMonthDays,
    automationOpen,
    availableModels,
    avatarTargetPersonalityIdRef,
    brainStatus,
    calendarOpen,
    clearMemoryConfirmOpen,
    clearSessionToo,
    connectGoogle,
    createUserProfile,
    currentModelEntry,
    currentModelName,
    deleteAutomationJob,
    deletePersonalityConfirmOpen,
    deleteSelectedPersonalityPreset,
    deleteSelectedUserProfile,
    deleteUserProfileConfirmOpen,
    disconnectGoogle,
    googleBusy,
    googleCalendarEvents,
    googleClientId,
    googleClientSecret,
    googleNotice,
    googlePanelOpen,
    googleRedirectUri,
    googleStatus,
    handleAddLinkedFolder,
    handleChooseModelFolder,
    handleChooseVoiceFolder,
    handleClearPersonalityMemory,
    handleGenerateImage,
    handleQuickImageGenerate,
    handleRemoveLinkedFolder,
    handleStartTelegram,
    handleStopTelegram,
    handleTestTelegram,
    imageHeight,
    imageStudioDrawing,
    imageStudioOpen,
    imageWidth,
    isAudioPlaying,
    isGeneratingImage,
    linkedFolders,
    loadModelPath,
    memorySize,
    minContextSize: MIN_CHAT_CONTEXT_SIZE,
    minP,
    modelMenuOpen,
    openAutomationEditor,
    openDeleteGoogleEventConfirm,
    openPersonalityProfile,
    openUserProfile,
    personality,
    personalityAvatar,
    personalityAvatarPickerRef,
    personalityMenuOpen,
    personalityNameDraft,
    personalityPresets,
    personalityProfileOpen,
    previewVoiceSample,
    previewingVoicePath,
    quickImagePrompt,
    recentAutomationJobs,
    refreshGoogleCalendarEvents,
    refreshToolRuns,
    removeTelegramGuest,
    repeatLastN,
    repeatPenalty,
    replyLength,
    resetSamplingDefaults,
    samplingOpen,
    samplingTemperature,
    saveActiveUserProfile,
    saveCurrentPersonalityPreset,
    selectAutomationDate,
    selectPersonalityPreset,
    selectUserProfile,
    selectedAutomationDate,
    selectedAutomationDateObj,
    selectedAutomationLabel,
    selectedGoogleEvents,
    selectedModelPath,
    selectedPersonalityId,
    selectedPersonalityPreset,
    selectedThemeSwatch,
    selectedUserProfile,
    selectedUserProfileId,
    selectedUserVoicePath,
    selectedUserVoiceRowRef,
    selectedUserVoiceSample,
    selectedVoicePath,
    selectedVoiceRowRef,
    selectedVoiceSample,
    setAutomationMonth,
    setAutomationOpen,
    setCalendarOpen,
    setClearMemoryConfirmOpen,
    setClearSessionToo,
    setDeletePersonalityConfirmOpen,
    setDeleteUserProfileConfirmOpen,
    setGoogleClientId,
    setGoogleClientSecret,
    setGooglePanelOpen,
    setGoogleRedirectUri,
    setImageHeight,
    setImageStudioOpen,
    setImageWidth,
    setMemorySize,
    setMinP,
    setModelMenuOpen,
    setPersonality,
    setPersonalityMenuOpen,
    setPersonalityNameDraft,
    setPersonalityProfileOpen,
    setQuickImagePrompt,
    setQuickModelMenuOpen,
    setRepeatLastN,
    setRepeatPenalty,
    setReplyLength,
    setSamplingOpen,
    setSamplingTemperature,
    setSelectedGoogleEvent,
    setSelectedModelPath,
    setSelectedVoicePath,
    setTelegramBotToken,
    setTelegramGuestDraft,
    setTelegramOwnerId,
    setTelegramPanelOpen,
    setThemePickerOpen,
    setToolRunsOpen,
    setTopK,
    setTopP,
    setUserDescription,
    setUserName,
    setUserProfileMenuOpen,
    setUserProfileOpen,
    setVoiceFolder,
    setWorkspaceOpen,
    telegramBotToken,
    telegramGuestDraft,
    telegramGuests,
    telegramOwnerId,
    telegramPanelOpen,
    telegramRunning,
    telegramStatus,
    theme: selectedThemeSwatch,
    toolRuns,
    toolRunsOpen,
    toggleAutomationJob,
    topK,
    topP,
    updateActiveCharacterVoicePath,
    updateActiveUserProfile,
    updateActiveUserVoicePath,
    updateSelectedPersonalityPreset,
    userAvatar,
    userAvatarPickerRef,
    userDescription,
    userName,
    userProfileMenuOpen,
    userProfileOpen,
    userProfiles,
    voiceFolder,
    voiceSamples,
    waveformProcessing,
    workspaceOpen,
  });
  const {
    closeSetupScreen,
    handleInstallSetupBundle,
    handleInstallSetupPart,
  } = useSetupInstallActions({
    activeSetupTier,
    ensureConversationStartsAtBottom,
    ensureRuntimeEngineReady,
    prepareVoiceHelpers,
    scanModelLibrary,
    setLeftPanelOpen,
    setModelFolder,
    setPendingAutoLoadPath,
    setRightPanelOpen,
    setSelectedModelPath,
    setSetupCatalog,
    setSetupCompleted,
    setSetupInstalling,
    setSetupNotice,
    setSetupPreflight,
    setSetupProgress,
    setSetupScreenOpen,
    setupCatalog,
    setupInstalling,
    systemInfo,
  });

  return (
    <AppShell
      activeSetupPartKey={activeSetupPartKey}
      activeSetupTier={activeSetupTier}
      detectedSetupTier={detectedSetupTier}
      activeTaskType={activeTaskType}
      appVersion={`v${CURRENT_APP_VERSION}`}
      approveActionProposal={approveActionProposal}
      approveShellAction={approveShellAction}
      assistantAvatar={assistantAvatar}
      attachImageFromFile={attachImageFromFile}
      automationDate={automationDate}
      automationDateMenuOpen={automationDateMenuOpen}
      automationEditorMonth={automationEditorMonth}
      automationEditorOpen={automationEditorOpen}
      automationEveryAmount={automationEveryAmount}
      automationEveryUnit={automationEveryUnit}
      automationEveryUnitMenuOpen={automationEveryUnitMenuOpen}
      automationMonthMenuOpen={automationMonthMenuOpen}
      automationName={automationName}
      automationPrompt={automationPrompt}
      automationRepeat={automationRepeat}
      automationTime={automationTime}
      automationTimeMenuOpen={automationTimeMenuOpen}
      availableModels={availableModels}
      availableUpdate={availableUpdate}
      avatarTargetPersonalityIdRef={avatarTargetPersonalityIdRef}
      brainStatus={brainStatus}
      chooseImageForComposer={chooseImageForComposer}
      chooseSetupTier={chooseSetupTier}
      clearActiveChatSession={clearActiveChatSession}
      clearImage={clearImage}
      closeSetupScreen={closeSetupScreen}
      collapsedImageParts={collapsedImageParts}
      composerHasText={composerHasText}
      composerInputRef={composerInputRef}
      conversationEndRef={conversationEndRef}
      conversationLogoClass={conversationLogoClass}
      conversationScrollRef={conversationScrollRef}
      currentModelEntry={currentModelEntry}
      dateTimeLine={dateTimeLine}
      deleteGoogleEvent={deleteGoogleEvent}
      deleteImageFromChatMessage={deleteImageFromChatMessage}
      dismissChatPart={dismissChatPart}
      dismissImageProposal={dismissImageProposal}
      editingAutomationId={editingAutomationId}
      engineErrorMsg={engineErrorMsg}
      engineStatus={engineStatus}
      ensureAudioPlaybackUnlocked={ensureAudioPlaybackUnlocked}
      executingShellActionId={executingShellActionId}
      firstStartupSetupNeeded={firstStartupSetupNeeded}
      freshChatConfirmOpen={freshChatConfirmOpen}
      googleDeleteTarget={googleDeleteTarget}
      handleChatScroll={handleChatScroll}
      handleComposerInput={handleComposerInput}
      handleGenerateImage={handleGenerateImage}
      handleInstallSetupBundle={handleInstallSetupBundle}
      handleInstallSetupPart={handleInstallSetupPart}
      handleMicToggle={handleMicToggle}
      handleSend={handleSend}
      hardwareGpuLabel={hardwareGpuLabel}
      hardwareRamLabel={hardwareRamLabel}
      image={image}
      imageViewer={imageViewer}
      input={input}
      isApproving={isApproving}
      isAudioPlaying={isAudioPlaying}
      isCompactLayout={isCompactLayout}
      isDragging={isDragging}
      isGeneratingImage={isGeneratingImage}
      isRecording={isRecording}
      isStreaming={isStreaming}
      isTranscribing={isTranscribing}
      leftPanelContent={leftPanelContent}
      leftPanelOpen={leftPanelOpen}
      linkedFolders={linkedFolders}
      liveConversation={liveConversation}
      loadModelPath={loadModelPath}
      markUiInteraction={markUiInteraction}
      messages={messages}
      modelLoadStatus={modelLoadStatus}
      openDeleteGoogleEventConfirm={openDeleteGoogleEventConfirm}
      openImageViewer={openImageViewer}
      openPersonalityProfile={openPersonalityProfile}
      openUserProfile={openUserProfile}
      pendingShellActions={pendingShellActions}
      personalityAvatarPickerRef={personalityAvatarPickerRef}
      previewingVoicePath={previewingVoicePath}
      quickModelMenuOpen={quickModelMenuOpen}
      readAvatarImage={readAvatarImage}
      rejectShellAction={rejectShellAction}
      revealImageLocation={revealImageLocation}
      rightPanelContent={rightPanelContent}
      rightPanelOpen={rightPanelOpen}
      saveAutomationJob={saveAutomationJob}
      scrollToBottom={scrollToBottom}
      selectedModel={selectedModel}
      selectedModelPath={selectedModelPath}
      selectedPersonalityId={selectedPersonalityId}
      selectedPersonalityPreset={selectedPersonalityPreset}
      selectedThemeSwatch={selectedThemeSwatch}
      selectedUserProfile={selectedUserProfile}
      sendInFlightRef={sendInFlightRef}
      selectedEvent={selectedGoogleEvent}
      selectedGoogleEvent={selectedGoogleEvent}
      setAutoVoiceMode={setAutoVoiceMode}
      setAutomationDate={setAutomationDate}
      setAutomationDateMenuOpen={setAutomationDateMenuOpen}
      setAutomationEditorMonth={setAutomationEditorMonth}
      setAutomationEditorOpen={setAutomationEditorOpen}
      setAutomationEveryAmount={setAutomationEveryAmount}
      setAutomationEveryUnit={setAutomationEveryUnit}
      setAutomationEveryUnitMenuOpen={setAutomationEveryUnitMenuOpen}
      setAutomationMonthMenuOpen={setAutomationMonthMenuOpen}
      setAutomationName={setAutomationName}
      setAutomationPrompt={setAutomationPrompt}
      setAutomationRepeat={setAutomationRepeat}
      setAutomationTime={setAutomationTime}
      setAutomationTimeMenuOpen={setAutomationTimeMenuOpen}
      setCollapsedImageParts={setCollapsedImageParts}
      setComposerNotice={setComposerNotice}
      setComposerText={setComposerText}
      setEditingAutomationId={setEditingAutomationId}
      setFreshChatConfirmOpen={setFreshChatConfirmOpen}
      setGoogleDeleteTarget={setGoogleDeleteTarget}
      setImageViewer={setImageViewer}
      setIsDragging={setIsDragging}
      setLeftPanelOpen={setLeftPanelOpen}
      setModelMenuOpen={setModelMenuOpen}
      setPersonalityAvatar={setPersonalityAvatar}
      setPersonalityMenuOpen={setPersonalityMenuOpen}
      setPersonalityPresets={setPersonalityPresets}
      setQuickModelMenuOpen={setQuickModelMenuOpen}
      setRightPanelOpen={setRightPanelOpen}
      setSelectedGoogleEvent={setSelectedGoogleEvent}
      setSelectedModelPath={setSelectedModelPath}
      setSetupScreenOpen={setSetupScreenOpen}
      setSpeakingMessageId={setSpeakingMessageId}
      setThemePickerOpen={setThemePickerOpen}
      setThemeSwatchId={setThemeSwatchId}
      setThinkingEnabled={setThinkingEnabled}
      setUserAvatar={setUserAvatar}
      setUserProfileMenuOpen={setUserProfileMenuOpen}
      settingsLoadError={settingsLoadError}
      settingsLoaded={settingsLoaded}
      setupCatalog={setupCatalog}
      setupInstalling={setupInstalling}
      setupNotice={setupNotice}
      setupPreflight={setupPreflight}
      setupProgress={setupProgress}
      setupTierOverride={setupTierOverride}
      showScrollBottom={showScrollBottom}
      speakMessageText={speakMessageText}
      speakingMessageId={speakingMessageId}
      stopActiveAudio={stopActiveAudio}
      stopActiveResponse={stopActiveResponse}
      systemInfo={systemInfo}
      themePickerOpen={themePickerOpen}
      themeSwatches={themeSwatches}
      themeSwatchId={themeSwatchId}
      thinkingEnabled={thinkingEnabled}
      topProgressActive={topProgressActive}
      topProgressPercent={topProgressPercent}
      topStatusText={topStatusText}
      userAvatar={userAvatar}
      userAvatarPickerRef={userAvatarPickerRef}
      userName={userName}
      voicePlaybackRequestRef={voicePlaybackRequestRef}
    />
  );
}

export default App;
