import { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ActionProposal, ChatMessage } from "../types";
import {
  FileActionResult,
  PendingShellAction,
  UserProfilePreset,
  conversationWantsVietnamese,
  createMessageId,
  extractChoiceText,
  formatFileActionResult,
  textLooksVietnamese,
} from "../appCore";

type UseActionProposalsOptions = {
  addPendingShellAction: (action: PendingShellAction) => void;
  ensureChatModelReady: () => Promise<boolean>;
  googleClientId: string;
  googleClientSecret: string;
  linkedFolders: string[];
  messages: ChatMessage[];
  minP: number;
  repeatLastN: number;
  repeatPenalty: number;
  replyLength: number;
  samplingTemperature: number;
  selectedUserProfile?: UserProfilePreset;
  setComposerNotice: Dispatch<SetStateAction<string>>;
  setIsApproving: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  topK: number;
  topP: number;
  userName: string;
};

const proposalString = (proposal: ActionProposal, key: string) => {
  const value = proposal.arguments?.[key];
  return typeof value === "string" ? value : "";
};

const proposalJsonPayload = (proposal: ActionProposal, key: string) => {
  const value = proposal.arguments?.[key];
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
};

const stripReasoningLeak = (text: string) => {
  let cleaned = text.trim();
  const finalMarkers = [
    "Final answer:",
    "Final reply:",
    "Response:",
    "Reply:",
  ];
  for (const marker of finalMarkers) {
    const index = cleaned.toLowerCase().lastIndexOf(marker.toLowerCase());
    if (index >= 0) {
      cleaned = cleaned.slice(index + marker.length).trim();
      break;
    }
  }
  if (/^here'?s a thinking process\b/i.test(cleaned) || /^thinking process\b/i.test(cleaned)) {
    const lastParagraph = cleaned
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !/^(?:\d+\.|\*|\-)\s/.test(part))
      .pop();
    return lastParagraph || "";
  }
  return cleaned
    .replace(/<\/?think>/gi, "")
    .replace(/^\s*(?:analysis|reasoning|thoughts?)\s*:\s*/i, "")
    .trim();
};

export function useActionProposals(options: UseActionProposalsOptions) {
  const dismissImageProposal = (messageId: string, proposalIndex: number) => {
    options.setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId || !Array.isArray(message.content)) {
          return message;
        }
        const nextContent = message.content.filter((_, index) => index !== proposalIndex);
        return {
          ...message,
          content: nextContent.length ? nextContent : "Image creation was cancelled.",
        };
      }),
    );
  };

  const dismissChatPart = (messageId: string, partIndex: number, fallbackText: string) => {
    options.setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId || !Array.isArray(message.content)) {
          return message;
        }
        const nextContent = message.content.filter((_, index) => index !== partIndex);
        return {
          ...message,
          content: nextContent.length ? nextContent : fallbackText,
        };
      }),
    );
  };

  const executeActionProposal = async (proposal: ActionProposal) => {
    if (proposal.action_type === "write_file") {
      const result = await invoke<FileActionResult>("write_linked_text_file", {
        relativePath: proposalString(proposal, "relative_path"),
        content: proposalString(proposal, "content"),
        rootFolder: proposalString(proposal, "root_folder") || options.linkedFolders[0],
        folders: options.linkedFolders,
      });
      return formatFileActionResult(result);
    }
    if (proposal.action_type === "move_file") {
      const result = await invoke<FileActionResult>("move_linked_file", {
        source: proposalString(proposal, "source"),
        destinationRelativePath: proposalString(proposal, "destination_relative_path"),
        rootFolder: proposalString(proposal, "root_folder") || options.linkedFolders[0],
        folders: options.linkedFolders,
      });
      return formatFileActionResult(result);
    }
    if (proposal.action_type === "delete_file") {
      const result = await invoke<FileActionResult>("trash_linked_file", {
        source: proposalString(proposal, "source"),
        folders: options.linkedFolders,
      });
      return formatFileActionResult(result);
    }
    if (proposal.action_type === "run_powershell") {
      const action = await invoke<PendingShellAction>("propose_shell_action", {
        command: proposalString(proposal, "command"),
        workingDirectory: proposalString(proposal, "working_directory") || undefined,
        purpose: proposalString(proposal, "purpose") || proposal.details,
        timeoutSeconds: Number(proposal.arguments?.timeout_seconds) || 30,
      });
      options.addPendingShellAction(action);
      return `System action is waiting for final approval: ${action.purpose}`;
    }
    if (proposal.action_type === "gmail_send") {
      return await invoke<string>("send_google_gmail_message", {
        clientId: options.googleClientId,
        clientSecret: options.googleClientSecret,
        to: proposalString(proposal, "to"),
        subject: proposalString(proposal, "subject"),
        body: proposalString(proposal, "body"),
        senderName: options.selectedUserProfile?.name || options.userName || undefined,
      });
    }
    if (proposal.action_type === "gmail_trash") {
      return await invoke<string>("trash_google_gmail_message", {
        clientId: options.googleClientId,
        clientSecret: options.googleClientSecret,
        id: proposalString(proposal, "id"),
      });
    }
    if (proposal.action_type === "calendar_create") {
      const result = await invoke<{ id: string; title: string; html_link: string | null }>("create_google_calendar_event", {
        clientId: options.googleClientId,
        clientSecret: options.googleClientSecret,
        title: proposalString(proposal, "title"),
        start: proposalString(proposal, "start"),
        end: proposalString(proposal, "end"),
        description: proposalString(proposal, "description") || null,
        location: proposalString(proposal, "location") || null,
      });
      return `Event created: "${result.title}"${result.html_link ? ` - [Open in Calendar](${result.html_link})` : ""}`;
    }
    if (proposal.action_type === "calendar_delete") {
      return await invoke<string>("delete_google_calendar_event", {
        clientId: options.googleClientId,
        clientSecret: options.googleClientSecret,
        id: proposalString(proposal, "id"),
      });
    }
    if (proposal.action_type === "google_contact_delete") {
      return await invoke<string>("delete_google_contact", {
        clientId: options.googleClientId,
        clientSecret: options.googleClientSecret,
        resourceName: proposalString(proposal, "resource_name"),
      });
    }
    if (proposal.action_type === "google_action") {
      return await invoke<string>("execute_google_api", {
        clientId: options.googleClientId,
        clientSecret: options.googleClientSecret,
        method: proposalString(proposal, "method") || "POST",
        url: proposalString(proposal, "url"),
        payload: proposalJsonPayload(proposal, "payload"),
      });
    }
    throw new Error("This action type is not supported yet.");
  };

  const naturalizeSystemResult = async (userRequest: string, rawResult: string) => {
    const trimmed = rawResult.trim();
    if (!trimmed) return "";
    try {
      const ready = await options.ensureChatModelReady();
      if (!ready) return trimmed;
      const languageHint = conversationWantsVietnamese(options.messages) || textLooksVietnamese(userRequest)
        ? "Reply in natural Vietnamese matching the current conversation."
        : "Reply in the current conversation language.";
      const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stream: false,
          temperature: options.samplingTemperature,
          top_k: options.topK,
          top_p: options.topP,
          min_p: options.minP,
          repeat_last_n: options.repeatLastN,
          repeat_penalty: options.repeatPenalty,
          max_tokens: Math.min(240, options.replyLength),
          chat_template_kwargs: {
            enable_thinking: false,
            thinking: false,
          },
          messages: [
            {
              role: "system",
              content: `Turn a verified system/tool result into one short, natural assistant reply. ${languageHint} Final answer only. Do not include thinking, analysis, plans, drafts, labels, message IDs, raw API wording, JSON, tool names, or backend status unless the user explicitly needs it.`,
            },
            {
              role: "user",
              content: `Original user request:\n${userRequest.trim() || "(scheduled automation)"}\n\nVerified result:\n${trimmed}`,
            },
          ],
        }),
      });
      if (!response.ok) return trimmed;
      const body = await response.json();
      const reply = extractChoiceText(body?.choices?.[0]);
      return stripReasoningLeak(reply.visible.trim() || reply.fallback.trim()) || trimmed;
    } catch (error) {
      console.error("Naturalize system result error:", error);
      return trimmed;
    }
  };

  const approveActionProposal = async (messageId: string, partIndex: number, proposal: ActionProposal) => {
    options.setIsApproving(true);
    const startedAt = performance.now();
    try {
      console.log("Approving action:", proposal.action_type, proposal.arguments);
      const rawResult = await executeActionProposal(proposal);
      const naturalResultText = await naturalizeSystemResult(proposal.details || proposal.action_type, rawResult);
      dismissChatPart(messageId, partIndex, "Action approved.");
      options.setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          content: naturalResultText,
          created_at: Date.now(),
          completed_at: Date.now(),
          duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        },
      ]);
      return;
    } catch (error) {
      console.error("Action approval error:", error);
      options.setComposerNotice(error instanceof Error ? error.message : String(error));
    } finally {
      options.setIsApproving(false);
    }
  };

  return {
    approveActionProposal,
    dismissChatPart,
    dismissImageProposal,
    executeActionProposal,
    naturalizeSystemResult,
  };
}
