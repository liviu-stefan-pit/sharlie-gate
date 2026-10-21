import { createHash } from "node:crypto";
import { classifyTool, argValue } from "../history-cleaner/tool-registry.js";

export interface CanonCall {
  id: string;
  name: string;
  kind: "read" | "edit" | "shell" | "other";
  args: Record<string, unknown>;
  path?: string;
  command?: string;
  turn: number;
  current: boolean;
}

export interface CanonBlock {
  role: "system" | "user" | "assistant" | "tool";
  text: string;
  protectedKind?: "thinking" | "image" | "tool_use";
  toolUseId?: string;
  toolName?: string;
  isToolResult?: boolean;
  turn: number;
  current: boolean;
  msgHash: string;
  blockIdx: number;
  setText: (next: string) => void;
}

export interface CanonRequest {
  provider: "anthropic" | "openai-chat" | "openai-responses" | "gemini" | "other";
  model: string;
  raw: Record<string, unknown>;
  blocks: CanonBlock[];
  calls: CanonCall[];
  currentTurn: number;
  changed: boolean;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function assignTurns<T extends { human: boolean }>(items: T[]): { turn: number; current: number }[] {
  let turn = 0;
  const out: { turn: number; current: number }[] = [];
  for (const item of items) {
    if (item.human) turn += 1;
    out.push({ turn, current: 0 });
  }
  const current = turn;
  return out.map((row) => ({ turn: row.turn, current }));
}

export function callFrom(name: string, args: Record<string, unknown>, id: string, turn: number, current: number): CanonCall {
  const spec = classifyTool(name);
  return {
    id,
    name,
    kind: spec.kind,
    args,
    path: spec.kind === "edit" || spec.kind === "read" ? normalizePath(argValue(args, spec.pathArgs ?? []) ?? "") : undefined,
    command: spec.kind === "shell" ? argValue(args, spec.commandArgs ?? []) : undefined,
    turn,
    current: turn >= current,
  };
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d: string) => `${d.toLowerCase()}:`);
}

export function editPaths(calls: CanonCall[], currentTurn: number): Set<string> {
  const paths = calls
    .filter((call) => call.kind === "edit" && call.path && call.turn >= currentTurn - 1)
    .map((call) => call.path as string);
  return new Set(paths);
}
