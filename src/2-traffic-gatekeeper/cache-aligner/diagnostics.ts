export interface Diagnosis {
  present: boolean;
  reason?: string;
  missedTokens?: number;
}

export interface ProviderMeta {
  usage?: Record<string, unknown>;
  responseId?: string;
  diagnosis?: Diagnosis;
}

export interface CacheHold {
  system: boolean;
  tools: boolean;
  reason?: string;
}

/** A diagnosed match clears holds. A miss on tools or system stops edits in that region. */
export function holdsForDiagnosis(diagnosis: Diagnosis | undefined): CacheHold | undefined {
  if (!diagnosis?.present) return undefined;
  if (diagnosis.reason === "tools_changed") return { system: false, tools: true, reason: diagnosis.reason };
  if (diagnosis.reason === "system_changed") return { system: true, tools: false, reason: diagnosis.reason };
  return { system: false, tools: false };
}

export function readProviderMeta(payload: unknown): ProviderMeta {
  const found: ProviderMeta = {};
  walk(payload, 0, found);
  return found;
}

export function mergeMeta(into: ProviderMeta, next: ProviderMeta): void {
  if (next.usage) into.usage = into.usage ? { ...into.usage, ...next.usage } : next.usage;
  if (next.responseId && !into.responseId) into.responseId = next.responseId;
  if (next.diagnosis?.present) into.diagnosis = next.diagnosis;
}

function walk(node: unknown, depth: number, into: ProviderMeta): void {
  if (!node || typeof node !== "object" || depth > 4) return;
  const rec = node as Record<string, unknown>;
  if (!into.usage) {
    const usage = usageOf(rec);
    if (usage) into.usage = usage;
  }
  if (!into.responseId && typeof rec.id === "string" && /^(msg_|resp_)/.test(rec.id)) into.responseId = rec.id;
  if (!into.diagnosis?.present) {
    const diagnosis = diagnosisOf(rec);
    if (diagnosis) into.diagnosis = diagnosis;
  }
  for (const value of Object.values(rec)) {
    if (value && typeof value === "object") walk(value, depth + 1, into);
  }
}

function usageOf(rec: Record<string, unknown>): Record<string, unknown> | undefined {
  if (rec.usageMetadata && typeof rec.usageMetadata === "object") return rec.usageMetadata as Record<string, unknown>;
  if (rec.usage_metadata && typeof rec.usage_metadata === "object") return rec.usage_metadata as Record<string, unknown>;
  if (rec.usage && typeof rec.usage === "object") return rec.usage as Record<string, unknown>;
  if (typeof rec.input_tokens === "number" || typeof rec.prompt_tokens === "number" || typeof rec.promptTokenCount === "number") return rec;
  return undefined;
}

function diagnosisOf(rec: Record<string, unknown>): Diagnosis | undefined {
  if ("diagnostics" in rec) {
    if (rec.diagnostics === null) return { present: true };
    if (rec.diagnostics && typeof rec.diagnostics === "object") {
      const diag = rec.diagnostics as Record<string, unknown>;
      const reason = diag.cache_miss_reason;
      if (reason && typeof reason === "object") {
        const node = reason as Record<string, unknown>;
        return {
          present: true,
          reason: typeof node.type === "string" ? node.type : undefined,
          missedTokens: typeof node.cache_missed_input_tokens === "number" ? node.cache_missed_input_tokens : undefined,
        };
      }
      if (typeof reason === "string") return { present: true, reason };
      return { present: true };
    }
  }
  if (rec.prompt_cache_diagnostics && typeof rec.prompt_cache_diagnostics === "object") {
    const diag = rec.prompt_cache_diagnostics as Record<string, unknown>;
    if (diag.type === "cache_hit") return { present: true };
    return {
      present: true,
      reason: typeof diag.reason === "string" ? diag.reason : undefined,
      missedTokens: typeof diag.cache_missed_tokens === "number" ? diag.cache_missed_tokens : undefined,
    };
  }
  return undefined;
}
