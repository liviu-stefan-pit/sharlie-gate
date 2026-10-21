export interface CountAuth {
  apiKey?: string;
  authorization?: string;
  googApiKey?: string;
  anthropicVersion?: string;
}

export function isCountEndpoint(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return path.endsWith("/count_tokens") || path.endsWith(":countTokens");
}

/** Official count URL for the pre-image. Never the generation URL. */
export function countUrlFor(provider: string, upstreamUrl: string): string | undefined {
  try {
    if (provider === "anthropic") return `${new URL(upstreamUrl).origin}/v1/messages/count_tokens`;
    if (provider === "gemini") {
      const path = upstreamUrl.split("?")[0] ?? upstreamUrl;
      if (!/:(?:stream)?generateContent$/.test(path)) return undefined;
      return path.replace(/:(?:stream)?generateContent$/, ":countTokens");
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function shouldSample(seed: string, rate: number): boolean {
  if (!(rate > 0)) return false;
  if (rate >= 1) return true;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296 < rate;
}

export function calibratedTokens(byteTokens: number, ratioE6: number): number {
  if (byteTokens <= 0 || ratioE6 <= 0) return 0;
  return Math.max(0, Math.round((byteTokens * ratioE6) / 1_000_000));
}

/**
 * Ask the provider to count the pre-image. Refuses any URL that is not a count endpoint,
 * so the unpruned body is never sent to generation.
 */
export async function sampleProviderCount(input: {
  url: string;
  preImage: string;
  provider: string;
  auth?: CountAuth;
  fetchImpl?: typeof fetch;
}): Promise<number | undefined> {
  if (!input.preImage || !isCountEndpoint(input.url)) return undefined;
  const headers = new Headers({ "content-type": "application/json" });
  if (input.provider === "anthropic") {
    if (input.auth?.apiKey) headers.set("x-api-key", input.auth.apiKey);
    else if (input.auth?.authorization) headers.set("authorization", input.auth.authorization);
    else return undefined;
    headers.set("anthropic-version", input.auth?.anthropicVersion || "2023-06-01");
  } else if (input.provider === "gemini") {
    if (input.auth?.googApiKey) headers.set("x-goog-api-key", input.auth.googApiKey);
    else if (input.auth?.apiKey) headers.set("x-goog-api-key", input.auth.apiKey);
    else if (input.auth?.authorization) headers.set("authorization", input.auth.authorization);
    else return undefined;
  } else {
    return undefined;
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(input.url, {
      method: "POST",
      headers,
      body: input.preImage,
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return undefined;
    const json = await response.json() as Record<string, unknown>;
    const count = json.input_tokens ?? json.totalTokens ?? json.total_tokens;
    return typeof count === "number" && Number.isFinite(count) ? count : undefined;
  } catch {
    return undefined;
  }
}
