export type StructuredMemoryDocument = {
  profile_facts: string[];
  preferences: string[];
  relationship: string[];
  projects: string[];
  open_threads: string[];
  recent_turns: string[];
};

export type MemoryEvent = {
  user: string;
  assistant: string;
  created_at: number;
};

const MEMORY_SCHEMA_KEYS: (keyof StructuredMemoryDocument)[] = [
  "profile_facts",
  "preferences",
  "relationship",
  "projects",
  "open_threads",
  "recent_turns",
];

const MARKDOWN_SECTION_KEYS: Record<string, keyof StructuredMemoryDocument> = {
  "self and stable facts": "profile_facts",
  "stable user facts": "profile_facts",
  preferences: "preferences",
  "relationship and communication": "relationship",
  "relationship and communication style": "relationship",
  "projects and recurring topics": "projects",
  "open threads": "open_threads",
  "open threads to remember": "open_threads",
  "recent useful context": "recent_turns",
};

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

const isMemoryBoilerplate = (value: string) =>
  value === "None yet." || value.startsWith("This is the character's living memory");

const looksLikeMojibake = (value: string) =>
  /(?:[\u00c2\u00c3\u00c4\u00c6]|\u00e1[\u00ba\u00bb]|\u00e2\u20ac|\u00ef\u00bf\u00bd|\ufffd|\?m l\?|Ti\u00e1|Ch\u00e1|\u00c4\u2018|kh\u00c3|nh\u00e1|g\u00e1)/.test(value);

export const normalizeStructuredMemory = (value: Partial<StructuredMemoryDocument>) => {
  const next = emptyStructuredMemory();
  for (const key of MEMORY_SCHEMA_KEYS) {
    const seen = new Set<string>();
    const items = Array.isArray(value[key]) ? value[key] ?? [] : [];
    next[key] = items
      .map(cleanMemoryItem)
      .filter(Boolean)
      .filter((item) => !isMemoryBoilerplate(item))
      .filter((item) => !looksLikeMojibake(item))
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
    // Fall through to Markdown/legacy import.
  }

  if (clean.includes("## ")) {
    const parsedMarkdown = emptyStructuredMemory();
    let currentKey: keyof StructuredMemoryDocument | null = null;
    for (const rawLine of clean.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("# ")) continue;
      if (line.startsWith("## ")) {
        const title = line.replace(/^##\s+/, "").trim().toLocaleLowerCase();
        currentKey = MARKDOWN_SECTION_KEYS[title] ?? null;
        continue;
      }
      if (!currentKey || !line.startsWith("-")) continue;
      const item = compactMemoryLine(line.replace(/^[-*]\s*/, ""), 420);
      if (item && item.toLocaleLowerCase() !== "none yet.") {
        parsedMarkdown[currentKey].push(item);
      }
    }
    return normalizeStructuredMemory(parsedMarkdown);
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

export const memoryEventKey = (createdAt = Date.now()) =>
  `event:${createdAt}:${Math.random().toString(36).slice(2, 8)}`;

export const parseMemoryEvent = (raw: string): MemoryEvent | null => {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const user = typeof parsed.user === "string" ? compactMemoryLine(parsed.user, 1200) : "";
    const assistant = typeof parsed.assistant === "string" ? compactMemoryLine(parsed.assistant, 1200) : "";
    const created_at = typeof parsed.created_at === "number" && Number.isFinite(parsed.created_at)
      ? parsed.created_at
      : Date.now();
    if (!user && !assistant) return null;
    return { user, assistant, created_at };
  } catch {
    return null;
  }
};

export const serializeMemoryEvent = (userText: string, assistantText: string, createdAt = Date.now()) =>
  JSON.stringify({
    user: compactMemoryLine(userText, 1200),
    assistant: compactMemoryLine(assistantText, 1200),
    created_at: createdAt,
  });

export const memoryEventToRecentTurn = (event: MemoryEvent) =>
  [
    event.user.trim() ? `User: ${compactMemoryLine(event.user, 260)}` : "",
    event.assistant.trim() ? `Assistant: ${compactMemoryLine(event.assistant, 260)}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

export const mergeMemoryEventsIntoSummary = (rawMemory: string, events: MemoryEvent[]) => {
  const memory = parseStructuredMemory(rawMemory);
  const turns = events
    .sort((a, b) => a.created_at - b.created_at)
    .map(memoryEventToRecentTurn)
    .filter(Boolean);
  for (const turn of turns) {
    memory.recent_turns = [...memory.recent_turns.filter((item) => item !== turn), turn];
  }
  memory.recent_turns = memory.recent_turns.slice(-LIMITS.recent_turns);
  return serializeStructuredMemory(normalizeStructuredMemory(memory));
};

export const formatLongTermMemoryForPrompt = (rawSummary: string, events: MemoryEvent[]) => {
  const summary = formatStructuredMemoryForPrompt(rawSummary);
  const recentEvents = events
    .sort((a, b) => a.created_at - b.created_at)
    .slice(-8)
    .map(memoryEventToRecentTurn)
    .filter(Boolean);
  const eventSection = section("Recent uncompressed memory events", recentEvents);
  return [summary, eventSection].filter(Boolean).join("\n\n");
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
  memoryEvents: MemoryEvent[] = [],
) => {
  const current = parseStructuredMemory(rawMemory);
  const events = memoryEvents.length
    ? memoryEvents
    : [{ user: userText, assistant: assistantText, created_at: Date.now() }];
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
            "Treat the new memory events as raw evidence. Promote durable facts into stable sections; keep temporary context only in recent_turns or open_threads.",
            "Remove duplicates, resolve contradictions by keeping the newest explicit correction, and avoid storing private secrets, passwords, API keys, or one-off small talk.",
            "Keep each item short and useful. Maximum items: profile_facts 24, preferences 24, relationship 18, projects 24, open_threads 18, recent_turns 18.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            current_memory: current,
            new_events: events.map((event) => ({
              user: compactMemoryLine(event.user, 1200),
              assistant: compactMemoryLine(event.assistant, 1200),
              created_at: event.created_at,
            })),
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
