import type { Block, FoldRange } from "../blocks.js";
import type { RawLine } from "../scanner.js";

/** Ruby, Lua, and Elixir keyword…end blocks. Strings are skipped so `end` inside them does not count. */
export function keywordEndBlocks(raw: RawLine[]): Block[] {
  const events: { line: number; kind: "open" | "close"; name: string; blockKind: Block["kind"] }[] = [];
  let inStr: string | null = null;
  raw.forEach((line, lineNo) => {
    const text = line.text;
    let i = 0;
    while (i < text.length) {
      const ch = text[i] ?? "";
      if (inStr) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === inStr) inStr = null;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = ch;
        i += 1;
        continue;
      }
      if (ch === "#") break;
      const rest = text.slice(i);
      const open = /^(?:def|class|module|do|function)\b\s*([A-Za-z_][\w]*)?/.exec(rest);
      if (open && (i === 0 || !/\w/.test(text[i - 1] ?? ""))) {
        const word = /^(def|class|module|do|function)/.exec(rest)?.[1] ?? "do";
        events.push({
          line: lineNo,
          kind: "open",
          name: open[1] || word,
          blockKind: word === "class" || word === "module" ? "container" : "callable",
        });
        i += open[0].length;
        continue;
      }
      if (/^end\b/.test(rest) && (i === 0 || !/\w/.test(text[i - 1] ?? ""))) {
        events.push({ line: lineNo, kind: "close", name: "end", blockKind: "other" });
        i += 3;
        continue;
      }
      i += 1;
    }
  });
  const stack: { line: number; name: string; kind: Block["kind"]; depth: number }[] = [];
  const blocks: Block[] = [];
  for (const event of events) {
    if (event.kind === "open") {
      stack.push({ line: event.line, name: event.name, kind: event.blockKind, depth: stack.length });
      continue;
    }
    const open = stack.pop();
    if (!open || open.line === event.line) continue;
    blocks.push({
      name: open.name,
      kind: open.kind,
      headerStart: open.line,
      headerEnd: open.line,
      bodyStart: open.line + 1,
      bodyEnd: event.line - 1,
      closeLine: event.line,
      depth: open.depth,
    });
  }
  return blocks;
}

export function markdownFolds(raw: RawLine[], minFoldLines: number): FoldRange[] {
  const heads: number[] = [];
  raw.forEach((line, i) => {
    if (/^#{1,6}\s+\S/.test(line.text)) heads.push(i);
  });
  const folds: FoldRange[] = [];
  heads.forEach((head, idx) => {
    const next = heads[idx + 1] ?? raw.length;
    const sectionEnd = next - 1;
    let first = head + 1;
    while (first <= sectionEnd && (raw[first]?.text.trim().length ?? 0) === 0) first += 1;
    const foldStart = first + 1;
    if (sectionEnd - foldStart + 1 >= minFoldLines) {
      folds.push({ start: foldStart, end: sectionEnd, name: raw[head]?.text.trim() ?? "section", kind: "other" });
    }
  });
  return folds;
}

export function csvFolds(raw: RawLine[], minFoldLines: number): FoldRange[] {
  const start = 6;
  const end = raw.length - 1;
  if (end - start + 1 >= minFoldLines) return [{ start, end, name: "rows", kind: "data" }];
  return [];
}
