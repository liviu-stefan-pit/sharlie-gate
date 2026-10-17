export interface UsageTokens {
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
}

export function extractUsage(payload: unknown, provider: "anthropic" | "openai" | "custom" | string): UsageTokens | undefined {
  const usage = findUsage(payload);
  if (!usage) return undefined;
  if (provider === "openai") return openaiUsage(usage);
  return anthropicUsage(usage);
}

function findUsage(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const node = payload as Record<string, unknown>;
  if (typeof node.input_tokens === "number" || typeof node.prompt_tokens === "number" || node.input_tokens_details) return node;
  if (node.usage && typeof node.usage === "object") return node.usage as Record<string, unknown>;
  if (node.message && typeof node.message === "object") return findUsage(node.message);
  if (node.response && typeof node.response === "object") return findUsage(node.response);
  return undefined;
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
  };
}

export function sentTokens(usage: UsageTokens): number {
  return usage.input + usage.cacheRead + usage.cacheWrite5m + usage.cacheWrite1h;
}
