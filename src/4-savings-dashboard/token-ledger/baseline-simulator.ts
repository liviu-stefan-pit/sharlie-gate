import type { ModelPrice } from "./pricing.js";
import { costPico } from "./money.js";

/** What the client would have cached on its own, priced as a deduction from the no-cache baseline. */
export function clientNativeCachePico(input: {
  prefixTokens: number;
  withinTtl: boolean;
  clientCaches: boolean;
  price: ModelPrice;
}): { readTokens: number; pico: bigint } {
  if (!input.clientCaches || !input.withinTtl || input.prefixTokens < input.price.minCacheable) {
    return { readTokens: 0, pico: 0n };
  }
  const readTokens = input.prefixTokens;
  const pico = costPico(readTokens, input.price.inputE6) - costPico(readTokens, input.price.cacheReadE6);
  return { readTokens, pico };
}
