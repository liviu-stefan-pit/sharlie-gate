export interface UsageTokens {
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
  /** Thinking tokens. Already inside output when the provider bills them there. Not a saving. */
  reasoning?: number;
}

export function usageProvider(provider: string | undefined): string {
  if (!provider) return "anthropic";
  if (provider.startsWith("openai")) return "openai";
  return provider;
}

export function extractUsage(payload: unknown, provider: "anthropic" | "openai" | "gemini" | "custom" | string): UsageTokens | undefined {
  const usage = findUsage(payload);
  if (!usage) return undefined;
  const kind = usageProvider(provider);
  if (kind === "gemini" || (kind !== "anthropic" && kind !== "openai" && isGeminiUsage(usage))) return geminiUsage(usage);
  if (kind === "openai") return openaiUsage(usage);
  return anthropicUsage(usage);
}

function findUsage(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const node = payload as Record<string, unknown>;
  if (node.usageMetadata && typeof node.usageMetadata === "object") return node.usageMetadata as Record<string, unknown>;
  if (node.usage_metadata && typeof node.usage_metadata === "object") return node.usage_metadata as Record<string, unknown>;
  if (isGeminiUsage(node) || typeof node.input_tokens === "number" || typeof node.prompt_tokens === "number" || node.input_tokens_details) return node;
  if (node.usage && typeof node.usage === "object") return node.usage as Record<string, unknown>;
  if (node.message && typeof node.message === "object") return findUsage(node.message);
  if (node.response && typeof node.response === "object") return findUsage(node.response);
  return undefined;
}

function isGeminiUsage(usage: Record<string, unknown>): boolean {
  return typeof usage.promptTokenCount === "number"
    || typeof usage.prompt_token_count === "number"
    || typeof usage.cachedContentTokenCount === "number"
    || typeof usage.cached_content_token_count === "number";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function anthropicUsage(usage: Record<string, unknown>): UsageTokens {
  const creation = usage.cache_creation && typeof usage.cache_creation === "object" ? usage.cache_creation as Record<string, unknown> : undefined;
  const w5 = creation ? num(creation.ephemeral_5m_input_tokens) : num(usage.cache_creation_input_tokens);
  const w1 = creation ? num(creation.ephemeral_1h_input_tokens) : 0;
  return {
    input: num(usage.input_tokens),
    cacheRead: num(usage.cache_read_input_tokens),
    cacheWrite5m: w5,
    cacheWrite1h: w1,
    output: num(usage.output_tokens),
    reasoning: num(usage.reasoning_tokens ?? usage.thinking_tokens),
  };
}

/** promptTokenCount includes cached tokens. Implicit cache has no write surcharge. */
function geminiUsage(usage: Record<string, unknown>): UsageTokens {
  const prompt = num(usage.promptTokenCount ?? usage.prompt_token_count);
  const cached = num(usage.cachedContentTokenCount ?? usage.cached_content_token_count);
  return {
    input: prompt >= cached ? prompt - cached : prompt,
    cacheRead: cached,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    output: num(usage.candidatesTokenCount ?? usage.candidates_token_count),
    reasoning: num(usage.thoughtsTokenCount ?? usage.thoughts_token_count),
  };
}

function openaiUsage(usage: Record<string, unknown>): UsageTokens {
  const details = (usage.input_tokens_details ?? usage.prompt_tokens_details) as Record<string, unknown> | undefined;
  const read = num(details?.cached_tokens);
  const write = num(details?.cache_write_tokens);
  const total = num(usage.input_tokens ?? usage.prompt_tokens);
  return {
    input: Math.max(0, total - read - write),
    cacheRead: read,
    cacheWrite5m: write,
    cacheWrite1h: 0,
    output: num(usage.output_tokens ?? usage.completion_tokens),
    reasoning: num(detailsOf(usage.output_tokens_details ?? usage.completion_tokens_details)?.reasoning_tokens),
  };
}

function detailsOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

export function sentTokens(usage: UsageTokens): number {
  return usage.input + usage.cacheRead + usage.cacheWrite5m + usage.cacheWrite1h;
}
