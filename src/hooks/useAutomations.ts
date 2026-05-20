import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AutomationEveryUnit,
  AutomationJob,
  AutomationRepeat,
  buildAutomationSchedule,
  buildMonthDays,
  parseAutomationSchedule,
  toLocalDateKey,
} from "../appCore";

export function useAutomations({
  setComposerNotice,
}: {
  setComposerNotice: (notice: string) => void;
}) {
  const [automationJobs, setAutomationJobs] = useState<AutomationJob[]>([]);
  const [automationName, setAutomationName] = useState("");
  const [automationPrompt, setAutomationPrompt] = useState("");
  const [automationDate, setAutomationDate] = useState(() => toLocalDateKey(new Date()));
  const [automationTime, setAutomationTime] = useState("");
  const [automationRepeat, setAutomationRepeat] = useState<AutomationRepeat>("once");
  const [automationEveryAmount, setAutomationEveryAmount] = useState(15);
  const [automationEveryUnit, setAutomationEveryUnit] =
    useState<AutomationEveryUnit>("minutes");
  const [automationTimeMenuOpen, setAutomationTimeMenuOpen] = useState(false);
  const [automationDateMenuOpen, setAutomationDateMenuOpen] = useState(false);
  const [automationMonthMenuOpen, setAutomationMonthMenuOpen] = useState(false);
  const [automationEveryUnitMenuOpen, setAutomationEveryUnitMenuOpen] =
    useState(false);
  const [automationEditorMonth, setAutomationEditorMonth] = useState(
    () => new Date(),
  );
  const [automationMonth, setAutomationMonth] = useState(() => new Date());
  const [selectedAutomationDate, setSelectedAutomationDate] = useState(() =>
    toLocalDateKey(new Date()),
  );
  const [automationEditorOpen, setAutomationEditorOpen] = useState(false);
  const [editingAutomationId, setEditingAutomationId] = useState<number | null>(
    null,
  );

  const refreshAutomationJobs = async () => {
    try {
      const jobs = await invoke<AutomationJob[]>("list_automation_jobs", {
        includeDisabled: true,
      });
      setAutomationJobs(jobs);
    } catch (error) {
      console.error("Automation load error:", error);
    }
  };

  const openAutomationEditor = (job?: AutomationJob) => {
    if (job) {
      const parsed = parseAutomationSchedule(job.schedule, selectedAutomationDate);
      setEditingAutomationId(job.id);
      setAutomationName(job.name);
      setAutomationPrompt(job.prompt);
      setAutomationDate(parsed.date);
      setAutomationEditorMonth(new Date(`${parsed.date}T00:00:00`));
      setAutomationTime(parsed.time);
      setAutomationRepeat(parsed.repeat);
      setAutomationEveryAmount(parsed.everyAmount);
      setAutomationEveryUnit(parsed.everyUnit);
    } else {
      setEditingAutomationId(null);
      setAutomationName("");
      setAutomationPrompt("");
      setAutomationDate(selectedAutomationDate);
      setAutomationEditorMonth(new Date(`${selectedAutomationDate}T00:00:00`));
      setAutomationTime("");
      setAutomationRepeat("once");
      setAutomationEveryAmount(15);
      setAutomationEveryUnit("minutes");
    }
    setAutomationEditorOpen(true);
  };

  const saveAutomationJob = async () => {
    const scheduleDate = automationDate || selectedAutomationDate;
    const schedule = buildAutomationSchedule(
      scheduleDate,
      automationTime,
      automationRepeat,
      automationEveryAmount,
      automationEveryUnit,
    );
    if (!automationName.trim() || !automationPrompt.trim() || !schedule) {
      setComposerNotice("Add an event title and task.");
      return;
    }

    try {
      const payload = {
        name: automationName,
        prompt: automationPrompt,
        schedule,
        enabled: true,
      };
      const wasEditing = Boolean(editingAutomationId);
      const job = editingAutomationId
        ? await invoke<AutomationJob>("update_automation_job", {
            id: editingAutomationId,
            ...payload,
          })
        : await invoke<AutomationJob>("create_automation_job", payload);
      setAutomationJobs((prev) => [
        job,
        ...prev.filter((item) => item.id !== job.id),
      ]);
      setSelectedAutomationDate(scheduleDate);
      setAutomationMonth(new Date(`${scheduleDate}T00:00:00`));
      setEditingAutomationId(null);
      setAutomationName("");
      setAutomationPrompt("");
      setAutomationDate(scheduleDate);
      setAutomationTime("");
      setAutomationRepeat("once");
      setAutomationEveryAmount(15);
      setAutomationEveryUnit("minutes");
      setAutomationEditorOpen(false);
      setComposerNotice(wasEditing ? "Automation updated." : "Automation saved.");
    } catch (error) {
      setComposerNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleAutomationJob = async (job: AutomationJob) => {
    const updated = await invoke<AutomationJob>("set_automation_job_enabled", {
      id: job.id,
      enabled: !job.enabled,
    });
    setAutomationJobs((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    );
  };

  const deleteAutomationJob = async (id: number) => {
    await invoke<boolean>("delete_automation_job", { id });
    setAutomationJobs((prev) => prev.filter((item) => item.id !== id));
  };

  const selectAutomationDate = (date: Date) => {
    const key = toLocalDateKey(date);
    setSelectedAutomationDate(key);
    setAutomationMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  };

  const automationMonthDays = buildMonthDays(automationMonth);
  const activeAutomationCount = automationJobs.filter((job) => job.enabled).length;
  const recentAutomationJobs = [...automationJobs]
    .sort((a, b) => {
      if (a.created_at !== b.created_at) return b.created_at - a.created_at;
      return b.id - a.id;
    })
    .slice(0, 10);
  const selectedAutomationDateObj = new Date(`${selectedAutomationDate}T00:00:00`);
  const selectedAutomationLabel = Number.isNaN(selectedAutomationDateObj.getTime())
    ? selectedAutomationDate
    : new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      }).format(selectedAutomationDateObj);

  return {
    automationJobs,
    setAutomationJobs,
    automationName,
    setAutomationName,
    automationPrompt,
    setAutomationPrompt,
    automationDate,
    setAutomationDate,
    automationTime,
    setAutomationTime,
    automationRepeat,
    setAutomationRepeat,
    automationEveryAmount,
    setAutomationEveryAmount,
    automationEveryUnit,
    setAutomationEveryUnit,
    automationTimeMenuOpen,
    setAutomationTimeMenuOpen,
    automationDateMenuOpen,
    setAutomationDateMenuOpen,
    automationMonthMenuOpen,
    setAutomationMonthMenuOpen,
    automationEveryUnitMenuOpen,
    setAutomationEveryUnitMenuOpen,
    automationEditorMonth,
    setAutomationEditorMonth,
    automationMonth,
    setAutomationMonth,
    selectedAutomationDate,
    selectedAutomationDateObj,
    selectedAutomationLabel,
    automationEditorOpen,
    setAutomationEditorOpen,
    editingAutomationId,
    setEditingAutomationId,
    automationMonthDays,
    activeAutomationCount,
    recentAutomationJobs,
    refreshAutomationJobs,
    openAutomationEditor,
    saveAutomationJob,
    toggleAutomationJob,
    deleteAutomationJob,
    selectAutomationDate,
  };
}
