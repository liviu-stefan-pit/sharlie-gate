import { createHash } from "node:crypto";
import { normalizePath, type CanonBlock, type CanonCall } from "../adapters/canonical.js";

export interface FileView {
  block: CanonBlock;
  path: string;
  start: number;
  end: number;
  hash: string;
  lines: number;
  turn: number;
}

export function fileViews(blocks: CanonBlock[], calls: CanonCall[]): FileView[] {
  const byId = new Map(calls.map((call) => [call.id, call]));
  const views: FileView[] = [];
  for (const block of blocks) {
    if (!block.isToolResult || block.protectedKind) continue;
    const call = block.toolUseId ? byId.get(block.toolUseId) : undefined;
    if (call && call.kind !== "read") continue;
    const path = call?.path || sniffPath(block.text);
    if (!path) continue;
    const lines = block.text.split(/\r?\n/);
    const range = sniffRange(block.text) ?? { start: 1, end: Math.max(1, lines.length) };
    views.push({
      block,
      path: normalizePath(path),
      start: range.start,
      end: range.end,
      hash: createHash("sha256").update(stripLineNumbers(block.text)).digest("hex"),
      lines: lines.length,
      turn: block.turn,
    });
  }
  return views;
}

function sniffPath(text: string): string | undefined {
  const match = /^(?:File|Path):\s+(\S+)/m.exec(text);
  return match?.[1];
}

function sniffRange(text: string): { start: number; end: number } | undefined {
  const match = /^(\d+)\|/.exec(text);
  if (!match?.[1]) return undefined;
  const nums = [...text.matchAll(/^(\d+)\|/gm)].map((m) => Number(m[1]));
  const start = nums[0];
  const end = nums[nums.length - 1];
  if (!start || !end) return undefined;
  return { start, end };
}

export function stripLineNumbers(text: string): string {
  return text.replace(/^\s*\d+\|/gm, "");
}

export function covers(later: FileView, older: FileView): boolean {
  return later.path === older.path && later.start <= older.start && later.end >= older.end;
}
