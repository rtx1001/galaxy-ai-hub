import { clampNumber } from '../utils';
import { AutomationEveryUnit, AutomationJob, AutomationRepeat, GoogleCalendarEvent } from './models';

export const toLocalDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const monthTitle = (date: Date) =>
  new Intl.DateTimeFormat(undefined, { month: "short" }).format(date).toUpperCase();

export const getLunarLabel = (date: Date) => {
  try {
    const parts = new Intl.DateTimeFormat("vi-VN-u-ca-chinese", {
      day: "numeric",
      month: "numeric",
    }).formatToParts(date);
    const day = parts.find((part) => part.type === "day")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    return day && month ? `${day}/${month}` : "";
  } catch {
    return "";
  }
};

export const buildMonthDays = (monthDate: Date) => {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
};

export const googleEventMatchesDate = (event: GoogleCalendarEvent, dateKey: string) =>
  event.start.slice(0, 10) === dateKey || event.end.slice(0, 10) === dateKey;

export const googleEventTimeLabel = (event: GoogleCalendarEvent | null, withDate = false) => {
  if (!event) return "";
  if (event.all_day) {
    try {
      const d = event.start ? new Date(event.start) : new Date();
      return withDate ? `${toLocalDateKey(d)} - All day` : "All day";
    } catch {
      return "All day";
    }
  }
  const start = new Date(event.start || "");
  const end = new Date(event.end || "");
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
  if (Number.isNaN(start.getTime())) return "";
  
  const timeStr = Number.isNaN(end.getTime()) 
    ? timeFormat.format(start) 
    : `${timeFormat.format(start)} - ${timeFormat.format(end)}`;
    
  if (withDate) {
    try {
      const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
      return `${dateFormat.format(start)} - ${timeStr}`;
    } catch {
      return timeStr;
    }
  }
  return timeStr;
};

export const buildGoogleMonthRange = (monthDate: Date) => {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1, 0, 0, 0, 0);
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1, 0, 0, 0, 0);
  return { timeMin: first.toISOString(), timeMax: last.toISOString() };
};

export const normalizeCalendarEventForDisplay = (event: GoogleCalendarEvent): GoogleCalendarEvent => {
  if (event.all_day) {
    return event;
  }
  const start = event.start && !/[zZ]|[+-]\d{2}:\d{2}$/.test(event.start) ? `${event.start}Z` : event.start;
  const end = event.end && !/[zZ]|[+-]\d{2}:\d{2}$/.test(event.end) ? `${event.end}Z` : event.end;
  return { ...event, start, end };
};

export const buildAutomationSchedule = (
  date: string,
  time: string,
  repeat: AutomationRepeat,
  everyAmount = 15,
  everyUnit: AutomationEveryUnit = "minutes",
) => {
  const safeEveryAmount = Math.max(1, Math.floor(everyAmount || 1));
  const everySuffix = repeat === "every_hours" || everyUnit === "hours" ? "h" : "m";
  const repeatPart =
    repeat === "once"
      ? ""
      : repeat === "every_minutes" || repeat === "every_hours"
        ? ` @every:${safeEveryAmount}${everySuffix}`
          : ` @${repeat}`;
  const timePart = time ? ` ${time}` : "";
  return `${date}${repeatPart}${timePart}`.trim();
};

export const automationRepeatLabel = (repeat: string) => {
  const everyMatch = /^@?every:(\d+)(m|h)$/.exec(repeat);
  if (everyMatch) {
    const amount = Number(everyMatch[1]);
    const unit = everyMatch[2] === "h" ? "hour" : "min";
    return `Every ${amount} ${unit}${unit === "hour" && amount !== 1 ? "s" : ""}`;
  }
  if (repeat === "@5m" || repeat === "5m") return "Every 5 min";
  if (repeat === "@15m" || repeat === "15m") return "Every 15 min";
  if (repeat === "@30m" || repeat === "30m") return "Every 30 min";
  if (repeat === "@hourly" || repeat === "hourly") return "Every 1 hour";
  if (repeat === "@daily" || repeat === "daily") return "Daily";
  if (repeat === "@weekly" || repeat === "weekly") return "Weekly";
  if (repeat === "@monthly" || repeat === "monthly") return "Monthly";
  return "Once";
};

export const automationScheduleLabel = (value: string, selectedDate: string) => {
  const trimmed = value.trim();
  if (!trimmed) return `Once - ${selectedDate}`;
  const parts = trimmed.split(/\s+/);
  if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
    const repeat = parts.find((part) => part.startsWith("@")) ?? "";
    const time = parts.find((part) => /^\d{2}:\d{2}$/.test(part)) ?? "";
    const day = parts[0];
    const repeatLabel = repeat ? automationRepeatLabel(repeat) : `Once - ${day}`;
    return `${repeatLabel}${time ? ` - ${time}` : ""}`;
  }
  if (/^\d{2}:\d{2}$/.test(trimmed)) return `Once - ${selectedDate} - ${trimmed}`;
  if (trimmed.startsWith("@")) return automationRepeatLabel(trimmed);
  return trimmed;
};

export const parseAutomationSchedule = (schedule: string, fallbackDate: string) => {
  const parts = schedule.trim().split(/\s+/).filter(Boolean);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(parts[0] || "") ? parts[0] : fallbackDate;
  const repeatToken = parts.find((part) => /^@(5m|15m|30m|hourly|daily|weekly|monthly|every:\d+[mh])$/.test(part));
  const time = parts.find((part) => /^\d{2}:\d{2}$/.test(part)) || "";
  if (!repeatToken) return { date, time, repeat: "once" as AutomationRepeat, everyAmount: 15, everyUnit: "minutes" as AutomationEveryUnit };
  const everyMatch = /^@every:(\d+)(m|h)$/.exec(repeatToken);
  if (everyMatch) {
    const everyUnit = everyMatch[2] === "h" ? "hours" : "minutes";
    return {
      date,
      time,
      repeat: everyUnit === "hours" ? "every_hours" as AutomationRepeat : "every_minutes" as AutomationRepeat,
      everyAmount: clampNumber(Number(everyMatch[1]), 1, everyUnit === "hours" ? 24 : 1440),
      everyUnit: everyUnit as AutomationEveryUnit,
    };
  }
  if (repeatToken === "@hourly") return { date, time, repeat: "every_hours" as AutomationRepeat, everyAmount: 1, everyUnit: "hours" as AutomationEveryUnit };
  if (repeatToken === "@5m" || repeatToken === "@15m" || repeatToken === "@30m") {
    return { date, time, repeat: "every_minutes" as AutomationRepeat, everyAmount: Number(repeatToken.slice(1, -1)), everyUnit: "minutes" as AutomationEveryUnit };
  }
  return { date, time, repeat: repeatToken.slice(1) as AutomationRepeat, everyAmount: 15, everyUnit: "minutes" as AutomationEveryUnit };
};

export const compactAutomationSummary = (name: string, schedule: string, prompt: string, fallbackDate: string) => {
  const scheduleText = automationScheduleLabel(schedule, fallbackDate);
  const task = prompt.trim().replace(/\s+/g, " ");
  return [name.trim(), scheduleText, task].filter(Boolean).join(" - ");
};

export const parseTimeParts = (time = "") => {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return { hours: 0, minutes: 0 };
  return { hours: Number(match[1]), minutes: Number(match[2]) };
};

export const automationIntervalMinutes = (repeat: string) => {
  const everyMatch = /^@every:(\d+)(m|h)$/.exec(repeat);
  if (everyMatch) return Number(everyMatch[1]) * (everyMatch[2] === "h" ? 60 : 1);
  if (repeat === "@5m") return 5;
  if (repeat === "@15m") return 15;
  if (repeat === "@30m") return 30;
  if (repeat === "@hourly") return 60;
  return 0;
};

export const getAutomationDueAt = (job: AutomationJob, now: Date) => {
  const parts = job.schedule.trim().split(/\s+/).filter(Boolean);
  const datePart = parts[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;

  const repeat = parts.find((part) => /^@(5m|15m|30m|hourly|daily|weekly|monthly|every:\d+[mh])$/.test(part));
  const timePart = parts.find((part) => /^\d{2}:\d{2}$/.test(part)) ?? "";
  const anchor = new Date(`${datePart}T00:00:00`);
  if (Number.isNaN(anchor.getTime()) || now < anchor) return null;

  const { hours, minutes } = parseTimeParts(timePart);
  const firstRun = new Date(anchor);
  firstRun.setHours(hours, minutes, 0, 0);

  const interval = repeat ? automationIntervalMinutes(repeat) : 0;
  if (interval > 0) {
    if (now < firstRun) return null;
    const elapsed = now.getTime() - firstRun.getTime();
    const intervalMs = interval * 60_000;
    return firstRun.getTime() + Math.floor(elapsed / intervalMs) * intervalMs;
  }

  const candidate = new Date(now);
  candidate.setHours(hours, minutes, 0, 0);

  if (!repeat) {
    candidate.setFullYear(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  } else if (repeat === "@weekly" && candidate.getDay() !== anchor.getDay()) {
    return null;
  } else if (repeat === "@monthly" && candidate.getDate() !== anchor.getDate()) {
    return null;
  }

  if (now < candidate) return null;
  return candidate.getTime();
};
