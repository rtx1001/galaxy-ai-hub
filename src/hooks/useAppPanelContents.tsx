import { LeftPanelContent, RightPanelContent } from "../components/SidePanelContent";
import { profileRefId } from "../appCore";

type UseAppPanelContentsOptions = Record<string, any>;

export function useAppPanelContents(options: UseAppPanelContentsOptions) {
  const {
    activeAutomationCount,
    automationJobs,
    automationMonth,
    automationMonthDays,
    automationOpen,
    availableModels,
    brainStatus,
    calendarOpen,
    clearToolRuns,
    clearMemoryConfirmOpen,
    clearSessionToo,
    createUserProfile,
    currentModelEntry,
    currentModelName,
    deletePersonalityConfirmOpen,
    deleteSelectedPersonalityPreset,
    deleteSelectedUserProfile,
    deleteUserProfileConfirmOpen,
    deleteAutomationJob,
    googleBusy,
    googleCalendarEvents,
    googleNotice,
    googlePanelOpen,
    googleStatus,
    googleClientId,
    googleClientSecret,
    handleAddLinkedFolder,
    handleChooseModelFolder,
    handleChooseVoiceFolder,
    handleClearPersonalityMemory,
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
    minContextSize,
    minP,
    modelMenuOpen,
    openAutomationEditor,
    openDeleteGoogleEventConfirm,
    openPersonalityProfile,
    openUserProfile,
    personality,
    personalityAvatar,
    personalityMenuOpen,
    personalityNameDraft,
    personalityPresets,
    personalityProfileOpen,
    previewVoiceSample,
    previewingVoicePath,
    quickImageMode,
    quickImagePrompt,
    recentAutomationJobs,
    refreshGoogleCalendarEvents,
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
    setCalendarOpen,
    setClearMemoryConfirmOpen,
    setClearSessionToo,
    setDeletePersonalityConfirmOpen,
    setDeleteUserProfileConfirmOpen,
    setGooglePanelOpen,
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
    setSelectedModelPath,
    setSelectedGoogleEvent,
    setMediaPlayerPanelOpen,
    setTelegramBotToken,
    setTelegramGuestDraft,
    setTelegramOwnerId,
    setTelegramPanelOpen,
    setThemePickerOpen,
    setToolRunsOpen,
    setTopK,
    setTopP,
    setUserDescription,
    setUserProfileMenuOpen,
    setUserProfileOpen,
    setWorkspaceOpen,
    telegramBotToken,
    telegramGuestDraft,
    telegramGuests,
    telegramOwnerId,
    telegramPanelOpen,
    telegramRunning,
    telegramStatus,
    theme,
    toolRuns,
    toolRunsOpen,
    mediaPlayerBusy,
    mediaPlayerPanelOpen,
    mediaPlayerStatus,
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
  } = options;

  const sharedUserProfileOptions = [
    ...userProfiles,
    ...personalityPresets.map((preset: any) => ({
      id: profileRefId("personality", preset.id),
      name: preset.name,
      avatar: preset.avatar,
    })),
  ];
  const sharedPersonalityOptions = [
    ...personalityPresets,
    ...userProfiles.map((profile: any) => ({
      id: profileRefId("user", profile.id),
      name: profile.name,
      avatar: profile.avatar,
    })),
  ];

  const leftPanelContent = (
    <LeftPanelContent
      selectedUserProfileId={selectedUserProfileId}
      selectedUserName={selectedUserProfile?.name || "You"}
      userAvatar={userAvatar}
      userName={userName}
      userProfiles={userProfiles}
      userProfileOptions={sharedUserProfileOptions}
      userProfileMenuOpen={userProfileMenuOpen}
      calendarOpen={calendarOpen}
      automationMonth={automationMonth}
      automationMonthDays={automationMonthDays}
      selectedAutomationDate={selectedAutomationDate}
      selectedAutomationDateObj={selectedAutomationDateObj}
      selectedAutomationLabel={selectedAutomationLabel}
      googleCalendarEvents={googleCalendarEvents}
      selectedGoogleEvents={selectedGoogleEvents}
      workspaceOpen={workspaceOpen}
      linkedFolders={linkedFolders}
      imageStudioOpen={imageStudioOpen}
      imageStudioDrawing={imageStudioDrawing}
      quickImagePrompt={quickImagePrompt}
      quickImageMode={quickImageMode}
      assistantAvatar={selectedPersonalityPreset?.avatar || personalityAvatar || ""}
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
      onOpenUserProfile={openUserProfile}
      userAutoPilot={userAutoPilot}
      onToggleUserAutoPilot={() => options.setUserAutoPilot((prev: boolean) => !prev)}
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
      onAutomationMonthChange={options.setAutomationMonth}
      onSelectAutomationDate={selectAutomationDate}
      onSelectGoogleEvent={setSelectedGoogleEvent}
      onDeleteGoogleEvent={openDeleteGoogleEventConfirm}
      onToggleWorkspace={setWorkspaceOpen}
      onAddLinkedFolder={() => handleAddLinkedFolder().catch((error: unknown) => console.error(error))}
      onRemoveLinkedFolder={handleRemoveLinkedFolder}
      onToggleImageStudio={setImageStudioOpen}
      onQuickImagePromptChange={setQuickImagePrompt}
      onQuickImageModeChange={options.setQuickImageMode}
      onGenerateQuickImage={(extraReferenceImages) => void handleQuickImageGenerate(extraReferenceImages)}
      onImageWidthChange={setImageWidth}
      onImageHeightChange={setImageHeight}
      onToggleTelegram={setTelegramPanelOpen}
      onTelegramBotTokenChange={setTelegramBotToken}
      onTelegramOwnerIdChange={setTelegramOwnerId}
      onTelegramGuestDraftChange={setTelegramGuestDraft}
      onSaveTelegramGuest={options.addTelegramGuest}
      onRemoveTelegramGuest={removeTelegramGuest}
      onTestTelegram={() => handleTestTelegram().catch((error: unknown) => console.error("Telegram error:", error))}
      onStartStopTelegram={() =>
        (telegramRunning ? handleStopTelegram() : handleStartTelegram()).catch((error: unknown) =>
          console.error(telegramRunning ? "Telegram stop error:" : "Telegram start error:", error),
        )
      }
      onToggleGoogle={setGooglePanelOpen}
      onGoogleClientIdChange={options.setGoogleClientId}
      onGoogleClientSecretChange={options.setGoogleClientSecret}
      onConnectToggleGoogle={() =>
        (googleStatus.connected ? options.disconnectGoogle() : options.connectGoogle()).catch((error: unknown) =>
          console.error(googleStatus.connected ? "Google disconnect error:" : "Google connect error:", error),
        )
      }
      onRefreshGoogleCalendar={() => refreshGoogleCalendarEvents().catch((error: unknown) => console.error("Google Calendar refresh error:", error))}
    />
  );

  const rightPanelContent = (
    <RightPanelContent
      selectedPersonalityId={selectedPersonalityId}
      selectedPersonalityPreset={selectedPersonalityPreset}
      personalityAvatar={personalityAvatar}
      personalityPresets={personalityPresets}
      personalityOptions={sharedPersonalityOptions}
      personalityMenuOpen={personalityMenuOpen}
      automationOpen={automationOpen}
      activeAutomationCount={activeAutomationCount}
      automationJobs={automationJobs}
      recentAutomationJobs={recentAutomationJobs}
      selectedAutomationDate={selectedAutomationDate}
      brainStatus={brainStatus}
      modelMenuOpen={modelMenuOpen}
      availableModels={availableModels}
      selectedModelPath={selectedModelPath}
      currentModelName={currentModelName}
      currentModelEntry={currentModelEntry}
      theme={theme || selectedThemeSwatch}
      isAudioPlaying={isAudioPlaying}
      waveformProcessing={waveformProcessing}
      clearMemoryOpen={clearMemoryConfirmOpen}
      clearSessionToo={clearSessionToo}
      selectedUserProfileId={selectedUserProfileId}
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
      minContextSize={minContextSize}
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
      mediaPlayerBusy={mediaPlayerBusy}
      mediaPlayerOpen={mediaPlayerPanelOpen}
      mediaPlayerStatus={mediaPlayerStatus}
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
      onToggleAutomation={options.setAutomationOpen}
      onAddAutomation={() => openAutomationEditor()}
      onEditAutomation={openAutomationEditor}
      onToggleAutomationJob={(job) => toggleAutomationJob(job).catch((error: unknown) => console.error("Automation toggle error:", error))}
      onDeleteAutomationJob={(id) => deleteAutomationJob(id).catch((error: unknown) => console.error("Automation delete error:", error))}
      onChooseModelFolder={() => handleChooseModelFolder().catch((error: unknown) => console.error("Folder error:", error))}
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
        loadModelPath(path).catch((error: unknown) => console.error("Model select error:", error));
      }}
      onToggleClearSession={setClearSessionToo}
      onConfirmClearMemory={() => handleClearPersonalityMemory().catch(console.error)}
      onCancelClearMemory={() => {
        setClearMemoryConfirmOpen(false);
        setClearSessionToo(false);
      }}
      onCloseUserProfile={() => setUserProfileOpen(false)}
      onChooseUserAvatar={() => userAvatarPickerRef.current?.click()}
      onUserNameChange={options.setUserName}
      onUserDescriptionChange={setUserDescription}
      onChooseVoiceFolder={() => handleChooseVoiceFolder().catch((error: unknown) => console.error("Voice folder error:", error))}
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
        options.avatarTargetPersonalityIdRef.current = selectedPersonalityId;
        options.personalityAvatarPickerRef.current?.click();
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
        updateSelectedPersonalityPreset()
          .then(() => setPersonalityProfileOpen(false))
          .catch((error: unknown) => console.error("Character files save error:", error));
      }}
      onConfirmDeletePersonality={() => {
        deleteSelectedPersonalityPreset();
        setDeletePersonalityConfirmOpen(false);
      }}
      onCancelDeletePersonality={() => setDeletePersonalityConfirmOpen(false)}
      onToggleToolRuns={setToolRunsOpen}
      onClearToolRuns={() => clearToolRuns().catch((error: unknown) => console.error("Tool activity clear error:", error))}
      onToggleSampling={setSamplingOpen}
      onResetSampling={resetSamplingDefaults}
      onTemperatureChange={setSamplingTemperature}
      onTopKChange={setTopK}
      onTopPChange={setTopP}
      onMinPChange={setMinP}
      onRepeatLastNChange={setRepeatLastN}
      onRepeatPenaltyChange={setRepeatPenalty}
      onToggleMediaPlayer={setMediaPlayerPanelOpen}
      onMediaPlayerPlay={() => options.mediaPlayerPlay().catch((error: unknown) => console.error("Media player play error:", error))}
      onMediaPlayerPause={() => options.mediaPlayerPause().catch((error: unknown) => console.error("Media player pause error:", error))}
      onMediaPlayerNext={() => options.mediaPlayerNext().catch((error: unknown) => console.error("Media player next error:", error))}
      onMediaPlayerPrevious={() =>
        options.mediaPlayerPrevious().catch((error: unknown) => console.error("Media player previous error:", error))
      }
    />
  );

  return { leftPanelContent, rightPanelContent };
}
