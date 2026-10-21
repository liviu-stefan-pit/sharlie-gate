import { ContentStore } from "../../core/content-store.js";
import { loadConfig, type SharlieConfig } from "../../core/config.js";
import { estimateTokens } from "../../core/tokens.js";
import { clientAlreadyCaches, detectWire, toCanon } from "../adapters/detect.js";
import { openAIRoutesCacheItself } from "../cache-aligner/breakpoints.js";
import type { CacheHold } from "../cache-aligner/diagnostics.js";
import { conversationId, DecisionTable } from "../conversation-state/frozen-decisions.js";
import { runFilters } from "../filters/pipeline.js";
import { learnSignatures } from "../cache-aligner/volatile-detect.js";

export interface TransformState {
  store: { put(text: string): string };
  decisions: DecisionTable;
  learned: Set<string>;
  lastSystem: Map<string, string>;
  lastPrefix: Map<string, string>;
  lastSeen: Map<string, number>;
  holds: Map<string, CacheHold>;
  previousResponseId: Map<string, string>;
  bypass: boolean;
  filtersEnabled: boolean;
  throwOnce?: boolean;
}

export interface TransformOutcome {
  body: Buffer;
  bypassReason?: string;
  conversationId?: string;
  prefixHash?: string;
  prefixDrift?: boolean;
  notes: { filterId: string; label: string; tokens: number; ref?: string }[];
  model?: string;
  provider?: string;
  rawByteTokens: number;
  prefixTokens: number;
  clientCaches: boolean;
  withinTtl: boolean;
  modified: boolean;
  holdReason?: string;
}

export function createTransformState(store?: { put(text: string): string }): TransformState {
  return {
    store: store ?? new MemoryStore(),
    decisions: new DecisionTable(),
    learned: new Set(),
    lastSystem: new Map(),
    lastPrefix: new Map(),
    lastSeen: new Map(),
    holds: new Map(),
    previousResponseId: new Map(),
    bypass: false,
    filtersEnabled: true,
  };
}

export function transformBody(rawBody: Buffer, pathname: string, state: TransformState, cfg?: SharlieConfig): TransformOutcome {
  const config = cfg ?? loadConfig({});
  const rawByteTokens = estimateTokens(rawBody.toString("utf8"));
  if (state.bypass || !state.filtersEnabled) return untouched(rawBody, { rawByteTokens });
  const started = Date.now();
  try {
    if (state.throwOnce) {
      state.throwOnce = false;
      throw new Error("injected filter failure");
    }
    const originalText = rawBody.toString("utf8");
    const parsed = JSON.parse(originalText) as Record<string, unknown>;
    const kind = detectWire(pathname, parsed);
    const canon = toCanon(kind, parsed, pathname);
    if (!canon) return untouched(rawBody, { rawByteTokens });
    const system = canon.blocks.filter((b) => b.role === "system").map((b) => b.text).join("\n");
    const firstUser = canon.blocks.find((b) => b.role === "user" && !b.isToolResult)?.text ?? "";
    const id = conversationId({ model: canon.model, tools: parsed.tools, system, firstUser });
    const previous = state.lastSystem.get(id);
    if (previous) for (const sig of learnSignatures(previous, system)) state.learned.add(sig);
    const seenAt = state.lastSeen.get(id);
    const withinTtl = seenAt !== undefined && Date.now() - seenAt < 5 * 60 * 1000;
    const gap = seenAt === undefined ? 0 : Date.now() - seenAt;
    const prefixTokens = estimateTokens(
      canon.blocks.filter((block) => !block.current && block.turn < canon.currentTurn).map((block) => block.text).join("\n"),
    );
    const hold = state.holds.get(id);
    const result = runFilters(canon, {
      store: state.store,
      decisions: state.decisions,
      conversationId: id,
      epoch: 1,
      epochOpen: true,
      minLinesToFold: config.minLinesToFold,
      learned: state.learned,
      medianGapMs: gap,
      enabled: config.filters,
      holds: hold,
      isolateCacheAccounting: config.isolateCacheAccounting,
    });
    if (Date.now() - started > config.pipelineBudgetMs) {
      return untouched(rawBody, { rawByteTokens, bypassReason: "pipeline-budget", conversationId: id, model: canon.model, provider: canon.provider });
    }
    const diagnosed = attachDiagnostics(parsed, canon.provider, canon.model, state.previousResponseId.get(id));
    state.lastSystem.set(id, canon.blocks.filter((b) => b.role === "system").map((b) => b.text).join("\n"));
    state.lastSeen.set(id, Date.now());
    const prior = state.lastPrefix.get(id);
    const drift = prior !== undefined && prior !== result.prefixHash;
    state.lastPrefix.set(id, result.prefixHash);
    const shared = {
      notes: result.notes,
      conversationId: id,
      prefixHash: result.prefixHash,
      prefixDrift: drift,
      model: canon.model,
      provider: canon.provider,
      rawByteTokens,
      prefixTokens,
      clientCaches: clientAlreadyCaches(originalText),
      withinTtl,
      modified: result.changed,
      holdReason: hold?.reason,
    };
    if (!result.changed && !diagnosed) return { body: rawBody, ...shared };
    return { body: Buffer.from(JSON.stringify(parsed)), ...shared };
  } catch (error) {
    return untouched(rawBody, { rawByteTokens, bypassReason: error instanceof Error ? error.message : "transform-failed" });
  }
}

function attachDiagnostics(raw: Record<string, unknown>, provider: string, model: string, previous: string | undefined): boolean {
  if (provider === "anthropic") {
    const existing = raw.diagnostics;
    if (existing && typeof existing === "object" && "previous_message_id" in (existing as Record<string, unknown>)) return false;
    raw.diagnostics = { previous_message_id: previous ?? null };
    return true;
  }
  if ((provider === "openai-chat" || provider === "openai-responses") && previous && openAIRoutesCacheItself(model)) {
    const prev = typeof raw.prompt_cache_options === "object" && raw.prompt_cache_options ? raw.prompt_cache_options as Record<string, unknown> : {};
    if (typeof prev.comparison_response_id === "string" && prev.comparison_response_id) return false;
    raw.prompt_cache_options = { ...prev, comparison_response_id: previous };
    return true;
  }
  return false;
}

function untouched(body: Buffer, extra: Partial<TransformOutcome> = {}): TransformOutcome {
  return {
    body,
    notes: [],
    rawByteTokens: 0,
    prefixTokens: 0,
    clientCaches: false,
    withinTtl: false,
    modified: false,
    ...extra,
  };
}

class MemoryStore {
  private n = 0;
  put(): string {
    this.n += 1;
    return `sg:${this.n.toString(16).padStart(8, "0")}`;
  }
}

export function openContentStore(file: string): ContentStore {
  return ContentStore.open(file);
}
