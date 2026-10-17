export const PICO_PER_DOLLAR = 1_000_000_000_000n;
export const CENT = 10_000_000_000n;
export const TICK = 100_000_000n;

/** cost in picodollars = tokens * usd_per_mtok_e6. Exact. */
export function costPico(tokens: number, priceE6: number): bigint {
  return BigInt(tokens) * BigInt(priceE6);
}

export function floorTo(pico: bigint, unit: bigint): bigint {
  if (unit <= 0n) throw new Error("unit must be positive");
  if (pico >= 0n) return (pico / unit) * unit;
  if (pico % unit === 0n) return pico;
  return (pico / unit - 1n) * unit;
}

export function formatPico(pico: bigint, unit: bigint, decimals: number): string {
  const floored = floorTo(pico, unit);
  const negative = floored < 0n;
  const abs = negative ? -floored : floored;
  const whole = abs / PICO_PER_DOLLAR;
  const frac = abs % PICO_PER_DOLLAR;
  const digits = frac.toString().padStart(12, "0").slice(0, decimals);
  return `${negative ? "-" : ""}$${whole.toString()}.${digits}`;
}

export function formatHeadline(pico: bigint): string {
  return formatPico(pico, CENT, 2);
}

export function formatTicker(pico: bigint): string {
  return formatPico(pico, TICK, 4);
}

export function signed(formatted: string): string {
  if (formatted.startsWith("-")) return formatted;
  if (formatted === "$0.00" || formatted === "$0.0000") return formatted;
  return `+${formatted}`;
}
