import { createHash } from "node:crypto";

export interface FrozenDecision {
  filterId: string;
  replacement: string;
  epoch: number;
}

export class DecisionTable {
  private readonly rows = new Map<string, FrozenDecision>();

  constructor(seed: [string, FrozenDecision][] = []) {
    for (const [key, value] of seed) this.rows.set(key, value);
  }

  key(conversationId: string, msgHash: string, blockIdx: number): string {
    return `${conversationId}|${msgHash}|${blockIdx}`;
  }

  get(key: string): FrozenDecision | undefined {
    return this.rows.get(key);
  }

  set(key: string, decision: FrozenDecision): void {
    this.rows.set(key, decision);
  }

  entries(): [string, FrozenDecision][] {
    return [...this.rows.entries()];
  }
}

export function conversationId(parts: { model: string; tools: unknown; system: string; firstUser: string }): string {
  const tools = Array.isArray(parts.tools)
    ? (parts.tools as { name?: string }[]).map((tool) => tool.name ?? "").join(",")
    : "";
  return createHash("sha256").update(`${parts.model}|${tools}|${stable(parts.system)}|${parts.firstUser}`).digest("hex").slice(0, 16);
}

export function stable(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?/g, "")
    .replace(/Today'?s date[^\n]*/gi, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "");
}

export interface EpochInput {
  gapMs: number;
  ttlMs: number;
  pendingTokens: number;
  prefixTokens: number;
  turnJustClosed: boolean;
  firstRequest: boolean;
}

export function epochOpen(input: EpochInput): boolean {
  if (input.firstRequest) return true;
  if (input.gapMs > input.ttlMs) return true;
  if (input.turnJustClosed) return true;
  const bar = Math.max(8000, input.prefixTokens * 0.25);
  return input.pendingTokens >= bar;
}
