import type { BraceEvent, LineScan } from "./scanner.js";
import type { RawLine } from "./scanner.js";

export type BlockKind = "container" | "callable" | "contract" | "data" | "control" | "other";

export interface Block {
  name: string;
  kind: BlockKind;
  headerStart: number;
  headerEnd: number;
  bodyStart: number;
  bodyEnd: number;
  closeLine: number;
  depth: number;
  parent?: number;
}

const CONTROL =
  /^(?:export\s+|pub\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|async\s+|unsafe\s+|virtual\s+|override\s+|abstract\s+|sealed\s+|partial\s+|extern\s+|default\s+|declare\s+)*(?:if|for|while|switch|catch|else|do|try|using|lock|match|return)\b/;

const CONTAINER =
  /\b(?:class|interface|struct|enum|trait|impl|namespace|module|object|protocol|record|extension|type)\b/;

const CALLABLE =
  /\b(?:function|fn|func|fun|def|sub|func)\b|=>|(?:public|private|protected|static|async|export|const|let|var|pub|fn)\b[^;\n]*\(/;

export function buildBraceBlocks(raw: RawLine[], scan: LineScan[], events: BraceEvent[]): Block[] {
  const stack: { line: number; depth: number }[] = [];
  const blocks: Block[] = [];
  for (const event of events) {
    if (event.kind === "open") {
      stack.push({ line: event.line, depth: stack.length });
      continue;
    }
    const open = stack.pop();
    if (!open) continue;
    if (open.line === event.line) continue;
    const headerEnd = open.line;
    const headerStart = findHeaderStart(raw, scan, headerEnd);
    const header = raw.slice(headerStart, headerEnd + 1).map((l) => l.text).join("\n");
    const bodyStart = headerEnd + 1;
    const bodyEnd = event.line - 1;
    blocks.push({
      name: extractName(header),
      kind: classify(header),
      headerStart,
      headerEnd,
      bodyStart,
      bodyEnd,
      closeLine: event.line,
      depth: open.depth,
    });
  }
  assignParents(blocks);
  return blocks;
}

function findHeaderStart(raw: RawLine[], scan: LineScan[], headerEnd: number): number {
  let start = headerEnd;
  let docs = 0;
  let wantSignature = /^[{]\s*$/.test((raw[headerEnd]?.text ?? "").trim());
  let i = headerEnd - 1;
  while (i >= 0) {
    const line = raw[i];
    const info = scan[i];
    if (!line || !info) break;
    const t = line.text.trim();
    if (t.length === 0) break;
    const doc = /^(?:@|#|\/\/|\/\*|\*|\/\/\/)/.test(t);
    if (doc) {
      docs += 1;
      if (docs > 3) break;
      start = i;
      i -= 1;
      continue;
    }
    if (wantSignature || info.parenEnd > 0 || /[,([\\]\s*$/.test(t)) {
      start = i;
      wantSignature = info.parenEnd > 0 || /[,([\\]\s*$/.test(t);
      i -= 1;
      continue;
    }
    break;
  }
  return start;
}

export function classify(header: string): BlockKind {
  const flat = header.replace(/\s+/g, " ").trim();
  const code = flat.replace(/^(?:\/\/|\/\*|\*|#).*$/gm, "").trim();
  if (CONTROL.test(code)) return "control";
  if (/\b(?:interface|enum)\b/.test(code) || /\btype\s+\w+\s*=/.test(code)) return "contract";
  if (CONTAINER.test(code) && !/\([^)]*\)\s*\{?\s*$/.test(code.split("{")[0] ?? code)) return "container";
  if (CALLABLE.test(code) || /\(/.test((code.split("{")[0] ?? code))) return "callable";
  if (CONTAINER.test(code)) return "container";
  return "data";
}

export function extractName(header: string): string {
  const flat = header.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").trim();
  const patterns = [
    /\b(?:class|interface|struct|enum|trait|namespace|module|object|protocol|record|type|impl)\s+([A-Za-z_][\w.]*)/,
    /\b(?:function|fn|func|fun|def|sub)\s+([A-Za-z_][\w]*)/,
    /\b(?:const|let|var|public|private|protected|static|async|export|pub)\s+(?:async\s+)?([A-Za-z_][\w]*)\s*(?:=|\()/,
    /\b([A-Za-z_][\w]*)\s*(?:<[^>]+>)?\s*\(/,
  ];
  for (const re of patterns) {
    const m = re.exec(flat);
    if (m?.[1] && !/^(if|for|while|switch|catch|return|new|function|public|private|protected)$/.test(m[1])) {
      return m[1];
    }
  }
  return "(anonymous)";
}

export function linkParents(blocks: Block[]): void {
  assignParents(blocks);
}

function assignParents(blocks: Block[]): void {
  const ordered = blocks
    .map((b, i) => ({ b, i }))
    .sort((a, c) => a.b.headerStart - c.b.headerStart || c.b.closeLine - a.b.closeLine);
  const stack: number[] = [];
  for (const { b, i } of ordered) {
    while (stack.length) {
      const parent = blocks[stack[stack.length - 1] ?? -1];
      if (!parent || b.headerStart > parent.closeLine) stack.pop();
      else break;
    }
    const parentIdx = stack[stack.length - 1];
    if (parentIdx !== undefined) b.parent = parentIdx;
    stack.push(i);
  }
}

export interface FoldRange {
  start: number;
  end: number;
  name: string;
  kind: BlockKind;
}

export function planFolds(
  blocks: Block[],
  minFoldLines: number,
  contractKeepLines: number,
): FoldRange[] {
  const folds: FoldRange[] = [];
  const sorted = [...blocks].sort((a, b) => a.depth - b.depth || a.bodyStart - b.bodyStart);
  for (const block of sorted) {
    if (block.kind === "container") continue;
    if (block.kind === "contract") {
      const span = block.closeLine - block.headerStart + 1;
      if (span <= contractKeepLines) continue;
    }
    if (block.bodyStart > block.bodyEnd) continue;
    const bodyLen = block.bodyEnd - block.bodyStart + 1;
    if (bodyLen < minFoldLines) continue;
    if (folds.some((f) => rangesOverlap(f.start, f.end, block.bodyStart, block.bodyEnd))) continue;
    if (block.kind === "contract") continue;
    folds.push({ start: block.bodyStart, end: block.bodyEnd, name: block.name, kind: block.kind });
  }
  return folds.sort((a, b) => a.start - b.start);
}

export function foldImportRuns(raw: RawLine[], keep: number, minFoldLines: number, existing: FoldRange[]): FoldRange[] {
  const extra: FoldRange[] = [];
  let runStart = -1;
  const flush = (runEnd: number) => {
    if (runStart < 0) return;
    const foldStart = runStart + keep;
    if (runEnd - foldStart + 1 >= minFoldLines) {
      if (!existing.some((f) => rangesOverlap(f.start, f.end, foldStart, runEnd)) &&
          !extra.some((f) => rangesOverlap(f.start, f.end, foldStart, runEnd))) {
        extra.push({ start: foldStart, end: runEnd, name: "imports", kind: "other" });
      }
    }
    runStart = -1;
  };
  raw.forEach((line, i) => {
    const t = line.text.trim();
    const isImport = /^(import|using|from|require\(|#include)\b/.test(t) || /^import\s*\(/.test(t);
    if (isImport) {
      if (runStart < 0) runStart = i;
    } else if (t.length === 0 && runStart >= 0) {
      /* allow blank lines inside an import run */
    } else {
      flush(i - 1);
    }
  });
  flush(raw.length - 1);
  return extra;
}

export function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 <= b1 && b0 <= a1;
}
