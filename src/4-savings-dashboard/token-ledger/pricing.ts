import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import defaults from "./pricing.json" with { type: "json" };
import { pricingOverridePath } from "../../core/paths.js";

export interface ModelPrice {
  provider: string;
  pattern: string;
  inputE6: number;
  outputE6: number;
  cacheReadE6: number;
  cacheWrite5mE6: number;
  cacheWrite1hE6: number;
  minCacheable: number;
}

interface RawPrice {
  provider: string;
  pattern: string;
  input_e6?: number;
  output_e6?: number;
  cache_read_e6?: number;
  cache_write_5m_e6?: number;
  cache_write_1h_e6?: number;
  min_cacheable?: number;
  inputE6?: number;
  outputE6?: number;
  cacheReadE6?: number;
  cacheWrite5mE6?: number;
  cacheWrite1hE6?: number;
  minCacheable?: number;
}

function normalize(row: RawPrice): ModelPrice {
  return {
    provider: row.provider,
    pattern: row.pattern,
    inputE6: row.inputE6 ?? row.input_e6 ?? 0,
    outputE6: row.outputE6 ?? row.output_e6 ?? 0,
    cacheReadE6: row.cacheReadE6 ?? row.cache_read_e6 ?? 0,
    cacheWrite5mE6: row.cacheWrite5mE6 ?? row.cache_write_5m_e6 ?? 0,
    cacheWrite1hE6: row.cacheWrite1hE6 ?? row.cache_write_1h_e6 ?? 0,
    minCacheable: row.minCacheable ?? row.min_cacheable ?? 1024,
  };
}

export function loadPrices(): ModelPrice[] {
  const rows = (defaults as RawPrice[]).map(normalize);
  if (fs.existsSync(pricingOverridePath())) {
    const extra = JSON.parse(fs.readFileSync(pricingOverridePath(), "utf8")) as RawPrice[];
    rows.push(...extra.map(normalize));
  }
  return rows;
}

export function priceFor(provider: string, model: string, prices = loadPrices()): ModelPrice | undefined {
  const list = prices.filter((price) => price.provider === provider || price.provider === "*");
  return list.find((price) => model.includes(price.pattern)) ?? list.find((price) => price.pattern === "*");
}

export function bundledPricingPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "pricing.json");
}
