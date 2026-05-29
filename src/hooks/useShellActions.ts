import { useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatMessage } from "../types";
import {
  PendingShellAction,
  ShellExecutionResult,
  createMessageId,
  extractShellToolRequest,
  formatShellResult,
  stripShellToolRequest,
} from "../appCore";

export function useShellActions({
  refreshToolRuns,
  setComposerNotice,
  setMessages,
}: {
  refreshToolRuns: () => Promise<void>;
  setComposerNotice: (notice: string) => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}) {
  const [pendingShellActions, setPendingShellActions] = useState<
    PendingShellAction[]
  >([]);
  const [executingShellActionId, setExecutingShellActionId] = useState<
    number | null
  >(null);

  const addPendingShellAction = (action: PendingShellAction) => {
    setPendingShellActions((prev) => [
      ...prev.filter((item) => item.id !== action.id),
      action,
    ]);
  };

  const refreshPendingShellActions = async () => {
    try {
      const actions = await invoke<PendingShellAction[]>(
        "list_pending_shell_actions",
      );
      setPendingShellActions(actions);
    } catch (error) {
      console.error("Pending shell action load error:", error);
    }
  };

  const handleShellToolRequest = async (
    assistantMessageId: string,
    replyText: string,
  ) => {
    const request = extractShellToolRequest(replyText);
    if (!request?.command?.trim()) {
      return replyText;
    }

    const visibleReply =
      stripShellToolRequest(replyText) ||
      "I prepared a system action. Review it below before it runs.";
    const action = await invoke<PendingShellAction>("propose_shell_action", {
      command: request.command,
      workingDirectory: request.working_directory || undefined,
      purpose: request.purpose || "Run the requested local system action.",
      timeoutSeconds: request.timeout_seconds || 30,
    });
    const finalReply = `${visibleReply}\n\nWaiting for your approval before running: ${action.purpose}`;
    addPendingShellAction(action);
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantMessageId
          ? {
              ...message,
              content: finalReply,
            }
          : message,
      ),
    );
    setComposerNotice("A system action is waiting for approval.");
    return finalReply;
  };

  const recordClientToolRun = async (
    toolName: string,
    input: Record<string, unknown>,
    outputText: string,
    success: boolean,
    startedAt: number,
  ) => {
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    await invoke("record_agent_tool_run", {
      run: {
        tool_name: toolName,
        input_json: JSON.stringify(input),
        output_text: outputText,
        success,
        duration_ms: durationMs,
      },
    });
    refreshToolRuns().catch((error) =>
      console.error("Tool activity refresh error:", error),
    );
  };

  const rejectShellAction = async (id: number) => {
    await invoke<boolean>("reject_shell_action", { id });
    setPendingShellActions((prev) => prev.filter((action) => action.id !== id));
  };

  const approveShellAction = async (action: PendingShellAction) => {
    setExecutingShellActionId(action.id);
    const startedAt = performance.now();
    try {
      const result = await invoke<ShellExecutionResult>("execute_shell_action", {
        id: action.id,
      });
      await invoke("record_agent_tool_run", {
        run: {
          tool_name: "powershell",
          input_json: JSON.stringify(action),
          output_text: formatShellResult(result),
          success: !result.timed_out && result.exit_code === 0,
          duration_ms: Math.round(result.duration_ms),
        },
      }).catch(() => undefined);
      refreshToolRuns().catch((error) =>
        console.error("Tool activity refresh error:", error),
      );
      setPendingShellActions((prev) =>
        prev.filter((item) => item.id !== action.id),
      );
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          content: formatShellResult(result),
          created_at: Date.now(),
          completed_at: Date.now(),
          duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        },
      ]);
    } catch (error) {
      setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setExecutingShellActionId(null);
    }
  };

  return {
    pendingShellActions,
    executingShellActionId,
    addPendingShellAction,
    refreshPendingShellActions,
    handleShellToolRequest,
    recordClientToolRun,
    rejectShellAction,
    approveShellAction,
  };
}
