import { extractVolatile } from "./volatile-detect.js";
import type { CanonBlock } from "../adapters/canonical.js";

export const DYNAMIC_OPEN = "<sharlie-gate:dynamic-context>";
export const DYNAMIC_CLOSE = "</sharlie-gate:dynamic-context>";

export function relocateDynamics(blocks: CanonBlock[], learned?: Set<string>): string[] {
  const moved: string[] = [];
  for (const block of blocks) {
    if (block.role !== "system" || block.protectedKind) continue;
    const { stable, dynamic } = extractVolatile(block.text, learned);
    if (!dynamic.length) continue;
    moved.push(...dynamic);
    block.setText(stable);
    block.text = stable;
  }
  if (!moved.length) return moved;
  const target = [...blocks].reverse().find((block) => block.current && block.role === "user" && !block.isToolResult && !block.protectedKind);
  if (!target) return moved;
  if (target.text.includes(DYNAMIC_OPEN)) return moved;
  const addition = `\n${DYNAMIC_OPEN}\n${moved.join("\n")}\n${DYNAMIC_CLOSE}`;
  const next = `${target.text}${addition}`;
  target.setText(next);
  target.text = next;
  return moved;
}
