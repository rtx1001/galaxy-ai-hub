import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ToolRunRecord } from "../appCore";

export function useToolRuns(defaultOpen: boolean) {
  const [toolRuns, setToolRuns] = useState<ToolRunRecord[]>([]);
  const [toolRunsOpen, setToolRunsOpen] = useState(defaultOpen);

  const refreshToolRuns = useCallback(async () => {
    try {
      const runs = await invoke<ToolRunRecord[]>("list_agent_tool_runs", { limit: 10 });
      setToolRuns(runs);
    } catch (error) {
      console.error("Tool activity load error:", error);
    }
  }, []);

  return {
    toolRuns,
    toolRunsOpen,
    setToolRunsOpen,
    refreshToolRuns,
  };
}
