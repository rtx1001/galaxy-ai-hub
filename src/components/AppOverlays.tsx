import { useRef } from "react";
import { GoogleCalendarEvent, googleEventTimeLabel } from "../appCore";
import { clampNumber } from "../utils";

type ImageViewerState = {
  url: string;
  localPath?: string;
  zoom: number;
  x: number;
  y: number;
};

export function FreshChatConfirmModal({
  open,
  onClose,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  onClear: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-[28px] bg-[#1e1f20] p-6 shadow-2xl ring-1 ring-[#282a2c]" onClick={(e) => e.stopPropagation()}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--accent-color)" }}>Clear Chat</div>
        <h3 className="font-title text-xl text-[#e3e3e3]">Clear chat?</h3>
        <p className="mt-2 text-sm leading-6 text-[#c4c7c5]">
          This clears only the visible conversation and current attached image. It does not delete saved settings, personalities, Google login, folders, or long-term memory.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            title="Clear the visible chat only"
            onClick={onClear}
            className="rounded-2xl border px-5 py-2.5 text-sm font-semibold shadow-sm transition hover:brightness-110"
            style={{
              borderColor: "color-mix(in srgb, var(--accent-color) 32%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--accent-color) 18%, #131314 82%)",
              color: "color-mix(in srgb, var(--accent-color) 72%, white 28%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            Clear Chat
          </button>
          <button
            type="button"
            title="Keep the current conversation"
            onClick={onClose}
            className="rounded-2xl border border-[#282a2c] bg-[#1e1f20] px-4 py-2.5 text-sm font-semibold text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function ImageViewerOverlay({
  imageViewer,
  setImageViewer,
}: {
  imageViewer: ImageViewerState | null;
  setImageViewer: React.Dispatch<React.SetStateAction<ImageViewerState | null>>;
}) {
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  if (!imageViewer) return null;
  return (
    <div
      className="fixed inset-0 z-[320] flex items-center justify-center bg-black/82 p-4 backdrop-blur-sm"
      onClick={() => setImageViewer(null)}
    >
      <div
        className="h-full w-full overflow-hidden"
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => {
          event.preventDefault();
          const direction = event.deltaY > 0 ? -0.18 : 0.18;
          setImageViewer((prev) =>
            prev
              ? {
                  ...prev,
                  zoom: clampNumber(Number((prev.zoom + direction).toFixed(2)), 0.6, 6),
                }
              : prev,
          );
        }}
      >
        <img
          src={imageViewer.url}
          alt="Full size preview"
          draggable={false}
          className="h-full w-full cursor-grab select-none object-contain active:cursor-grabbing"
          style={{
            transform: `translate(${imageViewer.x}px, ${imageViewer.y}px) scale(${imageViewer.zoom})`,
            transition: dragRef.current ? "none" : "transform 120ms ease-out",
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              originX: imageViewer.x,
              originY: imageViewer.y,
              moved: false,
            };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            const dx = event.clientX - drag.startX;
            const dy = event.clientY - drag.startY;
            if (Math.abs(dx) + Math.abs(dy) > 5) {
              drag.moved = true;
            }
            setImageViewer((prev) =>
              prev ? { ...prev, x: drag.originX + dx, y: drag.originY + dy } : prev,
            );
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current;
            dragRef.current = null;
            if (!drag || drag.pointerId !== event.pointerId || !drag.moved) {
              setImageViewer(null);
            }
          }}
        />
      </div>
    </div>
  );
}

export function GoogleEventModals({
  selectedEvent,
  deleteTarget,
  onCloseSelected,
  onRequestDelete,
  onCloseDelete,
  onConfirmDelete,
}: {
  selectedEvent: GoogleCalendarEvent | null;
  deleteTarget: GoogleCalendarEvent | null;
  onCloseSelected: () => void;
  onRequestDelete: (event: GoogleCalendarEvent) => void;
  onCloseDelete: () => void;
  onConfirmDelete: (eventId: string) => void;
}) {
  return (
    <>
      {selectedEvent && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={onCloseSelected}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-[#1e1f20] p-6 shadow-2xl ring-1 ring-[#282a2c]" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-title text-xl text-[#e3e3e3]">{selectedEvent.title || "Untitled Event"}</h3>
            <EventDetails event={selectedEvent} />
            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => onRequestDelete(selectedEvent)}
                className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-5 py-2.5 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/20"
              >
                Delete Event
              </button>
              <button
                type="button"
                onClick={onCloseSelected}
                className="rounded-2xl border border-[#282a2c] bg-[#131314] px-5 py-2.5 text-sm font-semibold text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[310] flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm" onClick={onCloseDelete}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-[#1e1f20] p-6 shadow-2xl ring-1 ring-[#282a2c]" onClick={(e) => e.stopPropagation()}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-300">Delete Event</div>
            <h3 className="mt-2 font-title text-xl text-[#e3e3e3]">{deleteTarget.title || "Untitled Event"}</h3>
            <EventDetails event={deleteTarget} />
            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  const id = deleteTarget.id;
                  onCloseDelete();
                  if (id) onConfirmDelete(id);
                }}
                className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-5 py-2.5 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/20"
              >
                Delete Event
              </button>
              <button
                type="button"
                onClick={onCloseDelete}
                className="rounded-2xl border border-[#282a2c] bg-[#131314] px-5 py-2.5 text-sm font-semibold text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function EventDetails({ event }: { event: GoogleCalendarEvent }) {
  return (
    <div className="mt-4 space-y-4">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9aa0a6]">Time</div>
        <div className="mt-1 text-sm text-[#e3e3e3]">{googleEventTimeLabel(event, true)}</div>
      </div>
      {event.location && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9aa0a6]">Location</div>
          <div className="mt-1 text-sm text-[#e3e3e3]">{event.location}</div>
        </div>
      )}
      {event.description && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9aa0a6]">Description</div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-[#e3e3e3]">{event.description}</div>
        </div>
      )}
    </div>
  );
}
