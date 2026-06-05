import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ToolResultCard, ImageProposal, ActionProposal, FilePreviewResult, GoogleCalendarEvent } from "../types";
import { formatBytes, toolCardStyle, fieldValue, compactDetailsForKind, cleanDisplayPath, localAssetUrl, pauseOtherMediaElements } from "../utils";
import { CheckIcon, ChevronDownIcon, CloseIcon, FolderOpenIcon, PlusIcon, TrashIcon } from "./Icons";
import { ImageModeDropdown, imageModeLabel, normalizeImageMode } from "./ImageModeDropdown";
import { RegisteredAudio } from "./RegisteredAudio";

type DisplayLanguage = "en" | "vi";

const uiText = (_language: DisplayLanguage) => ({
  perception: "Perception",
  openInExplorer: "Open in Explorer",
  close: "Close",
  imageTitle: "Image creation request",
  imageDescription: "The assistant wants to create an image. Review it before starting.",
  cancel: "Cancel",
  generate: "Generate",
  approve: "Approve",
});

type ImageReferencePreview = {
  id: string;
  src: string;
  label: string;
  source?: "chat_image" | "user_avatar" | "bot_avatar" | "extra_image";
};

type LocalImageDataUrl = {
  data_url: string;
  path: string;
};

const isBotImageMode = (mode: string) => normalizeImageMode(mode) === "bot_image";
const isUserImageMode = (mode: string) => normalizeImageMode(mode) === "user_image";
const isUserBotImageMode = (mode: string) => normalizeImageMode(mode) === "user_bot_image";
const normalizedReferenceSources = (sources?: string[] | null) =>
  Array.isArray(sources)
    ? sources
        .map((source) => source.trim().toLowerCase().replace(/[-\s]+/g, "_"))
        .filter((source, index, items) =>
          ["chat_image", "user_avatar", "bot_avatar"].includes(source) && items.indexOf(source) === index,
        )
    : [];

const displayImageSource = (value?: string | null) => {
  if (!value) return "";
  if (value.startsWith("data:image/") || value.startsWith("http://") || value.startsWith("https://")) return value;
  return localAssetUrl(value) || value;
};

const imagePromptMentionsUserProfile = (prompt: string, userName?: string) => {
  const lowered = prompt.toLocaleLowerCase();
  const name = userName?.trim().toLocaleLowerCase() || "";
  return Boolean(name && lowered.includes(name)) || /\b(the\s+user|selected\s+user|user\s+profile)\b/i.test(prompt);
};

const initialReferenceSourcesForMode = ({
  mode,
  prompt,
  proposalSources,
  chatImageRef,
  userAvatar,
  assistantAvatar,
  userName,
}: {
  mode: string;
  prompt: string;
  proposalSources?: string[] | null;
  chatImageRef?: string | null;
  userAvatar?: string;
  assistantAvatar?: string;
  userName?: string;
}) => {
  const normalizedMode = normalizeImageMode(mode);
  const proposalReferenceSources = normalizedReferenceSources(proposalSources);
  if (proposalReferenceSources.length) return proposalReferenceSources;
  if (normalizedMode !== "image_image") return [];
  const sources: string[] = [];
  if (displayImageSource(chatImageRef)) sources.push("chat_image");
  if (userAvatar && imagePromptMentionsUserProfile(prompt, userName)) sources.push("user_avatar");
  if (assistantAvatar && /\b(the\s+assistant|assistant\s+avatar|bot\s+avatar|current\s+assistant)\b/i.test(prompt)) {
    sources.push("bot_avatar");
  }
  return sources;
};

function ImageReferenceDots({
  mode,
  assistantAvatar,
  userAvatar,
  chatImageRef,
  extraImageRefs,
  referenceSources,
  onAddImages,
  onRemoveImage,
}: {
  mode: string;
  assistantAvatar?: string;
  userAvatar?: string;
  chatImageRef?: string | null;
  extraImageRefs: ImageReferencePreview[];
  referenceSources?: string[];
  onAddImages: () => void;
  onRemoveImage: (ref: ImageReferencePreview) => void;
}) {
  const refs: ImageReferencePreview[] = [];
  const normalizedMode = normalizeImageMode(mode);
  const selectedSources = normalizedReferenceSources(referenceSources);
  const wantsUserReference = selectedSources.includes("user_avatar");
  const wantsBotReference = selectedSources.includes("bot_avatar");
  const wantsChatReference = selectedSources.includes("chat_image");
  if (isBotImageMode(normalizedMode) && assistantAvatar) {
    refs.push({ id: "bot", src: assistantAvatar, label: "Bot avatar", source: "bot_avatar" });
  } else if (isUserImageMode(normalizedMode) && userAvatar) {
    refs.push({ id: "user", src: userAvatar, label: "User avatar", source: "user_avatar" });
  } else if (isUserBotImageMode(normalizedMode)) {
    if (userAvatar) refs.push({ id: "user", src: userAvatar, label: "User avatar", source: "user_avatar" });
    if (assistantAvatar) refs.push({ id: "bot", src: assistantAvatar, label: "Bot avatar", source: "bot_avatar" });
  } else if (normalizedMode === "image_image") {
    const displayChatImage = displayImageSource(chatImageRef);
    if (displayChatImage && wantsChatReference) refs.push({ id: "chat-image", src: displayChatImage, label: "Chat image", source: "chat_image" });
    if (userAvatar && wantsUserReference) {
      refs.push({ id: "user", src: userAvatar, label: "User avatar", source: "user_avatar" });
    }
    if (assistantAvatar && wantsBotReference) refs.push({ id: "bot", src: assistantAvatar, label: "Bot avatar", source: "bot_avatar" });
    refs.push(...extraImageRefs.map((ref) => ({ ...ref, source: "extra_image" as const })));
  }
  if (!refs.length && normalizedMode !== "image_image") return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {refs.map((ref) => (
        <span
          key={ref.id}
          className="group/ref relative inline-flex h-8 w-8 shrink-0 overflow-hidden rounded-full border border-[var(--accent-soft-strong)] bg-[#0f1011] p-0.5 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        >
          <img src={ref.src} alt="" className="h-full w-full rounded-full object-cover" />
          {normalizedMode === "image_image" && (
            <button
              type="button"
              aria-label={`Remove ${ref.label}`}
              title={`Remove ${ref.label}`}
              onClick={(event) => {
                event.stopPropagation();
                onRemoveImage(ref);
              }}
              className="absolute inset-0 flex items-center justify-center rounded-full bg-black/70 text-white opacity-0 backdrop-blur-[1px] transition hover:bg-rose-500/85 group-hover/ref:opacity-100"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      ))}
      {normalizedMode === "image_image" && (
        <button
          type="button"
          onClick={onAddImages}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#282a2c] bg-[#0f1011] text-[#c4c7c5] transition hover:border-[var(--accent-soft-strong)] hover:text-[var(--accent-color)]"
          title="Add another reference image"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function FilePreviewCard({
    preview,
    linkedFolders,
    language = "en",
}: {
    preview: FilePreviewResult;
    linkedFolders: string[];
    language?: DisplayLanguage;
}) {
    const labels = uiText(language);
    const mime = preview.mime_type.toLowerCase();
    const dataUrl = preview.data_url || "";
    const assetUrl = localAssetUrl(preview.path);
    const mediaUrl = assetUrl || dataUrl;
    const isAudio = mime.startsWith("audio/");
    const isImage = mime.startsWith("image/");
    return (
    <div className={`${isAudio ? "overflow-visible" : "overflow-hidden"} rounded-3xl border border-[#282a2c] bg-[#131314]`}>
      <div className="border-b border-[#282a2c] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[#f1f3f4]">{preview.name}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-[#c4c7c5]">
              <span>{preview.extension || "file"}</span>
              <span>{formatBytes(preview.size_bytes)}</span>
              {preview.truncated && <span>preview truncated</span>}
            </div>
          </div>
          <button
            type="button"
            title={labels.openInExplorer}
            onClick={() => invoke("open_in_explorer", { path: preview.path, folders: linkedFolders }).catch(console.error)}
            className="shrink-0 flex h-9 w-9 items-center justify-center rounded-xl border border-[#282a2c] bg-[#1e1f20] text-[var(--accent-color)] transition hover:bg-[#282a2c]"
            style={{ boxShadow: "inset 0 0 0 9999px transparent" }}
          >
            <FolderOpenIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className={`${isAudio ? "overflow-visible" : ""} ${isImage ? "p-2.5" : "p-3"}`}>
        {isImage && mediaUrl && (
          <div className="overflow-hidden rounded-[18px] bg-[#131314] ring-1 ring-[#282a2c]">
            <img src={mediaUrl} alt={preview.name} className="max-h-[520px] w-full object-contain" />
          </div>
        )}
        {isAudio && mediaUrl && (
          <RegisteredAudio id={`file-preview:${preview.path}`} title={preview.name} src={mediaUrl} className="w-full" />
        )}
        {mime.startsWith("video/") && mediaUrl && (
          <video src={mediaUrl} controls onPlay={(event) => pauseOtherMediaElements(event.currentTarget)} className="max-h-[520px] w-full rounded-2xl bg-black" />
        )}
        {mime === "application/pdf" && mediaUrl && (
          <iframe title={preview.name} src={mediaUrl} className="h-[520px] w-full rounded-2xl bg-[#0f1011]" />
        )}
        {preview.text !== null && (
          <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-2xl bg-[#0f1011] p-3 text-xs leading-6 text-[#dfe3ea] ring-1 ring-[#282a2c]">
            {preview.text}
          </pre>
        )}
        {preview.perception && (
          <details className="mt-3 rounded-2xl bg-[#0f1011] p-3 text-xs leading-6 text-[#dfe3ea] ring-1 ring-[#282a2c]">
            <summary className="cursor-pointer select-none font-semibold text-[var(--accent-color)]">{labels.perception}</summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-sans">{preview.perception}</pre>
          </details>
        )}
        {!mediaUrl && preview.text === null && (
          <div className="text-sm text-[#c4c7c5]">This file type cannot be displayed inside chat yet.</div>
        )}
      </div>
    </div>
    );
}

export function ToolResultCards({ cards, onDeleteCalendarEvent, language = "en" }: { cards: ToolResultCard[], onDeleteCalendarEvent?: (event: GoogleCalendarEvent) => void, language?: DisplayLanguage }) {
    const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
    if (!cards.length) return null;
    const labels = uiText(language);
    return (
    <>
    <div className="space-y-3">
      {cards.map((card, cardIndex) => {
        const style = toolCardStyle(card.kind);
        return (
          <details
            key={`${card.kind}-${cardIndex}`}
            className={`overflow-hidden rounded-3xl border border-[#282a2c] bg-[#131314] shadow-sm ring-1 ${style.ring}`}
          >
            <summary className="cursor-pointer select-none list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--accent-color)]">▶</span>
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
                    <h3 className="truncate text-sm font-semibold text-[#f1f3f4]">{card.title}</h3>
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-[#282a2c] bg-[#0f1011] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent-color)]">
                  {style.label}
                </span>
              </div>
            </summary>

            <div className="border-t border-[#282a2c]">
              {card.fields.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 py-3">
                  {card.fields.map((field: any, fieldIndex: number) => (
                    <div key={`${field.label}-${fieldIndex}`} className="rounded-2xl bg-[#0f1011] px-3 py-2 ring-1 ring-[#282a2c]">
                      <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9aa0a6]">{field.label}</span>
                      <span className="text-xs text-[#e3e3e3]">{cleanDisplayPath(String(field.value))}</span>
                    </div>
                  ))}
                </div>
              )}

            {card.items.length > 0 && (
              <div className="divide-y divide-[#282a2c]">
                {card.items.map((item, itemIndex) => {
                  const details = compactDetailsForKind(card.kind, item);
                  const from = fieldValue(item, "From");
                  const date = fieldValue(item, "Date");
                  const start = fieldValue(item, "Start");
                  const type = fieldValue(item, "Type");
                  const size = fieldValue(item, "Size");
                  return (
                    <article key={`${item.title}-${itemIndex}`} className={`group relative px-4 py-3 transition hover:bg-[#1a1b1c] ${card.kind === "calendar" ? "cursor-pointer" : ""}`} onClick={() => card.kind === "calendar" && setSelectedEvent({ title: item.title, details })}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold leading-6 text-[#f1f3f4]">
                            {item.url ? (
                              <a href={item.url} target="_blank" rel="noreferrer" className="text-[#d7e3ff] underline-offset-4 hover:underline">
                                {cleanDisplayPath(item.title)}
                              </a>
                            ) : (
                              cleanDisplayPath(item.title)
                            )}
                          </div>
                          {item.subtitle && card.kind !== "gmail" && (
                            <div className="mt-1 break-all text-xs leading-5 text-[#9aa0a6]">{cleanDisplayPath(item.subtitle)}</div>
                          )}
                        </div>
                        {(date || start || type || size) && (
                          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                            {[date || start, type, size].filter(Boolean).map((badge) => (
                              <span key={badge} className="rounded-full bg-[#0f1011] px-2 py-1 text-[10px] font-semibold text-[#c4c7c5] ring-1 ring-[#282a2c]">
                                {cleanDisplayPath(String(badge))}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {card.kind === "calendar" && onDeleteCalendarEvent && (
                        <button
                          type="button"
                          title="Delete event"
                          onClick={(e) => {
                            e.stopPropagation();
                            const id = fieldValue(item, "ID");
                            if (id) {
                              onDeleteCalendarEvent({
                                id,
                                title: cleanDisplayPath(item.title),
                                start: fieldValue(item, "Start"),
                                end: fieldValue(item, "End"),
                                all_day: fieldValue(item, "Start") === "All day",
                                location: fieldValue(item, "Location") || null,
                                description: fieldValue(item, "Details") || null,
                                html_link: item.url,
                              });
                            }
                          }}
                          className="absolute bottom-2 right-2 rounded-lg p-1.5 text-[#9aa0a6] opacity-40 transition hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      )}

                      {from && <div className="mt-1 text-xs text-[#c4c7c5]">{cleanDisplayPath(from)}</div>}
                      {details.length > 0 && (
                        <dl className="mt-3 grid gap-x-3 gap-y-2 text-xs leading-5 sm:grid-cols-[90px_1fr]">
                          {details.map((field: any, fieldIndex: number) => (
                            <div key={`${field.label}-${fieldIndex}`} className="contents">
                              <dt className="font-semibold text-[#9aa0a6]">{field.label}</dt>
                              <dd className="min-w-0 break-words text-[#e3e3e3]">{cleanDisplayPath(String(field.value))}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {item.url && (
                        <div className="mt-3">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex rounded-full border border-[#282a2c] bg-[#0f1011] px-3 py-1.5 text-xs font-semibold text-[var(--accent-color)] transition hover:bg-[#282a2c]"
                          >
                            Open
                          </a>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {card.text && (
              <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap p-4 text-xs leading-6 text-[#dfe3ea]">
                {cleanDisplayPath(card.text)}
              </pre>
            )}
            </div>
          </details>
        );
      })}
    </div>
      {selectedEvent && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={() => setSelectedEvent(null)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-[#1e1f20] p-6 shadow-2xl ring-1 ring-[#282a2c]" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-title text-xl text-[#e3e3e3]">{selectedEvent.title}</h3>
            <div className="mt-4 space-y-3">
              {selectedEvent.details?.map((field: any, i: number) => (
                <div key={i}>
                  <div className="text-[10px] font-semibold text-[#9aa0a6] uppercase tracking-[0.12em]">{field.label}</div>
                  <div className="mt-1 text-sm text-[#e3e3e3] whitespace-pre-wrap">{cleanDisplayPath(String(field.value))}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="rounded-2xl border border-[#282a2c] bg-[#131314] px-5 py-2.5 text-sm font-semibold text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]"
              >
                {labels.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
    );
}

export function ImageProposalCard({
      proposal,
      disabled,
      forceCollapsed = false,
      assistantAvatar,
      userAvatar,
      userName,
      chatImageRef,
      onGenerate,
      onCancel,
      language = "en",
    }: {
          proposal: ImageProposal;
          disabled: boolean;
          forceCollapsed?: boolean;
          assistantAvatar?: string;
          userAvatar?: string;
          userName?: string;
          chatImageRef?: string | null;
          onGenerate: (prompt: string, mode: string, extraReferenceImages?: string[], referenceSources?: string[]) => void;
          onCancel: () => void;
          language?: DisplayLanguage;
        }) {
    const labels = uiText(language);
    const [draftPrompt, setDraftPrompt] = useState(proposal.prompt);
    const [selectedMode, setSelectedMode] = useState(normalizeImageMode(proposal.mode || "text_image"));
    const [extraImageRefs, setExtraImageRefs] = useState<ImageReferencePreview[]>([]);
    const [selectedReferenceSources, setSelectedReferenceSources] = useState<string[]>(() =>
      initialReferenceSourcesForMode({
        mode: proposal.mode || "text_image",
        prompt: proposal.prompt,
        proposalSources: proposal.reference_sources,
        chatImageRef,
        userAvatar,
        assistantAvatar,
        userName,
      }),
    );
    const [open, setOpen] = useState(true);
    useEffect(() => {
      setDraftPrompt(proposal.prompt);
      const nextMode = normalizeImageMode(proposal.mode || "text_image");
      setSelectedMode(nextMode);
      setSelectedReferenceSources(
        initialReferenceSourcesForMode({
          mode: nextMode,
          prompt: proposal.prompt,
          proposalSources: proposal.reference_sources,
          chatImageRef,
          userAvatar,
          assistantAvatar,
          userName,
        }),
      );
      setExtraImageRefs([]);
    }, [proposal.prompt, proposal.mode, proposal.reference_sources, chatImageRef, userAvatar, assistantAvatar, userName]);
    useEffect(() => {
      if (forceCollapsed) {
        setOpen(false);
      }
    }, [forceCollapsed]);
    const selectedModeLabel = imageModeLabel(selectedMode);
    const maskText = "Mask";
    const changeSelectedMode = (mode: string) => {
      const nextMode = normalizeImageMode(mode);
      setSelectedMode(nextMode);
      setSelectedReferenceSources(
        initialReferenceSourcesForMode({
          mode: nextMode,
          prompt: draftPrompt,
          proposalSources: proposal.reference_sources,
          chatImageRef,
          userAvatar,
          assistantAvatar,
          userName,
        }),
      );
    };
    const removeReferenceImage = (ref: ImageReferencePreview) => {
      if (ref.source === "extra_image") {
        setExtraImageRefs((prev) => prev.filter((item) => item.id !== ref.id));
        return;
      }
      if (ref.source) {
        setSelectedReferenceSources((prev) => prev.filter((source) => source !== ref.source));
      }
    };
    const addReferenceImages = async () => {
      const selected = await openDialog({
        directory: false,
        multiple: true,
        title: "Choose reference image",
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] },
        ],
      });
      const paths = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
      if (!paths.length) return;
      const loaded: ImageReferencePreview[] = [];
      for (const path of paths) {
        try {
          const result = await invoke<LocalImageDataUrl>("read_local_image_data_url", { path });
          loaded.push({
            id: `${result.path}-${loaded.length}-${Date.now()}`,
            src: result.data_url,
            label: result.path.split(/[\\/]/).pop() || "Reference image",
          });
        } catch (error) {
          console.error("Reference image load error:", error);
        }
      }
      if (loaded.length) {
        setExtraImageRefs((prev) => [...prev, ...loaded].slice(0, 4));
      }
    };
    return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="w-full overflow-visible rounded-[22px] border border-[var(--accent-soft-strong)] bg-[#131314] shadow-sm"
    >
      <summary className="cursor-pointer select-none list-none px-3.5 py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 text-[var(--accent-color)] transition-transform ${open ? "rotate-180" : ""}`} />
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--accent-color)]" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[#f1f3f4]">{labels.imageTitle}</div>
              {!open && (
                <div className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9aa0a6]">
                  {selectedModeLabel}
                </div>
              )}
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-[#282a2c] bg-[#0f1011] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent-color)]">
            Approval
          </span>
        </div>
      </summary>
      <div className="border-t border-[#282a2c] p-3">
        <textarea
          value={draftPrompt}
          onChange={(event) => setDraftPrompt(event.target.value)}
          className="approval-prompt-textarea min-h-24 max-h-56 w-full resize-none rounded-2xl border border-[#282a2c] bg-[#0f1011] p-3 pr-2 text-sm leading-6 text-[#e3e3e3] outline-none transition focus:border-[var(--accent-soft-strong)]"
          placeholder="Describe the image..."
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] leading-5">
            <ImageModeDropdown value={selectedMode} onChange={changeSelectedMode} />
            <ImageReferenceDots
              mode={selectedMode}
              assistantAvatar={assistantAvatar}
              userAvatar={userAvatar}
              chatImageRef={chatImageRef}
              extraImageRefs={extraImageRefs}
              referenceSources={selectedReferenceSources}
              onAddImages={addReferenceImages}
              onRemoveImage={removeReferenceImage}
            />
            {proposal.mask_prompt && (
              <span className="max-w-full rounded-full border border-[#282a2c] bg-[#0f1011] px-2.5 py-1 font-semibold text-[#c4c7c5]">
                <span className="mr-1.5 uppercase tracking-[0.12em] text-[#9aa0a6]">{maskText}</span>
                <span className="text-[#e3e3e3]">{proposal.mask_prompt}</span>
              </span>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              title={labels.cancel}
              onClick={onCancel}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#282a2c] bg-[#131314] text-[#e3e3e3] transition hover:bg-[#282a2c]"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={labels.generate}
              disabled={disabled || !draftPrompt.trim()}
              onClick={() => {
                setOpen(false);
                const referenceSources = normalizedReferenceSources(selectedReferenceSources);
                const sourceRefs =
                  normalizeImageMode(selectedMode) === "image_image"
                    ? [
                        referenceSources.includes("user_avatar") ? userAvatar : null,
                        referenceSources.includes("bot_avatar") ? assistantAvatar : null,
                      ].filter((value): value is string => Boolean(value))
                    : [];
                onGenerate(
                  draftPrompt.trim(),
                  selectedMode,
                  [...sourceRefs, ...extraImageRefs.map((ref) => ref.src)],
                  referenceSources,
                );
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#0b0d10] transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: "var(--accent-color)" }}
            >
              <CheckIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </details>
    );
}

export function ActionProposalCard({
      proposal,
      disabled,
      forceCollapsed = false,
      onApprove,
      onCancel,
      language = "en",
    }: {
          proposal: ActionProposal;
          disabled: boolean;
          forceCollapsed?: boolean;
          onApprove: () => void;
          onCancel: () => void;
          language?: DisplayLanguage;
        }) {
    const labels = uiText(language);
    const [open, setOpen] = useState(true);
    useEffect(() => {
      if (forceCollapsed) {
        setOpen(false);
      }
    }, [forceCollapsed]);
    const actionTitle = "Action request";
    const detailsLabel = "Details";
    const riskClass = proposal.risk_level === "high"
              ? "bg-rose-500/15 text-rose-200"
              : proposal.risk_level === "medium"
                ? "bg-amber-500/15 text-amber-200"
                : "text-[var(--accent-color)]";
    return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="w-full overflow-hidden rounded-[22px] border border-[#282a2c] bg-[#131314]"
    >
      <summary className="cursor-pointer select-none list-none px-3.5 py-3 [&::-webkit-details-marker]:hidden">
      <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[10px] text-[var(--accent-color)]">▶</span>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--accent-color)]" />
          <div className="truncate text-sm font-semibold text-[#f1f3f4]">{actionTitle}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${riskClass}`} style={proposal.risk_level === "low" ? { backgroundColor: "var(--accent-soft)" } : undefined}>
          {proposal.risk_level}
        </span>
      </div>
      </summary>
      <div className="border-t border-[#282a2c] p-3">
        <div className="text-sm font-semibold text-[#f1f3f4]">{proposal.title}</div>
        <div className="mt-1 text-xs leading-5 text-[#c4c7c5]">{proposal.details}</div>
        <details className="mt-2 overflow-hidden rounded-2xl border border-[#282a2c] bg-[#0f1011] text-xs text-[#c4c7c5]">
          <summary className="cursor-pointer select-none px-3 py-2 font-semibold text-[var(--accent-color)] [&::-webkit-details-marker]:hidden">
            ▶ {detailsLabel}
          </summary>
          <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap border-t border-[#282a2c] p-3 leading-5 text-[#dfe3ea]">
            {JSON.stringify(proposal.arguments, null, 2)}
          </pre>
        </details>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-[#282a2c] bg-[#131314] px-4 py-2 text-xs font-semibold text-[#e3e3e3] transition hover:bg-[#282a2c]"
        >
          {labels.cancel}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setOpen(false);
            onApprove();
          }}
          className="rounded-full px-4 py-2 text-xs font-semibold text-[#0b0d10] transition disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: "var(--accent-color)" }}
        >
          {labels.approve}
        </button>
      </div>
      </div>
    </details>
    );
}
