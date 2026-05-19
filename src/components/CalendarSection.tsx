import { GoogleCalendarEvent, getLunarLabel, googleEventMatchesDate, googleEventTimeLabel, monthTitle, normalizeCalendarEventForDisplay, toLocalDateKey } from "../appCore";
import { getVietnameseLunarDate } from "../utils";
import { ChevronDownIcon, TrashIcon } from "./Icons";

export function CalendarSection({
  open,
  month,
  monthDays,
  selectedDate,
  selectedDateObj,
  selectedLabel,
  googleEvents,
  selectedGoogleEvents,
  onToggle,
  onMonthChange,
  onSelectDate,
  onSelectGoogleEvent,
  onDeleteGoogleEvent,
}: {
  open: boolean;
  month: Date;
  monthDays: Date[];
  selectedDate: string;
  selectedDateObj: Date;
  selectedLabel: string;
  googleEvents: GoogleCalendarEvent[];
  selectedGoogleEvents: GoogleCalendarEvent[];
  onToggle: (open: boolean) => void;
  onMonthChange: (date: Date) => void;
  onSelectDate: (date: Date) => void;
  onSelectGoogleEvent: (event: GoogleCalendarEvent) => void;
  onDeleteGoogleEvent: (event: GoogleCalendarEvent) => void;
}) {
  return (
    <details
      className="overflow-hidden rounded-[20px] border border-[#282a2c] bg-[#1e1f20] shadow-sm"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className="grid h-12 cursor-pointer list-none grid-cols-[minmax(0,1fr)_16px] items-center gap-2 px-3 [&::-webkit-details-marker]:hidden">
        <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">Calendar</div>
        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[#c4c7c5] transition ${open ? "rotate-180" : ""}`} />
      </summary>
      <div className="space-y-2.5 border-t border-[#282a2c] p-3">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-xl border border-[#282a2c] bg-[#131314] px-3 py-2 text-sm font-bold text-[#e3e3e3] transition hover:bg-[#282a2c]">{"\u2039"}</button>
          <div className="text-center">
            <div className="font-title text-xl font-bold text-[#e3e3e3]">{monthTitle(month)}</div>
            <div className="text-[11px] text-[#9aa0a6]">{month.getFullYear()}</div>
          </div>
          <button type="button" onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-xl border border-[#282a2c] bg-[#131314] px-3 py-2 text-sm font-bold text-[#e3e3e3] transition hover:bg-[#282a2c]">{"\u203A"}</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-[#9aa0a6]">
          {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
            <div key={`${day}-${index}`} className={index === 0 ? "text-rose-400" : ""}>{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {monthDays.map((date) => {
            const key = toLocalDateKey(date);
            const inMonth = date.getMonth() === month.getMonth();
            const selected = key === selectedDate;
            const today = key === toLocalDateKey(new Date());
            const dayGoogleEvents = googleEvents.filter((event) => googleEventMatchesDate(event, key));
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectDate(date)}
                title={getVietnameseLunarDate(date)}
                className={`relative flex aspect-square w-full max-w-9 justify-self-center rounded-lg border px-1 text-center transition ${selected ? "border-[#e3e3e3] bg-[#e3e3e3] text-[#131314]" : today ? "border-[var(--accent-color)] bg-[#131314] text-[#e3e3e3] hover:bg-[#282a2c]" : "border-transparent bg-[#131314] text-[#e3e3e3] hover:border-[#282a2c] hover:bg-[#282a2c]"} ${!inMonth ? "opacity-35" : ""}`}
              >
                <div className="flex min-w-0 flex-1 flex-col items-center justify-center">
                  <div className={`text-sm font-bold leading-none ${date.getDay() === 0 && !selected ? "text-rose-400" : ""}`}>{date.getDate()}</div>
                </div>
                <div className="absolute bottom-1 flex min-h-1 justify-center gap-0.5">
                  {dayGoogleEvents.slice(0, 3).map((event) => <span key={event.id} className="h-1.5 w-1.5 rounded-full bg-[var(--accent-color)]" />)}
                </div>
              </button>
            );
          })}
        </div>
        <div className="rounded-2xl border border-[#282a2c] bg-[#131314] p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-[#e3e3e3]">{selectedLabel}</div>
              <div className="mt-0.5 text-xs text-[#73777f]">Lunar {getLunarLabel(selectedDateObj) || "unavailable"}</div>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {selectedGoogleEvents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#3a3b3d] px-4 py-3 text-sm text-[#c4c7c5]">No events on this date.</div>
            ) : (
              selectedGoogleEvents.map((event) => (
                <div
                  key={`google-${event.id}`}
                  className="group relative cursor-pointer rounded-2xl p-3 ring-1 ring-[var(--accent-soft)] transition"
                  style={{ backgroundColor: "color-mix(in srgb, var(--accent-color) 12%, #131314)" }}
                  onClick={() => onSelectGoogleEvent(normalizeCalendarEventForDisplay(event))}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[#e3e3e3]">{event.title}</div>
                      <div className="mt-0.5 truncate text-xs text-[var(--accent-color)]">Google Calendar - {googleEventTimeLabel(event)}</div>
                      {event.location && <div className="mt-1 truncate text-xs text-[#c4c7c5]">{event.location}</div>}
                    </div>
                    <div className="rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--accent-color)]">Google</div>
                  </div>
                  <button
                    type="button"
                    title="Delete event"
                    onClick={(eventClick) => {
                      eventClick.stopPropagation();
                      onDeleteGoogleEvent(event);
                    }}
                    className="absolute bottom-2 right-2 rounded-lg p-1 text-[var(--accent-color)] opacity-40 transition hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
