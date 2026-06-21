import {
  PersonalityPreset,
  DisplayLanguage,
  buildConversationIdentityBlock,
  cleanAssistantDisplayText,
  extractChatResponseText,
  hasUnexpectedHanDrift,
  modelAwareReplySampling,
  stripThinkBlocks,
} from "../appCore";

const IMAGE_REPLY_TIMEOUT_MS = 25_000;

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

type UseImageCompletionReplyOptions = {
  appLog: (message: string) => void;
  characterSoul: string;
  chatDisplayLanguage: DisplayLanguage;
  ensureChatModelReady: () => Promise<boolean>;
  hasVision: boolean;
  minP: number;
  personality: string;
  personalityPresets: PersonalityPreset[];
  repeatLastN: number;
  repeatPenalty: number;
  samplingTemperature: number;
  selectedModelPath: string;
  selectedPersonalityId: string;
  topK: number;
  topP: number;
  userDescription: string;
  userName: string;
};

export function useImageCompletionReply(options: UseImageCompletionReplyOptions) {
  const generateNaturalImageCompletionReply = async (
    prompt: string,
    mode: string,
    imageDataUrl: string,
  ) => {
    const activePersonality =
      options.personalityPresets.find((preset) => preset.id === options.selectedPersonalityId) ??
      options.personalityPresets[0];
    const assistantName = activePersonality?.name || "Assistant";
    const activeUserName = options.userName.trim() || "User";
    const userLanguageHint =
      options.chatDisplayLanguage === "vi"
        ? "Reply in the same Vietnamese tone the user is using."
        : "Reply in the same language and tone the user is using.";
    const profilePrompt = [
      buildConversationIdentityBlock({
        assistantName,
        userName: activeUserName,
        userDescription: options.userDescription,
      }),
      "",
      `Assistant profile:
Name: ${assistantName}
Instructions:
${options.personality || activePersonality?.prompt || "You are a helpful assistant."}`,
      options.characterSoul.trim() ? `\nAdditional character context:\n${options.characterSoul.trim()}` : "",
      activeUserName || options.userDescription.trim()
        ? `\nUser profile:\nName: ${activeUserName}\nAbout user: ${options.userDescription.trim() || ""}`
        : "",
      `\nTask: You just finished creating an image for the user. Write one short, natural assistant message for the chat bubble. ${userLanguageHint} Do not mention tools, prompts, files, generation engines, or approval. Do not ask a generic follow-up unless it feels natural. Keep it under 24 words.`,
    ].join("");

    const userContent = options.hasVision
      ? [
          {
            type: "text",
            text: `The created image is attached. Original image request mode: ${mode}. Visual request: ${prompt}`,
          },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ]
      : `Original image request mode: ${mode}. Visual request: ${prompt}`;

    try {
      options.appLog("image completion reply start");
      const ready = await withTimeout(options.ensureChatModelReady(), IMAGE_REPLY_TIMEOUT_MS, "Image completion model load");
      if (!ready) {
        throw new Error("Image completion model was not ready");
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), IMAGE_REPLY_TIMEOUT_MS);
      const replySampling = modelAwareReplySampling({
        modelPath: options.selectedModelPath,
        temperature: options.samplingTemperature,
        topK: options.topK,
        topP: options.topP,
        minP: options.minP,
        repeatPenalty: options.repeatPenalty,
      });
      const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: profilePrompt },
            { role: "user", content: userContent },
          ],
          temperature: Math.min(1.0, Math.max(0.45, replySampling.temperature)),
          top_k: replySampling.topK,
          top_p: replySampling.topP,
          min_p: replySampling.minP,
          repeat_last_n: options.repeatLastN,
          repeat_penalty: replySampling.repeatPenalty,
          max_tokens: 64,
          stream: false,
          chat_template_kwargs: {
            enable_thinking: false,
            thinking: false,
          },
        }),
      }).finally(() => clearTimeout(timeoutId));

      if (!response.ok) {
        throw new Error(`Image reply failed with status ${response.status}`);
      }

      const rawReply = stripThinkBlocks(extractChatResponseText(await response.json()))
        .replace(/\s+/g, " ")
        .trim();
      let reply = cleanAssistantDisplayText(rawReply);
      if (hasUnexpectedHanDrift(rawReply)) {
        const repairResponse = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              {
                role: "system",
                content: "Rewrite the message in the current chat language. Translate unexpected foreign-script fragments. Preserve meaning and tone. Output only the repaired message.",
              },
              { role: "user", content: rawReply },
            ],
            temperature: 0.25,
            top_k: Math.max(20, Math.min(replySampling.topK || 40, 40)),
            top_p: Math.min(replySampling.topP || 0.9, 0.9),
            min_p: replySampling.minP,
            repeat_last_n: Math.max(options.repeatLastN, 128),
            repeat_penalty: Math.max(replySampling.repeatPenalty, 1.1),
            max_tokens: 96,
            stream: false,
            chat_template_kwargs: {
              enable_thinking: false,
              thinking: false,
            },
          }),
        });
        if (repairResponse.ok) {
          const repaired = cleanAssistantDisplayText(extractChatResponseText(await repairResponse.json()));
          if (repaired && !hasUnexpectedHanDrift(repaired)) reply = repaired;
        }
      }
      options.appLog(`image completion reply done length=${reply.length}`);
      return reply;
    } catch (error) {
      console.error("Image completion reply error:", error);
      options.appLog(`image completion reply failed error=${error instanceof Error ? error.message : String(error)}`);
      return "";
    }
  };

  return { generateNaturalImageCompletionReply };
}
