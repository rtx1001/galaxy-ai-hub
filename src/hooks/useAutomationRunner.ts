import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AutomationJob, SendOptions } from "../appCore";
import { getAutomationDueAt } from "../appCore";

type EngineStatus = "initializing" | "downloading" | "ready" | "error";

type UseAutomationRunnerOptions = {
  settingsLoaded: boolean;
  automationJobs: AutomationJob[];
  isStreaming: boolean;
  engineStatus: EngineStatus;
  selectedModelPath: string;
  sendInFlightRef: MutableRefObject<boolean>;
  lastComposerInputAtRef: MutableRefObject<number>;
  automationRunKeysRef: MutableRefObject<Set<string>>;
  setComposerNotice: Dispatch<SetStateAction<string>>;
  setAutomationJobs: Dispatch<SetStateAction<AutomationJob[]>>;
  handleSend: (options?: SendOptions) => Promise<void>;
};

export function useAutomationRunner({
  settingsLoaded,
  automationJobs,
  isStreaming,
  engineStatus,
  selectedModelPath,
  sendInFlightRef,
  lastComposerInputAtRef,
  automationRunKeysRef,
  setComposerNotice,
  setAutomationJobs,
  handleSend,
}: UseAutomationRunnerOptions) {
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  useEffect(() => {
    if (!settingsLoaded) return;

    const checkAutomations = () => {
      if (sendInFlightRef.current || isStreaming || engineStatus !== "ready" || !selectedModelPath) {
        return;
      }
      if (Date.now() - lastComposerInputAtRef.current < 1200) return;

      const now = new Date();
      const dueJob = automationJobs.find((job) => {
        if (!job.enabled) return false;
        const dueAt = getAutomationDueAt(job, now);
        if (!dueAt) return false;
        if ((job.last_run_at ?? 0) * 1000 >= dueAt) return false;
        const runKey = `${job.id}:${dueAt}`;
        if (automationRunKeysRef.current.has(runKey)) return false;
        automationRunKeysRef.current.add(runKey);
        return true;
      });

      if (!dueJob) return;

      setComposerNotice(`Running scheduled task: ${dueJob.name}`);
      invoke<AutomationJob>("mark_automation_job_ran", { id: dueJob.id })
        .then((updated) => {
          setAutomationJobs((prev) => prev.map((job) => (job.id === updated.id ? updated : job)));
        })
        .catch((error) => console.error("Automation mark error:", error));

      handleSendRef.current({
        text: dueJob.prompt,
        sourceLabel: dueJob.name,
        skipLocalIntent: true,
        silentUser: true,
        autoApproveActions: true,
      }).catch((error) => console.error("Automation run error:", error));
    };

    checkAutomations();
    const handle = window.setInterval(checkAutomations, 15_000);
    return () => window.clearInterval(handle);
  }, [settingsLoaded, automationJobs, isStreaming, engineStatus, selectedModelPath]);
}
