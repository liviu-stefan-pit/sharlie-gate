export interface BreakpointPlan {
  ttl: "5m" | "1h";
  slots: number;
}

export function chooseTtl(medianGapMs: number | undefined): "5m" | "1h" {
  if (medianGapMs !== undefined && medianGapMs > 4 * 60 * 1000) return "1h";
  return "5m";
}

/** Up to four Anthropic cache breakpoints. Top-level automatic caching is left untouched. */
export function applyAnthropicBreakpoints(raw: Record<string, unknown>, ttl: "5m" | "1h"): number {
  if (raw.cache_control && typeof raw.cache_control === "object") return 0;
  const marker = { type: "ephemeral", ttl };
  let used = 0;
  const mark = (node: Record<string, unknown>) => {
    if (used >= 4) return;
    node.cache_control = marker;
    used += 1;
  };
  if (Array.isArray(raw.system) && raw.system.length) {
    const last = raw.system[raw.system.length - 1];
    if (last && typeof last === "object") mark(last as Record<string, unknown>);
  }
  if (Array.isArray(raw.tools) && raw.tools.length) {
    const last = raw.tools[raw.tools.length - 1];
    if (last && typeof last === "object") mark(last as Record<string, unknown>);
  }
  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  if (messages.length >= 2) {
    const history = messages[messages.length - 2];
    if (history && typeof history === "object") mark(history as Record<string, unknown>);
  }
  if (messages.length) {
    const last = messages[messages.length - 1];
    if (last && typeof last === "object") mark(last as Record<string, unknown>);
  }
  return used;
}

export function applyOpenAICacheKey(raw: Record<string, unknown>, conversationId: string, responses: boolean): void {
  if (typeof raw.prompt_cache_key === "string" && raw.prompt_cache_key.length) return;
  raw.prompt_cache_key = conversationId;
  if (responses && typeof raw.model === "string" && /gpt-5\.6|gpt-5\.7|gpt-6/.test(raw.model)) {
    raw.prompt_cache_options = { ...(typeof raw.prompt_cache_options === "object" && raw.prompt_cache_options ? raw.prompt_cache_options as object : {}), ttl: "30m" };
  }
}
