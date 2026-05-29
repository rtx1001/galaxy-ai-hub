import React from "react";
import { ActionProposal, ChatContentPart, ChatMessage } from "../types";
import { GoogleCalendarEvent, SystemInfo, extractMessageText } from "../appCore";
import { AvatarImage } from "./UI";
import { FilePreviewCard, ToolResultCards, ImageProposalCard, ActionProposalCard } from "./ToolCards";
import { FormattedMessageText } from "./ChatBubble";
import { ChevronDownIcon, ChevronUpIcon, FolderIcon, SpeakerIcon, StopIcon, TrashIcon } from "./Icons";

const formatBubbleTimestamp = (value?: number) => {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatReplyDuration = (value?: number) => {
  if (typeof value !== "number" || value < 0) return "";
  const seconds = Math.max(1, Math.round(value / 1000));
  return `${seconds}s`;
};

export function ConversationPane({
  scrollRef,
  endRef,
  messages,
  brandLogo,
  systemInfo,
  assistantName,
  assistantAvatar,
  userName,
  userAvatar,
  hardwareGpuLabel,
  hardwareRamLabel,
  isStreaming,
  isGeneratingImage,
  isApproving,
  collapsedImageParts,
  linkedFolders,
  speakingMessageId,
  showScrollBottom,
  onScroll,
  onOpenPersonalityProfile,
  onOpenUserProfile,
  onOpenImageViewer,
  onRevealImageLocation,
  onDeleteImageMessage,
  onToggleImageCollapsed,
  onDismissImageProposal,
  onGenerateImage,
  onDismissChatPart,
  onApproveActionProposal,
  onDeleteCalendarEvent,
  onSpeakToggle,
  onScrollToBottom,
}: {
  scrollRef: React.RefObject<HTMLElement | null>;
  endRef: React.RefObject<HTMLDivElement | null>;
  messages: ChatMessage[];
  brandLogo: string;
  systemInfo: SystemInfo | null;
  assistantName: string;
  assistantAvatar: string;
  userName: string;
  userAvatar: string;
  hardwareGpuLabel: string;
  hardwareRamLabel: string;
  isStreaming: boolean;
  isGeneratingImage: boolean;
  isApproving: boolean;
  collapsedImageParts: Record<string, boolean>;
  linkedFolders: string[];
  speakingMessageId: string | null;
  showScrollBottom: boolean;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  onOpenPersonalityProfile: () => void;
  onOpenUserProfile: () => void;
  onOpenImageViewer: (url: string, localPath?: string) => void;
  onRevealImageLocation: (path: string) => void;
  onDeleteImageMessage: (messageId: string) => void;
  onToggleImageCollapsed: (key: string) => void;
  onDismissImageProposal: (messageId: string, partIndex: number) => void;
  onGenerateImage: (prompt: string, mode: string, maskPrompt?: string) => void;
  onDismissChatPart: (messageId: string, partIndex: number, fallbackText: string) => void;
  onApproveActionProposal: (messageId: string, partIndex: number, proposal: ActionProposal) => void;
  onDeleteCalendarEvent: (event: GoogleCalendarEvent) => void;
  onSpeakToggle: (messageId: string, text: string, role: ChatMessage["role"]) => void;
  onScrollToBottom: () => void;
}) {
  return (
    <section ref={scrollRef} onScroll={onScroll} className="conversation-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
      {messages.length === 0 ? (
        <div className="relative z-10 mx-auto flex h-full max-w-3xl flex-col items-center justify-center text-center">
          <img src={brandLogo} alt="Galaxy AI Hub" className="mx-auto h-auto w-full max-w-[260px] object-contain" />
          <h1 className="mt-8 font-title text-4xl tracking-tight text-[#f4f6f8] md:text-5xl">Start a conversation.</h1>
          {systemInfo && (
            <div className="mt-8 w-full max-w-[740px] rounded-[22px] border border-[#282a2c] bg-[#1b1c1e] px-6 py-4 text-left shadow-[0_12px_40px_rgba(0,0,0,0.28)]">
              <div className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[112px_minmax(0,1fr)]">
                <button
                  type="button"
                  onClick={onOpenPersonalityProfile}
                  className="h-28 w-28 shrink-0 overflow-hidden rounded-[18px] bg-[#131314] text-left ring-1 ring-[#282a2c] transition hover:ring-[var(--accent-color)]"
                  title="Open assistant profile"
                >
                  <AvatarImage src={assistantAvatar} fallback={assistantName || "AI"} className="h-full w-full rounded-[18px]" />
                </button>
                <div className="min-w-0 self-center">
                  <div className="text-[24px] font-semibold leading-none tracking-tight text-[#f4f6f8]">{assistantName || "Assistant"}</div>
                  <div className="mt-1 text-[10px] font-bold uppercase leading-none tracking-[0.22em] text-[#c4c7c5]">Hardware Check</div>
                  <dl className="mt-2 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px] leading-4 sm:grid-cols-[82px_minmax(0,1fr)]">
                    <dt className="font-semibold text-[#9aa0a6]">CPU</dt>
                    <dd className="min-w-0 break-words text-[#e3e3e3]">{systemInfo.cpu_name}</dd>
                    <dt className="font-semibold text-[#9aa0a6]">GPU - RAM</dt>
                    <dd className="min-w-0 break-words text-[#e3e3e3]">{hardwareGpuLabel}</dd>
                    <dt className="font-semibold text-[#9aa0a6]">RAM</dt>
                    <dd className="min-w-0 break-words text-[#e3e3e3]">{hardwareRamLabel}</dd>
                  </dl>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-5">
          {messages.map((message, index) => {
            const messageText = extractMessageText(message.content);
            const canSpeak = Boolean(messageText) && !(typeof message.content === "string" && message.content.startsWith("[Error"));
            const firstImagePartIndex = Array.isArray(message.content)
              ? message.content.findIndex((part) => part.type === "image_url" && Boolean(part.image_url.local_path))
              : -1;
            const firstImagePart = firstImagePartIndex >= 0 && Array.isArray(message.content)
              ? (message.content[firstImagePartIndex] as Extract<ChatContentPart, { type: "image_url" }>)
              : undefined;
            const firstImagePath = firstImagePart?.image_url.local_path;
            const firstImagePartKey = firstImagePartIndex >= 0 ? `${message.id}:${firstImagePartIndex}` : "";
            const firstImageCollapsed = firstImagePartKey ? Boolean(collapsedImageParts[firstImagePartKey]) : false;
            const hasImageContent = Array.isArray(message.content) && message.content.some((part) => part.type === "image_url");
            const hasApprovalContent = Array.isArray(message.content) && message.content.some((part) => part.type === "image_proposal" || part.type === "action_proposal");
            const isTypingIndicator = message.role === "assistant" && message.content === "" && index === messages.length - 1 && isStreaming;
            const messageComplete = !isTypingIndicator && (message.role === "user" || Boolean(message.completed_at || message.duration_ms || messageText.trim() || hasImageContent || hasApprovalContent));
            const bubbleTimestamp = messageComplete ? formatBubbleTimestamp(message.created_at) : "";
            const replyDuration = messageComplete && message.role === "assistant" ? formatReplyDuration(message.duration_ms) : "";
            const hasBubbleFooter = Boolean(bubbleTimestamp || replyDuration || firstImagePath || firstImagePartKey || canSpeak);

            return (
              <div key={message.id} data-message-id={message.id} className={`chat-message-row flex items-start gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                {message.role === "assistant" && (
                  <div className="mt-1 h-10 w-10 shrink-0 overflow-hidden rounded-2xl bg-[#1e1f20] ring-1 ring-[#282a2c]" title={assistantName || "Assistant"}>
                    <AvatarImage src={assistantAvatar} fallback={assistantName || "AI"} className="h-full w-full rounded-2xl" />
                  </div>
                )}
                <div
                  className={`chat-bubble min-w-0 max-w-[88%] ${hasApprovalContent ? "w-[88%]" : ""} overflow-hidden rounded-[28px] shadow-sm ring-1 ${hasImageContent ? "px-3 py-3" : isTypingIndicator ? "px-4 py-3" : "px-5 py-4"} ${
                    message.role === "user" ? "text-[#e3e3e3]" : "bg-[#1e1f20] text-[#e3e3e3] ring-[#282a2c]"
                  }`}
                  style={message.role === "user" ? { backgroundColor: "var(--accent-soft)", boxShadow: "inset 0 0 0 1px var(--accent-soft-strong)" } : undefined}
                >
                  {message.role === "assistant" && message.thinking && (
                    <details className="mb-3 overflow-hidden rounded-2xl border border-[#282a2c] bg-[#131314] px-3 py-2 text-xs text-[#c4c7c5]">
                      <summary className="cursor-pointer select-none font-semibold text-[var(--accent-color)]">Thinking process</summary>
                      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans leading-6">{message.thinking}</pre>
                    </details>
                  )}
                  {Array.isArray(message.content) ? (
                    <div className="space-y-3">
                      {message.content.map((part, partIndex) =>
                        part.type === "text" ? (
                          <FormattedMessageText key={partIndex} text={part.text} compact={message.role === "user"} />
                        ) : part.type === "image_url" ? (
                          <ImagePart
                            key={partIndex}
                            messageId={message.id}
                            partIndex={partIndex}
                            part={part}
                            collapsed={Boolean(collapsedImageParts[`${message.id}:${partIndex}`])}
                            onToggle={onToggleImageCollapsed}
                            onOpen={onOpenImageViewer}
                          />
                        ) : part.type === "image_proposal" ? (
                          <ImageProposalCard
                            key={partIndex}
                            proposal={part.image_proposal}
                            disabled={isGeneratingImage}
                            forceCollapsed={index < messages.length - 1}
                            language="en"
                            onCancel={() => onDismissImageProposal(message.id, partIndex)}
                            onGenerate={(prompt) => onGenerateImage(prompt, part.image_proposal.mode, part.image_proposal.mask_prompt ?? undefined)}
                          />
                        ) : part.type === "action_proposal" ? (
                          <ActionProposalCard
                            key={partIndex}
                            proposal={part.action_proposal}
                            disabled={isApproving}
                            forceCollapsed={index < messages.length - 1}
                            language="en"
                            onCancel={() => onDismissChatPart(message.id, partIndex, "Action was cancelled.")}
                            onApprove={() => onApproveActionProposal(message.id, partIndex, part.action_proposal)}
                          />
                        ) : part.type === "tool_result_cards" ? (
                          <ToolResultCards key={partIndex} cards={part.cards} language="en" onDeleteCalendarEvent={onDeleteCalendarEvent} />
                        ) : (
                          <FilePreviewCard key={partIndex} preview={part.file_preview} linkedFolders={linkedFolders} language="en" />
                        ),
                      )}
                    </div>
                  ) : isTypingIndicator ? (
                    <span className="flex h-4 items-center gap-1">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[#c4c7c5]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[#c4c7c5] [animation-delay:120ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[#c4c7c5] [animation-delay:240ms]" />
                    </span>
                  ) : (
                    <FormattedMessageText text={message.content} compact={message.role === "user"} />
                  )}

                  {hasBubbleFooter && (
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        {(bubbleTimestamp || replyDuration) && (
                          <span className="chat-bubble-meta min-w-0 text-[10px] font-semibold leading-none text-[#9aa0a6]">
                            {bubbleTimestamp}
                            {replyDuration ? ` - ${replyDuration}` : ""}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {firstImagePath && (
                          <button
                            type="button"
                            title="Open image folder"
                            onClick={() => onRevealImageLocation(firstImagePath)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#282a2c] bg-[#131314] text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
                          >
                            <FolderIcon className="h-4 w-4" />
                          </button>
                        )}
                        {firstImagePartKey && (
                          <button
                            type="button"
                            title="Delete image message"
                            onClick={() => onDeleteImageMessage(message.id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#282a2c] bg-[#131314] text-[#e3e3e3] transition hover:bg-rose-500/10 hover:text-rose-300"
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {firstImagePartKey && (
                          <button
                            type="button"
                            title={firstImageCollapsed ? "Expand image" : "Collapse image"}
                            onClick={() => onToggleImageCollapsed(firstImagePartKey)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#282a2c] bg-[#131314] text-[#e3e3e3] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
                          >
                            {firstImageCollapsed ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronUpIcon className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        {canSpeak && (
                          <button
                            type="button"
                            onClick={() => onSpeakToggle(message.id, messageText, message.role)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#282a2c] bg-[#131314] text-[#e3e3e3] transition hover:bg-[#282a2c]"
                            title={speakingMessageId === message.id ? "Stop speech" : "Speak"}
                          >
                            {speakingMessageId === message.id ? <StopIcon className="h-3.5 w-3.5" /> : <SpeakerIcon className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {message.role === "user" && (
                  <button
                    type="button"
                    onClick={onOpenUserProfile}
                    className="mt-1 h-10 w-10 shrink-0 overflow-hidden rounded-2xl"
                    style={{ backgroundColor: "var(--accent-soft)", boxShadow: "inset 0 0 0 1px var(--accent-soft-strong)" }}
                    title="Edit user profile"
                  >
                    <AvatarImage src={userAvatar} fallback={userName || "You"} className="h-full w-full rounded-2xl" />
                  </button>
                )}
              </div>
            );
          })}
          <div ref={endRef} className="h-6 shrink-0" />
        </div>
      )}
      {showScrollBottom && (
        <button
          onClick={onScrollToBottom}
          className="sticky bottom-4 left-1/2 z-10 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border border-[#52555a] bg-[#3d3f42]/90 text-[var(--accent-color)] shadow-lg backdrop-blur-md transition hover:bg-[#4a4c50]/90 active:scale-95"
          title="Scroll to bottom"
        >
          <ChevronDownIcon className="h-5 w-5" />
        </button>
      )}
    </section>
  );
}

function ImagePart({
  messageId,
  partIndex,
  part,
  collapsed,
  onToggle,
  onOpen,
}: {
  messageId: string;
  partIndex: number;
  part: Extract<ChatContentPart, { type: "image_url" }>;
  collapsed: boolean;
  onToggle: (key: string) => void;
  onOpen: (url: string, localPath?: string) => void;
}) {
  const key = `${messageId}:${partIndex}`;
  if (collapsed) {
    return (
      <div className="flex h-10 items-center rounded-[14px] border border-dashed border-[#3a3b3d] px-3 text-sm font-semibold text-[#c4c7c5]">
        Image collapsed
      </div>
    );
  }
  return (
    <div className="relative overflow-visible">
      <div className="hidden">
        <button
          type="button"
          title="Collapse image"
          onClick={() => onToggle(key)}
          className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#282a2c] bg-[#131314]/90 text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
        >
          <ChevronUpIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {part.image_url.url ? (
        <button
          type="button"
          title="View image"
          onClick={() => onOpen(part.image_url.url, part.image_url.local_path ?? undefined)}
          className="block w-full overflow-hidden rounded-[14px] text-left"
        >
          <img src={part.image_url.url} alt="Chat visual" className="max-h-[420px] w-full rounded-[14px] object-contain transition hover:brightness-110" />
        </button>
      ) : (
        <div className="flex h-52 items-center justify-center rounded-[14px] border border-[#282a2c] bg-[#131314]/35 text-sm text-[#9aa0a6]">
          Reloading image...
        </div>
      )}
    </div>
  );
}
