import type { RefObject } from "react";
import type {
  AutomationJob,
  GoogleCalendarEvent,
  GoogleConnectionStatus,
  ModelLibraryEntry,
  PersonalityPreset,
  TelegramGuest,
  ThemeSwatch,
  ToolRunRecord,
  UserProfilePreset,
  VoiceSample,
} from "../appCore";
import { AutomationSection } from "./AutomationSection";
import { BrainSection } from "./BrainSection";
import { CalendarSection } from "./CalendarSection";
import { GoogleSection } from "./GoogleSection";
import { ImageStudioSection } from "./ImageStudioSection";
import { ProfileModalLayer } from "./ProfileModalLayer";
import { ProfilePickerSection } from "./ProfilePickerSection";
import { SamplingSection } from "./SamplingSection";
import { TelegramSection } from "./TelegramSection";
import { ToolActivitySection } from "./ToolActivitySection";
import { WorkspaceSection } from "./WorkspaceSection";

type BrainStatus = "Idle" | "Loading" | "Ready" | "Thinking" | "Error";

export function LeftPanelContent({
  selectedUserProfileId,
  selectedUserName,
  userAvatar,
  userName,
  userProfiles,
  userProfileMenuOpen,
  calendarOpen,
  automationMonth,
  automationMonthDays,
  selectedAutomationDate,
  selectedAutomationDateObj,
  selectedAutomationLabel,
  googleCalendarEvents,
  selectedGoogleEvents,
  automationOpen,
  activeAutomationCount,
  automationJobs,
  recentAutomationJobs,
  workspaceOpen,
  linkedFolders,
  imageStudioOpen,
  imageStudioDrawing,
  quickImagePrompt,
  quickImageMode,
  assistantAvatar,
  imageWidth,
  imageHeight,
  isGeneratingImage,
  telegramPanelOpen,
  telegramRunning,
  telegramBotToken,
  telegramOwnerId,
  telegramStatus,
  telegramGuests,
  telegramGuestDraft,
  googlePanelOpen,
  googleStatus,
  googleNotice,
  googleBusy,
  googleClientId,
  googleClientSecret,
  onOpenUserProfile,
  onToggleUserMenu,
  onSelectUserProfile,
  onCreateUserProfile,
  onToggleCalendar,
  onAutomationMonthChange,
  onSelectAutomationDate,
  onSelectGoogleEvent,
  onDeleteGoogleEvent,
  onToggleAutomation,
  onAddAutomation,
  onEditAutomation,
  onToggleAutomationJob,
  onDeleteAutomationJob,
  onToggleWorkspace,
  onAddLinkedFolder,
  onRemoveLinkedFolder,
  onToggleImageStudio,
  onQuickImagePromptChange,
  onQuickImageModeChange,
  onGenerateQuickImage,
  onImageWidthChange,
  onImageHeightChange,
  onToggleTelegram,
  onTelegramBotTokenChange,
  onTelegramOwnerIdChange,
  onTelegramGuestDraftChange,
  onSaveTelegramGuest,
  onRemoveTelegramGuest,
  onTestTelegram,
  onStartStopTelegram,
  onToggleGoogle,
  onGoogleClientIdChange,
  onGoogleClientSecretChange,
  onConnectToggleGoogle,
  onRefreshGoogleCalendar,
}: {
  selectedUserProfileId: string;
  selectedUserName: string;
  userAvatar: string;
  userName: string;
  userProfiles: UserProfilePreset[];
  userProfileMenuOpen: boolean;
  calendarOpen: boolean;
  automationMonth: Date;
  automationMonthDays: Date[];
  selectedAutomationDate: string;
  selectedAutomationDateObj: Date;
  selectedAutomationLabel: string;
  googleCalendarEvents: GoogleCalendarEvent[];
  selectedGoogleEvents: GoogleCalendarEvent[];
  automationOpen: boolean;
  activeAutomationCount: number;
  automationJobs: AutomationJob[];
  recentAutomationJobs: AutomationJob[];
  workspaceOpen: boolean;
  linkedFolders: string[];
  imageStudioOpen: boolean;
  imageStudioDrawing: boolean;
  quickImagePrompt: string;
  quickImageMode: string;
  assistantAvatar: string;
  imageWidth: number;
  imageHeight: number;
  isGeneratingImage: boolean;
  telegramPanelOpen: boolean;
  telegramRunning: boolean;
  telegramBotToken: string;
  telegramOwnerId: string;
  telegramStatus: string;
  telegramGuests: TelegramGuest[];
  telegramGuestDraft: TelegramGuest | null;
  googlePanelOpen: boolean;
  googleStatus: GoogleConnectionStatus;
  googleNotice: string;
  googleBusy: boolean;
  googleClientId: string;
  googleClientSecret: string;
  onOpenUserProfile: () => void;
  onToggleUserMenu: () => void;
  onSelectUserProfile: (id: string) => void;
  onCreateUserProfile: () => void;
  onToggleCalendar: (open: boolean) => void;
  onAutomationMonthChange: (month: Date) => void;
  onSelectAutomationDate: (date: Date) => void;
  onSelectGoogleEvent: (event: GoogleCalendarEvent) => void;
  onDeleteGoogleEvent: (event: GoogleCalendarEvent) => void;
  onToggleAutomation: (open: boolean) => void;
  onAddAutomation: () => void;
  onEditAutomation: (job: AutomationJob) => void;
  onToggleAutomationJob: (job: AutomationJob) => void;
  onDeleteAutomationJob: (id: number) => void;
  onToggleWorkspace: (open: boolean) => void;
  onAddLinkedFolder: () => void;
  onRemoveLinkedFolder: (folderPath: string) => void;
  onToggleImageStudio: (open: boolean) => void;
  onQuickImagePromptChange: (prompt: string) => void;
  onQuickImageModeChange: (mode: string) => void;
  onGenerateQuickImage: (extraReferenceImages?: string[]) => void;
  onImageWidthChange: (value: number) => void;
  onImageHeightChange: (value: number) => void;
  onToggleTelegram: (open: boolean) => void;
  onTelegramBotTokenChange: (value: string) => void;
  onTelegramOwnerIdChange: (value: string) => void;
  onTelegramGuestDraftChange: (guest: TelegramGuest | null) => void;
  onSaveTelegramGuest: () => void;
  onRemoveTelegramGuest: (id: string) => void;
  onTestTelegram: () => void;
  onStartStopTelegram: () => void;
  onToggleGoogle: (open: boolean) => void;
  onGoogleClientIdChange: (value: string) => void;
  onGoogleClientSecretChange: (value: string) => void;
  onConnectToggleGoogle: () => void;
  onRefreshGoogleCalendar: () => void;
}) {
  return (
    <div className="space-y-3 p-3">
      <ProfilePickerSection
        title="User"
        selectedId={selectedUserProfileId}
        selectedName={selectedUserName}
        selectedAvatar={userAvatar}
        selectedFallback={userName || "You"}
        options={userProfiles}
        menuOpen={userProfileMenuOpen}
        createTitle="Create user profile"
        avatarTitle="Edit user profile"
        onAvatarClick={onOpenUserProfile}
        onToggleMenu={onToggleUserMenu}
        onSelect={onSelectUserProfile}
        onCreate={onCreateUserProfile}
      />
      <CalendarSection
        open={calendarOpen}
        month={automationMonth}
        monthDays={automationMonthDays}
        selectedDate={selectedAutomationDate}
        selectedDateObj={selectedAutomationDateObj}
        selectedLabel={selectedAutomationLabel}
        googleEvents={googleCalendarEvents}
        selectedGoogleEvents={selectedGoogleEvents}
        onToggle={onToggleCalendar}
        onMonthChange={onAutomationMonthChange}
        onSelectDate={onSelectAutomationDate}
        onSelectGoogleEvent={onSelectGoogleEvent}
        onDeleteGoogleEvent={onDeleteGoogleEvent}
      />
      <AutomationSection
        open={automationOpen}
        activeCount={activeAutomationCount}
        jobs={automationJobs}
        recentJobs={recentAutomationJobs}
        selectedDate={selectedAutomationDate}
        onToggle={onToggleAutomation}
        onAdd={onAddAutomation}
        onEdit={onEditAutomation}
        onToggleJob={onToggleAutomationJob}
        onDelete={onDeleteAutomationJob}
      />
      <WorkspaceSection
        open={workspaceOpen}
        linkedFolders={linkedFolders}
        onToggle={onToggleWorkspace}
        onAdd={onAddLinkedFolder}
        onRemove={onRemoveLinkedFolder}
      />
      <ImageStudioSection
        open={imageStudioOpen}
        drawing={imageStudioDrawing}
        quickPrompt={quickImagePrompt}
        quickMode={quickImageMode}
        assistantAvatar={assistantAvatar}
        userAvatar={userAvatar}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        isGeneratingImage={isGeneratingImage}
        onToggle={onToggleImageStudio}
        onQuickPromptChange={onQuickImagePromptChange}
        onQuickModeChange={onQuickImageModeChange}
        onGenerate={onGenerateQuickImage}
        onImageWidthChange={onImageWidthChange}
        onImageHeightChange={onImageHeightChange}
      />
      <TelegramSection
        open={telegramPanelOpen}
        running={telegramRunning}
        botToken={telegramBotToken}
        ownerName={userName.trim() || "Owner"}
        ownerId={telegramOwnerId}
        status={telegramStatus}
        guests={telegramGuests}
        guestDraft={telegramGuestDraft}
        onToggle={onToggleTelegram}
        onBotTokenChange={onTelegramBotTokenChange}
        onOwnerIdChange={onTelegramOwnerIdChange}
        onGuestDraftChange={onTelegramGuestDraftChange}
        onSaveGuest={onSaveTelegramGuest}
        onRemoveGuest={onRemoveTelegramGuest}
        onTest={onTestTelegram}
        onStartStop={onStartStopTelegram}
      />
      <GoogleSection
        open={googlePanelOpen}
        status={googleStatus}
        notice={googleNotice}
        busy={googleBusy}
        clientId={googleClientId}
        clientSecret={googleClientSecret}
        onToggle={onToggleGoogle}
        onClientIdChange={onGoogleClientIdChange}
        onClientSecretChange={onGoogleClientSecretChange}
        onConnectToggle={onConnectToggleGoogle}
        onRefreshCalendar={onRefreshGoogleCalendar}
      />
    </div>
  );
}

export function RightPanelContent({
  selectedPersonalityId,
  selectedPersonalityPreset,
  personalityAvatar,
  personalityPresets,
  personalityMenuOpen,
  brainStatus,
  modelMenuOpen,
  availableModels,
  selectedModelPath,
  currentModelName,
  currentModelEntry,
  theme,
  isAudioPlaying,
  waveformProcessing,
  clearMemoryOpen,
  clearSessionToo,
  userProfileOpen,
  userName,
  userAvatar,
  userDescription,
  userProfiles,
  selectedUserProfile,
  selectedUserVoicePath,
  selectedUserVoiceSample,
  deleteUserProfileConfirmOpen,
  personalityProfileOpen,
  personalityNameDraft,
  personality,
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
  toolRunsOpen,
  toolRuns,
  samplingOpen,
  samplingTemperature,
  topK,
  topP,
  minP,
  repeatLastN,
  repeatPenalty,
  onOpenPersonalityProfile,
  onTogglePersonalityMenu,
  onSelectPersonality,
  onCreatePersonality,
  onChooseModelFolder,
  onToggleModelMenu,
  onSelectModel,
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
  onToggleToolRuns,
  onClearToolRuns,
  onToggleSampling,
  onResetSampling,
  onTemperatureChange,
  onTopKChange,
  onTopPChange,
  onMinPChange,
  onRepeatLastNChange,
  onRepeatPenaltyChange,
}: {
  selectedPersonalityId: string;
  selectedPersonalityPreset?: PersonalityPreset;
  personalityAvatar: string;
  personalityPresets: PersonalityPreset[];
  personalityMenuOpen: boolean;
  brainStatus: BrainStatus;
  modelMenuOpen: boolean;
  availableModels: ModelLibraryEntry[];
  selectedModelPath: string;
  currentModelName: string;
  currentModelEntry?: ModelLibraryEntry | null;
  theme: ThemeSwatch;
  isAudioPlaying: boolean;
  waveformProcessing: boolean;
  clearMemoryOpen: boolean;
  clearSessionToo: boolean;
  userProfileOpen: boolean;
  userName: string;
  userAvatar: string;
  userDescription: string;
  userProfiles: UserProfilePreset[];
  selectedUserProfile?: UserProfilePreset;
  selectedUserVoicePath: string;
  selectedUserVoiceSample?: VoiceSample | null;
  deleteUserProfileConfirmOpen: boolean;
  personalityProfileOpen: boolean;
  personalityNameDraft: string;
  personality: string;
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
  toolRunsOpen: boolean;
  toolRuns: ToolRunRecord[];
  samplingOpen: boolean;
  samplingTemperature: number;
  topK: number;
  topP: number;
  minP: number;
  repeatLastN: number;
  repeatPenalty: number;
  onOpenPersonalityProfile: () => void;
  onTogglePersonalityMenu: () => void;
  onSelectPersonality: (id: string) => void;
  onCreatePersonality: () => void;
  onChooseModelFolder: () => void;
  onToggleModelMenu: () => void;
  onSelectModel: (path: string) => void;
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
  onToggleToolRuns: (open: boolean) => void;
  onClearToolRuns: () => void;
  onToggleSampling: (open: boolean) => void;
  onResetSampling: () => void;
  onTemperatureChange: (value: number) => void;
  onTopKChange: (value: number) => void;
  onTopPChange: (value: number) => void;
  onMinPChange: (value: number) => void;
  onRepeatLastNChange: (value: number) => void;
  onRepeatPenaltyChange: (value: number) => void;
}) {
  return (
    <div className="space-y-3 p-3">
      <ProfilePickerSection
        title="Personality"
        selectedId={selectedPersonalityId}
        selectedName={selectedPersonalityPreset?.name ?? "Choose personality"}
        selectedAvatar={selectedPersonalityPreset?.avatar || personalityAvatar}
        selectedFallback={selectedPersonalityPreset?.name || "AI"}
        options={personalityPresets}
        menuOpen={personalityMenuOpen}
        createTitle="Create assistant profile"
        avatarTitle="Edit character profile"
        onAvatarClick={onOpenPersonalityProfile}
        onToggleMenu={onTogglePersonalityMenu}
        onSelect={onSelectPersonality}
        onCreate={onCreatePersonality}
      />
      <BrainSection
        brainStatus={brainStatus}
        modelMenuOpen={modelMenuOpen}
        availableModels={availableModels}
        selectedModelPath={selectedModelPath}
        currentModelName={currentModelName}
        currentModelEntry={currentModelEntry}
        theme={theme}
        isAudioPlaying={isAudioPlaying}
        waveformProcessing={waveformProcessing}
        onChooseModelFolder={onChooseModelFolder}
        onToggleModelMenu={onToggleModelMenu}
        onSelectModel={onSelectModel}
      />
      <ProfileModalLayer
        clearMemoryOpen={clearMemoryOpen}
        characterName={selectedPersonalityPreset?.name ?? "This character"}
        clearSessionToo={clearSessionToo}
        userProfileOpen={userProfileOpen}
        userName={userName}
        userAvatar={userAvatar}
        userDescription={userDescription}
        userProfileCount={userProfiles.length}
        selectedUserProfile={selectedUserProfile}
        selectedUserVoicePath={selectedUserVoicePath}
        selectedUserVoiceSample={selectedUserVoiceSample}
        deleteUserProfileConfirmOpen={deleteUserProfileConfirmOpen}
        personalityProfileOpen={personalityProfileOpen}
        selectedPersonalityPreset={selectedPersonalityPreset}
        personalityAvatar={personalityAvatar}
        personalityNameDraft={personalityNameDraft}
        personality={personality}
        personalityProfileCount={personalityPresets.length}
        memorySize={memorySize}
        replyLength={replyLength}
        minContextSize={minContextSize}
        selectedVoicePath={selectedVoicePath}
        selectedVoiceSample={selectedVoiceSample}
        deletePersonalityConfirmOpen={deletePersonalityConfirmOpen}
        voiceFolder={voiceFolder}
        voiceSamples={voiceSamples}
        previewingVoicePath={previewingVoicePath}
        selectedUserVoiceRowRef={selectedUserVoiceRowRef}
        selectedVoiceRowRef={selectedVoiceRowRef}
        onToggleClearSession={onToggleClearSession}
        onConfirmClearMemory={onConfirmClearMemory}
        onCancelClearMemory={onCancelClearMemory}
        onCloseUserProfile={onCloseUserProfile}
        onChooseUserAvatar={onChooseUserAvatar}
        onUserNameChange={onUserNameChange}
        onUserDescriptionChange={onUserDescriptionChange}
        onChooseVoiceFolder={onChooseVoiceFolder}
        onPreviewUserVoice={onPreviewUserVoice}
        onSelectUserVoice={onSelectUserVoice}
        onToggleUserAutoSpeech={onToggleUserAutoSpeech}
        onRequestDeleteUser={onRequestDeleteUser}
        onSaveUserProfile={onSaveUserProfile}
        onConfirmDeleteUser={onConfirmDeleteUser}
        onCancelDeleteUser={onCancelDeleteUser}
        onClosePersonalityProfile={onClosePersonalityProfile}
        onChoosePersonalityAvatar={onChoosePersonalityAvatar}
        onPersonalityNameChange={onPersonalityNameChange}
        onPersonalityChange={onPersonalityChange}
        onPreviewCharacterVoice={onPreviewCharacterVoice}
        onSelectCharacterVoice={onSelectCharacterVoice}
        onMemorySizeChange={onMemorySizeChange}
        onReplyLengthChange={onReplyLengthChange}
        onRequestDeletePersonality={onRequestDeletePersonality}
        onRequestClearPersonalityMemory={onRequestClearPersonalityMemory}
        onSavePersonality={onSavePersonality}
        onConfirmDeletePersonality={onConfirmDeletePersonality}
        onCancelDeletePersonality={onCancelDeletePersonality}
      />
      <ToolActivitySection
        open={toolRunsOpen}
        toolRuns={toolRuns}
        onToggle={onToggleToolRuns}
        onClear={onClearToolRuns}
      />
      <SamplingSection
        open={samplingOpen}
        temperature={samplingTemperature}
        topK={topK}
        topP={topP}
        minP={minP}
        repeatLastN={repeatLastN}
        repeatPenalty={repeatPenalty}
        onToggle={onToggleSampling}
        onReset={onResetSampling}
        onTemperatureChange={onTemperatureChange}
        onTopKChange={onTopKChange}
        onTopPChange={onTopPChange}
        onMinPChange={onMinPChange}
        onRepeatLastNChange={onRepeatLastNChange}
        onRepeatPenaltyChange={onRepeatPenaltyChange}
      />
    </div>
  );
}
