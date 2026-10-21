import { holdsForDiagnosis, type Diagnosis } from "../../2-traffic-gatekeeper/cache-aligner/diagnostics.js";
import type { TransformOutcome, TransformState } from "../../2-traffic-gatekeeper/tunnel-connector/transform.js";
import { loadConfig } from "../../core/config.js";
import { account } from "./accountant.js";
import { clientNativeCachePico } from "./baseline-simulator.js";
import { calibratedTokens, sampleProviderCount, shouldSample, type CountAuth } from "./count-sample.js";
import { Ledger } from "./db.js";
import { costPico } from "./money.js";
import { priceFor } from "./pricing.js";
import { extractUsage, sentTokens, usageProvider, type UsageTokens } from "./usage-extract.js";

export interface ProxyCompletion {
  outcome: TransformOutcome;
  usage?: Record<string, unknown>;
  status: number;
  requestId?: string;
  preImage?: Buffer;
  countUrl?: string;
  auth?: CountAuth;
  responseId?: string;
  diagnosis?: Diagnosis;
  startedAt?: number;
}

const EMPTY_USAGE: UsageTokens = { input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, reasoning: 0 };

export async function recordProxyCompletion(
  ledger: Ledger,
  state: TransformState,
  info: ProxyCompletion,
  options: { sampleRate?: number; fetchImpl?: typeof fetch } = {},
): Promise<number | undefined> {
  const outcome = info.outcome;
  if (!outcome.model && !outcome.conversationId && outcome.notes.length === 0) return undefined;
  const provider = usageProvider(outcome.provider);
  const usage = info.usage ? extractUsage(info.usage, provider) : undefined;
  const byteTokens = outcome.rawByteTokens ?? 0;
  const price = outcome.model ? priceFor(provider, outcome.model) : undefined;
  const providerCount = await maybeCount(info, provider, byteTokens, options);
  const method = chooseMethod(ledger, provider, { providerCount, usage, byteTokens, modified: outcome.modified === true });
  const rawTokens = method.raw;
  if (method.calibrate && byteTokens > 0) ledger.noteCalibration(provider, rawTokens, byteTokens);
  const native = price
    ? clientNativeCachePico({
      prefixTokens: outcome.prefixTokens ?? 0,
      withinTtl: outcome.withinTtl === true,
      clientCaches: outcome.clientCaches === true,
      price,
    })
    : { readTokens: 0, pico: 0n };
  const priced = Boolean(price && usage && method.name === "provider-count");
  const result = account({
    rawTokens,
    clientNativePico: native.pico,
    clientCacheRead: native.readTokens,
    usage: usage ?? EMPTY_USAGE,
    price,
    verified: priced,
  });
  const displayNet = usage && price ? result.displayNet : 0n;
  const now = Date.now();
  const id = ledger.insertRequest({
    conversation_id: outcome.conversationId ?? null,
    source: "proxy",
    provider,
    model: outcome.model ?? null,
    provider_request_id: info.requestId ?? null,
    http_status: info.status,
    ts_start: info.startedAt ?? now,
    ts_end: now,
    raw_tokens: rawTokens,
    raw_tokens_method: method.name,
    zoom_in_tokens: 0,
    usage_input: usage?.input ?? null,
    usage_cache_read: usage?.cacheRead ?? null,
    usage_cache_write_5m: usage?.cacheWrite5m ?? null,
    usage_cache_write_1h: usage?.cacheWrite1h ?? null,
    usage_output: usage?.output ?? null,
    usage_reasoning: usage?.reasoning ?? null,
    baseline_cache_read: native.readTokens,
    price_snapshot_id: price ? ledger.ensurePrice(price) : null,
    baseline_nocache_pico: result.baselineNocache,
    baseline_pico: result.baseline,
    actual_in_pico: result.actualIn,
    actual_out_pico: result.actualOut,
    zoom_extra_pico: result.D,
    net_saved_pico: usage && price ? result.net : 0n,
    display_net_pico: displayNet,
    cache_credit_pico: usage && price ? result.B - result.C : 0n,
    counterfactual: outcome.clientCaches ? "client-caches" : "client-does-not-cache",
    verified: priced ? 1 : 0,
    prefix_hash: outcome.prefixHash ?? null,
    prefix_drift: outcome.prefixDrift ? 1 : 0,
    bypass_reason: outcome.bypassReason ?? null,
  });
  outcome.notes.forEach((note, seq) => {
    const pico = price ? costPico(note.tokens, price.inputE6) : 0n;
    ledger.insertReceiptLine(id, seq, note.label, note.tokens, pico, note.filterId);
  });
  let seq = outcome.notes.length;
  if (outcome.holdReason) {
    ledger.insertReceiptLine(id, seq, `Held edits after cache miss: ${outcome.holdReason}`, 0, 0n, "cache-prefix-stabilizer");
    seq += 1;
  }
  if (info.diagnosis?.reason) {
    ledger.insertReceiptLine(id, seq, `Cache miss: ${info.diagnosis.reason}`, info.diagnosis.missedTokens ?? 0, 0n, "cache-diagnostics");
  }
  rememberCache(ledger, state, outcome, info);
  return id;
}

function chooseMethod(ledger: Ledger, provider: string, input: {
  providerCount?: number;
  usage?: UsageTokens;
  byteTokens: number;
  modified: boolean;
}): { name: "provider-count" | "calibrated" | "bytes/4"; raw: number; calibrate: boolean } {
  if (input.providerCount !== undefined) {
    return { name: "provider-count", raw: input.providerCount, calibrate: true };
  }
  if (!input.modified && input.usage) {
    return { name: "provider-count", raw: sentTokens(input.usage), calibrate: input.byteTokens > 0 };
  }
  const factor = ledger.calibration(provider);
  if (factor && input.byteTokens > 0) {
    return { name: "calibrated", raw: calibratedTokens(input.byteTokens, factor.ratioE6), calibrate: false };
  }
  return { name: "bytes/4", raw: input.byteTokens, calibrate: false };
}

async function maybeCount(
  info: ProxyCompletion,
  provider: string,
  byteTokens: number,
  options: { sampleRate?: number; fetchImpl?: typeof fetch },
): Promise<number | undefined> {
  if (!info.outcome.modified || !info.countUrl || !info.preImage || byteTokens <= 0) return undefined;
  const cfg = loadConfig({});
  const fromEnv = process.env.SHARLIE_GATE_COUNT_SAMPLE;
  const rate = options.sampleRate ?? (fromEnv !== undefined ? Number(fromEnv) : (cfg.exactRawCount ? cfg.countSampleRate : 0));
  const seed = `${info.outcome.conversationId ?? ""}:${info.requestId ?? info.outcome.prefixHash ?? ""}:${info.startedAt ?? 0}`;
  if (!shouldSample(seed, rate)) return undefined;
  return sampleProviderCount({
    url: info.countUrl,
    preImage: info.preImage.toString("utf8"),
    provider,
    auth: info.auth,
    fetchImpl: options.fetchImpl,
  });
}

function rememberCache(ledger: Ledger, state: TransformState, outcome: TransformOutcome, info: ProxyCompletion): void {
  const id = outcome.conversationId;
  if (!id) return;
  if (info.responseId) state.previousResponseId.set(id, info.responseId);
  const holds = holdsForDiagnosis(info.diagnosis);
  if (holds) {
    if (holds.system || holds.tools) state.holds.set(id, holds);
    else state.holds.delete(id);
  }
  const current = state.holds.get(id);
  if (info.responseId || holds) {
    ledger.saveConversationCache({
      conversationId: id,
      previousResponseId: info.responseId,
      missReason: holds ? (holds.reason ?? null) : current?.reason,
      holdSystem: current?.system === true,
      holdTools: current?.tools === true,
      prefixHash: outcome.prefixHash,
    });
  }
}
