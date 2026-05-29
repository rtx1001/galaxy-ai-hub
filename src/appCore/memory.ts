export type StructuredMemoryDocument = {
  profile_facts: string[];
  preferences: string[];
  relationship: string[];
  projects: string[];
  open_threads: string[];
  recent_turns: string[];
};

const MEMORY_SCHEMA_KEYS: (keyof StructuredMemoryDocument)[] = [
  "profile_facts",
  "preferences",
  "relationship",
  "projects",
  "open_threads",
  "recent_turns",
];

const LIMITS: Record<keyof StructuredMemoryDocument, number> = {
  profile_facts: 24,
  preferences: 24,
  relationship: 18,
  projects: 24,
  open_threads: 18,
  recent_turns: 18,
};

export const emptyStructuredMemory = (): StructuredMemoryDocument => ({
  profile_facts: [],
  preferences: [],
  relationship: [],
  projects: [],
  open_threads: [],
  recent_turns: [],
});

export const compactMemoryLine = (text: string, limit = 420) => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit).trimEnd()}...`;
};

const cleanMemoryItem = (value: unknown) =>
  typeof value === "string"
    ? compactMemoryLine(value.replace(/^[-*]\s*/, ""), 420)
    : "";

export const normalizeStructuredMemory = (value: Partial<StructuredMemoryDocument>) => {
  const next = emptyStructuredMemory();
  for (const key of MEMORY_SCHEMA_KEYS) {
    const seen = new Set<string>();
    const items = Array.isArray(value[key]) ? value[key] ?? [] : [];
    next[key] = items
      .map(cleanMemoryItem)
      .filter(Boolean)
      .filter((item) => {
        const normalized = item.toLocaleLowerCase();
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      })
      .slice(-LIMITS[key]);
  }
  return next;
};

export const parseStructuredMemory = (raw: string): StructuredMemoryDocument => {
  const clean = raw.trim();
  if (!clean) return emptyStructuredMemory();
  try {
    const parsed = JSON.parse(clean);
    if (parsed && typeof parsed === "object") {
      return normalizeStructuredMemory(parsed as Partial<StructuredMemoryDocument>);
    }
  } catch {
    // Fall through to legacy bullet import.
  }

  const legacyLines = clean
    .split("\n")
    .map((line) => compactMemoryLine(line.replace(/^[-*]\s*/, ""), 420))
    .filter(Boolean)
    .slice(-LIMITS.recent_turns);
  return normalizeStructuredMemory({ recent_turns: legacyLines });
};

export const serializeStructuredMemory = (memory: StructuredMemoryDocument) =>
  JSON.stringify(normalizeStructuredMemory(memory));

const section = (title: string, items: string[]) =>
  items.length ? `${title}\n${items.map((item) => `- ${item}`).join("\n")}` : "";

export const formatStructuredMemoryForPrompt = (raw: string) => {
  const memory = parseStructuredMemory(raw);
  return [
    section("Stable user facts", memory.profile_facts),
    section("User preferences", memory.preferences),
    section("Relationship and communication style", memory.relationship),
    section("Projects and recurring topics", memory.projects),
    section("Open threads to remember", memory.open_threads),
    section("Recent useful context", memory.recent_turns),
  ]
    .filter(Boolean)
    .join("\n\n");
};

export const mergeTurnIntoMemoryLocally = (
  rawMemory: string,
  userText: string,
  assistantText: string,
) => {
  const memory = parseStructuredMemory(rawMemory);
  const turn = [
    userText.trim() ? `User: ${compactMemoryLine(userText, 260)}` : "",
    assistantText.trim() ? `Assistant: ${compactMemoryLine(assistantText, 260)}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  if (!turn) return serializeStructuredMemory(memory);
  memory.recent_turns = [...memory.recent_turns.filter((item) => item !== turn), turn]
    .slice(-LIMITS.recent_turns);
  return serializeStructuredMemory(normalizeStructuredMemory(memory));
};

const extractJsonObject = (text: string) => {
  const clean = text.trim();
  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || clean;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  return candidate.slice(start, end + 1);
};

export const compactMemoryWithBrain = async (
  rawMemory: string,
  userText: string,
  assistantText: string,
) => {
  const current = parseStructuredMemory(rawMemory);
  const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stream: false,
      temperature: 0.1,
      top_k: 20,
      top_p: 0.9,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content: [
            "You update a long-term memory document for a local AI companion.",
            "Return only valid JSON matching this schema:",
            '{"profile_facts":[],"preferences":[],"relationship":[],"projects":[],"open_threads":[],"recent_turns":[]}',
            "Be language-agnostic. Preserve names, places, languages, project names, and user wording when useful.",
            "Store durable facts, user preferences, relationship/communication style, projects, unresolved tasks, and recent context.",
            "Remove duplicates, resolve contradictions by keeping the newest explicit correction, and avoid storing private secrets, passwords, API keys, or one-off small talk.",
            "Keep each item short and useful. Maximum items: profile_facts 24, preferences 24, relationship 18, projects 24, open_threads 18, recent_turns 18.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            current_memory: current,
            new_turn: {
              user: compactMemoryLine(userText, 1200),
              assistant: compactMemoryLine(assistantText, 1200),
            },
          }),
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Memory compaction failed with status ${response.status}`);
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(extractJsonObject(text));
  return serializeStructuredMemory(normalizeStructuredMemory(parsed));
};
