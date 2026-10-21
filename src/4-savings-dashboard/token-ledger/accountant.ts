import { costPico } from "./money.js";
import type { ModelPrice } from "./pricing.js";
import type { UsageTokens } from "./usage-extract.js";
import { sentTokens } from "./usage-extract.js";

export interface AccountInput {
  rawTokens: number;
  zoomInTokens?: number;
  zoomExtraPico?: bigint;
  clientNativePico?: bigint;
  clientCacheRead?: number;
  usage: UsageTokens;
  price?: ModelPrice;
  verified: boolean;
}

export interface AccountResult {
  sent: number;
  A: bigint;
  B: bigint;
  C: bigint;
  D: bigint;
  baselineNocache: bigint;
  baseline: bigint;
  actualIn: bigint;
  actualOut: bigint;
  net: bigint;
  displayWould: bigint;
  displayActual: bigint;
  displayNet: bigint;
  priced: boolean;
}

export function account(input: AccountInput): AccountResult {
  const zoom = input.zoomInTokens ?? 0;
  const sent = sentTokens(input.usage);
  const D = input.zoomExtraPico ?? 0n;
  if (!input.price) {
    return {
      sent, A: 0n, B: 0n, C: 0n, D, baselineNocache: 0n, baseline: 0n, actualIn: 0n, actualOut: 0n, net: 0n,
      displayWould: 0n, displayActual: 0n, displayNet: 0n, priced: false,
    };
  }
  const p = input.price;
  const baselineNocache = costPico(input.rawTokens - zoom, p.inputE6);
  const C = input.clientNativePico ?? 0n;
  const baseline = baselineNocache - C;
  const actualIn = costPico(input.usage.input, p.inputE6)
    + costPico(input.usage.cacheRead, p.cacheReadE6)
    + costPico(input.usage.cacheWrite5m, p.cacheWrite5mE6)
    + costPico(input.usage.cacheWrite1h, p.cacheWrite1hE6);
  const actualOut = costPico(input.usage.output, p.outputE6);
  const A = costPico(input.rawTokens - zoom - sent, p.inputE6);
  const B = costPico(input.usage.cacheRead, p.inputE6 - p.cacheReadE6)
    - costPico(input.usage.cacheWrite5m, p.cacheWrite5mE6 - p.inputE6)
    - costPico(input.usage.cacheWrite1h, p.cacheWrite1hE6 - p.inputE6);
  const net = baseline - actualIn - D;
  const displayWould = costPico(input.rawTokens, p.inputE6);
  // Input bill only. Output and thinking tokens are paid either way, so they stay in actualOut.
  // C is cache the client would have hit without this gate, and is not claimed here.
  const displayActual = actualIn;
  const displayNet = displayWould - displayActual - D - C;
  return { sent, A, B, C, D, baselineNocache, baseline, actualIn, actualOut, net, displayWould, displayActual, displayNet, priced: true };
}

export function identityHolds(result: AccountResult): boolean {
  return result.A + result.B - result.C - result.D === result.net;
}
