import { ContentStore } from "../../core/content-store.js";
import { loadConfig, type SharlieConfig } from "../../core/config.js";
import { detectWire, toCanon } from "../adapters/detect.js";
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
}

export function createTransformState(store?: { put(text: string): string }): TransformState {
  return {
    store: store ?? new MemoryStore(),
    decisions: new DecisionTable(),
    learned: new Set(),
    lastSystem: new Map(),
    lastPrefix: new Map(),
    lastSeen: new Map(),
    bypass: false,
    filtersEnabled: true,
  };
}

export function transformBody(rawBody: Buffer, pathname: string, state: TransformState, cfg?: SharlieConfig): TransformOutcome {
  const config = cfg ?? loadConfig({});
  if (state.bypass || !state.filtersEnabled) return { body: rawBody, notes: [] };
  const started = Date.now();
  try {
    if (state.throwOnce) {
      state.throwOnce = false;
      throw new Error("injected filter failure");
    }
    const parsed = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    const kind = detectWire(pathname, parsed);
    const canon = toCanon(kind, parsed);
    if (!canon) return { body: rawBody, notes: [] };
    const system = canon.blocks.filter((b) => b.role === "system").map((b) => b.text).join("\n");
    const firstUser = canon.blocks.find((b) => b.role === "user" && !b.isToolResult)?.text ?? "";
    const id = conversationId({ model: canon.model, tools: parsed.tools, system, firstUser });
    const previous = state.lastSystem.get(id);
    if (previous) for (const sig of learnSignatures(previous, system)) state.learned.add(sig);
    const gap = Date.now() - (state.lastSeen.get(id) ?? Date.now());
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
    });
    if (Date.now() - started > config.pipelineBudgetMs) {
      return { body: rawBody, bypassReason: "pipeline-budget", notes: [], conversationId: id, model: canon.model };
    }
    state.lastSystem.set(id, canon.blocks.filter((b) => b.role === "system").map((b) => b.text).join("\n"));
    state.lastSeen.set(id, Date.now());
    const prior = state.lastPrefix.get(id);
    const drift = prior !== undefined && prior !== result.prefixHash;
    state.lastPrefix.set(id, result.prefixHash);
    if (!result.changed) return { body: rawBody, notes: result.notes, conversationId: id, prefixHash: result.prefixHash, prefixDrift: drift, model: canon.model, provider: canon.provider };
    return {
      body: Buffer.from(JSON.stringify(parsed)),
      notes: result.notes,
      conversationId: id,
      prefixHash: result.prefixHash,
      prefixDrift: drift,
      model: canon.model,
      provider: canon.provider,
    };
  } catch (error) {
    return { body: rawBody, bypassReason: error instanceof Error ? error.message : "transform-failed", notes: [] };
  }
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
