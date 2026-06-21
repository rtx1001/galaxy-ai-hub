import { PersonalityPreset, buildConversationIdentityBlock } from "../appCore";

type UseRuntimePromptBuildersOptions = {
  characterFolder: string;
  characterSoul: string;
  currentModelName: string;
  googleConnected: boolean;
  googleEmail?: string;
  linkedFolders: string[];
  localContext: string;
  omniVoiceReady: boolean;
  personality: string;
  personalityMemory: string;
  personalityPresets: PersonalityPreset[];
  selectedPersonalityId: string;
  telegramRunning: boolean;
  userDescription: string;
  userName: string;
  voiceInputReady: boolean;
};

export function useRuntimePromptBuilders(options: UseRuntimePromptBuildersOptions) {
  const buildSystemContextBlock = () => [
    `Time: ${new Date().toLocaleString()}`,
    `Location: ${options.localContext}`,
    `Default location: ${options.localContext}`,
    `Character folder: ${options.characterFolder || "not initialized"}`,
    `Active model: ${options.currentModelName}`,
    `Workspace folders: ${options.linkedFolders.length ? options.linkedFolders.join("; ") : "none"}`,
    `Google: ${options.googleConnected ? "online" : "offline"}`,
    `Telegram: ${options.telegramRunning ? "online" : "offline"}`,
    `Voice: input ${options.voiceInputReady ? "ready" : "not ready"}, tts ${options.omniVoiceReady ? "ready" : "not ready"}`,
    "Image: local Image Studio model",
  ].join(" | ");

  const buildAssistantRuntimePrompt = () => {
    const activePersonality =
      options.personalityPresets.find((preset) => preset.id === options.selectedPersonalityId) ?? options.personalityPresets[0];
    const assistantName = activePersonality?.name || "Assistant";
    const activeUserName = options.userName.trim() || "User";
    return [
      buildConversationIdentityBlock({
        assistantName,
        userName: activeUserName,
        userDescription: options.userDescription,
      }),
      "",
      `Assistant profile:
Name: ${assistantName}
Instructions:
${options.personality || activePersonality?.prompt || "Helpful assistant."}
`,
      options.characterSoul.trim() ? `\nAdditional character context:\n${options.characterSoul.trim()}` : "",
      options.personalityMemory.trim()
        ? `\nConversation memory:
${options.personalityMemory.trim()}
`
        : "",
      activeUserName || options.userDescription.trim()
        ? `\nUser profile:\nName: ${activeUserName}\nAbout user: ${options.userDescription.trim() || "No extra details."}`
        : "",
      options.linkedFolders.length
        ? `\nPermitted workspace folders:\n${options.linkedFolders.join("\n")}`
        : "\nPermitted workspace folders: none selected.",
      `\nConnected utilities:
Google Calendar: ${options.googleConnected ? `online${options.googleEmail ? ` (${options.googleEmail})` : ""}` : "offline"}
Gmail: ${options.googleConnected ? "online" : "offline"}
Telegram control: ${options.telegramRunning ? "online" : "offline"}
Voice input: ${options.voiceInputReady ? "ready" : "not ready"}
Voice TTS: ${options.omniVoiceReady ? "ready" : "not ready"}
Image generation: local Image Studio model
User location: ${options.localContext}`,
    ].join("");
  };

  return {
    buildAssistantRuntimePrompt,
    buildSystemContextBlock,
  };
}
