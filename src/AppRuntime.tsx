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
import { useMediaPlayerController } from "./hooks/useMediaPlayerController";
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
import { useLongTaskNotice } from "./hooks/useLongTaskNotice";
import {
  DEFAULT_SETTINGS,
  DisplayLanguage,
  ModelLibraryEntry,
  PersonalityPreset,
  UserProfilePreset,
  detectDisplayLanguage,
  extractChoiceText,
  extractChatResponseText,
  extractMessageText,
  extractTextValue,
  estimateTokens,
  hasUnexpectedHanDrift,
  cleanAssistantDisplayText,
  createMessageId,
} from "./appCore";

const MIN_CHAT_CONTEXT_SIZE = 8192;
const AUTOPILOT_MIN_TOKENS = 180;
const AUTOPILOT_MAX_TOKENS = 720;
const AUTOPILOT_HISTORY_MESSAGES = 12;
const AUTOPILOT_HISTORY_CHARS = 420;
const SUPPRESSED_TEXT_FIELD_TITLE_ATTR = "data-suppressed-text-field-title";

const randomAutoPilotMaxTokens = () =>
  Math.floor(AUTOPILOT_MIN_TOKENS + Math.random() * (AUTOPILOT_MAX_TOKENS - AUTOPILOT_MIN_TOKENS + 1));

const normalizeAutoPilotRepeatText = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const textSimilarity = (left: string, right: string) => {
  const leftWords = normalizeAutoPilotRepeatText(left).split(" ").filter(Boolean);
  const rightWords = normalizeAutoPilotRepeatText(right).split(" ").filter(Boolean);
  if (leftWords.length < 4 || rightWords.length < 4) return 0;
  const leftSet = new Set(leftWords);
  const rightSet = new Set(rightWords);
  let overlap = 0;
  for (const word of leftSet) {
    if (rightSet.has(word)) overlap += 1;
  }
  return overlap / Math.max(1, Math.min(leftSet.size, rightSet.size));
};

const isTooSimilarToRecentSpeakerText = (candidate: string, recentTexts: string[]) => {
  const cleanCandidate = normalizeAutoPilotRepeatText(candidate);
  if (!cleanCandidate) return false;
  return recentTexts.some((recent) => {
    const cleanRecent = normalizeAutoPilotRepeatText(recent);
    if (!cleanRecent) return false;
    if (cleanCandidate === cleanRecent) return true;
    if (cleanCandidate.length > 80 && cleanRecent.length > 80) {
      if (cleanCandidate.includes(cleanRecent) || cleanRecent.includes(cleanCandidate)) return true;
    }
    return textSimilarity(cleanCandidate, cleanRecent) >= 0.72;
  });
};

function restoreSuppressedTextFieldTitles() {
  document.querySelectorAll(`[${SUPPRESSED_TEXT_FIELD_TITLE_ATTR}]`).forEach((element) => {
    const title = element.getAttribute(SUPPRESSED_TEXT_FIELD_TITLE_ATTR) ?? "";
    element.removeAttribute(SUPPRESSED_TEXT_FIELD_TITLE_ATTR);
    element.setAttribute("title", title);
  });
}

function suppressTextFieldTitles(target: EventTarget | null) {
  if (!(target instanceof Element)) return;
  const textField = target.closest("input:not([type='range']):not([type='checkbox']):not([type='radio']), textarea");
  if (!textField) return;
  let element: Element | null = textField;
  while (element && element !== document.body) {
    if (element.hasAttribute("title") && !element.hasAttribute(SUPPRESSED_TEXT_FIELD_TITLE_ATTR)) {
      element.setAttribute(SUPPRESSED_TEXT_FIELD_TITLE_ATTR, element.getAttribute("title") ?? "");
      element.removeAttribute("title");
    }
    element = element.parentElement;
  }
}

function App() {
  useEffect(() => {
    const handleEnter = (event: Event) => suppressTextFieldTitles(event.target);
    const handleLeave = () => restoreSuppressedTextFieldTitles();
    document.addEventListener("pointerover", handleEnter, true);
    document.addEventListener("focusin", handleEnter, true);
    document.addEventListener("pointerout", handleLeave, true);
    document.addEventListener("focusout", handleLeave, true);
    return () => {
      document.removeEventListener("pointerover", handleEnter, true);
      document.removeEventListener("focusin", handleEnter, true);
      document.removeEventListener("pointerout", handleLeave, true);
      document.removeEventListener("focusout", handleLeave, true);
      restoreSuppressedTextFieldTitles();
    };
  }, []);

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
  const { toolRuns, toolRunsOpen, setToolRunsOpen, refreshToolRuns, clearToolRuns } = useToolRuns(DEFAULT_SETTINGS.ui_tool_activity_open);
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
    mediaPlayerPanelOpen,
    setMediaPlayerPanelOpen,
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
  const [userAutoPilot, setUserAutoPilot] = useState(DEFAULT_SETTINGS.user_auto_pilot);
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
    mediaPlayerStatus,
    mediaPlayerBusy,
    refreshMediaPlayerStatus,
    mediaPlayerPlay,
    mediaPlayerPause,
    mediaPlayerNext,
    mediaPlayerPrevious,
  } = useMediaPlayerController({
    settingsLoaded,
  });
  const {
    imageWidth,
    setImageWidth,
    imageHeight,
    setImageHeight,
    quickImagePrompt,
    setQuickImagePrompt,
    quickImageMode,
    setQuickImageMode,
  } = useImageStudioSettings();
  const [voiceFolder, setVoiceFolder] = useState(DEFAULT_SETTINGS.voice_folder);
  const [selectedVoicePath, setSelectedVoicePath] = useState(DEFAULT_SETTINGS.selected_voice_path);
  const [modelFolder, setModelFolder] = useState(DEFAULT_SETTINGS.model_folder);
  const [selectedModelPath, setSelectedModelPath] = useState(DEFAULT_SETTINGS.selected_model_path);
  const [thinkingEnabled, setThinkingEnabled] = useState(DEFAULT_SETTINGS.thinking_enabled);
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
  } = useSamplingSettings({ selectedModelPath, thinkingEnabled });
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
  const {
    linkedFolders,
    setLinkedFolders,
    handleAddLinkedFolder,
    handleRemoveLinkedFolder,
  } = useWorkspaceFolders();
  const [availableModels, setAvailableModels] = useState<ModelLibraryEntry[]>([]);
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
  const lastSpeechChunkPlaybackStartedRef = useRef<{ messageId: string; at: number; requestId: number } | null>(null);
  const autoSpeechEligibleAssistantIdsRef = useRef<Set<string>>(new Set());
  const liveConversationRef = useRef(liveConversation);
  const sendInFlightRef = useRef(false);
  const activeChatAbortRef = useRef<AbortController | null>(null);
  const activeChatRequestRef = useRef(0);
  const activeTaskTypeRef = useRef(activeTaskType);
  const isAudioPlayingRef = useRef(isAudioPlaying);
  const speakingMessageIdRef = useRef<string | null>(speakingMessageId);
  const userAutoPilotRef = useRef(userAutoPilot);
  const userAutoPilotDraftingRef = useRef(false);
  const userAutoPilotSpeechSettledAtRef = useRef(performance.now());
  const deferredAutoPilotMemoryTurnsRef = useRef<Array<{ userText: string; assistantText: string }>>([]);
  const memoryIdleFlushTimerRef = useRef<number | null>(null);
  const memoryIdleFlushRunningRef = useRef(false);
  const transcriptActiveSessionIdRef = useRef("");
  const transcriptLoggedMessageIdsRef = useRef<Set<string>>(new Set());
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
    selectedPersonalityName: selectedPersonalityPreset?.name || "Assistant",
    selectedMemoryPartnerId: selectedUserProfileId,
    selectedMemoryPartnerName: selectedUserProfile?.name || userName || "User",
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

  useEffect(() => {
    isAudioPlayingRef.current = isAudioPlaying;
  }, [isAudioPlaying]);

  useEffect(() => {
    speakingMessageIdRef.current = speakingMessageId;
  }, [speakingMessageId]);

  const queueAutoPilotMemoryTurn = (userText: string, assistantText: string) => {
    const cleanUser = userText.trim();
    const cleanAssistant = assistantText.trim();
    if (!cleanUser && !cleanAssistant) return;
    deferredAutoPilotMemoryTurnsRef.current = [
      ...deferredAutoPilotMemoryTurnsRef.current,
      { userText: cleanUser.slice(0, 900), assistantText: cleanAssistant.slice(0, 900) },
    ].slice(-8);
  };

  useEffect(() => () => {
    if (memoryIdleFlushTimerRef.current) {
      window.clearTimeout(memoryIdleFlushTimerRef.current);
      memoryIdleFlushTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    userAutoPilotRef.current = userAutoPilot;
  }, [userAutoPilot]);

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
    selectedPersonalityId: `${selectedUserProfileId}::${selectedPersonalityId}`,
  });
  const {
    saveActiveChatSession,
    loadChatSessionForPersonality,
    registerEmptyChatSession,
    removeChatSession,
    clearActiveChatSession,
    activeChatSessionId,
    updateChatSessionMessages,
  } = useChatSessions({
    settingsLoaded,
    selectedPersonalityId,
    selectedUserProfileId,
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

  useEffect(() => {
    if (!settingsLoaded || !activeChatSessionId) return;
    if (transcriptActiveSessionIdRef.current !== activeChatSessionId) {
      transcriptActiveSessionIdRef.current = activeChatSessionId;
      transcriptLoggedMessageIdsRef.current = new Set(
        messages
          .filter((message) => !message.pending && extractMessageText(message.content).trim())
          .map((message) => message.id),
      );
      return;
    }
    const userProfileName = selectedUserProfile?.name || userName || "User";
    const assistantName = selectedPersonalityPreset?.name || "Assistant";
    for (const message of messages) {
      if (message.pending || transcriptLoggedMessageIdsRef.current.has(message.id)) continue;
      const rawText = extractMessageText(message.content).replace(/\s+/g, " ").trim();
      const text = message.role === "assistant" ? cleanAssistantDisplayText(rawText) : rawText;
      if (!text) continue;
      transcriptLoggedMessageIdsRef.current.add(message.id);
      const speakerName = message.role === "user" ? userProfileName : assistantName;
      invoke("append_pair_chat_transcript", {
        firstId: selectedUserProfileId,
        firstName: userProfileName,
        secondId: selectedPersonalityId,
        secondName: assistantName,
        speakerName,
        createdAt: new Date(message.created_at || message.completed_at || Date.now()).toISOString(),
        text,
      }).catch((error: unknown) => {
        appLog(`chat transcript append failed ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }, [
    activeChatSessionId,
    messages,
    selectedPersonalityId,
    selectedPersonalityPreset?.name,
    selectedUserProfile?.name,
    selectedUserProfileId,
    settingsLoaded,
    userName,
  ]);

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

  useEffect(() => {
    const clearMemoryIdleTimer = () => {
      if (memoryIdleFlushTimerRef.current) {
        window.clearTimeout(memoryIdleFlushTimerRef.current);
        memoryIdleFlushTimerRef.current = null;
      }
    };
    const memoryCanFlush =
      !userAutoPilot &&
      !isStreaming &&
      !isGeneratingImage &&
      !isApproving &&
      !isTranscribing &&
      !isAudioPlaying &&
      !speakingMessageId &&
      !sendInFlightRef.current &&
      activeTaskType === "none" &&
      brainStatus !== "Thinking" &&
      brainStatus !== "Loading";
    if (!memoryCanFlush) {
      clearMemoryIdleTimer();
      return;
    }
    if (memoryIdleFlushRunningRef.current || memoryIdleFlushTimerRef.current) return;
    if (!deferredAutoPilotMemoryTurnsRef.current.length) return;
    memoryIdleFlushTimerRef.current = window.setTimeout(() => {
      memoryIdleFlushTimerRef.current = null;
      if (userAutoPilotRef.current || memoryIdleFlushRunningRef.current) return;
      const turns = deferredAutoPilotMemoryTurnsRef.current.splice(0);
      if (!turns.length) return;
      memoryIdleFlushRunningRef.current = true;
      const combinedUserText = turns.map((turn, index) => `Turn ${index + 1}: ${turn.userText}`).join("\n");
      const combinedAssistantText = turns.map((turn, index) => `Turn ${index + 1}: ${turn.assistantText}`).join("\n");
      try {
        Promise.resolve(updatePersonalityMemoryAfterTurn(combinedUserText, combinedAssistantText))
          .catch((error: unknown) => {
            appLog(`auto-pilot idle memory update failed ${error instanceof Error ? error.message : String(error)}`);
          })
          .finally(() => {
            memoryIdleFlushRunningRef.current = false;
          });
      } catch (error) {
        memoryIdleFlushRunningRef.current = false;
        appLog(`auto-pilot idle memory update failed ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 2500);
  }, [
    activeTaskType,
    brainStatus,
    isApproving,
    isAudioPlaying,
    isGeneratingImage,
    isStreaming,
    isTranscribing,
    speakingMessageId,
    updatePersonalityMemoryAfterTurn,
    userAutoPilot,
  ]);

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
    liveConversation,
    lastAutoSpokenAssistantIdRef,
    lastSpeechChunkPlaybackStartedRef,
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
    speakingMessageIdRef,
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
    selectedModelPath,
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
    assistantId: selectedPersonalityId,
    autoSpeechEligibleAssistantIdsRef,
    clearImage,
    chatDisplayLanguage,
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
    activeTaskTypeRef,
    setActiveTaskType,
    setIsGeneratingImage,
    setMessages,
    unloadLlmForTask,
    updateAssistantMessageById,
    updateLastAssistantMessage,
    userAvatar,
    userName,
  });

  const waitForConversationAudioIdle = async () => {
    const waitStartedAt = performance.now();
    while (
      performance.now() - waitStartedAt < 120_000 &&
      (
        speakingMessageIdRef.current ||
        isAudioPlayingRef.current ||
        activeTaskTypeRef.current === "voice"
      )
    ) {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
    return Math.round(performance.now() - waitStartedAt);
  };

  const waitForMessageSpeechStart = async (messageId: string) => {
    const waitStartedAt = performance.now();
    while (
      performance.now() - waitStartedAt < 25_000 &&
      (
        speakingMessageIdRef.current !== messageId ||
        !isAudioPlayingRef.current
      )
    ) {
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    return Math.round(performance.now() - waitStartedAt);
  };

  const waitForFinalSpeechChunkStart = async (messageId: string) => {
    const waitStartedAt = performance.now();
    while (
      performance.now() - waitStartedAt < 45_000 &&
      !(
        lastSpeechChunkPlaybackStartedRef.current &&
        lastSpeechChunkPlaybackStartedRef.current.messageId === messageId
      )
    ) {
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    return Math.round(performance.now() - waitStartedAt);
  };

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
    selectedUserProfileId,
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
    activeChatSessionId,
    updateChatSessionMessages,
    waitForConversationAudioIdle,
    waitForMessageSpeechStart,
    waitForFinalSpeechChunkStart,
  });

  useEffect(() => {
    if (speakingMessageId || isAudioPlaying || activeTaskType === "voice") {
      return;
    }
    userAutoPilotSpeechSettledAtRef.current = performance.now();
  }, [activeTaskType, isAudioPlaying, speakingMessageId]);

  useEffect(() => {
    if (!userAutoPilot || !settingsLoaded || firstStartupSetupNeeded) return;
    if (userAutoPilotDraftingRef.current || sendInFlightRef.current) return;
    if (isStreaming || isGeneratingImage || isApproving || isTranscribing) return;
    if (input.trim() || image) return;

    const visibleMessages = messages.filter((message) => extractMessageText(message.content).trim() || Array.isArray(message.content));
    const latest = visibleMessages[visibleMessages.length - 1];
    if (latest && latest.role !== "assistant") return;

    const speechStartedForLatest = Boolean(
      latest &&
      speakingMessageIdRef.current === latest.id &&
      isAudioPlayingRef.current,
    );
    const latestStillNeedsSpeech = latest ? autoSpeechEligibleAssistantIdsRef.current.has(latest.id) : false;
    if (latestStillNeedsSpeech && !speechStartedForLatest) return;
    if (
      activeTaskTypeRef.current !== "none" &&
      activeTaskTypeRef.current !== "llm" &&
      activeTaskTypeRef.current !== "voice"
    ) return;

    let cancelled = false;
    userAutoPilotDraftingRef.current = true;
    const speechSettleDelayMs = latest ? 0 : liveConversation ? 900 : 500;
    const elapsedSinceSpeechSettled = performance.now() - userAutoPilotSpeechSettledAtRef.current;
    const speechSettleWaitMs = Math.max(0, speechSettleDelayMs - elapsedSinceSpeechSettled);
    const baseDelayMs = visibleMessages.length === 0 ? 900 : latestStillNeedsSpeech ? 80 : 650;
    let timerStarted = false;
    const timer = window.setTimeout(async () => {
      timerStarted = true;
      const pendingUserMessageId = createMessageId();
      let removePendingAssistantBubble: (() => void) | null = null;
      const requestPairContext = {
        userProfileId: selectedUserProfileId,
        personalityId: selectedPersonalityId,
      };
      const updateAutoPilotMessages = (updater: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[])) => {
        if (typeof updateChatSessionMessages === "function" && activeChatSessionId) {
          updateChatSessionMessages(activeChatSessionId, updater, requestPairContext);
        } else {
          setMessages(updater as any);
        }
      };
      const removePendingUserBubble = () => {
        updateAutoPilotMessages((prev: ChatMessage[]) => prev.filter((message) => !(message.id === pendingUserMessageId && message.pending)));
      };
      try {
        updateAutoPilotMessages((prev: ChatMessage[]) => {
          if (prev.some((message) => message.id === pendingUserMessageId)) return prev;
          return [
            ...prev,
            {
              id: pendingUserMessageId,
              role: "user",
              speaker_id: selectedUserProfileId,
              content: "",
              pending: true,
              created_at: Date.now(),
            },
          ];
        });
        if (latest && latestStillNeedsSpeech) {
          const waitedForFinalMs = await waitForFinalSpeechChunkStart(latest.id);
          if (waitedForFinalMs > 250) {
            appLog(`auto-pilot waited for final speech chunk message=${latest.id} ms=${waitedForFinalMs}`);
          }
        }
        if (cancelled || !userAutoPilotRef.current) {
          removePendingUserBubble();
          return;
        }
        const ready = await ensureChatModelReady();
        if (!ready || cancelled || !userAutoPilotRef.current) {
          removePendingUserBubble();
          return;
        }

        setBrainStatus("Thinking");
        const userProfileName = selectedUserProfile?.name || userName || "User";
        const userProfileDescription = selectedUserProfile?.description || userDescription || "";
        const assistantProfile = selectedPersonalityPreset;
        const assistantName = assistantProfile?.name || "Assistant";
        const assistantDescription = personality || assistantProfile?.prompt || "";
        const recentHistory = visibleMessages.slice(-AUTOPILOT_HISTORY_MESSAGES).map((message) => {
          const text = extractMessageText(message.content).replace(/\s+/g, " ").trim();
          if (!text) return "";
          const speaker = message.role === "user" ? userProfileName : assistantName;
          return `${speaker}: ${text.slice(0, AUTOPILOT_HISTORY_CHARS)}`;
        }).filter(Boolean).join("\n");
        const instruction = [
          `You are writing the next chat message as ${userProfileName}.`,
          userProfileDescription ? `Profile for ${userProfileName}: ${userProfileDescription}` : "",
          `You are talking to ${assistantName}.`,
          assistantDescription ? `Profile for ${assistantName}: ${assistantDescription}` : "",
          "Write only one short next message that this character would naturally send.",
          "Keep it conversational, context-aware, and human. No labels, no analysis, no tool calls.",
          "Vary the length naturally. Usually keep it short; sometimes write a fuller reply if the moment needs it.",
          "Do not repeat or lightly rephrase this character's recent messages. Move the conversation forward.",
          "Match the current conversation language and relationship style.",
          visibleMessages.length === 0
            ? `This is a blank new conversation. Start with a natural greeting toward ${assistantName}.`
            : `Continue from the latest message by ${assistantName}.`,
        ].filter(Boolean).join("\n");
        const userDraftMaxTokens = randomAutoPilotMaxTokens();
        const userRecentTexts = visibleMessages
          .filter((message) => message.role === "user")
          .slice(-4)
          .map((message) => extractMessageText(message.content))
          .filter(Boolean);
        const repairAutoPilotMixedScriptDrift = async (rawText: string) => {
          const trimmed = rawText.trim();
          if (!trimmed) return "";
          if (!hasUnexpectedHanDrift(trimmed)) return cleanAssistantDisplayText(trimmed);
          try {
            const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                messages: [
                  {
                    role: "system",
                    content: [
                      "Repair a mixed-script model drift in one chat message.",
                      "Rewrite the message in the main language of the conversation.",
                      "Translate any unexpected foreign-script fragments into that language.",
                      "Preserve meaning, tone, names, relationship style, and intensity.",
                      "Do not add new events, facts, explanations, labels, or analysis.",
                      "Output only the repaired message.",
                    ].join("\n"),
                  },
                  {
                    role: "user",
                    content: [
                      recentHistory ? `Recent conversation:\n${recentHistory}` : "",
                      `Message to repair:\n${trimmed}`,
                    ].filter(Boolean).join("\n\n"),
                  },
                ],
                temperature: 0.25,
                top_k: Math.max(20, Math.min(topK || 40, 40)),
                top_p: Math.min(topP || 0.9, 0.9),
                min_p: minP,
                repeat_last_n: Math.max(repeatLastN, 128),
                repeat_penalty: Math.max(repeatPenalty, 1.1),
                max_tokens: Math.min(Math.max(160, estimateTokens(trimmed) + 80), Math.max(180, replyLength)),
                stream: false,
                chat_template_kwargs: {
                  enable_thinking: false,
                  thinking: false,
                },
              }),
            });
            if (!response.ok) return cleanAssistantDisplayText(trimmed);
            const repaired = cleanAssistantDisplayText(extractChatResponseText(await response.json()));
            if (repaired && !hasUnexpectedHanDrift(repaired)) {
              appLog("auto-pilot repaired mixed-script drift in draft");
              return repaired;
            }
          } catch (error) {
            appLog(`auto-pilot mixed-script repair failed ${error instanceof Error ? error.message : String(error)}`);
          }
          return cleanAssistantDisplayText(trimmed);
        };
        const requestUserDraft = async (avoidRepeat: boolean) => {
          const messagesForDraft = [
            { role: "system", content: avoidRepeat ? `${instruction}\nThe previous draft was too similar to a recent message. Write a clearly different next message while staying in character.` : instruction },
            ...(recentHistory ? [{ role: "user", content: `Conversation so far:\n${recentHistory}` }] : []),
            { role: "user", content: `Write ${userProfileName}'s next message now.` },
          ];
          const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: messagesForDraft,
              temperature: Math.max(0.62, Math.min(1.0, (samplingTemperature || 0.7) + (avoidRepeat ? 0.08 : 0))),
              top_k: topK,
              top_p: topP,
              min_p: minP,
              repeat_last_n: Math.max(repeatLastN, avoidRepeat ? 256 : 128),
              repeat_penalty: Math.max(repeatPenalty, avoidRepeat ? 1.16 : 1.1),
              max_tokens: Math.min(userDraftMaxTokens, Math.max(64, replyLength)),
              stop: [
                `\n${userProfileName}:`,
                `\n${assistantName}:`,
                "<|im_end|>",
                "<end_of_turn>",
              ],
              stream: false,
              chat_template_kwargs: {
                enable_thinking: false,
                thinking: false,
              },
            }),
          });
          if (!response.ok) {
            throw new Error(`Auto-pilot draft failed with status ${response.status}`);
          }
          return repairAutoPilotMixedScriptDrift(extractChatResponseText(await response.json()));
        };
        let text = await requestUserDraft(false);
        if (isTooSimilarToRecentSpeakerText(text, userRecentTexts)) {
          appLog("auto-pilot user draft repeated recent wording; retrying once");
          text = await requestUserDraft(true);
        }
        if (cancelled || !userAutoPilotRef.current) {
          removePendingUserBubble();
          return;
        }
        if (!text) throw new Error("Auto-pilot draft was empty.");
        appLog(`auto-pilot draft ready chars=${text.length}`);
        updateAutoPilotMessages((prev: ChatMessage[]) =>
          prev.map((message) =>
            message.id === pendingUserMessageId
              ? {
                  ...message,
                  content: text,
                  pending: false,
                  created_at: Date.now(),
                }
              : message,
          ),
        );
        if (cancelled || !userAutoPilotRef.current) return;
        let userSpeechPromise: Promise<void> | null = null;
        if (liveConversation && selectedUserProfile?.auto_speech !== false && text.trim()) {
          userSpeechPromise = speakMessageText(pendingUserMessageId, text, "user", { queued: true });
          void userSpeechPromise.catch((error: unknown) => {
            console.error("Auto-pilot user speech error:", error);
          });
          const waitedForStartMs = await waitForMessageSpeechStart(pendingUserMessageId);
          if (waitedForStartMs > 250) {
            appLog(`auto-pilot waited for user speech start message=${pendingUserMessageId} ms=${waitedForStartMs}`);
          }
          const waitedForUserFinalMs = await waitForFinalSpeechChunkStart(pendingUserMessageId);
          if (waitedForUserFinalMs > 250) {
            appLog(`auto-pilot waited for user final speech chunk message=${pendingUserMessageId} ms=${waitedForUserFinalMs}`);
          }
          void userSpeechPromise.catch(() => undefined);
        }
        if (cancelled || !userAutoPilotRef.current) return;

        const pendingAssistantMessageId = createMessageId();
        const assistantStartedAt = performance.now();
        updateAutoPilotMessages((prev: ChatMessage[]) => {
          if (prev.some((message) => message.id === pendingAssistantMessageId)) return prev;
          return [
            ...prev,
            {
              id: pendingAssistantMessageId,
              role: "assistant",
              speaker_id: selectedPersonalityId,
              content: "",
              pending: true,
              created_at: Date.now(),
            },
          ];
        });
        removePendingAssistantBubble = () => {
          updateAutoPilotMessages((prev: ChatMessage[]) => prev.filter((message) => message.id !== pendingAssistantMessageId));
        };
        const assistantReady = await ensureChatModelReady();
        if (!assistantReady || cancelled || !userAutoPilotRef.current) {
          removePendingAssistantBubble();
          return;
        }
        setBrainStatus("Thinking");
        const conversationAfterUser: ChatMessage[] = [
          ...visibleMessages,
          {
            id: pendingUserMessageId,
            role: "user",
            speaker_id: selectedUserProfileId,
            content: text,
            created_at: Date.now(),
          },
        ];
        const assistantHistory = conversationAfterUser.slice(-AUTOPILOT_HISTORY_MESSAGES).map((message) => {
          const messageText = extractMessageText(message.content).replace(/\s+/g, " ").trim();
          if (!messageText) return "";
          const speaker = message.role === "user" ? userProfileName : assistantName;
          return `${speaker}: ${messageText.slice(0, AUTOPILOT_HISTORY_CHARS)}`;
        }).filter(Boolean).join("\n");
        const assistantInstruction = [
          `You are writing the next chat message as ${assistantName}.`,
          assistantDescription ? `Profile for ${assistantName}: ${assistantDescription}` : "",
          `You are talking to ${userProfileName}.`,
          userProfileDescription ? `Profile for ${userProfileName}: ${userProfileDescription}` : "",
          "Write only one short next message that this character would naturally send.",
          "Keep it conversational, context-aware, and human. No labels, no analysis, no tool calls.",
          "Vary the length naturally. Usually keep it short; sometimes write a fuller reply if the moment needs it.",
          "Do not repeat or lightly rephrase this character's recent messages. Move the conversation forward.",
          "Match the current conversation language and relationship style.",
          `Continue from the latest message by ${userProfileName}.`,
        ].filter(Boolean).join("\n");
        const assistantDraftMaxTokens = randomAutoPilotMaxTokens();
        const assistantRecentTexts = conversationAfterUser
          .filter((message) => message.role === "assistant")
          .slice(-4)
          .map((message) => extractMessageText(message.content))
          .filter(Boolean);
        const requestAssistantDraft = async (avoidRepeat: boolean) => {
          const messagesForDraft = [
            { role: "system", content: avoidRepeat ? `${assistantInstruction}\nThe previous draft was too similar to a recent message. Write a clearly different next message while staying in character.` : assistantInstruction },
              ...(assistantHistory ? [{ role: "user", content: `Conversation so far:\n${assistantHistory}` }] : []),
              { role: "user", content: `Write ${assistantName}'s next message now.` },
          ];
          const assistantResponse = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: messagesForDraft,
              temperature: Math.max(0.62, Math.min(1.0, (samplingTemperature || 0.7) + (avoidRepeat ? 0.08 : 0))),
              top_k: topK,
              top_p: topP,
              min_p: minP,
              repeat_last_n: Math.max(repeatLastN, avoidRepeat ? 256 : 128),
              repeat_penalty: Math.max(repeatPenalty, avoidRepeat ? 1.16 : 1.1),
              max_tokens: Math.min(assistantDraftMaxTokens, Math.max(64, replyLength)),
              stop: [
                `\n${assistantName}:`,
                `\n${userProfileName}:`,
                "<|im_end|>",
                "<end_of_turn>",
              ],
              stream: false,
              chat_template_kwargs: {
                enable_thinking: false,
                thinking: false,
              },
            }),
          });
          if (!assistantResponse.ok) {
            throw new Error(`Auto-pilot assistant draft failed with status ${assistantResponse.status}`);
          }
          return repairAutoPilotMixedScriptDrift(extractChatResponseText(await assistantResponse.json()));
        };
        let assistantText = await requestAssistantDraft(false);
        if (isTooSimilarToRecentSpeakerText(assistantText, assistantRecentTexts)) {
          appLog("auto-pilot assistant draft repeated recent wording; retrying once");
          assistantText = await requestAssistantDraft(true);
        }
        if (cancelled || !userAutoPilotRef.current) {
          removePendingAssistantBubble();
          return;
        }
        if (!assistantText) throw new Error("Auto-pilot assistant draft was empty.");
        appLog(`auto-pilot assistant draft ready chars=${assistantText.length}`);
        const completedAt = Date.now();
        updateAutoPilotMessages((prev: ChatMessage[]) =>
          prev.map((message) =>
            message.id === pendingAssistantMessageId
              ? {
                  ...message,
                  content: assistantText,
                  pending: false,
                  completed_at: completedAt,
                  duration_ms: Math.max(0, Math.round(performance.now() - assistantStartedAt)),
                }
              : message,
          ),
        );
        queueAutoPilotMemoryTurn(text, assistantText);
        if (liveConversation) {
          autoSpeechEligibleAssistantIdsRef.current.add(pendingAssistantMessageId);
        }
      } catch (error) {
        removePendingUserBubble();
        removePendingAssistantBubble?.();
        console.error("Auto-pilot error:", error);
        appLog(`auto-pilot error=${error instanceof Error ? error.message : String(error)}`);
        setComposerNotice("Auto-pilot paused because it could not draft a reply.");
      } finally {
        userAutoPilotDraftingRef.current = false;
        if (!sendInFlightRef.current && !isStreaming) {
          setBrainStatus("Ready");
        }
      }
    }, baseDelayMs + speechSettleWaitMs);

    return () => {
      if (!timerStarted) {
        cancelled = true;
      }
      window.clearTimeout(timer);
      if (!timerStarted) {
        userAutoPilotDraftingRef.current = false;
      }
    };
  }, [
    activeChatSessionId,
    activeTaskType,
    firstStartupSetupNeeded,
    image,
    input,
    isApproving,
    isGeneratingImage,
    isStreaming,
    isTranscribing,
    isAudioPlaying,
    selectedPersonalityId,
    selectedUserProfileId,
    settingsLoaded,
    speakingMessageId,
    userAutoPilot,
    liveConversation,
  ]);
  const { stopActiveResponse } = useChatStop({
    activeChatAbortRef,
    activeChatRequestRef,
    sendInFlightRef,
    setBrainStatus,
    setComposerNotice,
    setIsStreaming,
  });
  const longTaskLabel = isGeneratingImage
    ? "Image generation"
    : isTranscribing
      ? "Voice transcription"
      : activeTaskTypeRef.current === "voice" && !isAudioPlaying
        ? "Voice generation"
        : brainStatus === "Loading" || modelLoadStatus.state === "starting" || modelLoadStatus.state === "loading"
          ? "Model loading"
          : isStreaming || brainStatus === "Thinking"
            ? "Chat response"
            : voiceSetupStatus.state !== "idle" && !voiceSetupStatus.ready
              ? "Voice setup"
              : omniVoiceStatus.state !== "idle" && !omniVoiceStatus.ready
                ? "Voice engine setup"
                : "Task";
  const longTaskBusy =
    isGeneratingImage ||
    isTranscribing ||
    isStreaming ||
    brainStatus === "Thinking" ||
    brainStatus === "Loading" ||
    modelLoadStatus.state === "starting" ||
    modelLoadStatus.state === "loading" ||
    (activeTaskTypeRef.current === "voice" && !isAudioPlaying) ||
    (voiceSetupStatus.state !== "idle" && !voiceSetupStatus.ready) ||
    (omniVoiceStatus.state !== "idle" && !omniVoiceStatus.ready);
  const {
    longTaskNotice,
    longTaskLabel: longTaskNoticeLabel,
    keepLongTaskRunning,
  } = useLongTaskNotice({
    busy: longTaskBusy,
    taskLabel: longTaskLabel,
  });
  const stopLongTask = () => {
    stopActiveResponse();
    voicePlaybackRequestRef.current += 1;
    stopActiveAudio();
    setSpeakingMessageId(null);
    setPreviewingVoicePath(null);
    setIsGeneratingImage(false);
    activeTaskTypeRef.current = "none";
    setActiveTaskType("none");
    void invoke("stop_omnivoice_engine").catch((error) => console.error("Stop voice engine error:", error));
    void invoke("stop_image_generation").catch((error) => console.error("Stop image generation error:", error));
    if (brainStatus === "Loading" || brainStatus === "Thinking" || isStreaming) {
      void invoke("stop_model")
        .then(() => {
          setBrainStatus("Idle");
          setModelLoadStatus({
            state: "idle",
            message: "No chat brain is loaded.",
            progress: 0,
          });
        })
        .catch((error) => console.error("Stop model error:", error));
    }
    setComposerNotice("Stopped.");
  };

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
    quickImageMode,
    isGeneratingImage,
    quickImagePrompt,
    assistantAvatar,
    userAvatar,
    recordClientToolRun,
    setComposerNotice,
    activeTaskTypeRef,
    setActiveTaskType,
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
    userAutoPilot,
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
    mediaPlayerPanelOpen,
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
    clearToolRuns,
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
    quickImageMode,
    setQuickImageMode,
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
    setMediaPlayerPanelOpen,
    setTelegramBotToken,
    setTelegramGuestDraft,
    setTelegramOwnerId,
    setTelegramPanelOpen,
    setThemePickerOpen,
    setToolRunsOpen,
    setTopK,
    setTopP,
    setUserAutoPilot,
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
    mediaPlayerBusy,
    mediaPlayerPanelOpen,
    mediaPlayerStatus,
    refreshMediaPlayerStatus,
    mediaPlayerPlay,
    mediaPlayerPause,
    mediaPlayerNext,
    mediaPlayerPrevious,
    toggleAutomationJob,
    topK,
    topP,
    updateActiveCharacterVoicePath,
    updateActiveUserProfile,
    updateActiveUserVoicePath,
    updateSelectedPersonalityPreset,
    userAvatar,
    userAutoPilot,
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
      longTaskLabel={longTaskNoticeLabel}
      longTaskNotice={longTaskNotice}
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
      setupScreenOpen={setupScreenOpen}
      setupTierOverride={setupTierOverride}
      showScrollBottom={showScrollBottom}
      speakMessageText={speakMessageText}
      speakingMessageId={speakingMessageId}
      stopActiveAudio={stopActiveAudio}
      stopActiveResponse={stopActiveResponse}
      stopLongTask={stopLongTask}
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
      keepLongTaskRunning={keepLongTaskRunning}
    />
  );
}

export default App;
