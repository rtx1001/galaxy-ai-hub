import type { ClipboardEvent, RefObject } from "react";
import type { ModelLibraryEntry, PendingShellAction } from "../appCore";
import {
  BrainIcon,
  BrushIcon,
  ChevronDownIcon,
  CloseIcon,
  EraserIcon,
  EyeIcon,
  ImageIcon,
  MicIcon,
  SendIcon,
  SpeakerIcon,
  StopIcon,
} from "./Icons";
import { IconButton } from "./UI";

type ThemeSwatch = {
  id: string;
  accent: string;
  hover: string;
  soft: string;
};

export function ChatComposer({
  pendingShellActions,
  executingShellActionId,
  image,
  composerInputRef,
  input,
  composerHasText,
  engineReady,
  isStreaming,
  sendInFlight,
  selectedThemeSwatch,
  thinkingEnabled,
  liveConversation,
  isRecording,
  isTranscribing,
  themePickerOpen,
  themeSwatches,
  themeSwatchId,
  quickModelMenuOpen,
  availableModels,
  selectedModelPath,
  selectedModel,
  brainStatus,
  currentModelEntry,
  onRejectShellAction,
  onApproveShellAction,
  onRemoveImage,
  onComposerInput,
  onComposerPaste,
  onSend,
  onStop,
  onToggleThinking,
  onToggleLiveConversation,
  onMicToggle,
  onChooseImage,
  onToggleThemePicker,
  onSelectTheme,
  onClearChat,
  onToggleQuickModelMenu,
  onSelectModel,
  longTaskNotice,
  longTaskLabel,
  onKeepLongTaskRunning,
  onStopLongTask,
}: {
  pendingShellActions: PendingShellAction[];
  executingShellActionId: number | null;
  image: string | null;
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  composerHasText: boolean;
  engineReady: boolean;
  isStreaming: boolean;
  sendInFlight: boolean;
  selectedThemeSwatch: ThemeSwatch;
  thinkingEnabled: boolean;
  liveConversation: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  themePickerOpen: boolean;
  themeSwatches: ThemeSwatch[];
  themeSwatchId: string;
  quickModelMenuOpen: boolean;
  availableModels: ModelLibraryEntry[];
  selectedModelPath: string;
  selectedModel: string | null;
  brainStatus: string;
  currentModelEntry?: ModelLibraryEntry | null;
  onRejectShellAction: (id: number) => void;
  onApproveShellAction: (action: PendingShellAction) => void;
  onRemoveImage: () => void;
  onComposerInput: (node: HTMLTextAreaElement) => void;
  onComposerPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  onToggleThinking: () => void;
  onToggleLiveConversation: () => void;
  onMicToggle: () => void;
  onChooseImage: () => void;
  onToggleThemePicker: () => void;
  onSelectTheme: (id: string) => void;
  onClearChat: () => void;
  onToggleQuickModelMenu: () => void;
  onSelectModel: (path: string) => void;
  longTaskNotice: boolean;
  longTaskLabel: string;
  onKeepLongTaskRunning: () => void;
  onStopLongTask: () => void;
}) {
  const activeSend = isStreaming || sendInFlight;
  const canSend = composerHasText || Boolean(image);

  return (
    <footer className="shrink-0 border-t border-[#282a2c] bg-[#131314] px-4 py-4">
      <div className="mx-auto w-full max-w-5xl rounded-[30px] border border-[#282a2c] bg-[#1e1f20] p-3 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
        {longTaskNotice && (
          <div className="mb-3 overflow-hidden rounded-[22px] border border-[var(--accent-soft-strong)] bg-[#131314] shadow-[0_12px_30px_rgba(0,0,0,0.28)]">
            <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#e3e3e3]">
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent-color)] shadow-[0_0_16px_var(--accent-color)]" />
                  <span>{longTaskLabel} is still running</span>
                </div>
                <div className="mt-1 text-xs text-[#c4c7c5]">
                  It has been running for over 2 minutes. It will keep running if you do nothing.
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onKeepLongTaskRunning}
                  className="rounded-full border border-[#282a2c] bg-[#1e1f20] px-3.5 py-2 text-xs font-semibold text-[#e3e3e3] transition hover:bg-[#282a2c]"
                >
                  Keep running
                </button>
                <button
                  type="button"
                  onClick={onStopLongTask}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-rose-500/35 bg-rose-500/12 text-rose-200 transition hover:bg-rose-500/20"
                  title="Stop task"
                >
                  <StopIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingShellActions.length > 0 && (
          <div className="mb-3 space-y-2">
            {pendingShellActions.map((action) => (
              <div key={action.id} className="overflow-hidden rounded-[22px] bg-[#131314] ring-1 ring-[#282a2c]">
                <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-[10px] text-[var(--accent-color)]">{"\u25B6"}</span>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--accent-color)]" />
                    <div className="truncate text-sm font-semibold text-[#e3e3e3]">System action request</div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${action.risk_level === "high" ? "bg-rose-500/15 text-rose-200" : action.risk_level === "medium" ? "bg-amber-500/15 text-amber-200" : ""}`}
                    style={action.risk_level === "low" ? { backgroundColor: "var(--accent-soft)", color: "var(--accent-color)" } : undefined}
                  >
                    {action.risk_level}
                  </span>
                </div>
                <div className="border-t border-[#282a2c] p-3">
                  <div className="text-xs leading-5 text-[#c4c7c5]">{action.purpose}</div>
                  <details className="mt-2 overflow-hidden rounded-2xl border border-[#282a2c] bg-[#0f1011] text-xs text-[#c4c7c5]">
                    <summary className="cursor-pointer select-none px-3 py-2 font-semibold text-[var(--accent-color)] [&::-webkit-details-marker]:hidden">
                      {"\u25B6"} Command
                    </summary>
                    <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap border-t border-[#282a2c] p-3 text-xs leading-5 text-[#e3e3e3]">{action.command}</pre>
                  </details>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-xs text-[#c4c7c5]" title={action.working_directory}>
                      Folder: {action.working_directory}
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => onRejectShellAction(action.id)} className="rounded-full border border-[#282a2c] bg-[#131314] px-4 py-2 text-xs font-semibold text-[#e3e3e3] transition hover:bg-[#282a2c]">
                        Cancel
                      </button>
                      <button type="button" onClick={() => onApproveShellAction(action)} disabled={executingShellActionId === action.id} className="rounded-full px-4 py-2 text-xs font-semibold text-[#131314] transition disabled:opacity-50" style={{ backgroundColor: "var(--accent-color)" }}>
                        {executingShellActionId === action.id ? "Running..." : "Run"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {image && (
          <div className="mb-3 flex items-center gap-3 rounded-3xl bg-[#131314] p-3 ring-1 ring-[#282a2c]">
            <img src={image} alt="Attached preview" className="h-14 w-14 rounded-2xl bg-[#131314] object-contain" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[#e3e3e3]">Image ready</div>
              <div className="truncate text-xs text-[#c4c7c5]">The selected brain will receive this picture with your next message.</div>
            </div>
            <IconButton title="Remove image" onClick={onRemoveImage}>
              <CloseIcon />
            </IconButton>
          </div>
        )}

        <div className="flex items-center gap-2 rounded-[24px] border border-[#282a2c] bg-[#131314] py-1.5 pl-4 pr-2">
          <textarea
            ref={composerInputRef}
            defaultValue={input}
            onInput={(event) => onComposerInput(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            onPaste={onComposerPaste}
            rows={1}
            className="min-h-[40px] w-full resize-none overflow-y-auto bg-transparent px-3 py-[10px] text-sm leading-5 text-[#e3e3e3] outline-none placeholder:text-[#73777f]"
            placeholder="Ask Galaxy anything..."
          />
          <button
            type="button"
            onClick={activeSend ? onStop : onSend}
            disabled={!activeSend && ((!canSend) || !engineReady)}
            className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-2xl text-sm font-semibold transition disabled:cursor-not-allowed"
            style={
              activeSend
                ? { backgroundColor: "var(--accent-color)", color: "#131314" }
                : canSend
                  ? { backgroundColor: selectedThemeSwatch.accent, color: "#131314" }
                  : { backgroundColor: "#2d2e30", color: "#5f6368" }
            }
            onMouseEnter={(event) => {
              if (event.currentTarget.disabled || activeSend || !canSend) return;
              event.currentTarget.style.backgroundColor = selectedThemeSwatch.hover;
            }}
            onMouseLeave={(event) => {
              if (event.currentTarget.disabled) return;
              event.currentTarget.style.backgroundColor = canSend ? selectedThemeSwatch.accent : "#2d2e30";
            }}
          >
            {activeSend ? <StopIcon className="h-4.5 w-4.5" /> : <SendIcon className="h-5 w-5" />}
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between border-t border-[#282a2c] px-1 pt-2">
          <div className="flex gap-1">
            <IconButton title={thinkingEnabled ? "AI brain reasoning is on" : "Enable AI brain reasoning"} onClick={onToggleThinking} active={thinkingEnabled}>
              <BrainIcon className="h-5 w-5" />
            </IconButton>
            <IconButton title={liveConversation ? "Live voice playback is on" : "Enable live voice playback"} onClick={onToggleLiveConversation} active={liveConversation}>
              <SpeakerIcon className="h-4.5 w-4.5" />
            </IconButton>
            <IconButton title={isRecording ? "Stop voice input recording" : isTranscribing ? "Voice input is transcribing" : "Start voice input"} onClick={onMicToggle} active={isRecording} disabled={isTranscribing}>
              <MicIcon className="h-4.5 w-4.5" />
            </IconButton>
            <IconButton title="Open image generation or attach an image" onClick={onChooseImage}>
              <ImageIcon className="h-4.5 w-4.5" />
            </IconButton>
            <div className="relative" data-dropdown-root>
              <button
                type="button"
                title="Choose theme color"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleThemePicker();
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#282a2c] bg-[#1e1f20] text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]"
                style={{
                  color: themePickerOpen ? selectedThemeSwatch.accent : undefined,
                  boxShadow: themePickerOpen ? `inset 0 0 0 1px ${selectedThemeSwatch.soft}` : undefined,
                }}
              >
                <BrushIcon className="h-4.5 w-4.5" />
              </button>
              {themePickerOpen && (
                <div
                  className="absolute bottom-full left-1/2 z-[220] mb-3 -translate-x-1/2 rounded-full border border-[#282a2c] bg-[#1e1f20] px-3 py-2 shadow-2xl"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center gap-2">
                    {themeSwatches.map((swatch) => (
                      <button
                        key={swatch.id}
                        type="button"
                        title={swatch.id}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onSelectTheme(swatch.id);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-full border transition"
                        style={{
                          backgroundColor: swatch.accent,
                          borderColor: swatch.id === themeSwatchId ? "#f3f4f6" : "rgba(255,255,255,0.12)",
                          boxShadow: swatch.id === themeSwatchId ? `0 0 0 2px ${swatch.soft}` : "none",
                        }}
                      >
                        <span className="sr-only">{swatch.id}</span>
                      </button>
                    ))}
                  </div>
                  <div className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-[#282a2c] bg-[#1e1f20]" />
                </div>
              )}
            </div>
            <IconButton title="Clear chat" onClick={onClearChat}>
              <EraserIcon className="h-4.5 w-4.5" />
            </IconButton>
            {isTranscribing && (
              <div className="ml-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: selectedThemeSwatch.accent }}>
                <div className="h-2 w-2 animate-ping rounded-full" style={{ backgroundColor: selectedThemeSwatch.accent }} />
                <span>Transcribing...</span>
              </div>
            )}
          </div>

          <div className="relative" data-dropdown-root>
            <button type="button" onClick={onToggleQuickModelMenu} className="flex max-w-[136px] items-center gap-2 overflow-hidden rounded-xl bg-[#0f1011] px-3 py-1.5 ring-1 ring-[#282a2c] transition hover:bg-[#1a1b1c]">
              <div className="flex items-center gap-1.5">
                <BrainIcon className={`h-3.5 w-3.5 shrink-0 ${brainStatus === "Ready" || brainStatus === "Thinking" ? "text-emerald-400" : "text-[#73777f]"}`} />
                {currentModelEntry?.has_vision && <EyeIcon className="h-3.5 w-3.5 shrink-0 text-[var(--accent-color)]" />}
                <span className="max-w-[96px] truncate text-[10px] font-bold uppercase tracking-[0.14em] text-[#e3e3e3]">
                  {selectedModel || "No Model"}
                </span>
              </div>
              <ChevronDownIcon className={`h-3 w-3 text-[#73777f] transition-transform ${quickModelMenuOpen ? "rotate-180" : ""}`} />
            </button>

            {quickModelMenuOpen && (
              <div className="dropdown-scroll absolute bottom-full right-0 z-50 mb-2 max-h-80 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-[#282a2c] bg-[#131314] p-2 shadow-2xl">
                {availableModels.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#73777f]">No models found</div>
                ) : (
                  availableModels.map((model) => (
                    <button
                      key={model.path}
                      type="button"
                      onClick={() => onSelectModel(model.path)}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition ${selectedModelPath === model.path ? "bg-[var(--accent-soft)] text-[var(--accent-color)]" : "text-[#c4c7c5] hover:bg-[#282a2c]"}`}
                    >
                      <div className="flex w-9 shrink-0 items-center gap-1.5">
                        <BrainIcon className={`h-4 w-4 shrink-0 ${selectedModelPath === model.path && (brainStatus === "Ready" || brainStatus === "Thinking") ? "text-emerald-400" : "text-[#c4c7c5]"}`} />
                        {model.has_vision && <EyeIcon className="h-3.5 w-3.5 shrink-0 text-[var(--accent-color)]" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{model.name}</div>
                        <div className="truncate text-[10px] opacity-60">{model.path.split(/[/\\]/).pop()}</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
