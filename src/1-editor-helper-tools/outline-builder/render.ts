import { createHash } from "node:crypto";
import { sectionMarker } from "../../core/markers.js";
import type { RawLine } from "./scanner.js";
import type { FoldRange } from "./blocks.js";

export function fileRev(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 8);
}

export function renderOutline(opts: {
  filePath: string;
  raw: RawLine[];
  folds: FoldRange[];
  rev: string;
}): { text: string; shown: number; sections: { start: number; end: number }[] } {
  const sections = opts.folds.map((f) => ({ start: f.start + 1, end: f.end + 1 }));
  const hidden = opts.folds.reduce((n, f) => n + (f.end - f.start + 1), 0);
  const shown = opts.raw.length - hidden;
  const header =
    `[outline] ${opts.filePath} | ${opts.raw.length.toLocaleString("en-US")} lines | rev ${opts.rev} | ` +
    `${shown.toLocaleString("en-US")} shown, ${opts.folds.length.toLocaleString("en-US")} sections hidden`;
  const byStart = new Map(opts.folds.map((f) => [f.start, f]));
  const out = [header];
  for (let i = 0; i < opts.raw.length; ) {
    const fold = byStart.get(i);
    const line = opts.raw[i];
    if (fold && line) {
      out.push(sectionMarker(fold.start + 1, fold.end + 1, line.indent));
      i = fold.end + 1;
    } else if (line) {
      out.push(line.text);
      i += 1;
    } else {
      i += 1;
    }
  }
  return { text: out.join("\n"), shown, sections };
}

export function renderMinified(filePath: string, raw: RawLine[], rev: string): string {
  const header =
    `[outline] ${filePath} | ${raw.length.toLocaleString("en-US")} lines | rev ${rev} | 0 shown, 1 sections hidden`;
  const marker = sectionMarker(1, Math.max(1, raw.length), 0);
  return `${header}\n[minified: use targeted_search to inspect this file]\n${marker}`;
}

export function renderHeadTail(filePath: string, raw: RawLine[], rev: string): { text: string; sections: { start: number; end: number }[] } {
  const head = raw.slice(0, 50);
  const tail = raw.slice(-50);
  const hiddenStart = 51;
  const hiddenEnd = raw.length - 50;
  const header =
    `[outline] ${filePath} | ${raw.length.toLocaleString("en-US")} lines | rev ${rev} | 100 shown, 1 sections hidden`;
  const marker = sectionMarker(hiddenStart, hiddenEnd, 0);
  const body = [...head.map((l) => l.text), marker, ...tail.map((l) => l.text)];
  return { text: [header, ...body].join("\n"), sections: [{ start: hiddenStart, end: hiddenEnd }] };
}
