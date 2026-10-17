import fs from "node:fs";
import path from "node:path";
import { outlineText } from "../outline-builder/engine.js";
import { symbolAtLine } from "../outline-builder/symbol-table.js";
import { listFiles, matchLinesInFile } from "./js-backend.js";
import { findRg, rgMatchLines } from "./rg-backend.js";

export interface SearchWindow {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  symbol?: string;
}

export interface SearchResult {
  windows: SearchWindow[];
  truncated: number;
  backend: "rg" | "js";
}

export function targetedSearch(root: string, opts: {
  query: string;
  isRegex?: boolean;
  pathGlob?: string;
  caseSensitive?: boolean;
  contextLines?: number;
  maxResults?: number;
  backend?: "auto" | "rg" | "js";
}): SearchResult {
  const context = Math.min(10, Math.max(0, opts.contextLines ?? 3));
  const maxResults = opts.maxResults ?? 50;
  const want = opts.backend ?? "auto";
  const useRg = want === "rg" || (want === "auto" && findRg() !== undefined);
  let hits: Map<string, number[]>;
  let backend: "rg" | "js" = useRg ? "rg" : "js";
  if (useRg) {
    try {
      hits = rgMatchLines(root, { ...opts, maxResults: maxResults + 1 });
    } catch {
      hits = jsHits(root, opts, maxResults + 1);
      backend = "js";
    }
  } else {
    hits = jsHits(root, opts, maxResults + 1);
    backend = "js";
  }
  let total = 0;
  for (const lines of hits.values()) total += lines.length;
  const truncated = Math.max(0, total - maxResults);
  const limited = limitHits(hits, maxResults);
  const windows: SearchWindow[] = [];
  for (const [rel, lines] of limited) {
    const abs = path.join(root, rel);
    let raw = "";
    try {
      raw = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const fileLines = raw.split(/\r?\n/);
    if (fileLines.length && fileLines[fileLines.length - 1] === "" && raw.endsWith("\n")) fileLines.pop();
    const symbols = outlineText(raw, rel, { force: true, minLinesToFold: 1 }).symbols;
    for (const window of mergeWindows(lines, context, fileLines.length)) {
      const body = fileLines.slice(window.start - 1, window.end).map((text, i) => `${window.start + i}|${text}`).join("\n");
      const sym = symbolAtLine(symbols, lines.find((n) => n >= window.start && n <= window.end) ?? window.start);
      windows.push({
        path: rel,
        startLine: window.start,
        endLine: window.end,
        text: body,
        symbol: sym ? `${sym.qualified} (lines ${sym.start}–${sym.end})` : undefined,
      });
    }
  }
  return { windows, truncated, backend };
}

function jsHits(root: string, opts: { query: string; isRegex?: boolean; pathGlob?: string; caseSensitive?: boolean }, maxResults: number): Map<string, number[]> {
  const map = new Map<string, number[]>();
  let count = 0;
  for (const rel of listFiles(root, opts.pathGlob)) {
    const lines = matchLinesInFile(path.join(root, rel), opts.query, opts);
    if (!lines.length) continue;
    const take = lines.slice(0, Math.max(0, maxResults - count));
    if (take.length) map.set(rel, take);
    count += take.length;
    if (count >= maxResults) break;
  }
  return map;
}

function limitHits(map: Map<string, number[]>, maxResults: number): Map<string, number[]> {
  const out = new Map<string, number[]>();
  let count = 0;
  for (const [file, lines] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const take: number[] = [];
    for (const line of lines) {
      if (count >= maxResults) break;
      take.push(line);
      count += 1;
    }
    if (take.length) out.set(file, take);
  }
  return out;
}

export function mergeWindows(hitLines: number[], context: number, fileLength: number): { start: number; end: number }[] {
  const sorted = [...hitLines].sort((a, b) => a - b);
  const windows: { start: number; end: number }[] = [];
  for (const line of sorted) {
    const start = Math.max(1, line - context);
    const end = Math.min(fileLength, line + context);
    const prev = windows[windows.length - 1];
    if (prev && start <= prev.end + 1) prev.end = Math.max(prev.end, end);
    else windows.push({ start, end });
  }
  return windows;
}
