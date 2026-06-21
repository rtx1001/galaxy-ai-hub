import type { AutomationEveryUnit, AutomationRepeat } from "../appCore";
import {
  automationScheduleLabel,
  buildAutomationSchedule,
  compactAutomationSummary,
  parseTimeParts,
  toLocalDateKey,
} from "../appCore";
import { clampNumber } from "../utils";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, RepeatIcon, SaveIcon } from "./Icons";
import { IconButton } from "./UI";

export function AutomationEditorModal({
  open,
  editingAutomationId,
  automationName,
  automationPrompt,
  automationDate,
  automationTime,
  automationRepeat,
  automationEveryAmount,
  automationEveryUnit,
  automationTimeMenuOpen,
  automationDateMenuOpen,
  automationMonthMenuOpen,
  automationEveryUnitMenuOpen,
  automationEditorMonth,
  onClose,
  onCancel,
  onSave,
  onAutomationNameChange,
  onAutomationPromptChange,
  onAutomationDateChange,
  onAutomationTimeChange,
  onAutomationRepeatChange,
  onAutomationEveryAmountChange,
  onAutomationEveryUnitChange,
  onAutomationTimeMenuOpenChange,
  onAutomationDateMenuOpenChange,
  onAutomationMonthMenuOpenChange,
  onAutomationEveryUnitMenuOpenChange,
  onAutomationEditorMonthChange,
}: {
  open: boolean;
  editingAutomationId: number | null;
  automationName: string;
  automationPrompt: string;
  automationDate: string;
  automationTime: string;
  automationRepeat: AutomationRepeat;
  automationEveryAmount: number;
  automationEveryUnit: AutomationEveryUnit;
  automationTimeMenuOpen: boolean;
  automationDateMenuOpen: boolean;
  automationMonthMenuOpen: boolean;
  automationEveryUnitMenuOpen: boolean;
  automationEditorMonth: Date;
  onClose: () => void;
  onCancel: () => void;
  onSave: () => void;
  onAutomationNameChange: (value: string) => void;
  onAutomationPromptChange: (value: string) => void;
  onAutomationDateChange: (value: string) => void;
  onAutomationTimeChange: (value: string) => void;
  onAutomationRepeatChange: (value: AutomationRepeat) => void;
  onAutomationEveryAmountChange: (value: number | ((previous: number) => number)) => void;
  onAutomationEveryUnitChange: (value: AutomationEveryUnit) => void;
  onAutomationTimeMenuOpenChange: (value: boolean | ((previous: boolean) => boolean)) => void;
  onAutomationDateMenuOpenChange: (value: boolean | ((previous: boolean) => boolean)) => void;
  onAutomationMonthMenuOpenChange: (value: boolean | ((previous: boolean) => boolean)) => void;
  onAutomationEveryUnitMenuOpenChange: (value: boolean | ((previous: boolean) => boolean)) => void;
  onAutomationEditorMonthChange: (value: Date | ((previous: Date) => Date)) => void;
}) {
  if (!open) return null;

  const automationDateLabel = (() => {
    const date = new Date(`${automationDate}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? automationDate || "Choose date"
      : new Intl.DateTimeFormat(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(date);
  })();

  const automationTimeParts = parseTimeParts(automationTime || "09:00");
  const automationPeriod = automationTimeParts.hours >= 12 ? "PM" : "AM";
  const automationHour12 = automationTimeParts.hours % 12 || 12;
  const automationHourOptions = Array.from({ length: 12 }, (_, index) => index + 1);
  const automationMinuteOptions = Array.from({ length: 60 }, (_, index) => index);
  const automationEditorMonthTitle = new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
  }).format(automationEditorMonth);
  const automationEditorYearOptions = Array.from({ length: 5 }, (_, index) => automationEditorMonth.getFullYear() + index);
  const automationEditorMonthOptions = Array.from({ length: 12 }, (_, index) => ({
    index,
    label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(automationEditorMonth.getFullYear(), index, 1)),
  }));
  const automationEditorMonthDays = (() => {
    const first = new Date(automationEditorMonth.getFullYear(), automationEditorMonth.getMonth(), 1);
    const start = new Date(first);
    const mondayOffset = (first.getDay() + 6) % 7;
    start.setDate(first.getDate() - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  })();

  const formatAutomationTime = (hours: number, minutes: number) =>
    `${String((hours + 24) % 24).padStart(2, "0")}:${String((minutes + 60) % 60).padStart(2, "0")}`;
  const setAutomationTimeFromParts = (hours: number, minutes: number) => {
    const total = ((hours * 60 + minutes) % 1440 + 1440) % 1440;
    onAutomationTimeChange(formatAutomationTime(Math.floor(total / 60), total % 60));
  };
  const setAutomationTimeFromClock = (hour12: number, minutes: number, period: string) => {
    const normalizedHour = clampNumber(Math.floor(hour12 || 12), 1, 12);
    const normalizedMinute = clampNumber(Math.floor(minutes || 0), 0, 59);
    const hours = period === "PM" ? (normalizedHour % 12) + 12 : normalizedHour % 12;
    setAutomationTimeFromParts(hours, normalizedMinute);
  };
  const adjustAutomationTime = (minutesDelta: number) => {
    const total = automationTimeParts.hours * 60 + automationTimeParts.minutes + minutesDelta;
    setAutomationTimeFromParts(Math.floor(total / 60), total % 60);
  };
  const setAutomationEditorDate = (date: Date) => {
    const key = toLocalDateKey(date);
    onAutomationDateChange(key);
    onAutomationEditorMonthChange(new Date(date.getFullYear(), date.getMonth(), 1));
    onAutomationDateMenuOpenChange(false);
    onAutomationMonthMenuOpenChange(false);
  };
  const ensureEveryRepeat = (unit = automationEveryUnit) => {
    onAutomationRepeatChange(unit === "hours" ? "every_hours" : "every_minutes");
    if (!automationTime) onAutomationTimeChange("09:00");
  };
  const schedule = buildAutomationSchedule(automationDate, automationTime, automationRepeat, automationEveryAmount, automationEveryUnit);

  return (
    <div className="fixed inset-0 z-[86] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl overflow-hidden rounded-[28px] bg-[#1e1f20] shadow-2xl ring-1 ring-[#282a2c]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 px-5 pt-5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-[var(--accent-color)]">
              <RepeatIcon className="h-4 w-4" />
              Automation
            </div>
            <h3 className="mt-1 font-title text-2xl text-[#e3e3e3]">{editingAutomationId ? "Edit automation" : "Schedule a task"}</h3>
            <p className="mt-1 text-sm leading-6 text-[#c4c7c5]">Choose the timing and keep the task instruction short and clear.</p>
          </div>
          <div className="px-5 pt-5">
            <IconButton title="Close" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </div>
        </div>

        <div className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_280px]">
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.16em] text-[#9aa0a6]">Task name</span>
              <input
                value={automationName}
                onChange={(event) => onAutomationNameChange(event.target.value)}
                className="w-full rounded-2xl border border-[#282a2c] bg-[#131314] px-4 py-3 text-sm font-semibold text-[#e3e3e3] outline-none transition placeholder:text-[#73777f] focus:border-[var(--accent-color)]"
                placeholder="Morning weather brief"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.16em] text-[#9aa0a6]">What should happen?</span>
              <textarea
                value={automationPrompt}
                onChange={(event) => onAutomationPromptChange(event.target.value)}
                rows={6}
                className="max-h-52 min-h-[152px] w-full resize-none overflow-y-auto rounded-3xl border border-[#282a2c] bg-[#131314] px-4 py-3 text-sm leading-6 text-[#e3e3e3] outline-none transition placeholder:text-[#73777f] focus:border-[var(--accent-color)]"
                placeholder="Check tomorrow's weather and tell me if I should bring an umbrella."
              />
            </label>
            <div className="px-1 text-xs leading-5 text-[#c4c7c5]">
              <div className="font-bold uppercase tracking-[0.16em] text-[var(--accent-color)]">Job preview</div>
              <div className="mt-1 text-sm font-semibold leading-6 text-[#e3e3e3]/90">
                {compactAutomationSummary(automationName || "Untitled task", schedule, automationPrompt || "No instruction yet", automationDate)}
              </div>
            </div>
          </div>

          <div className="rounded-[24px] bg-[#1b1c1e] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--accent-color)]">Schedule</div>
              <div className="mt-2 w-full truncate rounded-2xl bg-[var(--accent-soft)] px-3 py-2 text-xs font-bold text-[var(--accent-color)]">
                {automationScheduleLabel(schedule, automationDate)}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#9aa0a6]">Date</div>
                <div className="relative" data-dropdown-root>
                  <button
                    type="button"
                    onClick={() => {
                      onAutomationDateMenuOpenChange((open) => !open);
                      onAutomationMonthMenuOpenChange(false);
                    }}
                    className="flex h-11 w-full items-center justify-between rounded-2xl bg-[var(--accent-soft)] px-3 text-left text-sm font-semibold text-[var(--accent-color)] shadow-inner shadow-black/20 ring-1 ring-[var(--accent-soft-strong)] transition hover:brightness-110"
                  >
                    <span className="min-w-0 truncate">{automationDateLabel}</span>
                    <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[var(--accent-color)] transition ${automationDateMenuOpen ? "rotate-180" : ""}`} />
                  </button>
                  {automationDateMenuOpen && (
                    <div className="absolute left-0 right-0 top-full z-[130] mt-2 rounded-[22px] bg-[#131314] p-3 shadow-2xl ring-1 ring-[#282a2c]">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onAutomationMonthMenuOpenChange((open) => !open)}
                          className="min-w-0 truncate rounded-xl px-2 py-1 text-left text-xs font-bold text-[#e3e3e3] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
                        >
                          {automationEditorMonthTitle}
                        </button>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => onAutomationEditorMonthChange((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))} className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[#282a2c] bg-[#1e1f20] text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]" title="Previous month">
                            <ChevronUpIcon className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => onAutomationEditorMonthChange((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))} className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[#282a2c] bg-[#1e1f20] text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]" title="Next month">
                            <ChevronDownIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {automationMonthMenuOpen ? (
                        <div className="max-h-72 overflow-y-auto rounded-2xl bg-[#101112] p-2 ring-1 ring-[#282a2c]">
                          {automationEditorYearOptions.map((year) => (
                            <div key={year} className="mb-3 last:mb-0">
                              <button
                                type="button"
                                onClick={() => onAutomationEditorMonthChange((date) => new Date(year, date.getMonth(), 1))}
                                className={`mb-2 h-8 w-full rounded-xl px-2 text-left text-xs font-bold transition ${automationEditorMonth.getFullYear() === year ? "bg-[var(--accent-soft)] text-[var(--accent-color)]" : "text-[#e3e3e3] hover:bg-[#282a2c]"}`}
                              >
                                {year}
                              </button>
                              <div className="grid grid-cols-4 gap-1.5">
                                {automationEditorMonthOptions.map((month) => {
                                  const selected = automationEditorMonth.getFullYear() === year && automationEditorMonth.getMonth() === month.index;
                                  return (
                                    <button
                                      key={`${year}-${month.index}`}
                                      type="button"
                                      onClick={() => {
                                        onAutomationEditorMonthChange(new Date(year, month.index, 1));
                                        onAutomationMonthMenuOpenChange(false);
                                      }}
                                      className={`h-8 rounded-xl text-xs font-bold transition ${selected ? "bg-[var(--accent-color)] text-[#131314]" : "text-[#e3e3e3] hover:bg-[#282a2c] hover:text-[var(--accent-color)]"}`}
                                    >
                                      {month.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-[#e3e3e3]">
                            {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
                              <div key={day} className="py-1">{day}</div>
                            ))}
                          </div>
                          <div className="mt-1 grid grid-cols-7 gap-1">
                            {automationEditorMonthDays.map((date) => {
                              const key = toLocalDateKey(date);
                              const selected = key === automationDate;
                              const inMonth = date.getMonth() === automationEditorMonth.getMonth();
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => setAutomationEditorDate(date)}
                                  className={`h-8 rounded-xl text-xs font-bold transition ${selected ? "bg-[var(--accent-color)] text-[#131314] shadow-[0_0_12px_var(--accent-soft-strong)]" : inMonth ? "text-[#e3e3e3] hover:bg-[#282a2c] hover:text-[var(--accent-color)]" : "text-[#73777f] hover:bg-[#282a2c]"}`}
                                >
                                  {date.getDate()}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#9aa0a6]">Start time</div>
                <div className="relative" data-dropdown-root>
                  <button
                    type="button"
                    onClick={() => onAutomationTimeMenuOpenChange((open) => !open)}
                    className={`flex h-11 w-full items-center justify-between rounded-2xl px-3 text-left text-sm font-semibold shadow-inner shadow-black/20 ring-1 transition hover:bg-[#18191b] ${automationTime ? "bg-[var(--accent-soft)] text-[var(--accent-color)] ring-[var(--accent-soft-strong)]" : "bg-[#0f1011] text-[#e3e3e3] ring-[#282a2c] hover:ring-[var(--accent-soft-strong)]"}`}
                  >
                    <span>{automationTime ? `${automationHour12}:${String(automationTimeParts.minutes).padStart(2, "0")} ${automationPeriod}` : "Choose exact time"}</span>
                    <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[var(--accent-color)] transition ${automationTimeMenuOpen ? "rotate-180" : ""}`} />
                  </button>
                  {automationTimeMenuOpen && (
                    <div className="absolute left-0 right-0 top-full z-[120] mt-2 overflow-hidden rounded-[22px] bg-[#131314] p-2 shadow-2xl ring-1 ring-[#282a2c]">
                      <div className="grid grid-cols-[1fr_1fr_0.8fr] gap-2">
                        <div>
                          <button type="button" onClick={() => setAutomationTimeFromClock(automationHour12 === 12 ? 1 : automationHour12 + 1, automationTimeParts.minutes, automationPeriod)} className="mb-1 flex h-7 w-full items-center justify-center rounded-xl border border-[#282a2c] bg-[#131314] text-xs font-semibold text-[#c4c7c5] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]" title="Next hour">+</button>
                          <div className="automation-time-scroll max-h-28 overflow-y-auto pr-1">
                            {automationHourOptions.map((hour) => (
                              <button key={hour} type="button" onClick={() => setAutomationTimeFromClock(hour, automationTimeParts.minutes, automationPeriod)} className={`mb-1 flex h-8 w-full items-center justify-center rounded-xl text-xs font-bold transition last:mb-0 ${automationHour12 === hour ? "bg-[var(--accent-color)] text-[#131314] shadow-[0_0_12px_var(--accent-soft-strong)]" : "bg-[#18191b] text-[#c4c7c5] hover:bg-[#282a2c]"}`}>
                                {hour}
                              </button>
                            ))}
                          </div>
                          <button type="button" onClick={() => setAutomationTimeFromClock(automationHour12 === 1 ? 12 : automationHour12 - 1, automationTimeParts.minutes, automationPeriod)} className="mt-1 flex h-7 w-full items-center justify-center rounded-xl border border-[#282a2c] bg-[#131314] text-xs font-semibold text-[#c4c7c5] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]" title="Previous hour">-</button>
                        </div>
                        <div>
                          <button type="button" onClick={() => adjustAutomationTime(1)} className="mb-1 flex h-7 w-full items-center justify-center rounded-xl border border-[#282a2c] bg-[#131314] text-xs font-semibold text-[#c4c7c5] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]" title="Next minute">+</button>
                          <div className="automation-time-scroll max-h-28 overflow-y-auto pr-1">
                            {automationMinuteOptions.map((minute) => (
                              <button key={minute} type="button" onClick={() => setAutomationTimeFromClock(automationHour12, minute, automationPeriod)} className={`mb-1 flex h-8 w-full items-center justify-center rounded-xl text-xs font-bold transition last:mb-0 ${automationTimeParts.minutes === minute ? "bg-[var(--accent-color)] text-[#131314] shadow-[0_0_12px_var(--accent-soft-strong)]" : "bg-[#18191b] text-[#c4c7c5] hover:bg-[#282a2c]"}`}>
                                {String(minute).padStart(2, "0")}
                              </button>
                            ))}
                          </div>
                          <button type="button" onClick={() => adjustAutomationTime(-1)} className="mt-1 flex h-7 w-full items-center justify-center rounded-xl border border-[#282a2c] bg-[#131314] text-xs font-semibold text-[#c4c7c5] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]" title="Previous minute">-</button>
                        </div>
                        <div className="flex flex-col gap-2 pt-7">
                          {["AM", "PM"].map((period) => (
                            <button key={period} type="button" onClick={() => setAutomationTimeFromClock(automationHour12, automationTimeParts.minutes, period)} className={`h-10 rounded-xl text-xs font-bold transition ${automationPeriod === period ? "bg-[var(--accent-color)] text-[#131314] shadow-[0_0_12px_var(--accent-soft-strong)]" : "bg-[#18191b] text-[#c4c7c5] hover:bg-[#282a2c]"}`}>
                              {period}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9aa0a6]">Repeat</div>
                <div className="text-[11px] font-semibold text-[#73777f]">From {automationTime || "time"}</div>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { label: "Once", value: "once" },
                  { label: "Daily", value: "daily" },
                  { label: "Weekly", value: "weekly" },
                  { label: "Monthly", value: "monthly" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onAutomationRepeatChange(option.value as AutomationRepeat);
                      if (option.value !== "once" && !automationTime) onAutomationTimeChange("09:00");
                    }}
                    className={`h-9 rounded-xl text-xs font-bold transition ${automationRepeat === option.value ? "bg-[var(--accent-color)] text-[#131314] shadow-[0_0_14px_var(--accent-soft-strong)]" : "bg-[#0f1011] text-[#c4c7c5] ring-1 ring-[#282a2c] hover:bg-[#282a2c]"}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className={`mt-2 rounded-2xl p-2 transition ${automationRepeat === "every_minutes" || automationRepeat === "every_hours" ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent-soft-strong)]" : "bg-[#0f1011] ring-1 ring-[#282a2c]"}`}>
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#9aa0a6]">Every</div>
                <div className="grid grid-cols-[1fr_1.35fr] gap-2">
                  <div className={`grid h-10 min-w-0 grid-cols-[minmax(38px,1fr)_28px_28px] overflow-hidden rounded-xl shadow-sm ring-1 transition ${automationRepeat === "every_minutes" || automationRepeat === "every_hours" ? "bg-[var(--accent-soft)] text-[var(--accent-color)] ring-[var(--accent-soft-strong)]" : "bg-[#101112] text-[#e3e3e3] ring-[#282a2c]"}`} onFocus={() => ensureEveryRepeat()}>
                    <input
                      type="number"
                      min={1}
                      max={automationEveryUnit === "hours" ? 24 : 1440}
                      value={automationEveryAmount}
                      onChange={(event) => {
                        const next = clampNumber(Number(event.target.value || 1), 1, automationEveryUnit === "hours" ? 24 : 1440);
                        onAutomationEveryAmountChange(next);
                        ensureEveryRepeat();
                      }}
                      className="number-input min-w-0 appearance-none bg-transparent px-1 text-center text-sm font-bold leading-none outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <button type="button" onClick={() => { onAutomationEveryAmountChange((value) => clampNumber(value - 1, 1, automationEveryUnit === "hours" ? 24 : 1440)); ensureEveryRepeat(); }} className="grid h-full w-full place-items-center border-l border-[var(--accent-soft-strong)] text-sm font-bold transition hover:bg-[var(--accent-soft)]" aria-label="Decrease interval">-</button>
                    <button type="button" onClick={() => { onAutomationEveryAmountChange((value) => clampNumber(value + 1, 1, automationEveryUnit === "hours" ? 24 : 1440)); ensureEveryRepeat(); }} className="grid h-full w-full place-items-center border-l border-[var(--accent-soft-strong)] text-sm font-bold transition hover:bg-[var(--accent-soft)]" aria-label="Increase interval">+</button>
                  </div>
                  <div className="relative" data-dropdown-root>
                    <button type="button" onClick={() => onAutomationEveryUnitMenuOpenChange((open) => !open)} className={`flex h-10 w-full items-center justify-between rounded-xl px-3 text-sm font-bold ring-1 transition hover:brightness-110 ${automationRepeat === "every_minutes" || automationRepeat === "every_hours" ? "bg-[var(--accent-soft)] text-[var(--accent-color)] ring-[var(--accent-soft-strong)]" : "bg-[#101112] text-[#e3e3e3] ring-[#282a2c]"}`}>
                      <span>{automationEveryUnit}</span>
                      <ChevronDownIcon className={`h-4 w-4 text-[#c4c7c5] transition ${automationEveryUnitMenuOpen ? "rotate-180" : ""}`} />
                    </button>
                    {automationEveryUnitMenuOpen && (
                      <div className="absolute left-0 right-0 top-full z-[125] mt-1.5 rounded-xl bg-[#131314] p-1.5 shadow-2xl ring-1 ring-[#282a2c]">
                        {(["minutes", "hours"] as AutomationEveryUnit[]).map((unit) => (
                          <button
                            key={unit}
                            type="button"
                            onClick={() => {
                              onAutomationEveryUnitChange(unit);
                              onAutomationEveryUnitMenuOpenChange(false);
                              ensureEveryRepeat(unit);
                              onAutomationEveryAmountChange((value) => clampNumber(value, 1, unit === "hours" ? 24 : 1440));
                            }}
                            className={`mb-1 flex h-9 w-full items-center rounded-xl px-3 text-left text-sm font-bold transition last:mb-0 ${automationEveryUnit === unit ? "bg-[var(--accent-color)] text-[#131314]" : "text-[#e3e3e3] hover:bg-[#282a2c] hover:text-[var(--accent-color)]"}`}
                          >
                            {unit}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#282a2c] px-5 py-4">
          <button type="button" onClick={onCancel} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#282a2c] bg-[#131314] text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]" title="Cancel">
            <CloseIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onSave}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border text-sm font-semibold shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              borderColor: "color-mix(in srgb, var(--accent-color) 32%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--accent-color) 18%, #131314 82%)",
              color: "color-mix(in srgb, var(--accent-color) 72%, white 28%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
            disabled={!automationName.trim() || !automationPrompt.trim()}
            title="Save automation"
          >
            <SaveIcon className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
