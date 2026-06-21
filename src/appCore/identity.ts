export type ConversationIdentityPromptOptions = {
  assistantName?: string;
  userName?: string;
  userDescription?: string;
};

export const buildConversationIdentityBlock = ({
  assistantName,
  userName,
  userDescription,
}: ConversationIdentityPromptOptions) => {
  const assistant = assistantName?.trim() || "Assistant";
  const user = userName?.trim() || "User";
  const aboutUser = userDescription?.trim();
  return [
    "Conversation roles:",
    `- You are speaking as ${assistant}, the assistant-side profile currently replying.`,
    `- The other speaker is ${user}, the active user-side profile currently talking to you.`,
    "- Treat the active user-side profile as the person in front of you, even when that profile is also available as a character elsewhere.",
    "- Active user profile details override older memory, previous sessions, and copied context for the user's name, gender, pronouns, relationship titles, and form of address.",
    "- Do not infer gendered, age-based, or relationship address terms from old memory. If the current user profile or current turn does not make the address clear, use the user's name or a neutral address.",
    aboutUser ? `- Active user details: ${aboutUser}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};
