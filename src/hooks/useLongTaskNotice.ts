import { useEffect, useMemo, useState } from "react";

type LongTaskNoticeOptions = {
  busy: boolean;
  taskLabel: string;
  delayMs?: number;
};

export function useLongTaskNotice({ busy, taskLabel, delayMs = 120_000 }: LongTaskNoticeOptions) {
  const [visible, setVisible] = useState(false);
  const [dismissedKey, setDismissedKey] = useState("");
  const taskKey = useMemo(() => (busy ? taskLabel || "task" : ""), [busy, taskLabel]);

  useEffect(() => {
    if (!busy || !taskKey) {
      setVisible(false);
      setDismissedKey("");
      return;
    }
    if (dismissedKey === taskKey) {
      return;
    }
    const timer = window.setTimeout(() => {
      setVisible(true);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [busy, taskKey, dismissedKey, delayMs]);

  const keepRunning = () => {
    setVisible(false);
    setDismissedKey(taskKey);
  };

  return {
    longTaskNotice: visible && busy,
    longTaskLabel: taskLabel || "This task",
    keepLongTaskRunning: keepRunning,
  };
}
