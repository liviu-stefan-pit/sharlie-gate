import { BRACE_STYLE, type ScanStyle } from "../scanner.js";
import type { Block } from "../blocks.js";

export type ProfileId =
  | "c-family"
  | "python"
  | "keyword-end"
  | "markdown"
  | "json"
  | "yaml"
  | "toml"
  | "markup"
  | "sql"
  | "shell"
  | "csv"
  | "indent";

export interface Profile {
  id: ProfileId;
  style: ScanStyle;
  /** When set, only brace blocks at this depth or deeper are eligible to fold. */
  minFoldDepth?: number;
}

const PY_STYLE: ScanStyle = { ...BRACE_STYLE, slashLine: false, hashLine: true, block: false, template: false, triples: true };
const HASH_STYLE: ScanStyle = { ...BRACE_STYLE, slashLine: false, hashLine: true, block: false, template: false };
const RUST_STYLE: ScanStyle = { ...BRACE_STYLE, blockNest: true, rawRust: true };
const CSHARP_STYLE: ScanStyle = { ...BRACE_STYLE, verbatim: true };
const MARKUP_STYLE: ScanStyle = { ...BRACE_STYLE, slashLine: false, hashLine: false, block: false, quotes: true, template: false };

const EXT: Record<string, ProfileId> = {
  ts: "c-family", tsx: "c-family", js: "c-family", jsx: "c-family", mjs: "c-family", cjs: "c-family",
  go: "c-family", java: "c-family", kt: "c-family", kts: "c-family", scala: "c-family",
  c: "c-family", h: "c-family", cc: "c-family", cpp: "c-family", cxx: "c-family", hpp: "c-family",
  cs: "c-family", php: "c-family", swift: "c-family", rs: "c-family",
  py: "python", pyi: "python",
  rb: "keyword-end", lua: "keyword-end", ex: "keyword-end", exs: "keyword-end",
  md: "markdown", markdown: "markdown",
  json: "json", jsonc: "json",
  yaml: "yaml", yml: "yaml",
  toml: "toml", ini: "toml",
  html: "markup", htm: "markup", xml: "markup", vue: "markup", svelte: "markup",
  sql: "sql",
  sh: "shell", bash: "shell", zsh: "shell", ps1: "shell",
  csv: "csv",
};

export function profileFor(id: ProfileId): Profile {
  switch (id) {
    case "python":
      return { id, style: PY_STYLE };
    case "shell":
      return { id, style: HASH_STYLE };
    case "c-family":
      return { id, style: BRACE_STYLE };
    case "json":
      return { id, style: { ...BRACE_STYLE, slashLine: false, block: false, template: false }, minFoldDepth: 2 };
    case "markup":
      return { id, style: MARKUP_STYLE, minFoldDepth: 3 };
    default:
      return { id, style: BRACE_STYLE };
  }
}

export function styleForPath(filePath: string): ScanStyle {
  const id = detectProfile(filePath, "");
  if (id === "c-family" && filePath.endsWith(".rs")) return RUST_STYLE;
  if (id === "c-family" && filePath.endsWith(".cs")) return CSHARP_STYLE;
  return profileFor(id).style;
}

export function detectProfile(filePath: string, text: string): ProfileId {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  if (/^makefile$/i.test(base) || base === "Dockerfile") return "indent";
  const ext = base.includes(".") ? (base.split(".").pop() ?? "").toLowerCase() : "";
  if (ext && EXT[ext]) return EXT[ext] as ProfileId;
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  if (first.startsWith("#!")) {
    if (/python/.test(first)) return "python";
    if (/ruby/.test(first)) return "keyword-end";
    if (/sh|bash|zsh/.test(first)) return "shell";
  }
  const braces = (text.match(/[{}]/g) ?? []).length;
  const semis = (text.match(/;/g) ?? []).length;
  const colons = (text.match(/^\s+\S[^\n]*:\s*$/gm) ?? []).length;
  if (braces + semis >= 4 && braces + semis > colons) return "c-family";
  return "indent";
}

export function filterByDepth(blocks: Block[], minDepth: number | undefined): Block[] {
  if (minDepth === undefined) return blocks;
  return blocks.filter((b) => b.depth >= minDepth);
}

