import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { account, identityHolds } from "../../src/4-savings-dashboard/token-ledger/accountant.js";
import { formatHeadline, formatTicker } from "../../src/4-savings-dashboard/token-ledger/money.js";
import { priceFor } from "../../src/4-savings-dashboard/token-ledger/pricing.js";
import { extractUsage } from "../../src/4-savings-dashboard/token-ledger/usage-extract.js";
import { renderReceipt } from "../../src/4-savings-dashboard/receipts/receipt.js";
import { reviewEdit } from "../../src/3-safety-rules-and-config/protection-rules/guardrail-gate.js";
import { footerLine } from "../../src/4-savings-dashboard/status/footer.js";

const sonnet = priceFor("anthropic", "claude-sonnet-4.6");

describe("penny ledger", () => {
  it("reproduces the blueprint turn 4 receipt", () => {
    expect(sonnet).toBeDefined();
    const result = account({
      rawTokens: 28400,
      zoomInTokens: 1100,
      usage: { input: 2500, cacheRead: 12000, cacheWrite5m: 1200, cacheWrite1h: 0, output: 0 },
      price: sonnet,
      verified: true,
    });
    expect(formatTicker(result.displayWould)).toBe("$0.0852");
    expect(formatTicker(result.displayActual)).toBe("$0.0156");
    expect(formatTicker(result.displayNet)).toBe("$0.0696");
    expect(formatHeadline(result.displayNet)).toBe("$0.06");
    const text = renderReceipt({
      turn: 4,
      model: "Claude Sonnet 4.6",
      priceLabel: "$3.00 / 1M Input",
      time: "10:14:22 AM",
      project: "Report-Service",
      source: "Cursor Desktop",
      lines: [
        { label: "Duplicate file removed (from Turn #2)", tokens: -4200, pico: 12600000000n },
        { label: "Old resolved terminal log collapsed", tokens: -3100, pico: 9300000000n },
        { label: "2 background files folded to outlines", tokens: -6500, pico: 19500000000n },
        { label: "Zoom-In Penalty (1 section expanded)", tokens: 1100, pico: -3300000000n },
      ],
      account: result,
    });
    expect(text).toContain("$0.0852");
    expect(text).toContain("$0.0156");
    expect(text).toContain("+$0.0696");
    expect(text).toContain("+$0.06");
  });

  it("floors a tiny turn instead of inflating it", () => {
    const result = account({
      rawTokens: 4834,
      usage: { input: 1334, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0 },
      price: sonnet,
      verified: true,
    });
    expect(formatTicker(result.displayWould)).toBe("$0.0145");
    expect(formatTicker(result.displayActual)).toBe("$0.0040");
    expect(formatTicker(result.displayNet)).toBe("$0.0105");
    expect(formatHeadline(result.displayNet)).toBe("$0.01");
  });

  it("floors negative amounts away from zero", () => {
    expect(formatHeadline(-8_000_000_000n)).toBe("-$0.01");
    expect(formatTicker(-8_000_000_000n)).toBe("-$0.0080");
  });

  it("keeps the algebraic identity under fuzzing", () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 200_000 }),
      fc.integer({ min: 0, max: 50_000 }),
      fc.integer({ min: 0, max: 50_000 }),
      fc.integer({ min: 0, max: 20_000 }),
      (raw, read, write, zoom) => {
        const input = Math.max(0, raw);
        const result = account({
          rawTokens: input + read + write + zoom,
          zoomInTokens: zoom,
          usage: { input, cacheRead: read, cacheWrite5m: write, cacheWrite1h: 0, output: 0 },
          price: sonnet,
          verified: true,
        });
        expect(identityHolds(result)).toBe(true);
      },
    ));
  });

  it("reads provider usage payloads", () => {
    expect(extractUsage({
      usage: { input_tokens: 10, cache_read_input_tokens: 4, cache_creation_input_tokens: 2, output_tokens: 3 },
    }, "anthropic")).toMatchObject({ input: 10, cacheRead: 4, cacheWrite5m: 2, output: 3 });
    expect(extractUsage({
      usage: { input_tokens: 9, input_tokens_details: { cached_tokens: 4, cache_write_tokens: 1 }, output_tokens: 2 },
    }, "openai")).toMatchObject({ input: 4, cacheRead: 4, cacheWrite5m: 1 });
  });

  it("leaves unknown models unpriced", () => {
    const result = account({
      rawTokens: 10,
      usage: { input: 10, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0 },
      verified: false,
    });
    expect(result.priced).toBe(false);
    expect(result.displayNet).toBe(0n);
  });

  it("formats the terminal footer", () => {
    expect(footerLine(4200, 88, 21400000000n)).toContain("Sharlie-Gate");
  });
});

describe("guardrail gate", () => {
  const rules = { minLinesToFold: 150, currentTurn: 4 };
  const ok = {
    turnIndex: 2,
    lineCount: 400,
    kind: "file-view" as const,
    replacement: "[Duplicate file view removed — see latest copy in Turn 4 | ref sg:abcdef12]",
    original: "x".repeat(1000),
  };
  it("rejects the five violations and allows a safe edit", () => {
    expect(reviewEdit({ ...ok, turnIndex: 4 }, rules).rule).toBe("current-turn-immunity");
    expect(reviewEdit({ ...ok, lineCount: 10 }, rules).rule).toBe("small-file-bypass");
    expect(reviewEdit({ ...ok, isEditTargetLatest: true }, rules).rule).toBe("edit-target-full-visibility");
    expect(reviewEdit({ ...ok, replacement: "just gone" }, rules).rule).toBe("on-demand-expansion");
    expect(reviewEdit(ok, rules).allow).toBe(true);
  });
});
