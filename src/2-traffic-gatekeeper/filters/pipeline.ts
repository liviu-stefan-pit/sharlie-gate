import { reviewEdit, type GuardrailRules } from "../../3-safety-rules-and-config/protection-rules/guardrail-gate.js";
import { editPaths, type CanonBlock, type CanonRequest } from "../adapters/canonical.js";
import { DecisionTable } from "../conversation-state/frozen-decisions.js";
import { covers, fileViews } from "../history-cleaner/file-views.js";
import { commandClass, errorSignatures, isFailure, isSuccess } from "../history-cleaner/error-signals.js";
import { mostlySeenLater } from "../history-cleaner/winnow.js";
import { outlineText } from "../../1-editor-helper-tools/outline-builder/engine.js";
import { relocateDynamics } from "../cache-aligner/relocate.js";
import { applyAnthropicBreakpoints, applyOpenAICacheKey, chooseTtl } from "../cache-aligner/breakpoints.js";
import { prefixHash } from "../cache-aligner/prefix-verify.js";
import { estimateTokens } from "../../core/tokens.js";

export interface ReceiptNote {
  filterId: string;
  label: string;
  tokens: number;
  ref?: string;
}

export interface PipelineInput {
  store: { put(text: string): string };
  decisions: DecisionTable;
  conversationId: string;
  epoch: number;
  epochOpen: boolean;
  minLinesToFold?: number;
  learned?: Set<string>;
  medianGapMs?: number;
  enabled?: Partial<Record<string, boolean>>;
}

export interface PipelineResult {
  changed: boolean;
  notes: ReceiptNote[];
  prefixHash: string;
  rejected: string[];
}

export function runFilters(canon: CanonRequest, input: PipelineInput): PipelineResult {
  const notes: ReceiptNote[] = [];
  const rejected: string[] = [];
  const rules: GuardrailRules = { minLinesToFold: input.minLinesToFold ?? 150, currentTurn: canon.currentTurn };
  const enabled = {
    duplicateFileRemover: true,
    backgroundFileFolder: true,
    resolvedErrorLogCleaner: true,
    noisyTerminalTrimmer: true,
    cachePrefixStabilizer: true,
    ...input.enabled,
  };
  const ctx = { ...input, rules, notes, rejected, canon };
  if (enabled.duplicateFileRemover) duplicateFileRemover(ctx);
  if (enabled.backgroundFileFolder) backgroundFolder(ctx);
  if (enabled.resolvedErrorLogCleaner) resolvedErrors(ctx);
  if (enabled.noisyTerminalTrimmer) trimNoisy(ctx);
  if (enabled.cachePrefixStabilizer) stabilize(ctx);
  return { changed: canon.changed, notes, prefixHash: prefixHash(canon.blocks, canon.currentTurn), rejected };
}

interface Ctx extends PipelineInput {
  rules: GuardrailRules;
  notes: ReceiptNote[];
  rejected: string[];
  canon: CanonRequest;
}

function commit(ctx: Ctx, block: CanonBlock, replacement: string, filterId: string, label: string, lineCount: number, kind: "file-view" | "shell" | "other", isEditTargetLatest = false): boolean {
  const key = ctx.decisions.key(ctx.conversationId, block.msgHash, block.blockIdx);
  const frozen = ctx.decisions.get(key);
  if (frozen) {
    if (block.text !== frozen.replacement) {
      block.setText(frozen.replacement);
      block.text = frozen.replacement;
      ctx.canon.changed = true;
    }
    return true;
  }
  if (!ctx.epochOpen) return false;
  const before = estimateTokens(block.text);
  const ref = ctx.store.put(block.text);
  const stamped = replacement.includes("sg:") ? replacement : replacement.includes("ref PLACE") ? replacement.replaceAll("ref PLACE", `ref ${ref}`) : `${replacement}\n| ref ${ref}`;
  const gate = reviewEdit(
    { turnIndex: block.turn, lineCount, kind, isEditTargetLatest, replacement: stamped, original: block.text },
    ctx.rules,
  );
  if (!gate.allow) {
    ctx.rejected.push(gate.rule ?? "rejected");
    return false;
  }
  block.setText(stamped);
  block.text = stamped;
  ctx.canon.changed = true;
  ctx.decisions.set(key, { filterId, replacement: stamped, epoch: ctx.epoch });
  ctx.notes.push({ filterId, label, tokens: Math.max(0, before - estimateTokens(stamped)), ref });
  return true;
}

function duplicateFileRemover(ctx: Ctx): void {
  const views = fileViews(ctx.canon.blocks, ctx.canon.calls);
  const edits = editPaths(ctx.canon.calls, ctx.canon.currentTurn);
  const latest = new Map<string, number>();
  for (const view of views) latest.set(view.path, Math.max(latest.get(view.path) ?? 0, view.turn));
  for (const older of views) {
    const newer = views.find((view) => view !== older && view.turn > older.turn && (covers(view, older) || view.hash === older.hash));
    if (!newer) continue;
    const marker = `[Duplicate file view removed — see latest copy in Turn ${newer.turn} | ref PLACE]`;
    commit(
      ctx,
      older.block,
      marker,
      "duplicate-file-remover",
      `Duplicate file removed (from Turn #${older.turn})`,
      older.lines,
      "file-view",
      edits.has(older.path) && older.turn === latest.get(older.path),
    );
  }
  const texts = ctx.canon.blocks.filter((b) => b.isToolResult).map((b) => b.text);
  ctx.canon.blocks.forEach((block, index) => {
    if (!block.isToolResult || block.protectedKind || block.turn >= ctx.canon.currentTurn) return;
    if (mostlySeenLater(block.text, texts.slice(index + 1))) {
      commit(ctx, block, `[Duplicate file view removed — see latest copy in a later turn | ref PLACE]`, "duplicate-file-remover", "Duplicate block removed", block.text.split(/\r?\n/).length, "other");
    }
  });
}

function backgroundFolder(ctx: Ctx): void {
  const edits = editPaths(ctx.canon.calls, ctx.canon.currentTurn);
  for (const view of fileViews(ctx.canon.blocks, ctx.canon.calls)) {
    if (view.turn > ctx.canon.currentTurn - 2) continue;
    if (view.lines < ctx.rules.minLinesToFold) continue;
    if (edits.has(view.path)) continue;
    if (view.block.text.includes("[Section hidden:") || view.block.text.includes("[Duplicate file view")) continue;
    const outlined = outlineText(view.block.text, view.path, { minLinesToFold: ctx.rules.minLinesToFold });
    if (outlined.mode === "full") continue;
    const saved = 1 - outlined.text.length / Math.max(1, view.block.text.length);
    if (saved < 0.3) continue;
    commit(ctx, view.block, outlined.text, "background-file-folder", `Background file folded (${view.path})`, view.lines, "file-view");
  }
}

function resolvedErrors(ctx: Ctx): void {
  const shells = ctx.canon.blocks.filter((block) => block.isToolResult && shellCall(ctx, block));
  for (const block of shells) {
    const call = shellCall(ctx, block);
    if (!call || block.turn >= ctx.canon.currentTurn) continue;
    const lines = block.text.split(/\r?\n/);
    if (lines.length < 40 || !isFailure(block.text)) continue;
    const cls = commandClass(call.command);
    const later = ctx.canon.calls.find((other) => other.kind === "shell" && other.turn > block.turn && commandClass(other.command) === cls);
    const laterBlock = later ? shells.find((b) => b.toolUseId === later.id) : undefined;
    if (!later || !laterBlock || !isSuccess(laterBlock.text)) continue;
    const kept = [call.command ?? cls, ...errorSignatures(block.text)].filter(Boolean).join("\n");
    const marker = `${kept}\n[Resolved error log hidden — ${lines.length.toLocaleString("en-US")} lines omitted. Outcome: Resolved in Turn ${later.turn} | ref PLACE]`;
    commit(ctx, block, marker, "resolved-error-log-cleaner", "Old resolved terminal log collapsed", lines.length, "shell");
  }
}

function trimNoisy(ctx: Ctx): void {
  for (const block of ctx.canon.blocks) {
    if (!block.isToolResult || !shellCall(ctx, block)) continue;
    if (block.turn >= ctx.canon.currentTurn - 1) continue;
    const lines = block.text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "").split(/\r?\n/);
    if (lines.length <= 200) continue;
    const collapsed = collapse(lines);
    const errors = collapsed.filter((line) => /error|warn|failed|exception/i.test(line));
    const body = [...collapsed.slice(0, 30), ...errors, "...", ...collapsed.slice(-50)];
    commit(ctx, block, body.join("\n"), "noisy-terminal-trimmer", "Noisy terminal output trimmed", lines.length, "shell");
  }
}

function stabilize(ctx: Ctx): void {
  const moved = relocateDynamics(ctx.canon.blocks, ctx.learned);
  if (moved.length) ctx.canon.changed = true;
  if (ctx.canon.provider === "anthropic") {
    applyAnthropicBreakpoints(ctx.canon.raw, chooseTtl(ctx.medianGapMs));
    ctx.canon.changed = true;
  }
  if (ctx.canon.provider === "openai-chat" || ctx.canon.provider === "openai-responses") {
    applyOpenAICacheKey(ctx.canon.raw, ctx.conversationId, ctx.canon.provider === "openai-responses");
    ctx.canon.changed = true;
  }
}

function shellCall(ctx: Ctx, block: CanonBlock) {
  return ctx.canon.calls.find((call) => call.id === block.toolUseId && call.kind === "shell");
}

function collapse(lines: string[]): string[] {
  const out: string[] = [];
  let prev = "";
  let norm = "";
  let count = 0;
  const flush = () => {
    if (count > 1) out.push(`${prev} (x${count})`);
    else if (count === 1) out.push(prev);
  };
  for (const line of lines) {
    const next = line.replace(/\d+/g, "#");
    if (count > 0 && next === norm) count += 1;
    else {
      flush();
      prev = line;
      norm = next;
      count = 1;
    }
  }
  flush();
  return out;
}
