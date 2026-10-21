export interface BreakpointPlan {
  ttl: "5m" | "1h";
  slots: number;
}

export function chooseTtl(medianGapMs: number | undefined): "5m" | "1h" {
  if (medianGapMs !== undefined && medianGapMs > 4 * 60 * 1000) return "1h";
  return "5m";
}

/** GPT-5.6 and later route prompt cache themselves. A key only splits accounting. */
export function openAIRoutesCacheItself(model: string): boolean {
  return /gpt-5\.(?:[6-9]|[1-9]\d)|gpt-[6-9]/.test(model);
}

/** Up to four Anthropic cache breakpoints. Top-level automatic caching is left untouched. */
export function applyAnthropicBreakpoints(
  raw: Record<string, unknown>,
  ttl: "5m" | "1h",
  options: { markSystem?: boolean; markTools?: boolean } = {},
): number {
  if (raw.cache_control && typeof raw.cache_control === "object") return 0;
  const markSystem = options.markSystem !== false;
  const markTools = options.markTools !== false;
  const marker = { type: "ephemeral", ttl };
  let used = 0;
  const mark = (node: Record<string, unknown>) => {
    if (used >= 4) return;
    node.cache_control = marker;
    used += 1;
  };
  if (markSystem && Array.isArray(raw.system) && raw.system.length) {
    const last = raw.system[raw.system.length - 1];
    if (last && typeof last === "object") mark(last as Record<string, unknown>);
  }
  if (markTools && Array.isArray(raw.tools) && raw.tools.length) {
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

export function applyOpenAICacheKey(raw: Record<string, unknown>, conversationId: string, responses: boolean, isolateAccounting = false): void {
  const model = typeof raw.model === "string" ? raw.model : "";
  const modern = openAIRoutesCacheItself(model);
  const keepKey = typeof raw.prompt_cache_key === "string" && raw.prompt_cache_key.length > 0;
  if (!keepKey && (!modern || isolateAccounting)) raw.prompt_cache_key = conversationId;
  if (responses && modern) {
    const prev = typeof raw.prompt_cache_options === "object" && raw.prompt_cache_options ? raw.prompt_cache_options as Record<string, unknown> : {};
    raw.prompt_cache_options = { ...prev, ttl: typeof prev.ttl === "string" ? prev.ttl : "30m" };
  }
}
