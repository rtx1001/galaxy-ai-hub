import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import brandLogo from "./assets/logo-gah.svg";
import { ChatContentPart, ChatMessage, ModelLoadStatus } from "./types";
import { DownloadIcon } from "./components/Icons";
import { IconButton } from "./components/UI";
import { SetupScreen } from "./components/SetupScreen";
import { StartupScreen, SettingsLoadErrorScreen } from "./components/AppScreens";
import { AutomationEditorModal } from "./components/AutomationEditorModal";
import { LeftPanelContent, RightPanelContent } from "./components/SidePanelContent";
import { ConversationPane } from "./components/ConversationPane";
import { ChatComposer } from "./components/ChatComposer";
import { AppHeader } from "./components/AppHeader";
import { AvatarFileInputs } from "./components/AvatarFileInputs";
import { AppSidePanel } from "./components/AppSidePanel";
import { DropImageOverlay } from "./components/DropImageOverlay";
import { FreshChatConfirmModal, GoogleEventModals, ImageViewerOverlay } from "./components/AppOverlays";
import { useAvailableUpdate } from "./hooks/useAvailableUpdate";
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
import { useDropdownDismiss } from "./hooks/useDropdownDismiss";
import { useMissingTooltips } from "./hooks/useMissingTooltips";
import { useTrayControls } from "./hooks/useTrayControls";
import { useChatMessageMutations } from "./hooks/useChatMessageMutations";
import { useModelLibraryActions } from "./hooks/useModelLibraryActions";
import { useAutomationRunner } from "./hooks/useAutomationRunner";
import { useVoicePlaybackManager } from "./hooks/useVoicePlaybackManager";
import { useAutoSpeechQueue } from "./hooks/useAutoSpeechQueue";
import { usePersonalityMemory } from "./hooks/usePersonalityMemory";
import { useChatSessions } from "./hooks/useChatSessions";
import { useStoredImageHydration } from "./hooks/useStoredImageHydration";
import { useAppSettingsSave } from "./hooks/useAppSettingsSave";
import { useCharacterFiles } from "./hooks/useCharacterFiles";
import { useAppBackgroundRefresh } from "./hooks/useAppBackgroundRefresh";
import { useAppSettingsLoad } from "./hooks/useAppSettingsLoad";
import { useProfileActions } from "./hooks/useProfileActions";
import { useActionProposals } from "./hooks/useActionProposals";
import { useImageGeneration } from "./hooks/useImageGeneration";
import { useTelegramControls } from "./hooks/useTelegramControls";
import { useVoiceFolderActions } from "./hooks/useVoiceFolderActions";
import { useSetupInstallActions } from "./hooks/useSetupInstallActions";
import { useQuickImageGenerate } from "./hooks/useQuickImageGenerate";
import { useRuntimePromptBuilders } from "./hooks/useRuntimePromptBuilders";
import { useChatStop } from "./hooks/useChatStop";
import {
  AgentReactResult,
  DEFAULT_SETTINGS,
  DisplayLanguage,
  ModelLibraryEntry,
  ModelStatus,
  PersonalityPreset,
  SendOptions,
  UserProfilePreset,
  buildBrainMessages,
  buildToolAgentMessages,
  createMessageId,
  detectDisplayLanguage,
  estimateTokens,
  extractChatResponseText,
  extractChoiceText,
  extractMessageText,
  extractTextValue,
  findPendingActionProposal,
  findPendingImageProposal,
  formatReactThinking,
  getDefaultLocalContext,
  googleEventMatchesDate,
  isExplicitApprovalText,
  isGpuFitError,
  sleep,
  stripThinkBlocks,
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
    setupProgress,
    setSetupProgress,
    activeSetupTier,
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

  const currentModelEntry =
    availableModels.find((model) => model.path === selectedModelPath) ?? null;
  const currentModelName =
    currentModelEntry?.name || selectedModel || (selectedModelPath ? "Selected brain" : "No model selected");
  const localContext = getDefaultLocalContext();
  const selectedUserProfile =
    userProfiles.find((profile) => profile.id === selectedUserProfileId) ?? userProfiles[0] ?? DEFAULT_SETTINGS.user_profiles[0];
  const selectedPersonalityPreset =
    personalityPresets.find((preset) => preset.id === selectedPersonalityId) ?? personalityPresets[0];
  const assistantAvatar = selectedPersonalityPreset?.avatar || personalityAvatar || "";
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

  const collectBrainDiagnostics = async () => {
    const parts = [
      `brainStatus=${brainStatus}`,
      `engineStatus=${engineStatus}`,
      `modelState=${modelLoadStatus.state}`,
      `selectedModel=${selectedModelPath || "none"}`,
      `activeTask=${activeTaskTypeRef.current}`,
    ];
    try {
      const healthStartedAt = performance.now();
      const health = await fetch("http://127.0.0.1:8080/health", { cache: "no-store" });
      parts.push(`health=${health.status}`);
      parts.push(`health_ms=${Math.round(performance.now() - healthStartedAt)}`);
      parts.push(`health_body=${JSON.stringify((await health.text()).slice(0, 300))}`);
    } catch (error) {
      parts.push(`health_error=${JSON.stringify(error instanceof Error ? error.message : String(error))}`);
    }
    try {
      const status = await invoke<ModelLoadStatus>("get_model_load_status");
      parts.push(`load_status=${status.state}`);
      parts.push(`load_progress=${status.progress}`);
      parts.push(`load_message=${JSON.stringify(status.message)}`);
    } catch (error) {
      parts.push(`load_status_error=${JSON.stringify(error instanceof Error ? error.message : String(error))}`);
    }
    return parts.join(" ");
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

  const unloadLlmForTask = async (taskType: "voice" | "image") => {
    if (activeTaskTypeRef.current === taskType) {
      return;
    }

    stopActiveAudio();

    if (activeTaskTypeRef.current === "llm" || brainStatus === "Ready" || brainStatus === "Thinking") {
      setComposerNotice(taskType === "voice" ? "Preparing voice playback..." : "Preparing image creation...");
      try {
        await invoke<ModelStatus>("stop_model");
      } catch (error) {
        console.error("Model stop error:", error);
      }
      setBrainStatus("Idle");
      setModelLoadStatus({
        state: "idle",
        message: "No chat brain is loaded.",
        progress: 0,
      });
    }

    activeTaskTypeRef.current = taskType;
    setActiveTaskType(taskType);
  };
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

  const waitForModelReady = async (message = "Loading the selected brain...") => {
    const deadline = Date.now() + 10 * 60 * 1000;
    setBrainStatus("Loading");

    while (Date.now() < deadline) {
      const status = await invoke<ModelLoadStatus>("get_model_load_status");
      setModelLoadStatus(status);

      if (status.state === "ready") {
        setBrainStatus("Ready");
        return;
      }

      if (status.state === "error") {
        throw new Error(status.message);
      }

      try {
        const healthRes = await fetch("http://127.0.0.1:8080/health");
        if (healthRes.ok) {
          setModelLoadStatus({
            state: "ready",
            message: "Brain loaded and ready.",
            progress: 100,
          });
          setBrainStatus("Ready");
          return;
        }
      } catch {
        // keep waiting
      }

      setModelLoadStatus((prev) => ({
        state: prev.state || "loading",
        message: prev.message || message,
        progress: Math.max(prev.progress, 8),
      }));
      await sleep(1500);
    }

    throw new Error("Timed out waiting for the brain to become ready.");
  };

  const generateNaturalImageCompletionReply = async (
    prompt: string,
    mode: string,
    imageDataUrl: string,
  ) => {
    const activePersonality =
      personalityPresets.find((preset) => preset.id === selectedPersonalityId) ?? personalityPresets[0];
    const userLanguageHint =
      chatDisplayLanguage === "vi"
        ? "Reply in the same Vietnamese tone the user is using."
        : "Reply in the same language and tone the user is using.";
    const profilePrompt = [
      `Assistant profile:
Name: ${activePersonality?.name || "Assistant"}
Instructions:
${personality || activePersonality?.prompt || "You are a helpful assistant."}`,
      characterSoul.trim() ? `\nAdditional character context:\n${characterSoul.trim()}` : "",
      userName.trim() || userDescription.trim()
        ? `\nUser profile:\nName: ${userName.trim() || "User"}\nAbout user: ${userDescription.trim() || ""}`
        : "",
      `\nTask: You just finished creating an image for the user. Write one short, natural assistant message for the chat bubble. ${userLanguageHint} Do not mention tools, prompts, files, generation engines, or approval. Do not ask a generic follow-up unless it feels natural. Keep it under 24 words.`,
    ].join("");

    const userContent = hasVision
      ? [
          {
            type: "text",
            text: `The created image is attached. Original image request mode: ${mode}. Visual request: ${prompt}`,
          },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ]
      : `Original image request mode: ${mode}. Visual request: ${prompt}`;

    try {
      await ensureChatModelReady();
      const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: profilePrompt },
            { role: "user", content: userContent },
          ],
          temperature: Math.min(0.8, Math.max(0.45, samplingTemperature)),
          top_k: topK,
          top_p: topP,
          min_p: minP,
          repeat_last_n: repeatLastN,
          repeat_penalty: repeatPenalty,
          max_tokens: 64,
          stream: false,
          chat_template_kwargs: {
            enable_thinking: false,
            thinking: false,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Image reply failed with status ${response.status}`);
      }

      const reply = stripThinkBlocks(extractChatResponseText(await response.json()))
        .replace(/\s+/g, " ")
        .trim();
      return reply;
    } catch (error) {
      console.error("Image completion reply error:", error);
      appLog(`image completion reply failed error=${error instanceof Error ? error.message : String(error)}`);
      return "";
    }
  };

  const ensureChatModelReady = async () => {
    const targetModelPath = selectedModelPath || availableModels[0]?.path || "";
    if (!targetModelPath) {
      setComposerNotice("Choose a GGUF folder with a brain first.");
      return false;
    }

    if (engineStatus !== "ready") {
      setPendingAutoLoadPath(targetModelPath);
      setComposerNotice("The brain engine is still getting ready.");
      return false;
    }

    let shouldLoadModel =
      activeTaskTypeRef.current !== "llm" ||
      brainStatus !== "Ready" ||
      selectedModelPath !== targetModelPath;

    if (!shouldLoadModel) {
      try {
        const healthRes = await fetch("http://127.0.0.1:8080/health");
        shouldLoadModel = !healthRes.ok;
      } catch {
        shouldLoadModel = true;
      }
    }

    if (shouldLoadModel) {
      stopActiveAudio();
      setComposerNotice("Loading the chat brain...");
      await invoke("stop_omnivoice_engine").catch(() => undefined);
      await loadModelPath(targetModelPath);
    }

    return true;
  };

  const updateEngineForVision = async () => {
    if (!systemInfo) {
      throw new Error("System info is not ready yet.");
    }

    setEngineStatus("downloading");
    setModelLoadStatus({
      state: "loading",
      message: "Updating the brain engine so it can look at pictures...",
      progress: 5,
    });

    const result = await invoke<{ success: boolean; message: string }>("download_engine", {
      hasNvidiaGpu: systemInfo.has_nvidia_gpu,
      forceRefresh: true,
    });

    if (!result.success) {
      setEngineStatus("error");
      throw new Error(result.message);
    }

    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      const info = await refreshEngineInfo();
      if (info.ready && info.supports_mmproj) {
        setEngineStatus("ready");
        setEngineErrorMsg("");
        return;
      }
      await sleep(4000);
    }

    throw new Error("Timed out while updating the picture-aware brain engine.");
  };

  const ensureRuntimeEngineReady = async () => {
    const hasNvidiaGpu = systemInfo?.has_nvidia_gpu ?? false;
    try {
      const ready = await invoke<boolean>("check_engine_ready");
      if (ready) {
        await refreshEngineInfo();
        setEngineStatus("ready");
        setEngineErrorMsg("");
        return true;
      }
    } catch (error) {
      console.error("Engine ready check error:", error);
    }

    setEngineStatus("downloading");
    setSetupNotice("Preparing the brain engine for this PC...");
    const result = await invoke<{ success: boolean; message: string }>("download_engine", {
      hasNvidiaGpu,
      forceRefresh: false,
    });
    if (!result.success) {
      setEngineStatus("error");
      setEngineErrorMsg(result.message);
      throw new Error(result.message);
    }

    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      const ready = await invoke<boolean>("check_engine_ready");
      if (ready) {
        await refreshEngineInfo();
        setEngineStatus("ready");
        setEngineErrorMsg("");
        return true;
      }
      setSetupNotice("Downloading and preparing the brain engine...");
      await sleep(3000);
    }

    setEngineStatus("error");
    setEngineErrorMsg("The brain engine did not become ready in time.");
    throw new Error("The brain engine did not become ready in time.");
  };

  const loadModelPath = async (modelPath: string) => {
    if (!modelPath) {
      return;
    }

    if (engineStatus !== "ready") {
      setPendingAutoLoadPath(modelPath);
      setComposerNotice("The brain engine is still getting ready.");
      return;
    }

    if (modelLoadPromiseRef.current) {
      appLog(
        `model-load join requested=${modelPath} active=${modelLoadTargetRef.current || "unknown"}`,
      );
      await modelLoadPromiseRef.current;
      if (modelLoadTargetRef.current === modelPath || selectedModelPath === modelPath) {
        return;
      }
    }

    modelLoadTargetRef.current = modelPath;
    const loadPromise = (async () => {

    setSelectedModelPath(modelPath);
    setBrainStatus("Loading");
    activeTaskTypeRef.current = "llm";
    setActiveTaskType("llm");
    setModelLoadStatus({
      state: "starting",
      message: "Launching the selected brain...",
      progress: 2,
    });

    try {
      let activeGpuLayers = preferredChatGpuLayers;
      const effectiveContextSize = Math.max(memorySize, MIN_CHAT_CONTEXT_SIZE);
      if (effectiveContextSize !== memorySize) {
        setMemorySize(effectiveContextSize);
      }

      let result = await invoke<ModelStatus>("start_model", {
        modelPath,
        contextSize: effectiveContextSize,
        threads: recommendedThreads,
        gpuLayers: activeGpuLayers,
        reducedGpuLayers: reducedTaskGpuLayers,
      });

      if (result.status === "engine_update_required") {
        setModelLoadStatus({
          state: "loading",
          message: result.message,
          progress: 4,
        });
        await updateEngineForVision();
        result = await invoke<ModelStatus>("start_model", {
          modelPath,
          contextSize: effectiveContextSize,
          threads: recommendedThreads,
          gpuLayers: activeGpuLayers,
          reducedGpuLayers: reducedTaskGpuLayers,
        });
      }

      if (result.status !== "success") {
        throw new Error(result.message);
      }

      setSelectedModel(result.model_name);
      setHasVision(result.has_vision);
      activeTaskTypeRef.current = "llm";
      setActiveTaskType("llm");
      {
        const notices: string[] = [];
        if (!result.has_vision) {
          notices.push("This brain can chat, but it cannot look at pictures.");
        }
        if (result.gpu_layers < activeGpuLayers) {
          notices.push("Loaded with automatic memory placement to keep the main brain stable.");
        }
        setComposerNotice(notices.join(" "));
      }
      try {
        await waitForModelReady();
      } catch (error) {
        const fallbackGpuLayers = reducedTaskGpuLayers || 0;
        if (
          activeGpuLayers > fallbackGpuLayers &&
          fallbackGpuLayers > 0 &&
          isGpuFitError(error)
        ) {
          activeGpuLayers = fallbackGpuLayers;
          setModelLoadStatus({
            state: "starting",
            message: "The brain was too large for full graphics power. Trying a safer graphics setting...",
            progress: 2,
          });
          result = await invoke<ModelStatus>("start_model", {
            modelPath,
            contextSize: effectiveContextSize,
            threads: recommendedThreads,
            gpuLayers: activeGpuLayers,
            reducedGpuLayers: fallbackGpuLayers,
          });
          if (result.status !== "success") {
            throw new Error(result.message);
          }
          setSelectedModel(result.model_name);
          setHasVision(result.has_vision);
          activeTaskTypeRef.current = "llm";
          setActiveTaskType("llm");
          {
            const notices = [
              "Loaded with a safer graphics setting because full graphics power did not fit.",
            ];
            if (!result.has_vision) {
              notices.push("This brain can chat, but it cannot look at pictures.");
            }
            if (result.gpu_layers < activeGpuLayers) {
              notices.push("The engine also trimmed GPU layers automatically.");
            }
            setComposerNotice(notices.join(" "));
          }
          await waitForModelReady("Trying a safer graphics setting...");
        } else {
          throw error;
        }
      }
      setPendingAutoLoadPath(null);
    } catch (error) {
      console.error("Brain load error:", error);
      activeTaskTypeRef.current = "none";
      setActiveTaskType("none");
      setBrainStatus("Error");
      setModelLoadStatus({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
        progress: 100,
      });
    }
    })();
    modelLoadPromiseRef.current = loadPromise;
    try {
      await loadPromise;
    } finally {
      if (modelLoadPromiseRef.current === loadPromise) {
        modelLoadPromiseRef.current = null;
        modelLoadTargetRef.current = "";
      }
    }
  };

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

  const handleSend = async (options: SendOptions = {}) => {
    const promptText = options.text ?? composerInputRef.current?.value ?? input;
    const attachedImage = options.imageDataUrl ?? (options.text ? null : image);
    const attachedImagePath = options.imagePath ?? imagePath;
    if ((!promptText.trim() && !attachedImage) || isStreaming) {
      return;
    }

    if (sendInFlightRef.current) {
      appLog("Blocked a duplicate send event while another chat request was already running.");
      return;
    }

    if (liveConversation) {
      ensureAudioPlaybackUnlocked().catch(() => null);
    }

    sendInFlightRef.current = true;
    const requestId = activeChatRequestRef.current + 1;
    activeChatRequestRef.current = requestId;
    const isRequestStale = () => activeChatRequestRef.current !== requestId;

    let content: string | ChatContentPart[] = promptText;
    if (attachedImage) {
      content = [
        { type: "text", text: promptText || "Describe this image." },
        { type: "image_url", image_url: { url: attachedImage, local_path: attachedImagePath ?? undefined } },
      ];
    }

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content,
    };

    if (!options.silentUser) {
      setMessages((prev) => [...prev, userMessage]);
    }
    if (!options.text) {
      setComposerText("");
    }
    if (!options.silentUser && liveConversationRef.current && selectedUserProfile?.auto_speech !== false && typeof content === "string" && content.trim()) {
      void speakMessageText(userMessage.id, content, "user").catch((error) => {
        console.error("Live user speech error:", error);
      });
    }

    if (!attachedImage && typeof content === "string" && isExplicitApprovalText(content)) {
      const pendingImageProposal = findPendingImageProposal(messages);
      if (pendingImageProposal) {
        void handleGenerateImage(
          pendingImageProposal.proposal.prompt,
          pendingImageProposal.proposal.mode,
          pendingImageProposal.proposal.mask_prompt,
        );
        sendInFlightRef.current = false;
        return;
      }
      const pendingActionProposal = findPendingActionProposal(messages);
      if (pendingActionProposal) {
        void approveActionProposal(
          pendingActionProposal.messageId,
          pendingActionProposal.partIndex,
          pendingActionProposal.proposal,
        );
        sendInFlightRef.current = false;
        return;
      }
    }

    const assistantMessageId = createMessageId();
    setComposerNotice("");
    const newMessages: ChatMessage[] = [...messages, userMessage];
    setMessages((prev) => [...prev, { id: assistantMessageId, role: "assistant", content: "" }]);
    if (attachedImage && !options.imageDataUrl) {
      clearImage();
    }
    setIsStreaming(true);
    setBrainStatus("Loading");

    const temperature = samplingTemperature;
    let generatedText = "";
    let fallbackGeneratedText = "";
    let generatedThinking = "";
    let failed = false;
    let lastUiFlush = 0;
    const flushStreamedText = (force = false) => {
      if (isRequestStale()) return;
      const now = Date.now();
      if (!force && now - lastUiFlush < 45) {
        return;
      }
      lastUiFlush = now;
      updateLastAssistantMessage((last) => ({
        ...last,
        content: generatedText,
      }));
    };

    try {
      if (isRequestStale()) return;
      const ready = await ensureChatModelReady();
      if (!ready) {
        throw new Error("The chat brain is not ready yet.");
      }

      if (attachedImage && !hasVision) {
        throw new Error("This brain cannot look at pictures yet.");
      }

      setBrainStatus("Thinking");
      const activePersonality =
        personalityPresets.find((preset) => preset.id === selectedPersonalityId) ?? personalityPresets[0];
      const profilePrompt = [
        `Assistant profile:
Name: ${activePersonality?.name || "Assistant"}
Instructions:
${personality || activePersonality?.prompt || "You are a helpful assistant."}`,
        characterSoul.trim() ? `\nAdditional character context:\n${characterSoul.trim()}` : "",
        personalityMemory.trim()
          ? `\nConversation memory:
${personalityMemory.trim()}`
          : "",
        userName.trim() || userDescription.trim()
          ? `\nUser profile:\nName: ${userName.trim() || "User"}\nAbout user: ${userDescription.trim() || ""}`
          : "",
        `\nCurrent date: ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`,
      ].join("");
      const requestMessages = buildBrainMessages(profilePrompt, newMessages, hasVision);
      const toolAgentMessages = buildToolAgentMessages(newMessages);
      setLastContextTokens(
        [
          ...requestMessages.filter((message) => message.role === "system"),
          ...toolAgentMessages,
        ].reduce((total, message) => {
          const content = Array.isArray(message.content)
            ? extractMessageText(message.content)
            : message.content;
          return total + estimateTokens(content);
        }, 0),
      );
      const generationStartedAt = performance.now();

      if (!attachedImage) {
        setComposerNotice("Thinking with tools...");
        appLog(
          `chat-trace request model=${selectedModelPath || "none"} thinking=${thinkingEnabled} messages=${toolAgentMessages.length}/${newMessages.length} user=${JSON.stringify(promptText).slice(0, 600)}`,
        );
        collectBrainDiagnostics()
          .then((diagnostics) => appLog(`chat-diagnostics before_agent ${diagnostics}`))
          .catch(() => {});
        const reactResult = await invoke<AgentReactResult>("agent_jan_chat", {
          runtimePrompt: profilePrompt,
          contextBlock: buildSystemContextBlock(),
          messages: toolAgentMessages,
          folders: linkedFolders,
          googleClientId,
          googleClientSecret,
          temperature,
          topK,
          topP,
          minP,
          repeatLastN,
          repeatPenalty,
          maxTokens: replyLength,
          thinkingEnabled,
        });
        if (isRequestStale()) {
          return;
        }
        if (reactResult.tool_trace?.length) {
          refreshToolRuns().catch((error) => console.error("Tool activity refresh error:", error));
        }
        generatedText = reactResult.answer;
        generatedThinking = thinkingEnabled ? formatReactThinking(reactResult) : "";
        appLog(
          `chat-trace response tool=${reactResult.tool_used || "none"} answer=${JSON.stringify(reactResult.answer || "").slice(0, 800)} thinking=${generatedThinking ? "yes" : "no"}`,
        );
        if (options.autoApproveActions && reactResult.action_proposal) {
          const rawResult = await executeActionProposal(reactResult.action_proposal);
          generatedText = await naturalizeSystemResult(promptText, rawResult);
          const finalizedAssistantIds = finalizeAssistantMessageById(assistantMessageId, (last) => ({
            ...last,
            content: generatedText,
            thinking: thinkingEnabled ? generatedThinking || last.thinking : undefined,
          }));
          const elapsedSeconds = Math.max(0.1, (performance.now() - generationStartedAt) / 1000);
          setLastTokenSpeed(estimateTokens(generatedText) / elapsedSeconds);
          setBrainStatus("Ready");
          setComposerNotice("");
          await updatePersonalityMemoryAfterTurn(promptText, generatedText);
          if (liveConversationRef.current) {
            finalizedAssistantIds.forEach((id) => autoSpeechEligibleAssistantIdsRef.current.add(id));
          }
          return;
        }
        const structuredParts: ChatContentPart[] = [{ type: "text", text: generatedText }];
        if (reactResult.cards?.length) {
          structuredParts.push({ type: "tool_result_cards", cards: reactResult.cards });
        }
        if (reactResult.file_preview) {
          structuredParts.push({ type: "file_preview", file_preview: reactResult.file_preview });
        }
        if (reactResult.image_proposal) {
          structuredParts.push({ type: "image_proposal", image_proposal: reactResult.image_proposal });
        }
        if (reactResult.action_proposal) {
          structuredParts.push({ type: "action_proposal", action_proposal: reactResult.action_proposal });
        }
        const finalizedAssistantIds = finalizeAssistantMessageById(assistantMessageId, (last) => ({
          ...last,
          content: structuredParts.length > 1 ? structuredParts : generatedText,
          thinking: thinkingEnabled ? generatedThinking || last.thinking : undefined,
        }));
        if (reactResult.file_preview) {
          enrichPreviewPerception(assistantMessageId, reactResult.file_preview).catch((error) =>
            console.error("Preview perception enrichment error:", error),
          );
        }
        const elapsedSeconds = Math.max(0.1, (performance.now() - generationStartedAt) / 1000);
        setLastTokenSpeed(estimateTokens(generatedText) / elapsedSeconds);
        setBrainStatus("Ready");
        setComposerNotice("");
        await updatePersonalityMemoryAfterTurn(promptText, generatedText);
        if (liveConversationRef.current) {
          finalizedAssistantIds.forEach((id) => autoSpeechEligibleAssistantIdsRef.current.add(id));
        }
        return;
      }

      const chatPayload = {
        messages: requestMessages,
        temperature,
        top_k: topK,
        top_p: topP,
        min_p: minP,
        repeat_last_n: repeatLastN,
        repeat_penalty: repeatPenalty,
        max_tokens: replyLength,
        chat_template_kwargs: {
          enable_thinking: thinkingEnabled,
          thinking: thinkingEnabled,
        },
      };

      const abortController = new AbortController();
      activeChatAbortRef.current = abortController;
      const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          ...chatPayload,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Chat request failed with status ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let pendingChunk = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (isRequestStale()) break;

        pendingChunk += decoder.decode(value, { stream: true });
        const events = pendingChunk.split(/\r?\n\r?\n/);
        pendingChunk = events.pop() ?? "";

        for (const eventChunk of events) {
          if (isRequestStale()) break;
          const eventText = processSseEvent(eventChunk);
          generatedText += eventText.visibleText;
          fallbackGeneratedText += eventText.fallbackText;
          if (thinkingEnabled) {
            generatedThinking += eventText.fallbackText;
          }
          const elapsedSeconds = Math.max(0.1, (performance.now() - generationStartedAt) / 1000);
          setLastTokenSpeed(estimateTokens(generatedText) / elapsedSeconds);
          flushStreamedText();
        }
      }

      if (pendingChunk.trim()) {
        if (isRequestStale()) return;
        const eventText = processSseEvent(pendingChunk.trim());
        generatedText += eventText.visibleText;
        fallbackGeneratedText += eventText.fallbackText;
        if (thinkingEnabled) {
          generatedThinking += eventText.fallbackText;
        }
        const elapsedSeconds = Math.max(0.1, (performance.now() - generationStartedAt) / 1000);
        setLastTokenSpeed(estimateTokens(generatedText) / elapsedSeconds);
      }

      if (!generatedText.trim()) {
        if (fallbackGeneratedText.trim()) {
          const answerResponse = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abortController.signal,
            body: JSON.stringify({
              messages: [
                ...requestMessages,
                {
                  role: "assistant",
                  content: fallbackGeneratedText.trim(),
                },
                {
                  role: "user",
                  content: "Now give the final answer only. Do not include hidden thinking.",
                },
              ],
              temperature,
              top_k: topK,
              top_p: topP,
              min_p: minP,
              repeat_last_n: repeatLastN,
              repeat_penalty: repeatPenalty,
              max_tokens: replyLength,
              stream: false,
              chat_template_kwargs: {
                enable_thinking: false,
                thinking: false,
              },
            }),
          });

          if (answerResponse.ok) {
            generatedText = extractChatResponseText(await answerResponse.json());
          }
          if (!generatedText.trim()) {
            generatedText = fallbackGeneratedText.trim();
          }
        } else {
          const retryResponse = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abortController.signal,
            body: JSON.stringify({ ...chatPayload, stream: false }),
          });

          if (!retryResponse.ok) {
            throw new Error(`Chat retry failed with status ${retryResponse.status}`);
          }

          const retryData = await retryResponse.json();
          generatedText = extractChatResponseText(retryData);
        }
      }

      if (!generatedText.trim()) {
        appLog(
          `Chat returned no text after stream and retry. model=${selectedModelPath || "none"} messages=${newMessages.length}`,
        );
        throw new Error("The brain returned no text.");
      }
      if (thinkingEnabled && generatedThinking.trim()) {
        updateLastAssistantMessage((last) => ({
          ...last,
          thinking: generatedThinking.trim(),
        }));
      }
      if (isRequestStale()) return;
      generatedText = await handleShellToolRequest(assistantMessageId, generatedText);
      flushStreamedText(true);
      const finalizedAssistantIds = finalizeAssistantMessageById(assistantMessageId, (last) => ({
        ...last,
        content: generatedText,
        thinking: thinkingEnabled ? generatedThinking.trim() || last.thinking : undefined,
      }));
      await updatePersonalityMemoryAfterTurn(promptText, generatedText);
      if (liveConversationRef.current) {
        finalizedAssistantIds.forEach((id) => autoSpeechEligibleAssistantIdsRef.current.add(id));
      }

    } catch (error) {
      if (isRequestStale()) {
        return;
      }
      console.error("Chat error:", error);
      collectBrainDiagnostics()
        .then((diagnostics) =>
          appLog(
            `chat-error message=${JSON.stringify(error instanceof Error ? error.message : String(error))} ${diagnostics}`,
          ),
        )
        .catch(() => {});
      if (error instanceof Error && error.name === "AbortError") {
        updateLastAssistantMessage((last) =>
          last.content === "" ? { ...last, content: "[Stopped]" } : last,
        );
        setComposerNotice("Stopped.");
        setBrainStatus("Ready");
        return;
      }
      const partialReply = generatedText.trim();
      if (partialReply) {
        finalizeAssistantMessageById(assistantMessageId, (last) => ({
          ...last,
          content: partialReply,
        }));
        setComposerNotice(
          error instanceof Error
            ? `The reply stopped early: ${error.message}`
            : "The reply stopped early.",
        );
        setBrainStatus("Ready");
      } else {
        updateLastAssistantMessage((last) => ({
          ...last,
          content:
            error instanceof Error
              ? `[Error: ${error.message}]`
              : "[Error: Connection to the brain failed.]",
        }));
        setBrainStatus("Error");
        failed = true;
      }
    } finally {
      if (!isRequestStale()) {
        setIsStreaming(false);
        sendInFlightRef.current = false;
        if (!failed && !liveConversation) {
          setBrainStatus("Ready");
        }
      }
      activeChatAbortRef.current = null;
    }
  };

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

  useAppSettingsLoad({
    compressAvatarDataUrl,
    setAutomationOpen,
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
    minChatContextSize: MIN_CHAT_CONTEXT_SIZE,
  });

  useEffect(() => {
    liveConversationRef.current = liveConversation;
    if (!liveConversation) {
      autoSpeechEligibleAssistantIdsRef.current.clear();
      invoke("stop_omnivoice_engine").catch(() => undefined);
    }
  }, [liveConversation]);

  useEffect(() => {
    if (!settingsLoaded || telegramAutoStartAttemptedRef.current) return;
    telegramAutoStartAttemptedRef.current = true;
    if (!telegramBotToken.trim()) return;
    handleStartTelegram().catch((error) => console.error("Telegram auto-start error:", error));
  }, [settingsLoaded, telegramBotToken]);

  useTrayControls({
    settingsLoaded,
    telegramRunning,
    autoVoice: liveConversation,
    onToggleTelegram: () => (telegramRunning ? handleStopTelegram() : handleStartTelegram()),
    onToggleAutoVoice: () => setAutoVoiceMode(!liveConversation),
  });

  useEffect(() => {
    if (!settingsLoaded || !selectedUserProfileId) return;
    updateActiveUserProfile({
      name: userName,
      avatar: userAvatar,
      description: userDescription,
      location_label: userLocationLabel,
      latitude: userLatitude,
      longitude: userLongitude,
      auto_speech: selectedUserProfile?.auto_speech ?? true,
    });
  }, [settingsLoaded, selectedUserProfileId, userName, userAvatar, userDescription, userLocationLabel, userLatitude, userLongitude, selectedUserProfile?.auto_speech]);

  useMissingTooltips();

  useAppSettingsSave({
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
    userName,
    userAvatar,
    userDescription,
    userLatitude,
    userLocationLabel,
    userLongitude,
    userProfiles,
    voiceFolder,
    workspaceOpen,
  });

  useStoredImageHydration({
    settingsLoaded,
    messages,
    setMessages,
  });

  useAppBackgroundRefresh({
    automationMonth,
    googleClientId,
    googleClientSecret,
    googleConnected: googleStatus.connected,
    refreshAutomationJobs,
    refreshGoogleCalendarEvents,
    refreshGoogleStatus,
    refreshPendingShellActions,
    refreshToolRuns,
    selectedVoicePath,
    settingsLoaded,
    settingsReadyForSave,
    updateActiveCharacterVoicePath,
    voiceSamples,
  });

  useEffect(() => {
    if (messages.length === lastMessageCountRef.current) {
      return;
    }

    lastMessageCountRef.current = messages.length;
    const lastMessage = messages[messages.length - 1];
    window.requestAnimationFrame(() => {
      const container = conversationScrollRef.current;
      if (!container) return;

      if (lastMessage?.role === "assistant") {
        const element = document.querySelector(`[data-message-id="${lastMessage.id}"]`) as HTMLElement | null;
        if (element) {
          container.scrollTo({
            top: Math.max(0, element.offsetTop - container.offsetTop - 16),
            behavior: "smooth",
          });
        }
        return;
      }

      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    });
  }, [messages]);

  useAutoSpeechQueue({
    settingsLoaded,
    messages,
    liveConversation,
    isStreaming,
    isGeneratingImage,
    isTranscribing,
    speakingMessageId,
    selectedVoicePath,
    autoSpeechEligibleAssistantIdsRef,
    lastAutoSpokenAssistantIdRef,
    voicePlaybackRequestRef,
    ensureAudioPlaybackUnlocked,
    playAutoSpeechQueue,
  });

  useDropdownDismiss(() => {
    setModelMenuOpen(false);
    setQuickModelMenuOpen(false);
    setThemePickerOpen(false);
    setUserProfileMenuOpen(false);
    setPersonalityMenuOpen(false);
    setAutomationTimeMenuOpen(false);
    setAutomationDateMenuOpen(false);
    setAutomationMonthMenuOpen(false);
    setAutomationEveryUnitMenuOpen(false);
  });

  useEffect(() => {
    if (!settingsLoaded || !modelFolder) {
      return;
    }

    scanModelLibrary(modelFolder, selectedModelPath, true).catch((error) =>
      console.error("Initial model scan error:", error),
    );
  }, [settingsLoaded, modelFolder]);

  useEffect(() => {
    if (engineStatus !== "ready" || !pendingAutoLoadPath) {
      return;
    }

    loadModelPath(pendingAutoLoadPath).catch((error) =>
      console.error("Deferred model load error:", error),
    );
  }, [engineStatus, pendingAutoLoadPath]);

  const selectedGoogleEvents = googleCalendarEvents.filter((event) =>
    googleEventMatchesDate(event, selectedAutomationDate),
  );
  const hardwareGpuLabel = systemInfo?.gpu_details.replace(/\s*\(([^)]+)\)\s*$/, " - $1") ?? "";
  const hardwareRamLabel = systemInfo ? `${(systemInfo.total_ram_mb / 1024).toFixed(1)} GB` : "Unknown";
  const conversationLogoClass = messages.length === 0
    ? "hidden"
    : "pointer-events-none absolute left-1/2 top-1/2 z-0 w-[min(52vw,360px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.045]";
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

  useEffect(() => {
    if (!settingsLoaded || !setupScreenOpen || !setupCatalog || setupCatalog.tier !== activeSetupTier) {
      return;
    }
    const brainPart = setupCatalog.parts.find((part) => part.key === "brain");
    if (!brainPart?.installed) {
      return;
    }
    const nextFolder = setupCatalog.brain_model_folder;
    const nextModel = setupCatalog.selected_brain_model_path;
    if (!nextModel || selectedModelPath === nextModel) {
      return;
    }
    setModelFolder(nextFolder);
    setSelectedModelPath(nextModel);
    scanModelLibrary(nextFolder, nextModel, true).catch((error) =>
      console.error("Setup tier model switch error:", error),
    );
    if (engineStatus === "ready") {
      loadModelPath(nextModel).catch((error) => console.error("Setup tier load error:", error));
    } else {
      setPendingAutoLoadPath(nextModel);
    }
  }, [settingsLoaded, setupScreenOpen, setupCatalog, activeSetupTier, selectedModelPath, engineStatus]);

  useEffect(() => {
    if (!settingsLoaded || !setupCompleted || firstStartupSetupNeeded) {
      return;
    }
    if (voiceSetupStatus.ready && omniVoiceStatus.ready) {
      return;
    }
    void prepareVoiceHelpers(false);
  }, [settingsLoaded, setupCompleted, firstStartupSetupNeeded, voiceSetupStatus.ready, omniVoiceStatus.ready]);

  const leftPanelContent = (
    <LeftPanelContent
      selectedUserProfileId={selectedUserProfileId}
      selectedUserName={selectedUserProfile?.name || "You"}
      userAvatar={userAvatar}
      userName={userName}
      userProfiles={userProfiles}
      userProfileMenuOpen={userProfileMenuOpen}
      calendarOpen={calendarOpen}
      automationMonth={automationMonth}
      automationMonthDays={automationMonthDays}
      selectedAutomationDate={selectedAutomationDate}
      selectedAutomationDateObj={selectedAutomationDateObj}
      selectedAutomationLabel={selectedAutomationLabel}
      googleCalendarEvents={googleCalendarEvents}
      selectedGoogleEvents={selectedGoogleEvents}
      automationOpen={automationOpen}
      activeAutomationCount={activeAutomationCount}
      automationJobs={automationJobs}
      recentAutomationJobs={recentAutomationJobs}
      workspaceOpen={workspaceOpen}
      linkedFolders={linkedFolders}
      imageStudioOpen={imageStudioOpen}
      imageStudioDrawing={imageStudioDrawing}
      quickImagePrompt={quickImagePrompt}
      imageWidth={imageWidth}
      imageHeight={imageHeight}
      isGeneratingImage={isGeneratingImage}
      telegramPanelOpen={telegramPanelOpen}
      telegramRunning={telegramRunning}
      telegramBotToken={telegramBotToken}
      telegramOwnerId={telegramOwnerId}
      telegramStatus={telegramStatus}
      telegramGuests={telegramGuests}
      telegramGuestDraft={telegramGuestDraft}
      googlePanelOpen={googlePanelOpen}
      googleStatus={googleStatus}
      googleNotice={googleNotice}
      googleBusy={googleBusy}
      googleClientId={googleClientId}
      googleClientSecret={googleClientSecret}
      googleRedirectUri={googleRedirectUri}
      onOpenUserProfile={openUserProfile}
      onToggleUserMenu={() => {
        const next = !userProfileMenuOpen;
        setModelMenuOpen(false);
        setPersonalityMenuOpen(false);
        setQuickModelMenuOpen(false);
        setThemePickerOpen(false);
        setUserProfileMenuOpen(next);
      }}
      onSelectUserProfile={selectUserProfile}
      onCreateUserProfile={createUserProfile}
      onToggleCalendar={setCalendarOpen}
      onAutomationMonthChange={setAutomationMonth}
      onSelectAutomationDate={selectAutomationDate}
      onSelectGoogleEvent={setSelectedGoogleEvent}
      onDeleteGoogleEvent={openDeleteGoogleEventConfirm}
      onToggleAutomation={setAutomationOpen}
      onAddAutomation={() => openAutomationEditor()}
      onEditAutomation={openAutomationEditor}
      onToggleAutomationJob={(job) => toggleAutomationJob(job).catch((error) => console.error("Automation toggle error:", error))}
      onDeleteAutomationJob={(id) => deleteAutomationJob(id).catch((error) => console.error("Automation delete error:", error))}
      onToggleWorkspace={setWorkspaceOpen}
      onAddLinkedFolder={() => handleAddLinkedFolder().catch((error) => console.error(error))}
      onRemoveLinkedFolder={handleRemoveLinkedFolder}
      onToggleImageStudio={setImageStudioOpen}
      onQuickImagePromptChange={setQuickImagePrompt}
      onGenerateQuickImage={() => void handleQuickImageGenerate()}
      onImageWidthChange={setImageWidth}
      onImageHeightChange={setImageHeight}
      onToggleTelegram={setTelegramPanelOpen}
      onTelegramBotTokenChange={setTelegramBotToken}
      onTelegramOwnerIdChange={setTelegramOwnerId}
      onTelegramGuestDraftChange={setTelegramGuestDraft}
      onSaveTelegramGuest={addTelegramGuest}
      onRemoveTelegramGuest={removeTelegramGuest}
      onTestTelegram={() => handleTestTelegram().catch((error) => console.error("Telegram error:", error))}
      onStartStopTelegram={() =>
        (telegramRunning ? handleStopTelegram() : handleStartTelegram()).catch((error) =>
          console.error(telegramRunning ? "Telegram stop error:" : "Telegram start error:", error),
        )
      }
      onToggleGoogle={setGooglePanelOpen}
      onGoogleClientIdChange={setGoogleClientId}
      onGoogleClientSecretChange={setGoogleClientSecret}
      onGoogleRedirectUriChange={setGoogleRedirectUri}
      onConnectToggleGoogle={() =>
        (googleStatus.connected ? disconnectGoogle() : connectGoogle()).catch((error) =>
          console.error(googleStatus.connected ? "Google disconnect error:" : "Google connect error:", error),
        )
      }
      onRefreshGoogleCalendar={() => refreshGoogleCalendarEvents().catch((error) => console.error("Google Calendar refresh error:", error))}
    />
  );

  const rightPanelContent = (
    <RightPanelContent
      selectedPersonalityId={selectedPersonalityId}
      selectedPersonalityPreset={selectedPersonalityPreset}
      personalityAvatar={personalityAvatar}
      personalityPresets={personalityPresets}
      personalityMenuOpen={personalityMenuOpen}
      brainStatus={brainStatus}
      modelMenuOpen={modelMenuOpen}
      availableModels={availableModels}
      selectedModelPath={selectedModelPath}
      currentModelName={currentModelName}
      currentModelEntry={currentModelEntry}
      theme={selectedThemeSwatch}
      isAudioPlaying={isAudioPlaying}
      waveformProcessing={waveformProcessing}
      clearMemoryOpen={clearMemoryConfirmOpen}
      clearSessionToo={clearSessionToo}
      userProfileOpen={userProfileOpen}
      userName={userName}
      userAvatar={userAvatar}
      userDescription={userDescription}
      userProfiles={userProfiles}
      selectedUserProfile={selectedUserProfile}
      selectedUserVoicePath={selectedUserVoicePath}
      selectedUserVoiceSample={selectedUserVoiceSample}
      deleteUserProfileConfirmOpen={deleteUserProfileConfirmOpen}
      personalityProfileOpen={personalityProfileOpen}
      personalityNameDraft={personalityNameDraft}
      personality={personality}
      memorySize={memorySize}
      replyLength={replyLength}
      minContextSize={MIN_CHAT_CONTEXT_SIZE}
      selectedVoicePath={selectedVoicePath}
      selectedVoiceSample={selectedVoiceSample}
      deletePersonalityConfirmOpen={deletePersonalityConfirmOpen}
      voiceFolder={voiceFolder}
      voiceSamples={voiceSamples}
      previewingVoicePath={previewingVoicePath}
      selectedUserVoiceRowRef={selectedUserVoiceRowRef}
      selectedVoiceRowRef={selectedVoiceRowRef}
      toolRunsOpen={toolRunsOpen}
      toolRuns={toolRuns}
      samplingOpen={samplingOpen}
      samplingTemperature={samplingTemperature}
      topK={topK}
      topP={topP}
      minP={minP}
      repeatLastN={repeatLastN}
      repeatPenalty={repeatPenalty}
      onOpenPersonalityProfile={openPersonalityProfile}
      onTogglePersonalityMenu={() => {
        const next = !personalityMenuOpen;
        setModelMenuOpen(false);
        setUserProfileMenuOpen(false);
        setQuickModelMenuOpen(false);
        setThemePickerOpen(false);
        setPersonalityMenuOpen(next);
      }}
      onSelectPersonality={(id) => {
        selectPersonalityPreset(id);
        setPersonalityMenuOpen(false);
      }}
      onCreatePersonality={saveCurrentPersonalityPreset}
      onChooseModelFolder={() => handleChooseModelFolder().catch((error) => console.error("Folder error:", error))}
      onToggleModelMenu={() => {
        const next = !modelMenuOpen;
        setUserProfileMenuOpen(false);
        setPersonalityMenuOpen(false);
        setQuickModelMenuOpen(false);
        setThemePickerOpen(false);
        setModelMenuOpen(next);
      }}
      onSelectModel={(path) => {
        setModelMenuOpen(false);
        setSelectedModelPath(path);
        loadModelPath(path).catch((error) => console.error("Model select error:", error));
      }}
      onToggleClearSession={setClearSessionToo}
      onConfirmClearMemory={() => handleClearPersonalityMemory().catch(console.error)}
      onCancelClearMemory={() => {
        setClearMemoryConfirmOpen(false);
        setClearSessionToo(false);
      }}
      onCloseUserProfile={() => setUserProfileOpen(false)}
      onChooseUserAvatar={() => userAvatarPickerRef.current?.click()}
      onUserNameChange={setUserName}
      onUserDescriptionChange={setUserDescription}
      onChooseVoiceFolder={() => handleChooseVoiceFolder().catch((error) => console.error("Voice folder error:", error))}
      onPreviewUserVoice={(sample) => void previewVoiceSample(sample)}
      onSelectUserVoice={updateActiveUserVoicePath}
      onToggleUserAutoSpeech={() => updateActiveUserProfile({ auto_speech: !(selectedUserProfile?.auto_speech ?? true) })}
      onRequestDeleteUser={() => {
        setUserProfileOpen(false);
        setDeleteUserProfileConfirmOpen(true);
      }}
      onSaveUserProfile={saveActiveUserProfile}
      onConfirmDeleteUser={() => {
        deleteSelectedUserProfile();
        setDeleteUserProfileConfirmOpen(false);
      }}
      onCancelDeleteUser={() => setDeleteUserProfileConfirmOpen(false)}
      onClosePersonalityProfile={() => setPersonalityProfileOpen(false)}
      onChoosePersonalityAvatar={() => {
        avatarTargetPersonalityIdRef.current = selectedPersonalityId;
        personalityAvatarPickerRef.current?.click();
      }}
      onPersonalityNameChange={setPersonalityNameDraft}
      onPersonalityChange={setPersonality}
      onPreviewCharacterVoice={(sample) => void previewVoiceSample(sample)}
      onSelectCharacterVoice={updateActiveCharacterVoicePath}
      onMemorySizeChange={setMemorySize}
      onReplyLengthChange={setReplyLength}
      onRequestDeletePersonality={() => {
        setPersonalityProfileOpen(false);
        setDeletePersonalityConfirmOpen(true);
      }}
      onRequestClearPersonalityMemory={() => {
        setPersonalityProfileOpen(false);
        setClearMemoryConfirmOpen(true);
      }}
      onSavePersonality={() => {
        updateSelectedPersonalityPreset();
        setPersonalityProfileOpen(false);
      }}
      onConfirmDeletePersonality={() => {
        deleteSelectedPersonalityPreset();
        setDeletePersonalityConfirmOpen(false);
      }}
      onCancelDeletePersonality={() => setDeletePersonalityConfirmOpen(false)}
      onToggleToolRuns={setToolRunsOpen}
      onRefreshToolRuns={() => refreshToolRuns().catch((error) => console.error("Tool activity refresh error:", error))}
      onToggleSampling={setSamplingOpen}
      onResetSampling={resetSamplingDefaults}
      onTemperatureChange={setSamplingTemperature}
      onTopKChange={setTopK}
      onTopPChange={setTopP}
      onMinPChange={setMinP}
      onRepeatLastNChange={setRepeatLastN}
      onRepeatPenaltyChange={setRepeatPenalty}
    />
  );
  const {
    closeSetupScreen,
    handleInstallSetupBundle,
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
    setSetupProgress,
    setSetupScreenOpen,
    setupCatalog,
    setupInstalling,
    systemInfo,
  });

  if (!settingsLoaded) {
    return <StartupScreen />;
  }

  if (settingsLoadError) {
    return <SettingsLoadErrorScreen error={settingsLoadError} />;
  }

  if (firstStartupSetupNeeded) {
    return (
      <SetupScreen
        theme={selectedThemeSwatch}
        brandLogo={brandLogo}
        systemInfo={systemInfo}
        hardwareGpuLabel={hardwareGpuLabel}
        hardwareRamLabel={hardwareRamLabel}
        activeSetupTier={activeSetupTier}
        setupTierOverride={setupTierOverride}
        onSelectSetupTier={chooseSetupTier}
        setupCatalog={setupCatalog}
        setupInstalling={setupInstalling}
        activeSetupPartKey={activeSetupPartKey}
        setupProgress={setupProgress}
        setupNotice={setupNotice}
        onClose={closeSetupScreen}
        onChooseFiles={closeSetupScreen}
        onInstall={() => void handleInstallSetupBundle()}
      />
    );
  }

  return (
    <>
      <div
        className="min-h-screen text-[#e3e3e3]"
        style={
          {
            background: "linear-gradient(180deg, #131314 0%, #17181a 40%, #131314 100%)",
            "--accent-color": selectedThemeSwatch.accent,
            "--accent-hover": selectedThemeSwatch.hover,
            "--accent-soft": selectedThemeSwatch.soft,
            "--accent-soft-strong": `${selectedThemeSwatch.accent}44`,
          } as React.CSSProperties
        }
      >
      <AvatarFileInputs
        avatarTargetPersonalityIdRef={avatarTargetPersonalityIdRef}
        personalityAvatarPickerRef={personalityAvatarPickerRef}
        readAvatarImage={readAvatarImage}
        selectedPersonalityId={selectedPersonalityId}
        setPersonalityAvatar={setPersonalityAvatar}
        setPersonalityPresets={setPersonalityPresets}
        setUserAvatar={setUserAvatar}
        userAvatarPickerRef={userAvatarPickerRef}
      />

      <FreshChatConfirmModal
        open={freshChatConfirmOpen}
        onClose={() => setFreshChatConfirmOpen(false)}
        onClear={() => {
          clearActiveChatSession();
          setComposerText("");
          clearImage();
          setComposerNotice("");
          setFreshChatConfirmOpen(false);
        }}
      />

      <AutomationEditorModal
        open={automationEditorOpen}
        editingAutomationId={editingAutomationId}
        automationName={automationName}
        automationPrompt={automationPrompt}
        automationDate={automationDate}
        automationTime={automationTime}
        automationRepeat={automationRepeat}
        automationEveryAmount={automationEveryAmount}
        automationEveryUnit={automationEveryUnit}
        automationTimeMenuOpen={automationTimeMenuOpen}
        automationDateMenuOpen={automationDateMenuOpen}
        automationMonthMenuOpen={automationMonthMenuOpen}
        automationEveryUnitMenuOpen={automationEveryUnitMenuOpen}
        automationEditorMonth={automationEditorMonth}
        onClose={() => setAutomationEditorOpen(false)}
        onCancel={() => {
          setAutomationEditorOpen(false);
          setEditingAutomationId(null);
        }}
        onSave={() => saveAutomationJob().catch((error) => console.error("Automation save error:", error))}
        onAutomationNameChange={setAutomationName}
        onAutomationPromptChange={setAutomationPrompt}
        onAutomationDateChange={setAutomationDate}
        onAutomationTimeChange={setAutomationTime}
        onAutomationRepeatChange={setAutomationRepeat}
        onAutomationEveryAmountChange={setAutomationEveryAmount}
        onAutomationEveryUnitChange={setAutomationEveryUnit}
        onAutomationTimeMenuOpenChange={setAutomationTimeMenuOpen}
        onAutomationDateMenuOpenChange={setAutomationDateMenuOpen}
        onAutomationMonthMenuOpenChange={setAutomationMonthMenuOpen}
        onAutomationEveryUnitMenuOpenChange={setAutomationEveryUnitMenuOpen}
        onAutomationEditorMonthChange={setAutomationEditorMonth}
      />
      <div
        className="flex h-screen overflow-hidden"
        onPointerMove={markUiInteraction}
        onWheel={markUiInteraction}
      >
        <AppSidePanel
          open={leftPanelOpen}
          side="left"
          title="App Settings"
          isCompactLayout={isCompactLayout}
          onClose={() => setLeftPanelOpen(false)}
          actions={(
            <IconButton size="sm" title="Download models" onClick={() => setSetupScreenOpen(true)}>
              <DownloadIcon />
            </IconButton>
          )}
        >
          {leftPanelContent}
        </AppSidePanel>

        <main
          className="relative flex min-w-0 flex-1 flex-col overflow-hidden w-full"
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            attachImageFromFile(event.dataTransfer.files[0]);
          }}
        >
          {isDragging && <DropImageOverlay />}

          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
            <img src={brandLogo} alt="" aria-hidden="true" className={conversationLogoClass} />
          </div>

          <AppHeader
            activeTaskType={activeTaskType}
            availableUpdate={availableUpdate}
            brainStatus={brainStatus}
            dateTimeLine={dateTimeLine}
            isAudioPlaying={isAudioPlaying}
            isGeneratingImage={isGeneratingImage}
            leftPanelOpen={leftPanelOpen}
            modelLoadStatus={modelLoadStatus}
            previewingVoicePath={previewingVoicePath}
            rightPanelOpen={rightPanelOpen}
            setLeftPanelOpen={setLeftPanelOpen}
            setRightPanelOpen={setRightPanelOpen}
            speakingMessageId={speakingMessageId}
            topProgressActive={topProgressActive}
            topProgressPercent={topProgressPercent}
            topStatusText={topStatusText}
          />

          {engineErrorMsg && (
            <div className="shrink-0 border-b border-rose-500/20 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
              {engineErrorMsg}
            </div>
          )}

          <ConversationPane
            scrollRef={conversationScrollRef}
            endRef={conversationEndRef}
            messages={messages}
            brandLogo={brandLogo}
            systemInfo={systemInfo}
            assistantName={selectedPersonalityPreset?.name || "Assistant"}
            assistantAvatar={assistantAvatar}
            userName={userName}
            userAvatar={userAvatar}
            hardwareGpuLabel={hardwareGpuLabel}
            hardwareRamLabel={hardwareRamLabel}
            isStreaming={isStreaming}
            isGeneratingImage={isGeneratingImage}
            isApproving={isApproving}
            collapsedImageParts={collapsedImageParts}
            linkedFolders={linkedFolders}
            speakingMessageId={speakingMessageId}
            showScrollBottom={showScrollBottom}
            onScroll={handleChatScroll}
            onOpenPersonalityProfile={openPersonalityProfile}
            onOpenUserProfile={openUserProfile}
            onOpenImageViewer={openImageViewer}
            onRevealImageLocation={(path) => void revealImageLocation(path)}
            onDeleteImageMessage={deleteImageFromChatMessage}
            onToggleImageCollapsed={(key) => setCollapsedImageParts((prev) => ({ ...prev, [key]: !prev[key] }))}
            onDismissImageProposal={dismissImageProposal}
            onGenerateImage={(prompt, mode, maskPrompt) => void handleGenerateImage(prompt, mode, maskPrompt)}
            onDismissChatPart={dismissChatPart}
            onApproveActionProposal={(messageId, partIndex, proposal) => void approveActionProposal(messageId, partIndex, proposal)}
            onDeleteCalendarEvent={openDeleteGoogleEventConfirm}
            onSpeakToggle={(messageId, text, role) => {
              if (speakingMessageId === messageId) {
                voicePlaybackRequestRef.current += 1;
                stopActiveAudio();
                setSpeakingMessageId(null);
                return;
              }
              ensureAudioPlaybackUnlocked()
                .catch(() => null)
                .finally(() => speakMessageText(messageId, text, role));
            }}
            onScrollToBottom={() => scrollToBottom()}
          />
          <ChatComposer
            pendingShellActions={pendingShellActions}
            executingShellActionId={executingShellActionId}
            image={image}
            composerInputRef={composerInputRef}
            input={input}
            composerHasText={composerHasText}
            engineReady={engineStatus === "ready"}
            isStreaming={isStreaming}
            sendInFlight={sendInFlightRef.current}
            selectedThemeSwatch={selectedThemeSwatch}
            thinkingEnabled={thinkingEnabled}
            liveConversation={liveConversation}
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            themePickerOpen={themePickerOpen}
            themeSwatches={themeSwatches}
            themeSwatchId={themeSwatchId}
            quickModelMenuOpen={quickModelMenuOpen}
            availableModels={availableModels}
            selectedModelPath={selectedModelPath}
            selectedModel={selectedModel}
            brainStatus={brainStatus}
            currentModelEntry={currentModelEntry}
            onRejectShellAction={(id) => rejectShellAction(id).catch((error) => console.error("Reject shell action error:", error))}
            onApproveShellAction={(action) => approveShellAction(action).catch((error) => console.error("Approve shell action error:", error))}
            onRemoveImage={() => {
              clearImage();
            }}
            onComposerInput={handleComposerInput}
            onComposerPaste={(event) => {
              const items = event.clipboardData?.items;
              if (!items) return;
              for (let i = 0; i < items.length; i++) {
                if (items[i].type.startsWith("image/")) {
                  const file = items[i].getAsFile();
                  if (file) {
                    attachImageFromFile(file);
                    event.preventDefault();
                    return;
                  }
                }
              }
            }}
            onSend={() => handleSend().catch((error) => console.error("Send error:", error))}
            onStop={stopActiveResponse}
            onToggleThinking={() => setThinkingEnabled((prev) => !prev)}
            onToggleLiveConversation={() => setAutoVoiceMode(!liveConversation)}
            onMicToggle={() => handleMicToggle().catch((error) => console.error("Mic error:", error))}
            onChooseImage={() => chooseImageForComposer().catch((error) => console.error("Choose image error:", error))}
            onToggleThemePicker={() => {
              const next = !themePickerOpen;
              setModelMenuOpen(false);
              setUserProfileMenuOpen(false);
              setPersonalityMenuOpen(false);
              setQuickModelMenuOpen(false);
              setThemePickerOpen(next);
            }}
            onSelectTheme={(id) => {
              setThemeSwatchId(id);
              setThemePickerOpen(false);
            }}
            onClearChat={() => setFreshChatConfirmOpen(true)}
            onToggleQuickModelMenu={() => {
              const next = !quickModelMenuOpen;
              setModelMenuOpen(false);
              setUserProfileMenuOpen(false);
              setPersonalityMenuOpen(false);
              setThemePickerOpen(false);
              setQuickModelMenuOpen(next);
            }}
            onSelectModel={(path) => {
              setQuickModelMenuOpen(false);
              setSelectedModelPath(path);
              loadModelPath(path).catch((error) => console.error("Model select error:", error));
            }}
          />
        </main>

        <AppSidePanel
          open={rightPanelOpen}
          side="right"
          title="Model Controls"
          isCompactLayout={isCompactLayout}
          onClose={() => setRightPanelOpen(false)}
        >
          {rightPanelContent}
        </AppSidePanel>
      </div>
    </div>

    <ImageViewerOverlay imageViewer={imageViewer} setImageViewer={setImageViewer} />
    <GoogleEventModals
      selectedEvent={selectedGoogleEvent}
      deleteTarget={googleDeleteTarget}
      onCloseSelected={() => setSelectedGoogleEvent(null)}
      onRequestDelete={openDeleteGoogleEventConfirm}
      onCloseDelete={() => setGoogleDeleteTarget(null)}
      onConfirmDelete={(eventId) => {
        deleteGoogleEvent(eventId).catch((error) => console.error("Google event delete error:", error));
      }}
    />
    </>
  );
}

export default App;
