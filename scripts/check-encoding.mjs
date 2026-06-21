import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { TextDecoder } from "node:util";

const root = process.cwd();
const decoder = new TextDecoder("utf-8", { fatal: true });

const ignoredDirs = new Set([
  ".codex-cargo-target",
  ".git",
  ".idea",
  ".vscode",
  "_backups",
  "assistant-runtime",
  "config",
  "dist",
  "logs",
  "node_modules",
  "target",
]);

const ignoredPathParts = [
  "src-tauri\\target",
  "src-tauri/target",
  "src-tauri\\target-agent-test",
  "src-tauri/target-agent-test",
  "src-tauri\\target-codex-check",
  "src-tauri/target-codex-check",
];

const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".rs",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml",
]);

const textFilesWithoutExtension = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
]);

const mojibakePatterns = [
  { name: "replacement character", regex: new RegExp("\\uFFFD") },
  { name: "C1 control character", regex: new RegExp("[\\u0080-\\u009F]") },
  { name: "UTF-8 read as Windows-1252", regex: new RegExp("[\\u00C3\\u00C2][\\u0080-\\u017F]") },
  {
    name: "visible UTF-8 read as Windows-1252",
    regex: new RegExp("(?:\\u00C3.|\\u00C2[^\\sA-Za-z]|\\u00E1[\\u00BA\\u00BB]|\\u00C6[^\\s]|\\u00C4[^\\s]|\\u00E2[\\u0080-\\u017F\\u20AC].?|\\u00E3[\\u0080-\\u017F\\u20AC].?|\\u00EF[\\u0080-\\u017F\\u00BC].?)", "u"),
  },
  {
    name: "common visible mojibake sequence",
    regex: new RegExp("(?:\\u00E2\\u20AC|\\u00E3\\u20AC|\\u00EF\\u00BC|\\u00C3\\u00A0|\\u00C3\\u00A1|\\u00C3\\u00AA|\\u00C3\\u00B4|\\u00C3\\u00BD)", "u"),
  },
  { name: "Vietnamese/Thai UTF-8 read as Windows-1252", regex: new RegExp("[\\u00C4\\u00C6][\\u0080-\\u017F]") },
  { name: "Vietnamese tone byte fragments", regex: new RegExp("\\u00E1[\\u00BA\\u00BB]") },
  { name: "emoji UTF-8 read as Windows-1252", regex: new RegExp("(?:\\u00F0\\u0178|\\u00E2[\\u0080-\\u017F])") },
  { name: "lossy Vietnamese replacement", regex: /(?:\?m l\?ch|l\?ch|kh\?ng|h\?m|ng\?y|th\?ng|b\?y gi\?|c\?ng ty)/i },
];

function isIgnoredPath(path) {
  const normalized = path.replaceAll("\\", "/");
  return ignoredPathParts.some((part) =>
    normalized.includes(part.replaceAll("\\", "/")),
  );
}

function isTextFile(path) {
  const fileName = path.split(/[\\/]/).pop() ?? "";
  if (textFilesWithoutExtension.has(fileName)) {
    return true;
  }
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  return textExtensions.has(ext);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) {
      continue;
    }
    const fullPath = join(dir, entry);
    if (isIgnoredPath(fullPath)) {
      continue;
    }
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, out);
    } else if (stats.isFile() && isTextFile(fullPath)) {
      out.push(fullPath);
    }
  }
  return out;
}

const failures = [];

for (const file of walk(root)) {
  const rel = relative(root, file);
  const bytes = readFileSync(file);
  let text;
  try {
    text = decoder.decode(bytes);
  } catch (error) {
    failures.push(`${rel}: invalid UTF-8 (${error.message})`);
    continue;
  }

  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (text.charCodeAt(0) === 0xfeff) {
    failures.push(`${rel}:1:1: UTF-8 BOM is not allowed`);
  }
  for (const { name, regex } of mojibakePatterns) {
    const match = regex.exec(withoutBom);
    if (!match) {
      continue;
    }
    const before = withoutBom.slice(0, match.index);
    const line = before.split("\n").length;
    const column = match.index - before.lastIndexOf("\n");
    failures.push(`${rel}:${line}:${column}: possible mojibake (${name})`);
  }
}

if (failures.length > 0) {
  console.error("Encoding check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Encoding check passed.");
