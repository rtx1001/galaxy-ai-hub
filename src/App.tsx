import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";
import brandLogo from "./assets/logo-gah.svg";
import { ChatContentPart, ChatMessage, ChatSessions, EngineInfo, ModelLoadStatus, VoiceSetupStatus, ActionProposal, FilePreviewResult } from "./types";
import { CloseIcon, GearIcon, MenuIcon, DownloadIcon } from "./components/Icons";
import { IconButton } from "./components/UI";
import { ResourceHeader } from "./components/ResourceHeader";
import { SetupScreen } from "./components/SetupScreen";
import { StartupScreen, SettingsLoadErrorScreen } from "./components/AppScreens";
import { AutomationEditorModal } from "./components/AutomationEditorModal";
import { LeftPanelContent, RightPanelContent } from "./components/SidePanelContent";
import { ConversationPane } from "./components/ConversationPane";
import { ChatComposer } from "./components/ChatComposer";
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
import { clampNumber } from "./utils";
import {
  AgentReactResult,
  AppSettings,
  AudioSynthesisResult,
  AutomationJob,
  CharacterFiles,
  CharacterSettings,
  DEFAULT_SETTINGS,
  DisplayLanguage,
  FileActionResult,
  LocalImageDataUrl,
  MemoryItem,
  ModelLibraryEntry,
  ModelStatus,
  OmniVoiceVramEstimate,
  PendingShellAction,
  PersonalityPreset,
  SendOptions,
  SetupInstallResult,
  SPEECH_CACHE_LIMIT,
  ShellExecutionResult,
  TelegramBotStatus,
  THEME_SWATCHS,
  UserProfilePreset,
  VoiceSample,
  SystemInfo,
  VramMemoryStatus,
  buildBrainMessages,
  buildToolAgentMessages,
  compactChatSessionForStorage,
  compactSessionFingerprint,
  conversationWantsVietnamese,
  createMessageId,
  detectDisplayLanguage,
  detectVoicePreviewText,
  estimateTokens,
  extractChatResponseText,
  extractChoiceText,
  extractMessageText,
  extractShellToolRequest,
  extractTextValue,
  findPendingActionProposal,
  findPendingImageProposal,
  formatFileActionResult,
  formatReactThinking,
  formatShellResult,
  getAutomationDueAt,
  getDefaultLocalContext,
  googleEventMatchesDate,
  includesAnyPhrase,
  isExplicitApprovalText,
  isGpuFitError,
  normalizeIntentText,
  parseStoredChatSession,
  sanitizeTextForSpeech,
  sleep,
  splitAssistantMessageForChat,
  stripShellToolRequest,
  stripThinkBlocks,
  syncSoulCoreIdentity,
  textLooksVietnamese,
} from "./appCore";

const MIN_CHAT_CONTEXT_SIZE = 8192;

function App() {
  const [brainStatus, setBrainStatus] = useState<"Idle" | "Loading" | "Ready" | "Thinking" | "Error">("Idle");
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [engineStatus, setEngineStatus] = useState<"initializing" | "downloading" | "ready" | "error">("initializing");
  const [engineErrorMsg, setEngineErrorMsg] = useState("");
  const [, setEngineInfo] = useState<EngineInfo | null>(null);
  const [modelLoadStatus, setModelLoadStatus] = useState<ModelLoadStatus>({
    state: "idle",
    message: "",
    progress: 0,
  });
  const [voiceSetupStatus, setVoiceSetupStatus] = useState<VoiceSetupStatus>({
    state: "idle",
    message: "Voice helper is waiting.",
    progress: 0,
    ready: false,
  });
  const [omniVoiceStatus, setOmniVoiceStatus] = useState<VoiceSetupStatus>({
    state: "idle",
    message: "Voice playback engine is waiting.",
    progress: 0,
    ready: false,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatDisplayLanguage: DisplayLanguage = (() => {
    const latestUserText = [...messages]
      .reverse()
      .find((message) => message.role === "user" && extractMessageText(message.content).trim());
    return detectDisplayLanguage(extractMessageText(latestUserText?.content ?? ""));
  })();
  const [chatSessions, setChatSessions] = useState<ChatSessions>({});
  const [input, setInput] = useState("");
  const [composerHasText, setComposerHasText] = useState(false);
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
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const {
    isAudioPlaying,
    ensureAudioPlaybackUnlocked,
    playAudioBase64,
    stopActiveAudio,
  } = useAudioPlayback();
  const [pendingShellActions, setPendingShellActions] = useState<PendingShellAction[]>([]);
  const [executingShellActionId, setExecutingShellActionId] = useState<number | null>(null);
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
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [themeSwatchId, setThemeSwatchId] = useState(DEFAULT_SETTINGS.theme_swatch_id);
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
  const [personalityMemory, setPersonalityMemory] = useState("");
  const [characterSoul, setCharacterSoul] = useState("");
  const [characterFolder, setCharacterFolder] = useState("");
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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const userAvatarPickerRef = useRef<HTMLInputElement | null>(null);
  const personalityAvatarPickerRef = useRef<HTMLInputElement | null>(null);
  const avatarTargetPersonalityIdRef = useRef<string | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastComposerInputAtRef = useRef(0);
  const lastUiInteractionAtRef = useRef(0);
  const conversationScrollRef = useRef<HTMLElement | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const lastMessageCountRef = useRef(0);
  const chatSessionsRef = useRef<ChatSessions>({});
  const loadedChatSessionIdsRef = useRef<Set<string>>(new Set());
  const sessionShadowRef = useRef<Record<string, string>>({});
  const lastSessionMutationAtRef = useRef<Record<string, number>>({});
  const personalityMemoryShadowRef = useRef<Record<string, string>>({});
  const systemDefaultsAppliedRef = useRef(false);
  const speechCacheRef = useRef<Map<string, AudioSynthesisResult>>(new Map());
  const voicePlaybackRequestRef = useRef(0);
  const lastAutoSpokenAssistantIdRef = useRef<string | null>(null);
  const autoSpeechEligibleAssistantIdsRef = useRef<Set<string>>(new Set());
  const autoSpeechQueueRef = useRef<string[]>([]);
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
  const localContext = getDefaultLocalContext();
  const selectedUserProfile =
    userProfiles.find((profile) => profile.id === selectedUserProfileId) ?? userProfiles[0] ?? DEFAULT_SETTINGS.user_profiles[0];
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
  const selectedThemeSwatch =
    THEME_SWATCHS.find((swatch) => swatch.id === themeSwatchId) ?? THEME_SWATCHS[0];
  const voiceAutoPrepareStartedRef = useRef(false);

  useEffect(() => {
    activeTaskTypeRef.current = activeTaskType;
  }, [activeTaskType]);

  const recommendedThreads = systemInfo
    ? clampNumber(Math.min(systemInfo.cpu_threads, 8), 2, Math.max(2, systemInfo.cpu_threads))
    : 4;
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

  const refreshEngineInfo = async () => {
    const info = await invoke<EngineInfo>("get_engine_info");
    setEngineInfo(info);
    return info;
  };

  const markUiInteraction = () => {
    lastUiInteractionAtRef.current = Date.now();
  };

  const updateLastAssistantMessage = (
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last.role !== "assistant") return prev;
      updated[updated.length - 1] = updater(last);
      return updated;
    });
  };

  const updateAssistantMessageById = (
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId && message.role === "assistant" ? updater(message) : message,
      ),
    );
  };

  const finalizeAssistantMessageById = (
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    let splitIds: string[] = [];
    setMessages((prev) => {
      const index = prev.findIndex((message) => message.id === messageId && message.role === "assistant");
      if (index < 0) return prev;
      const next = [...prev];
      const updated = updater(next[index]);
      const splitMessages = splitAssistantMessageForChat(updated);
      splitIds = splitMessages.map((message) => message.id);
      next.splice(index, 1, ...splitMessages);
      return next;
    });
    return splitIds.length ? splitIds : [messageId];
  };

  const deleteImageFromChatMessage = (messageId: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId && Array.isArray(message.content)
          ? {
              ...message,
              content: [{ type: "text", text: "Image deleted." }],
              thinking: undefined,
            }
          : message,
      ),
    );
    setCollapsedImageParts((prev) => {
      const next: Record<string, boolean> = {};
      Object.entries(prev).forEach(([key, value]) => {
        if (!key.startsWith(`${messageId}:`)) {
          next[key] = value;
        }
      });
      return next;
    });
    autoSpeechEligibleAssistantIdsRef.current.delete(messageId);
    if (lastAutoSpokenAssistantIdRef.current === messageId) {
      lastAutoSpokenAssistantIdRef.current = null;
    }
    if (speakingMessageId === messageId) {
      voicePlaybackRequestRef.current += 1;
      stopActiveAudio();
      setSpeakingMessageId(null);
    }
  };

  const enrichPreviewPerception = async (messageId: string, preview: FilePreviewResult) => {
    const mime = preview.mime_type.toLowerCase();
    if (!preview.data_url || !mime.startsWith("audio/") || preview.perception) {
      return;
    }
    if (!voiceSetupStatus.ready || preview.size_bytes > 30 * 1024 * 1024) {
      return;
    }

    try {
      const result = await invoke<{ text: string; language: string; language_probability: number }>("transcribe_audio", {
        audioDataUrl: preview.data_url,
      });
      const text = result.text.trim();
      if (!text) {
        return;
      }
      const perception = `Transcript (${result.language || "unknown"}): ${text}`;
      updateAssistantMessageById(messageId, (message) => {
        if (!Array.isArray(message.content)) return message;
        return {
          ...message,
          content: message.content.map((part) =>
            part.type === "file_preview" && part.file_preview.path === preview.path
              ? { ...part, file_preview: { ...part.file_preview, perception } }
              : part,
          ),
        };
      });
    } catch (error) {
      console.error("Preview transcription error:", error);
    }
  };

  const saveActiveChatSession = (
    personalityId = selectedPersonalityId,
    session = messages,
  ) => {
    if (!personalityId) return;
    chatSessionsRef.current = {
      ...chatSessionsRef.current,
      [personalityId]: session,
    };
    setChatSessions((prev) =>
      prev[personalityId] === session ? prev : { ...prev, [personalityId]: session },
    );
  };

  const loadChatSessionForPersonality = (personalityId: string) => {
    const session = chatSessionsRef.current[personalityId] ?? [];
    setMessages(session);
    lastMessageCountRef.current = session.length;
    ensureConversationStartsAtBottom();
  };

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

  const refreshPendingShellActions = async () => {
    try {
      const actions = await invoke<PendingShellAction[]>("list_pending_shell_actions");
      setPendingShellActions(actions);
    } catch (error) {
      console.error("Pending shell action load error:", error);
    }
  };

  const handleShellToolRequest = async (assistantMessageId: string, replyText: string) => {
    const request = extractShellToolRequest(replyText);
    if (!request?.command?.trim()) {
      return replyText;
    }

    const visibleReply =
      stripShellToolRequest(replyText) ||
      "I prepared a system action. Review it below before it runs.";
    const action = await invoke<PendingShellAction>("propose_shell_action", {
      command: request.command,
      workingDirectory: request.working_directory || undefined,
      purpose: request.purpose || "Run the requested local system action.",
      timeoutSeconds: request.timeout_seconds || 30,
    });
    const finalReply = `${visibleReply}\n\nWaiting for your approval before running: ${action.purpose}`;
    setPendingShellActions((prev) => [...prev.filter((item) => item.id !== action.id), action]);
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantMessageId
          ? {
              ...message,
              content: finalReply,
            }
          : message,
      ),
    );
    setComposerNotice("A system action is waiting for approval.");
    return finalReply;
  };

  const recordClientToolRun = async (
    toolName: string,
    input: Record<string, unknown>,
    outputText: string,
    success: boolean,
    startedAt: number,
  ) => {
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    await invoke("record_agent_tool_run", {
      run: {
        tool_name: toolName,
        input_json: JSON.stringify(input),
        output_text: outputText,
        success,
        duration_ms: durationMs,
      },
    });
    refreshToolRuns().catch((error) => console.error("Tool activity refresh error:", error));
  };

  const rejectShellAction = async (id: number) => {
    await invoke<boolean>("reject_shell_action", { id });
    setPendingShellActions((prev) => prev.filter((action) => action.id !== id));
  };

  const approveShellAction = async (action: PendingShellAction) => {
    setExecutingShellActionId(action.id);
    try {
      const result = await invoke<ShellExecutionResult>("execute_shell_action", { id: action.id });
      await invoke("record_agent_tool_run", {
        run: {
          tool_name: "powershell",
          input_json: JSON.stringify(action),
          output_text: formatShellResult(result),
          success: !result.timed_out && result.exit_code === 0,
          duration_ms: Math.round(result.duration_ms),
        },
      }).catch(() => undefined);
      refreshToolRuns().catch((error) => console.error("Tool activity refresh error:", error));
      setPendingShellActions((prev) => prev.filter((item) => item.id !== action.id));
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          content: formatShellResult(result),
        },
      ]);
    } catch (error) {
      setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setExecutingShellActionId(null);
    }
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

  const chooseVoiceVramMode = async () => {
    const llmIsLoaded =
      activeTaskTypeRef.current === "llm" ||
      brainStatus === "Ready" ||
      brainStatus === "Thinking";

    if (!llmIsLoaded) {
      activeTaskTypeRef.current = "voice";
      setActiveTaskType("voice");
      return "voice-only" as const;
    }

    try {
      const [vram, estimate] = await Promise.all([
        invoke<VramMemoryStatus>("get_vram_memory_status"),
        invoke<OmniVoiceVramEstimate>("estimate_omnivoice_vram_need"),
      ]);
      appLog(
        `voice vram check free=${vram.free_mb}MB used=${vram.used_mb}MB total=${vram.total_mb}MB need=${estimate.required_mb}MB`,
      );

      if (vram.available && vram.free_mb >= estimate.required_mb) {
        setComposerNotice("Loading voice...");
        return "shared" as const;
      }
    } catch (error) {
      console.error("Voice VRAM check error:", error);
      appLog(`voice vram check failed ${error instanceof Error ? error.message : String(error)}`);
    }

    await unloadLlmForTask("voice");
    return "swapped" as const;
  };

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

  const rememberSpeech = (key: string, value: AudioSynthesisResult) => {
    const cache = speechCacheRef.current;
    cache.delete(key);
    cache.set(key, value);

    while (cache.size > SPEECH_CACHE_LIMIT) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) break;
      cache.delete(oldestKey);
    }
  };

  const synthesizeAndPlaySpeech = async (
    text: string,
    voiceSamplePath: string,
    requestId: number,
    manageVram = true,
  ) => {
    const speechText = sanitizeTextForSpeech(text);
    if (!speechText) {
      return;
    }

    stopActiveAudio();
    const cleanText = speechText.trim();
    const cacheKey = JSON.stringify([voiceSamplePath || "", cleanText]);
    const cached = speechCacheRef.current.get(cacheKey);
    const voiceTaskStartedAt = performance.now();
    const voiceInput = {
      voice_sample: voiceSamplePath ? voiceSamplePath.split(/[/\\]/).pop() : "default",
      text: cleanText.slice(0, 220),
      manage_vram: manageVram,
    };

    if (cached) {
      if (requestId !== voicePlaybackRequestRef.current) return;
      recordClientToolRun(
        "voice_cached",
        { ...voiceInput, cached: true },
        "Played cached voice audio.",
        true,
        voiceTaskStartedAt,
      ).catch(() => undefined);
      await playAudioBase64(cached.audio_base64, cached.mime_type);
      return;
    }

    let voiceMode: "shared" | "swapped" | "voice-only" | "none" = "none";
    let result: AudioSynthesisResult;
    try {
      if (manageVram) {
        voiceMode = await chooseVoiceVramMode();
      }

      setComposerNotice("Loading voice...");
      appLog(`voice synth start sample=${voiceSamplePath || "<design>"} request=${requestId} manageVram=${manageVram} mode=${voiceMode}`);
      await invoke("prepare_omnivoice_engine").catch(() => undefined);
      appLog(`voice synth engine ready sample=${voiceSamplePath || "<design>"} request=${requestId}`);
      result = await invoke<AudioSynthesisResult>("synthesize_speech", {
        text: cleanText,
        voiceSamplePath: voiceSamplePath || null,
        useSidecar: false,
      });
    } catch (error) {
      if (manageVram && voiceMode === "shared" && isGpuFitError(error)) {
        appLog(`voice synth shared mode failed from GPU memory, retrying with LLM unloaded`);
        await unloadLlmForTask("voice");
        try {
          result = await invoke<AudioSynthesisResult>("synthesize_speech", {
            text: cleanText,
            voiceSamplePath: voiceSamplePath || null,
            useSidecar: false,
          });
        } catch (retryError) {
          recordClientToolRun(
            "voice_speech",
            { ...voiceInput, mode: "swapped" },
            retryError instanceof Error ? retryError.message : String(retryError),
            false,
            voiceTaskStartedAt,
          ).catch(() => undefined);
          throw retryError;
        }
      } else {
        recordClientToolRun(
          "voice_speech",
          { ...voiceInput, mode: voiceMode },
          error instanceof Error ? error.message : String(error),
          false,
          voiceTaskStartedAt,
        ).catch(() => undefined);
        throw error;
      }
    }
    appLog(`voice synth received audio bytes_b64=${result.audio_base64.length} request=${requestId}`);
    rememberSpeech(cacheKey, result);
    if (requestId !== voicePlaybackRequestRef.current) return;
    recordClientToolRun(
      "voice_speech",
      { ...voiceInput, mode: voiceMode },
      "Generated voice audio.",
      true,
      voiceTaskStartedAt,
    ).catch(() => undefined);
    await playAudioBase64(result.audio_base64, result.mime_type);
    appLog(`voice synth playback started request=${requestId}`);
  };

  const speakMessageText = async (
    messageId: string,
    text: string,
    role: "user" | "assistant",
  ) => {
    const speechText = sanitizeTextForSpeech(text);
    if (!speechText.trim()) {
      return;
    }

    setSpeakingMessageId(messageId);
    const requestId = ++voicePlaybackRequestRef.current;
    const voicePath = role === "user" ? selectedUserVoicePath : selectedVoicePath;
    try {
      await synthesizeAndPlaySpeech(speechText, voicePath, requestId);
      setComposerNotice("");
    } catch (error) {
      console.error("Speech error:", error);
      setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === voicePlaybackRequestRef.current) {
        setSpeakingMessageId(null);
      }
      if (activeTaskTypeRef.current === "voice") {
        activeTaskTypeRef.current = "none";
        setActiveTaskType("none");
      }
      if (!sendInFlightRef.current && !isStreaming) {
        setBrainStatus(activeTaskTypeRef.current === "llm" ? "Ready" : "Idle");
      }
    }
  };

  const playAutoSpeechQueue = async (queue: string[], requestId: number) => {
    for (const messageId of queue) {
      if (requestId !== voicePlaybackRequestRef.current) return;
      const message = messages.find((item) => item.id === messageId && item.role === "assistant");
      const speechText = sanitizeTextForSpeech(message ? extractMessageText(message.content) : "");
      if (!speechText.trim()) {
        autoSpeechEligibleAssistantIdsRef.current.delete(messageId);
        continue;
      }

      autoSpeechEligibleAssistantIdsRef.current.delete(messageId);
      lastAutoSpokenAssistantIdRef.current = messageId;
      setSpeakingMessageId(messageId);
      try {
        await synthesizeAndPlaySpeech(speechText, selectedVoicePath, requestId);
      } catch (error) {
        console.error("Live speech error:", error);
        appLog(`live speech failed message=${messageId} error=${error instanceof Error ? error.message : String(error)}`);
        setComposerNotice(error instanceof Error ? error.message : String(error));
        return;
      } finally {
        if (requestId === voicePlaybackRequestRef.current) {
          setSpeakingMessageId(null);
        }
        if (activeTaskTypeRef.current === "voice") {
          activeTaskTypeRef.current = "none";
          setActiveTaskType("none");
        }
      }
    }
    if (requestId === voicePlaybackRequestRef.current) {
      setComposerNotice("");
      if (!sendInFlightRef.current && !isStreaming) {
        setBrainStatus(activeTaskTypeRef.current === "llm" ? "Ready" : "Idle");
      }
    }
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

  const previewVoiceSample = async (sample: VoiceSample) => {
    if (previewingVoicePath === sample.path) {
      voicePlaybackRequestRef.current += 1;
      stopActiveAudio();
      setPreviewingVoicePath(null);
      return;
    }

    voicePlaybackRequestRef.current += 1;
    stopActiveAudio();
    const requestId = voicePlaybackRequestRef.current;
    setPreviewingVoicePath(sample.path);
    try {
      await ensureAudioPlaybackUnlocked().catch(() => null);
      await synthesizeAndPlaySpeech(
        detectVoicePreviewText(sample),
        sample.path,
        requestId,
      );
      setComposerNotice("");
    } catch (error) {
      console.error("Voice preview error:", error);
      setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === voicePlaybackRequestRef.current) {
        setPreviewingVoicePath(null);
      }
      if (activeTaskTypeRef.current === "voice") {
        activeTaskTypeRef.current = "none";
        setActiveTaskType("none");
      }
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

  const scanModelLibrary = async (
    folderPath: string,
    preferredPath?: string,
    autoLoad?: boolean,
  ) => {
    if (!folderPath) {
      setAvailableModels([]);
      setSelectedModelPath("");
      setSelectedModel(null);
      return;
    }

    try {
      const models = await invoke<ModelLibraryEntry[]>("scan_model_folder", {
        folderPath,
      });
      setAvailableModels(models);

      if (models.length === 0) {
        setComposerNotice("No GGUF brains were found in that folder.");
        setSelectedModelPath("");
        return;
      }

      const targetPath =
        preferredPath && models.some((model) => model.path === preferredPath)
          ? preferredPath
          : models[0].path;
      setSelectedModelPath(targetPath);
      setComposerNotice("");

      if (autoLoad) {
        if (engineStatus === "ready") {
          await loadModelPath(targetPath);
        } else {
          setPendingAutoLoadPath(targetPath);
        }
      }
    } catch (error) {
      console.error("Model library scan error:", error);
      setComposerNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const handleChooseModelFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose your GGUF library folder",
      defaultPath: modelFolder || undefined,
    });

    if (typeof selected !== "string") {
      return;
    }

    setModelFolder(selected);
    await scanModelLibrary(selected, "", false);
  };

  const handleChooseVoiceFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose voice samples folder",
      defaultPath: voiceFolder || undefined,
    });

    if (typeof selected !== "string") {
      return;
    }

    setVoiceFolder(selected);
    updateActiveCharacterVoicePath("");
  };

  const handleTestTelegram = async () => {
    setTelegramStatus("Checking Telegram...");
    try {
      const status = await invoke<TelegramBotStatus>("test_telegram_bot", {
        token: telegramBotToken,
      });
      setTelegramStatus(status.message);
    } catch (error) {
      setTelegramStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const buildSystemContextBlock = () => [
    `Time: ${new Date().toLocaleString()}`,
    `Location: ${localContext}`,
    `Default location: ${localContext}`,
    `Character folder: ${characterFolder || "not initialized"}`,
    `Active model: ${currentModelName}`,
    `Workspace folders: ${linkedFolders.length ? linkedFolders.join("; ") : "none"}`,
    `Google: ${googleStatus.connected ? "online" : "offline"}`,
    `Telegram: ${telegramRunning ? "online" : "offline"}`,
    `Voice: input ${voiceSetupStatus.ready ? "ready" : "not ready"}, tts ${omniVoiceStatus.ready ? "ready" : "not ready"}`,
    "Image: local Qwen image model",
  ].join(" | ");

  const buildAssistantRuntimePrompt = () => {
    const activePersonality =
      personalityPresets.find((preset) => preset.id === selectedPersonalityId) ?? personalityPresets[0];
    return [
      `Assistant profile:
Name: ${activePersonality?.name || "Assistant"}
Instructions:
${personality || activePersonality?.prompt || "Helpful assistant."}
`,
      characterSoul.trim() ? `\nAdditional character context:\n${characterSoul.trim()}` : "",
      personalityMemory.trim()
        ? `\nConversation memory:
${personalityMemory.trim()}
`
        : "",
      userName.trim() || userDescription.trim()
        ? `\nUser profile:\nName: ${userName.trim() || "User"}\nAbout user: ${userDescription.trim() || "No extra details."}`
        : "",
      linkedFolders.length
        ? `\nPermitted workspace folders:\n${linkedFolders.join("\n")}`
        : "\nPermitted workspace folders: none selected.",
      `\nConnected utilities:
Google Calendar: ${googleStatus.connected ? `online${googleStatus.email ? ` (${googleStatus.email})` : ""}` : "offline"}
Gmail: ${googleStatus.connected ? "online" : "offline"}
Telegram control: ${telegramRunning ? "online" : "offline"}
Voice input: ${voiceSetupStatus.ready ? "ready" : "not ready"}
Voice TTS: ${omniVoiceStatus.ready ? "ready" : "not ready"}
Image generation: local Qwen image model
User location: ${localContext}`,
    ].join("");
  };

  const updateActiveCharacterVoicePath = (voicePath: string) => {
    setSelectedVoicePath(voicePath);
    if (!selectedPersonalityId) return;
    setPersonalityPresets((prev) =>
      prev.map((preset) =>
        preset.id === selectedPersonalityId ? { ...preset, voice_path: voicePath } : preset,
      ),
    );
  };

  const updateActiveUserProfile = (patch: Partial<UserProfilePreset>) => {
    setUserProfiles((prev) =>
      prev.map((profile) =>
        profile.id === selectedUserProfileId ? { ...profile, ...patch } : profile,
      ),
    );
  };

  const updateActiveUserVoicePath = (voicePath: string) => {
    updateActiveUserProfile({ voice_path: voicePath });
  };

  const saveActiveCharacterFiles = async (
    override?: Partial<CharacterSettings> & { name?: string; soul?: string },
  ) => {
    const activePersonality =
      personalityPresets.find((preset) => preset.id === selectedPersonalityId) ?? personalityPresets[0];
    if (!activePersonality) return;
    const nextName = override?.name ?? activePersonality.name;
    const nextPrompt = override?.prompt ?? (personality || activePersonality.prompt || "");
    const settings: CharacterSettings = {
      voice_path: override?.voice_path ?? selectedVoicePath ?? "",
      avatar: override?.avatar ?? activePersonality.avatar ?? personalityAvatar ?? "",
      prompt: nextPrompt,
      greeting: override?.greeting ?? "",
      notes: override?.notes ?? "",
    };
    const nextSoul = syncSoulCoreIdentity(override?.soul ?? characterSoul, nextName, nextPrompt);
    const saved = await invoke<CharacterFiles>("save_character_files", {
      id: activePersonality.id,
      name: nextName,
      soul: nextSoul,
      settings,
    });
    setCharacterSoul(saved.soul);
    setCharacterFolder(saved.folder);
  };

  const handleStartTelegram = async () => {
    setTelegramStatus("Starting Telegram control...");
    try {
      const status = await invoke<TelegramBotStatus>("start_telegram_bot", {
        token: telegramBotToken,
        ownerUserId: telegramOwnerId,
        systemPrompt: buildAssistantRuntimePrompt(),
        temperature: samplingTemperature,
        thinkingEnabled,
        topK,
        topP,
        minP,
        repeatLastN,
        repeatPenalty,
        maxTokens: Math.min(replyLength, 768),
        googleClientId,
        googleClientSecret,
        folders: linkedFolders,
      });
      setTelegramRunning(status.success);
      setTelegramStatus(status.message);
    } catch (error) {
      setTelegramRunning(false);
      setTelegramStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handleStopTelegram = async () => {
    try {
      const status = await invoke<TelegramBotStatus>("stop_telegram_bot");
      setTelegramRunning(false);
      setTelegramStatus(status.message);
    } catch (error) {
      setTelegramStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const setAutoVoiceMode = (enabled: boolean) => {
    if (enabled) {
      ensureAudioPlaybackUnlocked().catch(() => null);
      invoke("prepare_omnivoice_engine").catch(() => undefined);
    }
    setLiveConversation(enabled);
  };

  const personalityMemoryKind = (id = selectedPersonalityId) => `personality:${id}`;

  const handleChatScroll = (e: React.UIEvent<HTMLDivElement>) => {
    markUiInteraction();
    const target = e.target as HTMLDivElement;
    const isScrolledUp = target.scrollHeight - target.scrollTop - target.clientHeight > 150;
    setShowScrollBottom(isScrolledUp);
  };

  const scrollToBottom = () => {
    if (conversationScrollRef.current) {
      conversationScrollRef.current.scrollTo({
        top: conversationScrollRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  };

  const previewUserVoiceSample = async (sample: VoiceSample) => {
    await previewVoiceSample(sample);
  };

  const prepareVoiceHelpers = async (showNotice = false) => {
    if (voiceAutoPrepareStartedRef.current) return;
    voiceAutoPrepareStartedRef.current = true;
    if (showNotice) {
      setSetupNotice("Preparing voice helper so speech is ready on first use...");
    }
    try {
      const voiceStatus = await invoke<VoiceSetupStatus>("start_voice_setup");
      setVoiceSetupStatus(voiceStatus);
    } catch (error) {
      console.error("Voice helper auto-prepare error:", error);
    }
    try {
      const ttsStatus = await invoke<VoiceSetupStatus>("prepare_omnivoice_engine");
      setOmniVoiceStatus(ttsStatus);
    } catch (error) {
      console.error("Voice TTS auto-prepare error:", error);
    }
  };

  const snapConversationToBottom = () => {
    const container = conversationScrollRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "auto",
    });
  };

  const ensureConversationStartsAtBottom = () => {
    window.requestAnimationFrame(() => {
      snapConversationToBottom();
      window.requestAnimationFrame(() => {
        snapConversationToBottom();
      });
    });
    window.setTimeout(() => {
      snapConversationToBottom();
    }, 60);
  };

  const compactPersonalityMemory = (memory: string, feedback: string) => {
    const cleanFeedback = feedback.replace(/\s+/g, " ").trim();
    if (!cleanFeedback) return memory.trim();
    const bullet = `- ${cleanFeedback}`;
    const existing = memory
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line !== bullet);
    const next = [...existing, bullet].slice(-14).join("\n");
    return next.length > 2200 ? next.slice(next.length - 2200).replace(/^[^\n]*\n?/, "") : next;
  };

  const isPersonalityTrainingFeedback = (text: string) => {
    const lower = normalizeIntentText(text);
    return includesAnyPhrase(lower, [
      "remember",
      "learn",
      "from now on",
      "answer like",
      "dont answer",
      "do not answer",
      "bad answer",
      "good answer",
      "format like",
      "style like",
      "sai",
    ]);
  };

  const updatePersonalityMemoryAfterTurn = async (userText: string, answerText: string) => {
    if (!selectedPersonalityId || !isPersonalityTrainingFeedback(userText)) return;
    const feedback = `User feedback: ${userText}${answerText.trim() ? ` | Last answer summary: ${answerText.trim().slice(0, 220)}` : ""}`;
    const nextMemory = compactPersonalityMemory(personalityMemory, feedback);
    setPersonalityMemory(nextMemory);
    personalityMemoryShadowRef.current[selectedPersonalityId] = nextMemory;
    try {
      await invoke<MemoryItem>("remember_local_memory", {
        kind: personalityMemoryKind(),
        key: "compact_style_memory",
        value: nextMemory,
        source: "personality_training",
        confidence: 0.9,
      });
    } catch (error) {
      console.error("Personality memory save error:", error);
    }
  };

  const deletePersonalityMemory = async (personalityId: string) => {
    try {
      const items = await invoke<MemoryItem[]>("list_local_memory", {
        kind: personalityMemoryKind(personalityId),
        limit: 100,
      });
      await Promise.all(items.map((item) => invoke<boolean>("forget_local_memory", { id: item.id })));
    } catch (error) {
      console.error("Personality memory delete error:", error);
    }
  };

  const handleClearPersonalityMemory = async () => {
    if (!selectedPersonalityId) return;
    try {
      // Clear the compact style memory from the DB
      await deletePersonalityMemory(selectedPersonalityId);
      setPersonalityMemory("");
      // Optionally clear the saved chat session too
      if (clearSessionToo) {
        await invoke<boolean>("delete_personality_chat_session", { personalityId: selectedPersonalityId });
        setMessages([]);
      }
    } catch (error) {
      console.error("Clear memory error:", error);
    } finally {
      setClearMemoryConfirmOpen(false);
      setClearSessionToo(false);
    }
  };

  const dismissImageProposal = (messageId: string, proposalIndex: number) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId || !Array.isArray(message.content)) {
          return message;
        }
        const nextContent = message.content.filter((_, index) => index !== proposalIndex);
        return {
          ...message,
          content: nextContent.length ? nextContent : "Image creation was cancelled.",
        };
      }),
    );
  };

  const dismissChatPart = (messageId: string, partIndex: number, fallbackText: string) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId || !Array.isArray(message.content)) {
          return message;
        }
        const nextContent = message.content.filter((_, index) => index !== partIndex);
        return {
          ...message,
          content: nextContent.length ? nextContent : fallbackText,
        };
      }),
    );
  };

  const proposalString = (proposal: ActionProposal, key: string) => {
    const value = proposal.arguments?.[key];
    return typeof value === "string" ? value : "";
  };

  const proposalJsonPayload = (proposal: ActionProposal, key: string) => {
    const value = proposal.arguments?.[key];
    if (value == null) {
      return null;
    }
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value);
  };

  const executeActionProposal = async (proposal: ActionProposal) => {
    if (proposal.action_type === "write_file") {
      const result = await invoke<FileActionResult>("write_linked_text_file", {
        relativePath: proposalString(proposal, "relative_path"),
        content: proposalString(proposal, "content"),
        rootFolder: proposalString(proposal, "root_folder") || linkedFolders[0],
        folders: linkedFolders,
      });
      return formatFileActionResult(result);
    }
    if (proposal.action_type === "move_file") {
      const result = await invoke<FileActionResult>("move_linked_file", {
        source: proposalString(proposal, "source"),
        destinationRelativePath: proposalString(proposal, "destination_relative_path"),
        rootFolder: proposalString(proposal, "root_folder") || linkedFolders[0],
        folders: linkedFolders,
      });
      return formatFileActionResult(result);
    }
    if (proposal.action_type === "delete_file") {
      const result = await invoke<FileActionResult>("trash_linked_file", {
        source: proposalString(proposal, "source"),
        folders: linkedFolders,
      });
      return formatFileActionResult(result);
    }
    if (proposal.action_type === "run_powershell") {
      const action = await invoke<PendingShellAction>("propose_shell_action", {
        command: proposalString(proposal, "command"),
        workingDirectory: proposalString(proposal, "working_directory") || undefined,
        purpose: proposalString(proposal, "purpose") || proposal.details,
        timeoutSeconds: Number(proposal.arguments?.timeout_seconds) || 30,
      });
      setPendingShellActions((prev) => [...prev.filter((item) => item.id !== action.id), action]);
      return `System action is waiting for final approval: ${action.purpose}`;
    }
    if (proposal.action_type === "gmail_send") {
      return await invoke<string>("send_google_gmail_message", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        to: proposalString(proposal, "to"),
        subject: proposalString(proposal, "subject"),
        body: proposalString(proposal, "body"),
        senderName: selectedUserProfile?.name || userName || undefined,
      });
    }
    if (proposal.action_type === "gmail_trash") {
      return await invoke<string>("trash_google_gmail_message", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        id: proposalString(proposal, "id"),
      });
    }
    if (proposal.action_type === "calendar_create") {
      const result = await invoke<{ id: string; title: string; html_link: string | null }>("create_google_calendar_event", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        title: proposalString(proposal, "title"),
        start: proposalString(proposal, "start"),
        end: proposalString(proposal, "end"),
        description: proposalString(proposal, "description") || null,
        location: proposalString(proposal, "location") || null,
      });
      return `Event created: "${result.title}"${result.html_link ? ` \u2014 [Open in Calendar](${result.html_link})` : ""}`;
    }
    if (proposal.action_type === "calendar_delete") {
      return await invoke<string>("delete_google_calendar_event", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        id: proposalString(proposal, "id"),
      });
    }
    if (proposal.action_type === "google_contact_delete") {
      return await invoke<string>("delete_google_contact", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        resourceName: proposalString(proposal, "resource_name"),
      });
    }
    if (proposal.action_type === "google_action") {
      return await invoke<string>("execute_google_api", {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        method: proposalString(proposal, "method") || "POST",
        url: proposalString(proposal, "url"),
        payload: proposalJsonPayload(proposal, "payload"),
      });
    }
    throw new Error("This action type is not supported yet.");
  };

  const naturalizeSystemResult = async (userRequest: string, rawResult: string) => {
    const trimmed = rawResult.trim();
    if (!trimmed) return "";
    try {
      const ready = await ensureChatModelReady();
      if (!ready) return trimmed;
      const languageHint = conversationWantsVietnamese(messages) || textLooksVietnamese(userRequest)
        ? "Reply in natural Vietnamese matching the current conversation."
        : "Reply in the current conversation language.";
      const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stream: false,
          temperature: samplingTemperature,
          top_k: topK,
          top_p: topP,
          min_p: minP,
          repeat_last_n: repeatLastN,
          repeat_penalty: repeatPenalty,
          max_tokens: Math.min(160, replyLength),
          messages: [
            {
              role: "system",
              content: `Turn a verified system/tool result into one short, natural assistant reply. ${languageHint} Do not expose message IDs, raw API wording, JSON, tool names, or backend status unless the user explicitly needs it.`,
            },
            {
              role: "user",
              content: `Original user request:\n${userRequest.trim() || "(scheduled automation)"}\n\nVerified result:\n${trimmed}`,
            },
          ],
        }),
      });
      if (!response.ok) return trimmed;
      const body = await response.json();
      const reply = body?.choices?.[0]?.message?.content;
      return typeof reply === "string" && reply.trim() ? reply.trim() : trimmed;
    } catch (error) {
      console.error("Naturalize system result error:", error);
      return trimmed;
    }
  };

  const approveActionProposal = async (messageId: string, partIndex: number, proposal: ActionProposal) => {
    setIsApproving(true);
    try {
      console.log("Approving action:", proposal.action_type, proposal.arguments);
      const rawResult = await executeActionProposal(proposal);
      const naturalResultText = await naturalizeSystemResult(proposal.details || proposal.action_type, rawResult);
      dismissChatPart(messageId, partIndex, "Action approved.");
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          content: naturalResultText,
        },
      ]);
      return;
    } catch (error) {
      console.error("Action approval error:", error);
      setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setIsApproving(false);
    }
  };

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

  const stopActiveResponse = () => {
    activeChatRequestRef.current += 1;
    activeChatAbortRef.current?.abort();
    activeChatAbortRef.current = null;
    sendInFlightRef.current = false;
    setIsStreaming(false);
    setBrainStatus("Ready");
    setComposerNotice("Stopped.");
  };

  useEffect(() => {
    if (!settingsLoaded) return;

    const checkAutomations = () => {
      if (sendInFlightRef.current || isStreaming || engineStatus !== "ready" || !selectedModelPath) {
        return;
      }
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;

      const now = new Date();
      const dueJob = automationJobs.find((job) => {
        if (!job.enabled) return false;
        const dueAt = getAutomationDueAt(job, now);
        if (!dueAt) return false;
        if ((job.last_run_at ?? 0) * 1000 >= dueAt) return false;
        const runKey = `${job.id}:${dueAt}`;
        if (automationRunKeysRef.current.has(runKey)) return false;
        automationRunKeysRef.current.add(runKey);
        return true;
      });

      if (!dueJob) return;

      setComposerNotice(`Running scheduled task: ${dueJob.name}`);
      invoke<AutomationJob>("mark_automation_job_ran", { id: dueJob.id })
        .then((updated) => {
          setAutomationJobs((prev) => prev.map((job) => (job.id === updated.id ? updated : job)));
        })
        .catch((error) => console.error("Automation mark error:", error));

      handleSend({
        text: dueJob.prompt,
        sourceLabel: dueJob.name,
        skipLocalIntent: true,
        silentUser: true,
        autoApproveActions: true,
      }).catch((error) => console.error("Automation run error:", error));
    };

    checkAutomations();
    const handle = window.setInterval(checkAutomations, 15_000);
    return () => window.clearInterval(handle);
  }, [settingsLoaded, automationJobs, isStreaming, engineStatus, selectedModelPath]);

  const handleGenerateImage = async (promptOverride?: string, mode = "text_to_image", maskPrompt?: string | null) => {
    const prompt = (promptOverride ?? composerInputRef.current?.value ?? input).trim();
    if (!prompt || isGeneratingImage) {
      return;
    }
    const latestChatImage = [...messages]
      .reverse()
      .find((message) =>
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === "image_url"),
      )
      ?.content;
    const latestChatImageUrl = Array.isArray(latestChatImage)
      ? latestChatImage.find((part) => part.type === "image_url")?.image_url.url
      : null;
    const initImageDataUrls = (() => {
      if (mode === "avatar_image") return assistantAvatar ? [assistantAvatar] : [];
      if (mode === "user_avatar_image" || mode === "avatar_user_image") return userAvatar ? [userAvatar] : [];
      if (mode === "user_character_image" || mode === "user_and_character_image" || mode === "both_avatars_image") {
        return [userAvatar, assistantAvatar].filter((value): value is string => Boolean(value));
      }
      const source = image || (mode === "image_to_image" && latestChatImageUrl?.startsWith("data:image/") ? latestChatImageUrl : null);
      return source ? [source] : [];
    })();
    const needsReferenceImage = mode === "avatar_image" || mode === "user_avatar_image" || mode === "avatar_user_image" || mode === "user_character_image" || mode === "user_and_character_image" || mode === "both_avatars_image" || mode === "image_to_image";
    const needsBothAvatars = mode === "user_character_image" || mode === "user_and_character_image" || mode === "both_avatars_image";
    if (needsBothAvatars && initImageDataUrls.length < 2) {
      setComposerNotice("This image mode needs both the user avatar and character avatar first.");
      return;
    }
    if (needsReferenceImage && initImageDataUrls.length === 0) {
      setComposerNotice("This image mode needs a profile or attached image first.");
      return;
    }

    const assistantMessageId = createMessageId();
    setIsGeneratingImage(true);
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "Sending image...",
      },
    ]);
    setComposerText("");
    const imageTaskStartedAt = performance.now();
    const imageRunInput = {
      mode,
      prompt,
      mask_prompt: maskPrompt || "",
      width: imageWidth,
      height: imageHeight,
      reference_images: initImageDataUrls.length,
    };

    try {
      await unloadLlmForTask("image");
      await invoke("stop_omnivoice_engine").catch(() => undefined);
      appLog(
        `image-trace request prompt=${JSON.stringify(prompt).slice(0, 800)} size=${imageWidth}x${imageHeight}`,
      );
      const result = await invoke<{ image_base64: string; mime_type: string; file_path: string }>("generate_image", {
        prompt,
        initImageDataUrl: initImageDataUrls[0] || null,
        initImageDataUrls,
        maskPrompt: maskPrompt || null,
        width: imageWidth,
        height: imageHeight,
      });
      const imageUrl = `data:${result.mime_type};base64,${result.image_base64}`;
      appLog(`image-trace response mime=${result.mime_type} bytes_b64=${result.image_base64.length} file=${result.file_path || "<unknown>"}`);
      setIsGeneratingImage(false);
      const naturalReply = await generateNaturalImageCompletionReply(prompt, mode, imageUrl);
      updateAssistantMessageById(assistantMessageId, (last) => ({
        ...last,
        content: [
          { type: "text", text: naturalReply || "" },
          { type: "image_url", image_url: { url: imageUrl, local_path: result.file_path } },
        ],
      }));
      if (liveConversationRef.current && naturalReply.trim()) {
        autoSpeechEligibleAssistantIdsRef.current.add(assistantMessageId);
      }
      clearImage();
      setComposerNotice("");
      recordClientToolRun(
        "generate_image",
        imageRunInput,
        result.file_path ? `Generated image: ${result.file_path}` : "Generated image.",
        true,
        imageTaskStartedAt,
      ).catch(() => undefined);
    } catch (error) {
      recordClientToolRun(
        "generate_image",
        imageRunInput,
        error instanceof Error ? error.message : String(error),
        false,
        imageTaskStartedAt,
      ).catch(() => undefined);
      updateLastAssistantMessage((last) => ({
        ...last,
        content: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleQuickImageGenerate = async () => {
    const prompt = quickImagePrompt.trim();
    if (!prompt || isGeneratingImage) {
      return;
    }

    setIsGeneratingImage(true);
    setComposerNotice("Generating image...");
    const imageTaskStartedAt = performance.now();
    const imageRunInput = {
      mode: "text_to_image",
      prompt,
      width: imageWidth,
      height: imageHeight,
      source: "image_studio",
    };

    try {
      await unloadLlmForTask("image");
      await invoke("stop_omnivoice_engine").catch(() => undefined);
      appLog(
        `image-trace quick request prompt=${JSON.stringify(prompt).slice(0, 800)} size=${imageWidth}x${imageHeight}`,
      );
      const result = await invoke<{ image_base64: string; mime_type: string; file_path: string }>("generate_image", {
        prompt,
        initImageDataUrl: null,
        initImageDataUrls: [],
        maskPrompt: null,
        width: imageWidth,
        height: imageHeight,
      });
      const imageUrl = `data:${result.mime_type};base64,${result.image_base64}`;
      appLog(`image-trace quick response mime=${result.mime_type} bytes_b64=${result.image_base64.length} file=${result.file_path || "<unknown>"}`);
      setQuickImagePrompt("");
      setComposerNotice("");
      setIsGeneratingImage(false);
      recordClientToolRun(
        "generate_image",
        imageRunInput,
        result.file_path ? `Generated image: ${result.file_path}` : "Generated image.",
        true,
        imageTaskStartedAt,
      ).catch(() => undefined);
      await handleSend({
        text: prompt,
        imageDataUrl: imageUrl,
        imagePath: result.file_path,
        sourceLabel: "Image Studio",
        skipLocalIntent: true,
      });
    } catch (error) {
      console.error("Quick image generation error:", error);
      recordClientToolRun(
        "generate_image",
        imageRunInput,
        error instanceof Error ? error.message : String(error),
        false,
        imageTaskStartedAt,
      ).catch(() => undefined);
      setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleMicToggle = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (!voiceSetupStatus.ready) {
      setComposerNotice(
        voiceSetupStatus.state === "error"
          ? voiceSetupStatus.message
          : voiceSetupStatus.state === "idle"
            ? "Preparing voice listening now. Click the microphone again when it says ready."
            : "The voice helper is still getting ready. Please wait a moment.",
      );
      if (voiceSetupStatus.state === "idle") {
        await invoke("start_voice_setup");
      }
      return;
    }

    try {
      await unloadLlmForTask("voice");
      if (navigator.permissions?.query) {
        try {
          const permission = await navigator.permissions.query({ name: "microphone" as PermissionName });
          if (permission.state === "denied") {
            setComposerNotice("Microphone permission is blocked. Allow microphone access in the browser or app settings first.");
            return;
          }
        } catch {
          // Some environments do not expose microphone permission queries.
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      recordedChunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        setIsRecording(false);

        if (blob.size === 0) {
          return;
        }

        setIsTranscribing(true);
        try {
          const reader = new FileReader();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error("Could not read the recording."));
            reader.readAsDataURL(blob);
          });

          const result = await invoke<{
            text: string;
            language: string;
            language_probability: number;
          }>("transcribe_audio", {
            audioDataUrl: dataUrl,
          });

          {
            const currentText = composerInputRef.current?.value ?? input;
            setComposerText(currentText ? `${currentText} ${result.text}`.trim() : result.text);
          }
          setComposerNotice("");
        } catch (error) {
          console.error("Transcription error:", error);
          setComposerNotice(error instanceof Error ? error.message : String(error));
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      setComposerNotice("");
      setIsRecording(true);
    } catch (error) {
      console.error("Microphone error:", error);
      setComposerNotice("Microphone access was not granted. Allow microphone access and try again.");
    }
  };

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
        const activeUserProfile =
          normalizedUserProfiles.find((profile) => profile.id === nextUserProfileId) ??
          normalizedUserProfiles[0] ??
          DEFAULT_SETTINGS.user_profiles[0];
        setUserProfiles(normalizedUserProfiles);
        setSelectedUserProfileId(activeUserProfile.id);
        setUserName(activeUserProfile.name || DEFAULT_SETTINGS.user_name);
        setUserAvatar(activeUserProfile.avatar || nextUserAvatar);
        setUserDescription(activeUserProfile.description || "");
        setUserLocationLabel(activeUserProfile.location_label || "");
        setUserLatitude(typeof activeUserProfile.latitude === "number" && Number.isFinite(activeUserProfile.latitude) ? activeUserProfile.latitude : null);
        setUserLongitude(typeof activeUserProfile.longitude === "number" && Number.isFinite(activeUserProfile.longitude) ? activeUserProfile.longitude : null);
        setThemeSwatchId(
          THEME_SWATCHS.some((swatch) => swatch.id === stored.theme_swatch_id)
            ? stored.theme_swatch_id
            : DEFAULT_SETTINGS.theme_swatch_id,
        );
        setLiveConversation(stored.live_conversation);
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
        setMemorySize(clampNumber(stored.memory_size, MIN_CHAT_CONTEXT_SIZE, 32768));
        setReplyLength(clampNumber(stored.reply_length, 64, 4096));
        setIntelligenceQuality(clampNumber(stored.intelligence_quality, 0, 100));
        setPersonality(stored.personality || DEFAULT_SETTINGS.personality);
        setPersonalityPresets(normalizedPresets);
        const nextPersonalityId = stored.selected_personality_id || DEFAULT_SETTINGS.selected_personality_id;
        setSelectedPersonalityId(nextPersonalityId);
        setPersonalityNameDraft(normalizedPresets.find((preset) => preset.id === nextPersonalityId)?.name || "Assistant");
        setPersonalityAvatar(
          normalizedPresets.find((preset) => preset.id === nextPersonalityId)?.avatar || "",
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

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const register = async (event: string, handler: () => void) => {
      const unlisten = await listen(event, handler);
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    };

    const attachTrayHandlers = async () => {
      await Promise.all([
        register("tray-toggle-telegram", () => {
          (telegramRunning ? handleStopTelegram() : handleStartTelegram()).catch((error) =>
            console.error("Tray Telegram toggle error:", error),
          );
        }),
        register("tray-toggle-auto-voice", () => setAutoVoiceMode(!liveConversation)),
      ]);
    };

    attachTrayHandlers().catch((error) => console.error("Tray handler setup error:", error));

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [
    telegramBotToken,
    telegramOwnerId,
    samplingTemperature,
    topK,
    topP,
    minP,
    repeatLastN,
    repeatPenalty,
    replyLength,
    googleClientId,
    googleClientSecret,
    linkedFolders,
    personality,
    characterSoul,
    personalityMemory,
    userName,
    userDescription,
    googleStatus.connected,
    googleStatus.email,
    telegramRunning,
    voiceSetupStatus.ready,
    omniVoiceStatus.ready,
    liveConversation,
  ]);

  useEffect(() => {
    if (!settingsLoaded) return;
    invoke("update_tray_menu_state", {
      telegramRunning,
      autoVoice: liveConversation,
    }).catch((error) => console.error("Tray menu state update error:", error));
  }, [settingsLoaded, telegramRunning, liveConversation]);

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

  useEffect(() => {
    if (!settingsLoaded || !settingsReadyForSave || !selectedPersonalityId || !characterSoul.trim()) return;
    const handle = window.setTimeout(() => {
      saveActiveCharacterFiles().catch((error) => console.error("Character files save error:", error));
    }, 900);
    return () => window.clearTimeout(handle);
  }, [settingsLoaded, settingsReadyForSave, selectedPersonalityId, selectedVoicePath, personality, personalityAvatar, characterSoul]);

  useEffect(() => {
    const applyMissingTooltip = (event: MouseEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest("button,input,textarea,select")
        : null;
      if (!(target instanceof HTMLElement) || target.getAttribute("title")) return;
      const tooltip =
        target.getAttribute("aria-label") ||
        target.getAttribute("placeholder") ||
        target.textContent?.replace(/\s+/g, " ").trim() ||
        "";
      if (tooltip) target.setAttribute("title", tooltip);
    };
    document.addEventListener("mouseover", applyMissingTooltip, true);
    return () => document.removeEventListener("mouseover", applyMissingTooltip, true);
  }, []);

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

  useEffect(() => {
    chatSessionsRef.current = chatSessions;
  }, [chatSessions]);

  useEffect(() => {
    if (!selectedPersonalityId) return;
    setChatSessions((prev) =>
      prev[selectedPersonalityId] === messages
        ? prev
        : { ...prev, [selectedPersonalityId]: messages },
    );
  }, [messages, selectedPersonalityId]);

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId || loadedChatSessionIdsRef.current.has(selectedPersonalityId)) {
      return;
    }

    let active = true;
    invoke<string>("load_personality_chat_session", { personalityId: selectedPersonalityId })
      .then((raw) => {
        if (!active) return;
        const session = parseStoredChatSession(raw);
        loadedChatSessionIdsRef.current.add(selectedPersonalityId);
        chatSessionsRef.current = { ...chatSessionsRef.current, [selectedPersonalityId]: session };
        setChatSessions((prev) => ({ ...prev, [selectedPersonalityId]: session }));
        setMessages(session);
        lastMessageCountRef.current = session.length;
        sessionShadowRef.current[selectedPersonalityId] = compactSessionFingerprint(session);
        lastSessionMutationAtRef.current[selectedPersonalityId] = Date.now();
      })
      .catch((error) => {
        console.error("Chat session load error:", error);
        loadedChatSessionIdsRef.current.add(selectedPersonalityId);
      });

    return () => {
      active = false;
    };
  }, [settingsLoaded, selectedPersonalityId]);

  useEffect(() => {
    if (!settingsLoaded) return;
    ensureConversationStartsAtBottom();
  }, [settingsLoaded, selectedPersonalityId, messages.length]);

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId || !loadedChatSessionIdsRef.current.has(selectedPersonalityId)) {
      return;
    }
    const session = compactChatSessionForStorage(messages);
    const sessionJson = JSON.stringify(session);
    sessionShadowRef.current[selectedPersonalityId] = sessionJson;
    lastSessionMutationAtRef.current[selectedPersonalityId] = Date.now();
    const handle = window.setTimeout(() => {
      invoke("save_personality_chat_session", {
        personalityId: selectedPersonalityId,
        messagesJson: sessionJson,
      }).catch((error) => console.error("Chat session save error:", error));
    }, 900);
    return () => window.clearTimeout(handle);
  }, [settingsLoaded, selectedPersonalityId, messages]);

  useEffect(() => {
    if (!settingsLoaded) return;
    const missingImages: Array<{ messageId: string; partIndex: number; path: string }> = [];
    messages.forEach((message) => {
      if (!Array.isArray(message.content)) return;
      message.content.forEach((part, partIndex) => {
        if (part.type === "image_url" && part.image_url.local_path && !part.image_url.url) {
          missingImages.push({ messageId: message.id, partIndex, path: part.image_url.local_path });
        }
      });
    });
    if (!missingImages.length) return;

    let cancelled = false;
    Promise.all(
      missingImages.map(async (item) => {
        try {
          const result = await invoke<LocalImageDataUrl>("read_local_image_data_url", { path: item.path });
          return { ...item, url: result.data_url };
        } catch (error) {
          console.error("Stored image reload error:", error);
          return { ...item, url: "" };
        }
      }),
    ).then((loaded) => {
      if (cancelled) return;
      const loadedByPart = new Map(loaded.filter((item) => item.url).map((item) => [`${item.messageId}:${item.partIndex}`, item.url]));
      if (!loadedByPart.size) return;
      setMessages((prev) =>
        prev.map((message) => {
          if (!Array.isArray(message.content)) return message;
          let changed = false;
          const content = message.content.map((part, partIndex) => {
            if (part.type !== "image_url") return part;
            const url = loadedByPart.get(`${message.id}:${partIndex}`);
            if (!url) return part;
            changed = true;
            return { ...part, image_url: { ...part.image_url, url } };
          });
          return changed ? { ...message, content } : message;
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [settingsLoaded, messages]);

  useEffect(() => {
    refreshPendingShellActions();
    refreshAutomationJobs();
    refreshToolRuns();
    refreshGoogleStatus().catch((error) => console.error("Google startup status error:", error));
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId) return;
    invoke<MemoryItem[]>("list_local_memory", {
      kind: personalityMemoryKind(selectedPersonalityId),
      limit: 20,
    })
      .then((items) => {
        const memory = items.find((item) => item.key === "compact_style_memory")?.value || "";
        setPersonalityMemory(memory);
        personalityMemoryShadowRef.current[selectedPersonalityId] = memory;
      })
      .catch((error) => {
        console.error("Personality memory load error:", error);
        setPersonalityMemory("");
        personalityMemoryShadowRef.current[selectedPersonalityId] = "";
      });
  }, [settingsLoaded, selectedPersonalityId]);

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId || !loadedChatSessionIdsRef.current.has(selectedPersonalityId)) {
      return;
    }

    let active = true;
    const syncSession = async () => {
      if (sendInFlightRef.current || isStreaming) return;
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;
      const lastMutation = lastSessionMutationAtRef.current[selectedPersonalityId] ?? 0;
      if (Date.now() - lastMutation < 1800) return;
      try {
        const raw = await invoke<string>("load_personality_chat_session", {
          personalityId: selectedPersonalityId,
        });
        if (!active) return;
        const remoteSession = parseStoredChatSession(raw);
        const remoteFingerprint = compactSessionFingerprint(remoteSession);
        const currentFingerprint =
          sessionShadowRef.current[selectedPersonalityId] ??
          compactSessionFingerprint(chatSessionsRef.current[selectedPersonalityId] ?? []);
        if (remoteFingerprint === currentFingerprint) return;
        sessionShadowRef.current[selectedPersonalityId] = remoteFingerprint;
        chatSessionsRef.current = {
          ...chatSessionsRef.current,
          [selectedPersonalityId]: remoteSession,
        };
        setChatSessions((prev) => ({ ...prev, [selectedPersonalityId]: remoteSession }));
        setMessages(remoteSession);
        lastMessageCountRef.current = remoteSession.length;
      } catch (error) {
        console.error("Chat session sync error:", error);
      }
    };

    const handle = window.setInterval(() => {
      syncSession().catch((error) => console.error("Chat session sync error:", error));
    }, telegramRunning ? 2500 : 5000);

    syncSession().catch((error) => console.error("Chat session sync error:", error));
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, [settingsLoaded, selectedPersonalityId, telegramRunning, isStreaming]);

  useEffect(() => {
    if (!settingsLoaded || !selectedPersonalityId) return;

    let active = true;
    const syncMemory = async () => {
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;
      try {
        const items = await invoke<MemoryItem[]>("list_local_memory", {
          kind: personalityMemoryKind(selectedPersonalityId),
          limit: 20,
        });
        if (!active) return;
        const nextMemory = items.find((item) => item.key === "compact_style_memory")?.value || "";
        if ((personalityMemoryShadowRef.current[selectedPersonalityId] ?? "") === nextMemory) {
          return;
        }
        personalityMemoryShadowRef.current[selectedPersonalityId] = nextMemory;
        setPersonalityMemory(nextMemory);
      } catch (error) {
        console.error("Personality memory sync error:", error);
      }
    };

    const handle = window.setInterval(() => {
      syncMemory().catch((error) => console.error("Personality memory sync error:", error));
    }, telegramRunning ? 2500 : 5000);

    syncMemory().catch((error) => console.error("Personality memory sync error:", error));
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, [settingsLoaded, selectedPersonalityId, telegramRunning]);

  useEffect(() => {
    if (!settingsLoaded || !googleStatus.connected) {
      return;
    }

    refreshGoogleCalendarEvents(automationMonth).catch((error) => console.error("Google Calendar refresh error:", error));
  }, [settingsLoaded, googleStatus.connected, automationMonth, googleClientId, googleClientSecret]);

  useEffect(() => {
    let isActive = true;
    let pollHandle: ReturnType<typeof setInterval> | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const initializeEngine = async () => {
      try {
        const info = await invoke<SystemInfo>("check_system");
        if (!isActive) return;
        setSystemInfo(info);

        if (!systemDefaultsAppliedRef.current) {
          setMemorySize((prev) =>
            prev === DEFAULT_SETTINGS.memory_size
              ? Math.max(prev, info.recommended_context_size, MIN_CHAT_CONTEXT_SIZE)
              : prev,
          );
          systemDefaultsAppliedRef.current = true;
        }

        const ready = await invoke<boolean>("check_engine_ready");
        if (!isActive) return;
        if (ready) {
          await refreshEngineInfo();
          setEngineErrorMsg("");
          setEngineStatus("ready");
          return;
        }

        setEngineStatus("downloading");
        const result = await invoke<{ success: boolean; message: string }>("download_engine", {
          hasNvidiaGpu: info.has_nvidia_gpu,
          forceRefresh: false,
        });
        if (!isActive) return;

        if (!result.success) {
          setEngineErrorMsg(result.message);
          setEngineStatus("error");
          return;
        }

        pollHandle = setInterval(async () => {
          try {
            const isReady = await invoke<boolean>("check_engine_ready");
            if (!isActive) return;

            if (isReady && pollHandle) {
              clearInterval(pollHandle);
              if (timeoutHandle) clearTimeout(timeoutHandle);
              await refreshEngineInfo();
              setEngineErrorMsg("");
              setEngineStatus("ready");
            }
          } catch (error) {
            console.error("Engine poll error:", error);
          }
        }, 3000);

        timeoutHandle = setTimeout(() => {
          if (!isActive) return;
          if (pollHandle) clearInterval(pollHandle);
          setEngineStatus("error");
          setEngineErrorMsg("The brain download took too long. Please try again.");
        }, 20 * 60 * 1000);
      } catch (error) {
        if (!isActive) return;
        console.error(error);
        setEngineErrorMsg(error instanceof Error ? error.message : String(error));
        setEngineStatus("error");
      }
    };

    initializeEngine();

    return () => {
      isActive = false;
      if (pollHandle) clearInterval(pollHandle);
      if (timeoutHandle) clearTimeout(timeoutHandle);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let intervalHandle: ReturnType<typeof setInterval> | undefined;

    const syncVoiceStatus = async () => {
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;
      try {
        const status = await invoke<VoiceSetupStatus>("get_voice_setup_status");
        if (!active) return;
        setVoiceSetupStatus(status);

      } catch (error) {
        if (!active) return;
        console.error("Voice status error:", error);
      }
    };

    syncVoiceStatus();
    intervalHandle = setInterval(syncVoiceStatus, 5000);

    return () => {
      active = false;
      if (intervalHandle) clearInterval(intervalHandle);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let intervalHandle: ReturnType<typeof setInterval> | undefined;

    const syncOmniVoiceStatus = async () => {
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;
      try {
        const status = await invoke<VoiceSetupStatus>("get_omnivoice_engine_status");
        if (!active) return;
        setOmniVoiceStatus(status);
      } catch (error) {
        if (!active) return;
        console.error("OmniVoice status error:", error);
      }
    };

    syncOmniVoiceStatus();
    intervalHandle = setInterval(syncOmniVoiceStatus, 5000);

    return () => {
      active = false;
      if (intervalHandle) clearInterval(intervalHandle);
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !settingsReadyForSave) {
      return;
    }

    if (!selectedVoicePath && voiceSamples.length > 0) {
      updateActiveCharacterVoicePath(voiceSamples[0].path);
      return;
    }

    if (
      selectedVoicePath &&
      voiceSamples.length > 0 &&
      !voiceSamples.some((sample) => sample.path === selectedVoicePath)
    ) {
      updateActiveCharacterVoicePath(voiceSamples[0].path);
    }
  }, [settingsLoaded, selectedVoicePath, voiceSamples]);

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

  useEffect(() => {
    if (!settingsLoaded || !liveConversation || isStreaming || isGeneratingImage || isTranscribing || speakingMessageId) {
      return;
    }

    const queue = messages
      .filter((message) => message.role === "assistant" && autoSpeechEligibleAssistantIdsRef.current.has(message.id))
      .map((message) => message.id);
    if (!queue.length) {
      return;
    }

    const firstMessage = messages.find((message) => message.id === queue[0]);
    const firstText = firstMessage ? extractMessageText(firstMessage.content).trim() : "";
    if (!firstText || firstText.startsWith("[Error") || firstText === "[Stopped]") {
      autoSpeechEligibleAssistantIdsRef.current.delete(queue[0]);
      return;
    }

    if (lastAutoSpokenAssistantIdRef.current === queue[0]) {
      return;
    }

    autoSpeechQueueRef.current = queue;
    ensureAudioPlaybackUnlocked().catch(() => null);
    const requestId = ++voicePlaybackRequestRef.current;
    playAutoSpeechQueue(queue, requestId).catch((error) => {
      console.error("Live speech queue error:", error);
    });
  }, [settingsLoaded, messages, liveConversation, isStreaming, isGeneratingImage, isTranscribing, speakingMessageId, selectedVoicePath]);

  useEffect(() => {
    if (messages.length !== 0) {
      return;
    }

    window.requestAnimationFrame(() => {
      const container = conversationScrollRef.current;
      if (!container) return;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "auto",
      });
    });
  }, [messages.length, selectedPersonalityId]);

  useEffect(() => {
    const closeOpenDropdowns = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-dropdown-root]")) {
        return;
      }

      setModelMenuOpen(false);
      setQuickModelMenuOpen(false);
      setThemePickerOpen(false);
      setUserProfileMenuOpen(false);
      setPersonalityMenuOpen(false);
      setAutomationTimeMenuOpen(false);
      setAutomationDateMenuOpen(false);
      setAutomationMonthMenuOpen(false);
      setAutomationEveryUnitMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOpenDropdowns);
    return () => document.removeEventListener("pointerdown", closeOpenDropdowns);
  }, []);

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
  const currentModelName =
    currentModelEntry?.name || selectedModel || (selectedModelPath ? "Selected brain" : "No model selected");
  const selectedPersonalityPreset =
    personalityPresets.find((preset) => preset.id === selectedPersonalityId) ?? personalityPresets[0];
  const assistantAvatar = selectedPersonalityPreset?.avatar || personalityAvatar || "";
  const hardwareGpuLabel = systemInfo?.gpu_details.replace(/\s*\(([^)]+)\)\s*$/, " - $1") ?? "";
  const hardwareRamLabel = systemInfo ? `${(systemInfo.total_ram_mb / 1024).toFixed(1)} GB` : "Unknown";
  const conversationLogoClass = messages.length === 0
    ? "hidden"
    : "pointer-events-none absolute left-1/2 top-1/2 z-0 w-[min(52vw,360px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.045]";
  const compactComposerNotice = composerNotice
    .replace(/^Thinking with tools\.\.\.$/, "Chat: thinking with tools")
    .replace(/^Waiting for confirmation before using tools\.$/, "Chat: waiting for tool confirmation")
    .replace(/^Preparing voice playback\.\.\.$/, "Voice: preparing playback");
  const topStatusText =
    (brainStatus === "Loading" ? `Model: ${modelLoadStatus.message || "loading"}` : "") ||
    (brainStatus === "Error" ? `Model error: ${modelLoadStatus.message || "could not load"}` : "") ||
    (isGeneratingImage ? "Image: generating" : "") ||
    (isTranscribing ? "Voice: transcribing" : "") ||
    (isStreaming ? "Chat: generating reply" : "") ||
    compactComposerNotice ||
    (omniVoiceStatus.state !== "idle" && !omniVoiceStatus.ready ? "Voice: preparing playback" : "") ||
    (voiceSetupStatus.state !== "idle" && !voiceSetupStatus.ready ? `Voice input: ${voiceSetupStatus.message || "preparing"}` : "") ||
    (engineStatus === "downloading" ? "Engine: preparing model runtime" : "") ||
    (selectedModelPath ? `Ready: ${currentModelName}` : "No model loaded");

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
    if (!settingsLoaded || !setupCompleted || firstStartupSetupNeeded || voiceAutoPrepareStartedRef.current) {
      return;
    }
    if (voiceSetupStatus.ready && omniVoiceStatus.ready) {
      return;
    }
    void prepareVoiceHelpers(false);
  }, [settingsLoaded, setupCompleted, firstStartupSetupNeeded, voiceSetupStatus.ready, omniVoiceStatus.ready]);

  const topProgressPercent =
    brainStatus === "Loading" || brainStatus === "Error"
      ? Math.max(8, modelLoadStatus.progress)
      : omniVoiceStatus.state !== "idle" && !omniVoiceStatus.ready
        ? Math.max(8, omniVoiceStatus.progress)
      : voiceSetupStatus.state !== "idle" && !voiceSetupStatus.ready
        ? Math.max(8, voiceSetupStatus.progress)
        : isGeneratingImage
          ? 65
          : isTranscribing
            ? 45
            : isStreaming
              ? 100
              : engineStatus === "downloading"
                ? 25
                : 0;
  const topProgressActive = topProgressPercent > 0;
  const imageStudioDrawing = isGeneratingImage;
  const waveformProcessing =
    isGeneratingImage ||
    isStreaming ||
    isTranscribing ||
    brainStatus === "Loading" ||
    brainStatus === "Thinking" ||
    modelLoadStatus.state === "starting" ||
    modelLoadStatus.state === "loading" ||
    modelLoadStatus.state === "updating" ||
    (activeTaskType === "voice" && !isAudioPlaying) ||
    activeTaskType === "image" ||
    (voiceSetupStatus.state !== "idle" && !voiceSetupStatus.ready) ||
    Boolean(
      composerNotice &&
        /(thinking|preparing|loading|generating|sending|transcribing|starting|updating)/i.test(composerNotice),
    );

  const resizeComposerTextarea = (node: HTMLTextAreaElement) => {
    node.style.height = "0px";
    node.style.height = `${Math.min(192, Math.max(42, node.scrollHeight))}px`;
  };

  const setComposerText = (text: string) => {
    lastComposerInputAtRef.current = Date.now();
    setInput(text);
    setComposerHasText(Boolean(text.trim()));
    const node = composerInputRef.current;
    if (node) {
      node.value = text;
      resizeComposerTextarea(node);
    }
  };

  useEffect(() => {
    const node = composerInputRef.current;
    if (!node) return;
    if (node.value !== input) {
      node.value = input;
    }
    setComposerHasText((previous) => {
      const next = Boolean(node.value.trim());
      return previous === next ? previous : next;
    });
    resizeComposerTextarea(node);
  }, [input]);

  const selectPersonalityPreset = (presetId: string) => {
    const preset = personalityPresets.find((item) => item.id === presetId);
    if (!preset) return;
    saveActiveChatSession();
    setSelectedPersonalityId(preset.id);
    setPersonalityNameDraft(preset.name || "Assistant");
    setPersonality(preset.prompt);
    setPersonalityAvatar(preset.avatar || "");
    if (preset.voice_path) {
      setSelectedVoicePath(preset.voice_path);
    }
    loadChatSessionForPersonality(preset.id);
    setComposerText("");
    clearImage();
    setComposerNotice("");
  };

  const selectUserProfile = (profileId: string) => {
    const profile = userProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    setSelectedUserProfileId(profile.id);
    setUserName(profile.name || "You");
    setUserAvatar(profile.avatar || "");
    setUserDescription(profile.description || "");
    setUserLocationLabel(profile.location_label || "");
    setUserLatitude(typeof profile.latitude === "number" && Number.isFinite(profile.latitude) ? profile.latitude : null);
    setUserLongitude(typeof profile.longitude === "number" && Number.isFinite(profile.longitude) ? profile.longitude : null);
    setUserProfileMenuOpen(false);
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
    setUserProfiles((prev) => [...prev, profile]);
    setSelectedUserProfileId(profile.id);
    setUserName(profile.name);
    setUserAvatar("");
    setUserDescription("");
    setUserLocationLabel("");
    setUserLatitude(null);
    setUserLongitude(null);
    setUserProfileMenuOpen(false);
    setUserProfileOpen(true);
  };

  const openUserProfile = () => {
    setUserProfileMenuOpen(false);
    setUserProfileOpen(true);
  };

  const saveActiveUserProfile = () => {
    const nextName = userName.trim() || selectedUserProfile?.name || "You";
    setUserName(nextName);
    updateActiveUserProfile({
      name: nextName,
      avatar: userAvatar,
      description: userDescription,
      voice_path: selectedUserVoicePath,
      location_label: userLocationLabel,
      latitude: userLatitude,
      longitude: userLongitude,
      auto_speech: selectedUserProfile?.auto_speech ?? true,
    });
    setUserProfileOpen(false);
  };

  const deleteSelectedUserProfile = () => {
    if (userProfiles.length <= 1) return;
    setUserProfiles((prev) => {
      const next = prev.filter((profile) => profile.id !== selectedUserProfileId);
      const fallback = next[0] ?? DEFAULT_SETTINGS.user_profiles[0];
      setSelectedUserProfileId(fallback.id);
      setUserName(fallback.name || "You");
      setUserAvatar(fallback.avatar || "");
      setUserDescription(fallback.description || "");
      setUserLocationLabel(fallback.location_label || "");
      setUserLatitude(typeof fallback.latitude === "number" && Number.isFinite(fallback.latitude) ? fallback.latitude : null);
      setUserLongitude(typeof fallback.longitude === "number" && Number.isFinite(fallback.longitude) ? fallback.longitude : null);
      return next.length ? next : DEFAULT_SETTINGS.user_profiles;
    });
    setUserProfileOpen(false);
  };

  const openPersonalityProfile = () => {
    setPersonalityNameDraft(selectedPersonalityPreset?.name || "Assistant");
    setPersonalityProfileOpen(true);
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
    saveActiveChatSession();
    setPersonalityPresets((prev) => [...prev, preset]);
    setSelectedPersonalityId(preset.id);
    setPersonality(preset.prompt);
    setPersonalityAvatar("");
    setSelectedVoicePath("");
    setPersonalityNameDraft(name);
    setMessages([]);
    loadedChatSessionIdsRef.current.add(preset.id);
    chatSessionsRef.current = { ...chatSessionsRef.current, [preset.id]: [] };
    setChatSessions((prev) => ({ ...prev, [preset.id]: [] }));
    sessionShadowRef.current[preset.id] = compactSessionFingerprint([]);
    lastSessionMutationAtRef.current[preset.id] = Date.now();
    setPersonalityProfileOpen(true);
  };

  const updateSelectedPersonalityPreset = () => {
    const nextName = personalityNameDraft.trim() || selectedPersonalityPreset?.name || "Assistant";
    setPersonalityPresets((prev) =>
      prev.map((preset) =>
        preset.id === selectedPersonalityId
          ? { ...preset, name: nextName, prompt: personality, avatar: personalityAvatar, voice_path: selectedVoicePath }
          : preset,
      ),
    );
    setPersonalityNameDraft(nextName);
    saveActiveCharacterFiles({
      name: nextName,
      prompt: personality,
      avatar: personalityAvatar,
      voice_path: selectedVoicePath,
      soul: characterSoul,
    }).catch((error) => console.error("Character files save error:", error));
  };

  const deleteSelectedPersonalityPreset = () => {
    if (personalityPresets.length <= 1) return;
    const deletedPersonalityId = selectedPersonalityId;
    deletePersonalityMemory(deletedPersonalityId).catch((error) => console.error("Personality memory delete error:", error));
    invoke("delete_personality_chat_session", { personalityId: deletedPersonalityId }).catch((error) =>
      console.error("Personality chat session delete error:", error),
    );
    setPersonalityPresets((prev) => {
      const next = prev.filter((preset) => preset.id !== selectedPersonalityId);
      const fallback = next[0] ?? DEFAULT_SETTINGS.personality_presets[0];
      const { [deletedPersonalityId]: _deletedSession, ...remainingSessions } = chatSessionsRef.current;
      loadedChatSessionIdsRef.current.delete(deletedPersonalityId);
      chatSessionsRef.current = remainingSessions;
      setChatSessions(remainingSessions);
      setSelectedPersonalityId(fallback.id);
      setPersonalityNameDraft(fallback.name || "Assistant");
      setPersonality(fallback.prompt);
      setPersonalityAvatar(fallback.avatar || "");
      setPersonalityMemory("");
      setMessages(remainingSessions[fallback.id] ?? []);
      return next.length ? next : DEFAULT_SETTINGS.personality_presets;
    });
  };

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
      onPreviewUserVoice={(sample) => void previewUserVoiceSample(sample)}
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
  const handleInstallSetupBundle = async () => {
    if (setupInstalling) return;
    setSetupInstalling(true);
    setSetupProgress({
      stage: "starting",
      part_key: "",
      label: "",
      file_index: 0,
      file_count: setupCatalog?.parts.reduce((count, part) => count + part.files.length, 0) || 0,
      percent: 0,
      message: "Preparing local model folders...",
    });
    setSetupNotice("Downloading local AI parts. This can take a long time on the first run...");
    try {
      const result = await invoke<SetupInstallResult>("install_setup_bundle", {
        tier: activeSetupTier,
        hasNvidiaGpu: systemInfo?.has_nvidia_gpu ?? false,
      });
      setSetupCatalog(result.catalog);
      setModelFolder(result.catalog.brain_model_folder);
      setSelectedModelPath(result.catalog.selected_brain_model_path);
      setSetupCompleted(true);
      setLeftPanelOpen(true);
      setRightPanelOpen(true);
      setSetupNotice("Models downloaded. Preparing the app for first use...");
      await ensureRuntimeEngineReady();
      await scanModelLibrary(
        result.catalog.brain_model_folder,
        result.catalog.selected_brain_model_path,
        true,
      );
      setPendingAutoLoadPath(result.catalog.selected_brain_model_path);
      await prepareVoiceHelpers(true);
      setSetupNotice(result.message);
      setSetupScreenOpen(false);
      window.setTimeout(() => ensureConversationStartsAtBottom(), 0);
    } catch (error) {
      console.error("Setup install error:", error);
      setSetupNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSetupInstalling(false);
    }
  };

  const closeSetupScreen = () => {
    setSetupCompleted(true);
    setSetupScreenOpen(false);
    setLeftPanelOpen(true);
    setRightPanelOpen(true);
    window.setTimeout(() => ensureConversationStartsAtBottom(), 0);
  };

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
      <input
        ref={userAvatarPickerRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          readAvatarImage(event.target.files?.[0], setUserAvatar);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={personalityAvatarPickerRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          readAvatarImage(event.target.files?.[0], (dataUrl) => {
            const targetId = avatarTargetPersonalityIdRef.current || selectedPersonalityId;
            setPersonalityAvatar(dataUrl);
            setPersonalityPresets((prev) =>
              prev.map((preset) =>
                preset.id === targetId ? { ...preset, avatar: dataUrl } : preset,
              ),
            );
            avatarTargetPersonalityIdRef.current = null;
          });
          event.currentTarget.value = "";
        }}
      />

      <FreshChatConfirmModal
        open={freshChatConfirmOpen}
        onClose={() => setFreshChatConfirmOpen(false)}
        onClear={() => {
          setMessages([]);
          if (selectedPersonalityId) {
            chatSessionsRef.current = {
              ...chatSessionsRef.current,
              [selectedPersonalityId]: [],
            };
            setChatSessions((prev) => ({ ...prev, [selectedPersonalityId]: [] }));
          }
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
        <aside
          className={`${leftPanelOpen ? "flex" : "hidden"} ${
            isCompactLayout ? "fixed inset-y-0 left-0 z-50 w-[320px]" : "relative z-30 w-[292px] flex-none"
          } flex-col border-r border-[#323437] bg-[#18191b]`}
        >
          <div className="flex h-14 items-center justify-between border-b border-[#282a2c] px-4">
            <div className="text-sm font-semibold text-[#e3e3e3]">App Settings</div>
            <div className="flex items-center gap-2">
              <IconButton size="sm" title="Download models" onClick={() => setSetupScreenOpen(true)}>
                <DownloadIcon />
              </IconButton>
              <IconButton size="sm" title="Close app settings" onClick={() => setLeftPanelOpen(false)}>
                <CloseIcon />
              </IconButton>
            </div>
          </div>
          <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">{leftPanelContent}</div>
        </aside>

        {isCompactLayout && leftPanelOpen && (
          <button
            type="button"
            onClick={() => setLeftPanelOpen(false)}
            className="fixed inset-0 z-40 bg-black/35"
            aria-label="Close app settings overlay"
          />
        )}

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
          {isDragging && (
            <div className="absolute inset-0 z-40 flex items-center justify-center border-4 border-dashed bg-[#131314]/80 backdrop-blur-sm" style={{ borderColor: "var(--accent-soft-strong)" }}>
              <div className="rounded-[28px] bg-[#1e1f20] px-8 py-6 text-center shadow-xl ring-1 ring-[#282a2c]">
                <div className="font-title text-2xl text-[#e3e3e3]">Drop an image here</div>
                <div className="mt-2 text-sm text-[#c4c7c5]">The assistant will add it to the chat with your instruction.</div>
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
            <img src={brandLogo} alt="" aria-hidden="true" className={conversationLogoClass} />
          </div>

          <header className="shrink-0 border-b border-[#282a2c] bg-[#131314] px-3 py-2">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
              <IconButton title={leftPanelOpen ? "Close app settings" : "Open app settings"} onClick={() => setLeftPanelOpen((prev) => !prev)} size="sm" active={leftPanelOpen}>
                <GearIcon />
              </IconButton>
              <div className="min-w-0 overflow-hidden">
                <ResourceHeader
                  activeTaskType={activeTaskType}
                  brainStatus={brainStatus}
                  modelState={modelLoadStatus.state}
                  isGeneratingImage={isGeneratingImage}
                  isAudioPlaying={isAudioPlaying}
                  isVoiceBusy={Boolean(speakingMessageId || previewingVoicePath || isAudioPlaying)}
                />
              </div>
              <IconButton title={rightPanelOpen ? "Close model controls" : "Open model controls"} onClick={() => setRightPanelOpen((prev) => !prev)} size="sm" active={rightPanelOpen}>
                <MenuIcon />
              </IconButton>
            </div>
            <div className="mt-3 text-center text-[11px] font-medium text-[#9aa0a6]">
              {dateTimeLine}
            </div>

            {availableUpdate && (
              <div className="mt-2 flex justify-center">
                <button
                  type="button"
                  onClick={() => openUrl(availableUpdate.url).catch((error) => console.error("Open release page error:", error))}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-[color:var(--accent-soft-strong)] bg-[color:var(--accent-soft)] px-3 py-1 text-[11px] font-bold tracking-[0.12em] text-[color:var(--accent-color)] transition hover:border-[color:var(--accent-color)] hover:bg-[color:var(--accent-soft-strong)]"
                  title={`Open Galaxy AI Hub ${availableUpdate.version} release page`}
                >
                  <DownloadIcon />
                  <span className="truncate">New Update available</span>
                </button>
              </div>
            )}

            {topStatusText && (
              <div className="mt-1.5 rounded-2xl border border-[#282a2c] bg-[#1e1f20] px-3 py-1.5">
                <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-[#c4c7c5]">
                  <span className="min-w-0 truncate">{topStatusText}</span>
                  {topProgressActive && <span className="shrink-0 text-[#9aa0a6]">{Math.round(topProgressPercent)}%</span>}
                </div>
                {topProgressActive && (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#282a2c]">
                    <div
                      className={`h-full transition-all duration-300 ${brainStatus === "Error" ? "bg-rose-500" : ""}`}
                      style={{ width: `${topProgressPercent}%`, backgroundColor: brainStatus === "Error" ? undefined : "var(--accent-color)" }}
                    />
                  </div>
                )}
              </div>
            )}
          </header>

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
            themeSwatches={THEME_SWATCHS}
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
            onComposerInput={(node) => {
              lastComposerInputAtRef.current = Date.now();
              setComposerHasText((previous) => {
                const next = Boolean(node.value.trim());
                return previous === next ? previous : next;
              });
              resizeComposerTextarea(node);
            }}
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

        <aside
          className={`${rightPanelOpen ? "flex" : "hidden"} ${
            isCompactLayout ? "fixed inset-y-0 right-0 z-50 w-[320px]" : "relative z-30 w-[292px] flex-none"
          } flex-col border-l border-[#323437] bg-[#18191b]`}
        >
          <div className="flex h-14 items-center justify-between border-b border-[#282a2c] px-4">
            <div className="text-sm font-semibold text-[#e3e3e3]">Model Controls</div>
            <IconButton size="sm" title="Close model controls" onClick={() => setRightPanelOpen(false)}>
              <CloseIcon />
            </IconButton>
          </div>
          <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">{rightPanelContent}</div>
        </aside>

        {isCompactLayout && rightPanelOpen && (
          <button
            type="button"
            onClick={() => setRightPanelOpen(false)}
            className="fixed inset-0 z-40 bg-black/35"
            aria-label="Close model controls overlay"
          />
        )}
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
