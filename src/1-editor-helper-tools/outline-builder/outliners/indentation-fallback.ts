import type { RawLine } from "../scanner.js";
import { rangesOverlap, type FoldRange } from "../blocks.js";

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function indentLevels(raw: RawLine[]): { levels: number[]; unit: number } {
  const indents = raw.map((line) => (line.text.trim().length === 0 ? -1 : line.indent));
  for (let i = indents.length - 1; i >= 0; i--) {
    if ((indents[i] ?? 0) < 0) indents[i] = i + 1 < indents.length ? (indents[i + 1] ?? 0) : 0;
  }
  const deltas: number[] = [];
  for (let i = 1; i < indents.length; i++) {
    const d = Math.abs((indents[i] ?? 0) - (indents[i - 1] ?? 0));
    if (d > 0) deltas.push(d);
  }
  let unit = 1;
  if (deltas.length) unit = deltas.reduce((a, b) => gcd(a, b));
  unit = Math.min(8, Math.max(1, unit));
  return { levels: indents.map((n) => Math.floor((n ?? 0) / unit)), unit };
}

export interface IndentPlan {
  folds: FoldRange[];
  keepLevel: number;
  keptRatio: number;
  flat: boolean;
}

export function planIndentFolds(raw: RawLine[], minFoldLines: number): IndentPlan {
  const { levels } = indentLevels(raw);
  const total = raw.length || 1;
  const candidates = [0, 1, 2];
  let chosen: number | undefined;
  let chosenFolds: FoldRange[] = [];
  let chosenKept = 1;
  for (const k of candidates) {
    const folds = foldsForLevel(levels, raw, k, minFoldLines);
    const structural = levels.filter((level) => level <= k).length / total;
    const kept = total - folds.reduce((n, f) => n + (f.end - f.start + 1), 0);
    const outlineRatio = (kept + folds.length) / total;
    if (structural >= 0.1 && outlineRatio <= 0.4) {
      chosen = k;
      chosenFolds = folds;
      chosenKept = kept / total;
      break;
    }
  }
  if (chosen === undefined) {
    chosen = 0;
    chosenFolds = foldsForLevel(levels, raw, 0, minFoldLines);
    const kept = total - chosenFolds.reduce((n, f) => n + (f.end - f.start + 1), 0);
    chosenKept = kept / total;
  }
  return { folds: chosenFolds, keepLevel: chosen, keptRatio: chosenKept, flat: chosen === 0 && chosenKept > 0.6 };
}

function foldsForLevel(levels: number[], raw: RawLine[], k: number, minFoldLines: number): FoldRange[] {
  const folds: FoldRange[] = [];
  let run = -1;
  const flush = (end: number) => {
    if (run < 0) return;
    if (end - run + 1 >= minFoldLines) {
      const indent = raw[run]?.indent ?? 0;
      folds.push({ start: run, end, name: "block", kind: "other" });
      void indent;
    }
    run = -1;
  };
  levels.forEach((level, i) => {
    if (level > k) {
      if (run < 0) run = i;
    } else {
      flush(i - 1);
    }
  });
  flush(levels.length - 1);
  return folds.filter((f, i) => folds.every((o, j) => j === i || !rangesOverlap(f.start, f.end, o.start, o.end) || j > i));
}
