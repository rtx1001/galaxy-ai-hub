import React from "react";
import brandLogo from "../assets/logo-gah.svg";
import { DownloadIcon } from "./Icons";
import { IconButton } from "./UI";
import { SetupScreen } from "./SetupScreen";
import { StartupScreen, SettingsLoadErrorScreen } from "./AppScreens";
import { AutomationEditorModal } from "./AutomationEditorModal";
import { ConversationPane } from "./ConversationPane";
import { ChatComposer } from "./ChatComposer";
import { AppHeader } from "./AppHeader";
import { AvatarFileInputs } from "./AvatarFileInputs";
import { AppSidePanel } from "./AppSidePanel";
import { DropImageOverlay } from "./DropImageOverlay";
import { FreshChatConfirmModal, GoogleEventModals, ImageViewerOverlay } from "./AppOverlays";

type AppShellProps = Record<string, any>;

export function AppShell(props: AppShellProps) {
  if (!props.settingsLoaded) {
    return <StartupScreen />;
  }

  if (props.settingsLoadError) {
    return <SettingsLoadErrorScreen error={props.settingsLoadError} />;
  }

  if (props.firstStartupSetupNeeded) {
    return (
      <SetupScreen
        theme={props.selectedThemeSwatch}
        brandLogo={brandLogo}
        systemInfo={props.systemInfo}
        hardwareGpuLabel={props.hardwareGpuLabel}
        hardwareRamLabel={props.hardwareRamLabel}
        activeSetupTier={props.activeSetupTier}
        recommendedSetupTier={props.detectedSetupTier}
        onSelectSetupTier={props.chooseSetupTier}
        setupCatalog={props.setupCatalog}
        setupInstalling={props.setupInstalling}
        activeSetupPartKey={props.activeSetupPartKey}
        setupPreflight={props.setupPreflight}
        setupProgress={props.setupProgress}
        onClose={props.closeSetupScreen}
        onChooseFiles={props.closeSetupScreen}
        onInstall={() => void props.handleInstallSetupBundle()}
        onInstallPart={(partKey) => void props.handleInstallSetupPart(partKey)}
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
            "--accent-color": props.selectedThemeSwatch.accent,
            "--accent-hover": props.selectedThemeSwatch.hover,
            "--accent-soft": props.selectedThemeSwatch.soft,
            "--accent-soft-strong": `${props.selectedThemeSwatch.accent}44`,
          } as React.CSSProperties
        }
      >
        <AvatarFileInputs
          avatarTargetPersonalityIdRef={props.avatarTargetPersonalityIdRef}
          personalityAvatarPickerRef={props.personalityAvatarPickerRef}
          readAvatarImage={props.readAvatarImage}
          selectedPersonalityId={props.selectedPersonalityId}
          setPersonalityAvatar={props.setPersonalityAvatar}
          setPersonalityPresets={props.setPersonalityPresets}
          setUserAvatar={props.setUserAvatar}
          userAvatarPickerRef={props.userAvatarPickerRef}
        />

        <FreshChatConfirmModal
          open={props.freshChatConfirmOpen}
          onClose={() => props.setFreshChatConfirmOpen(false)}
          onClear={() => {
            props.clearActiveChatSession();
            props.setComposerText("");
            props.clearImage();
            props.setComposerNotice("");
            props.setFreshChatConfirmOpen(false);
          }}
        />

        <AutomationEditorModal
          open={props.automationEditorOpen}
          editingAutomationId={props.editingAutomationId}
          automationName={props.automationName}
          automationPrompt={props.automationPrompt}
          automationDate={props.automationDate}
          automationTime={props.automationTime}
          automationRepeat={props.automationRepeat}
          automationEveryAmount={props.automationEveryAmount}
          automationEveryUnit={props.automationEveryUnit}
          automationTimeMenuOpen={props.automationTimeMenuOpen}
          automationDateMenuOpen={props.automationDateMenuOpen}
          automationMonthMenuOpen={props.automationMonthMenuOpen}
          automationEveryUnitMenuOpen={props.automationEveryUnitMenuOpen}
          automationEditorMonth={props.automationEditorMonth}
          onClose={() => props.setAutomationEditorOpen(false)}
          onCancel={() => {
            props.setAutomationEditorOpen(false);
            props.setEditingAutomationId(null);
          }}
          onSave={() => props.saveAutomationJob().catch((error: unknown) => console.error("Automation save error:", error))}
          onAutomationNameChange={props.setAutomationName}
          onAutomationPromptChange={props.setAutomationPrompt}
          onAutomationDateChange={props.setAutomationDate}
          onAutomationTimeChange={props.setAutomationTime}
          onAutomationRepeatChange={props.setAutomationRepeat}
          onAutomationEveryAmountChange={props.setAutomationEveryAmount}
          onAutomationEveryUnitChange={props.setAutomationEveryUnit}
          onAutomationTimeMenuOpenChange={props.setAutomationTimeMenuOpen}
          onAutomationDateMenuOpenChange={props.setAutomationDateMenuOpen}
          onAutomationMonthMenuOpenChange={props.setAutomationMonthMenuOpen}
          onAutomationEveryUnitMenuOpenChange={props.setAutomationEveryUnitMenuOpen}
          onAutomationEditorMonthChange={props.setAutomationEditorMonth}
        />

        <div
          className="flex h-screen overflow-hidden"
          onPointerMove={props.markUiInteraction}
          onWheel={props.markUiInteraction}
        >
          <AppSidePanel
            open={props.leftPanelOpen}
            side="left"
            title="App Settings"
            isCompactLayout={props.isCompactLayout}
            onClose={() => props.setLeftPanelOpen(false)}
            actions={(
              <IconButton size="sm" title="Download models" onClick={() => props.setSetupScreenOpen(true)}>
                <DownloadIcon />
              </IconButton>
            )}
          >
            {props.leftPanelContent}
          </AppSidePanel>

          <main
            className="relative flex min-w-0 flex-1 flex-col overflow-hidden w-full"
            onDragOver={(event) => {
              event.preventDefault();
              props.setIsDragging(true);
            }}
            onDragLeave={() => props.setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              props.setIsDragging(false);
              props.attachImageFromFile(event.dataTransfer.files[0]);
            }}
          >
            {props.isDragging && <DropImageOverlay />}

            <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
              <img src={brandLogo} alt="" aria-hidden="true" className={props.conversationLogoClass} />
            </div>

            <AppHeader
              activeTaskType={props.activeTaskType}
              appVersion={props.appVersion}
              availableUpdate={props.availableUpdate}
              brainStatus={props.brainStatus}
              dateTimeLine={props.dateTimeLine}
              isAudioPlaying={props.isAudioPlaying}
              isGeneratingImage={props.isGeneratingImage}
              leftPanelOpen={props.leftPanelOpen}
              modelLoadStatus={props.modelLoadStatus}
              previewingVoicePath={props.previewingVoicePath}
              rightPanelOpen={props.rightPanelOpen}
              setLeftPanelOpen={props.setLeftPanelOpen}
              setRightPanelOpen={props.setRightPanelOpen}
              speakingMessageId={props.speakingMessageId}
              topProgressActive={props.topProgressActive}
              topProgressPercent={props.topProgressPercent}
              topStatusText={props.topStatusText}
            />

            {props.engineErrorMsg && (
              <div className="shrink-0 border-b border-rose-500/20 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
                {props.engineErrorMsg}
              </div>
            )}

            <ConversationPane
              scrollRef={props.conversationScrollRef}
              endRef={props.conversationEndRef}
              messages={props.messages}
              brandLogo={brandLogo}
              systemInfo={props.systemInfo}
              assistantName={props.selectedPersonalityPreset?.name || "Assistant"}
              assistantAvatar={props.assistantAvatar}
              userName={props.userName}
              userAvatar={props.userAvatar}
              hardwareGpuLabel={props.hardwareGpuLabel}
              hardwareRamLabel={props.hardwareRamLabel}
              isStreaming={props.isStreaming}
              isGeneratingImage={props.isGeneratingImage}
              isApproving={props.isApproving}
              collapsedImageParts={props.collapsedImageParts}
              linkedFolders={props.linkedFolders}
              speakingMessageId={props.speakingMessageId}
              showScrollBottom={props.showScrollBottom}
              onScroll={props.handleChatScroll}
              onOpenPersonalityProfile={props.openPersonalityProfile}
              onOpenUserProfile={props.openUserProfile}
              onOpenImageViewer={props.openImageViewer}
              onRevealImageLocation={(path) => void props.revealImageLocation(path)}
              onDeleteImageMessage={props.deleteImageFromChatMessage}
              onToggleImageCollapsed={(key) => props.setCollapsedImageParts((prev: Record<string, boolean>) => ({ ...prev, [key]: !prev[key] }))}
              onDismissImageProposal={props.dismissImageProposal}
              onGenerateImage={(prompt, mode, maskPrompt) => void props.handleGenerateImage(prompt, mode, maskPrompt)}
              onDismissChatPart={props.dismissChatPart}
              onApproveActionProposal={(messageId, partIndex, proposal) => void props.approveActionProposal(messageId, partIndex, proposal)}
              onDeleteCalendarEvent={props.openDeleteGoogleEventConfirm}
              onSpeakToggle={(messageId, text, role) => {
                if (props.speakingMessageId === messageId) {
                  props.voicePlaybackRequestRef.current += 1;
                  props.stopActiveAudio();
                  props.setSpeakingMessageId(null);
                  return;
                }
                props.ensureAudioPlaybackUnlocked()
                  .catch(() => null)
                  .finally(() => props.speakMessageText(messageId, text, role));
              }}
              onScrollToBottom={() => props.scrollToBottom()}
            />

            <ChatComposer
              pendingShellActions={props.pendingShellActions}
              executingShellActionId={props.executingShellActionId}
              image={props.image}
              composerInputRef={props.composerInputRef}
              input={props.input}
              composerHasText={props.composerHasText}
              engineReady={props.engineStatus === "ready"}
              isStreaming={props.isStreaming}
              sendInFlight={props.sendInFlightRef.current}
              selectedThemeSwatch={props.selectedThemeSwatch}
              thinkingEnabled={props.thinkingEnabled}
              liveConversation={props.liveConversation}
              isRecording={props.isRecording}
              isTranscribing={props.isTranscribing}
              themePickerOpen={props.themePickerOpen}
              themeSwatches={props.themeSwatches}
              themeSwatchId={props.themeSwatchId}
              quickModelMenuOpen={props.quickModelMenuOpen}
              availableModels={props.availableModels}
              selectedModelPath={props.selectedModelPath}
              selectedModel={props.selectedModel}
              brainStatus={props.brainStatus}
              currentModelEntry={props.currentModelEntry}
              onRejectShellAction={(id) => props.rejectShellAction(id).catch((error: unknown) => console.error("Reject shell action error:", error))}
              onApproveShellAction={(action) => props.approveShellAction(action).catch((error: unknown) => console.error("Approve shell action error:", error))}
              onRemoveImage={() => {
                props.clearImage();
              }}
              onComposerInput={props.handleComposerInput}
              onComposerPaste={(event) => {
                const items = event.clipboardData?.items;
                if (!items) return;
                for (let i = 0; i < items.length; i++) {
                  if (items[i].type.startsWith("image/")) {
                    const file = items[i].getAsFile();
                    if (file) {
                      props.attachImageFromFile(file);
                      event.preventDefault();
                      return;
                    }
                  }
                }
              }}
              onSend={() => props.handleSend().catch((error: unknown) => console.error("Send error:", error))}
              onStop={props.stopActiveResponse}
              onToggleThinking={() => props.setThinkingEnabled((prev: boolean) => !prev)}
              onToggleLiveConversation={() => props.setAutoVoiceMode(!props.liveConversation)}
              onMicToggle={() => props.handleMicToggle().catch((error: unknown) => console.error("Mic error:", error))}
              onChooseImage={() => props.chooseImageForComposer().catch((error: unknown) => console.error("Choose image error:", error))}
              onToggleThemePicker={() => {
                const next = !props.themePickerOpen;
                props.setModelMenuOpen(false);
                props.setUserProfileMenuOpen(false);
                props.setPersonalityMenuOpen(false);
                props.setQuickModelMenuOpen(false);
                props.setThemePickerOpen(next);
              }}
              onSelectTheme={(id) => {
                props.setThemeSwatchId(id);
                props.setThemePickerOpen(false);
              }}
              onClearChat={() => props.setFreshChatConfirmOpen(true)}
              onToggleQuickModelMenu={() => {
                const next = !props.quickModelMenuOpen;
                props.setModelMenuOpen(false);
                props.setUserProfileMenuOpen(false);
                props.setPersonalityMenuOpen(false);
                props.setThemePickerOpen(false);
                props.setQuickModelMenuOpen(next);
              }}
              onSelectModel={(path) => {
                props.setQuickModelMenuOpen(false);
                props.setSelectedModelPath(path);
                props.loadModelPath(path).catch((error: unknown) => console.error("Model select error:", error));
              }}
            />
          </main>

          <AppSidePanel
            open={props.rightPanelOpen}
            side="right"
            title="Model Controls"
            isCompactLayout={props.isCompactLayout}
            onClose={() => props.setRightPanelOpen(false)}
          >
            {props.rightPanelContent}
          </AppSidePanel>
        </div>
      </div>

      <ImageViewerOverlay imageViewer={props.imageViewer} setImageViewer={props.setImageViewer} />
      <GoogleEventModals
        selectedEvent={props.selectedGoogleEvent}
        deleteTarget={props.googleDeleteTarget}
        onCloseSelected={() => props.setSelectedGoogleEvent(null)}
        onRequestDelete={props.openDeleteGoogleEventConfirm}
        onCloseDelete={() => props.setGoogleDeleteTarget(null)}
        onConfirmDelete={(eventId) => {
          props.deleteGoogleEvent(eventId).catch((error: unknown) => console.error("Google event delete error:", error));
        }}
      />
    </>
  );
}
