import { createHash } from "node:crypto";
import type { CanonBlock } from "../adapters/canonical.js";

export function prefixHash(blocks: CanonBlock[], currentTurn: number): string {
  const parts = blocks
    .filter((block) => !block.current && block.turn < currentTurn && !block.protectedKind)
    .map((block) => `${block.role}:${block.text}`);
  return createHash("sha256").update(parts.join("\n---\n")).digest("hex");
}

export function firstDrift(previous: string, next: string): number {
  const limit = Math.min(previous.length, next.length);
  for (let i = 0; i < limit; i++) if (previous[i] !== next[i]) return i;
  return previous.length === next.length ? -1 : limit;
}
