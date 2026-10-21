import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { account, identityHolds } from "../../src/4-savings-dashboard/token-ledger/accountant.js";
import { formatHeadline, formatTicker } from "../../src/4-savings-dashboard/token-ledger/money.js";
import { priceFor } from "../../src/4-savings-dashboard/token-ledger/pricing.js";
import { extractUsage } from "../../src/4-savings-dashboard/token-ledger/usage-extract.js";
import { renderReceipt } from "../../src/4-savings-dashboard/receipts/receipt.js";
import { Ledger } from "../../src/4-savings-dashboard/token-ledger/db.js";
import { recordProxyCompletion } from "../../src/4-savings-dashboard/token-ledger/record.js";
import { countUrlFor, isCountEndpoint } from "../../src/4-savings-dashboard/token-ledger/count-sample.js";
import { createTransformState, type TransformOutcome } from "../../src/2-traffic-gatekeeper/tunnel-connector/transform.js";
import { mergeMeta, readProviderMeta, type ProviderMeta } from "../../src/2-traffic-gatekeeper/cache-aligner/diagnostics.js";
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
    const longAnswer = account({
      rawTokens: 28400,
      zoomInTokens: 1100,
      usage: { input: 2500, cacheRead: 12000, cacheWrite5m: 1200, cacheWrite1h: 0, output: 8000, reasoning: 3000 },
      price: sonnet,
      verified: true,
    });
    expect(longAnswer.displayNet).toBe(result.displayNet);
    expect(longAnswer.actualOut).toBeGreaterThan(0n);
    const claimed = account({
      rawTokens: 28400,
      zoomInTokens: 1100,
      clientNativePico: 1_000_000_000n,
      usage: { input: 2500, cacheRead: 12000, cacheWrite5m: 1200, cacheWrite1h: 0, output: 0 },
      price: sonnet,
      verified: true,
    });
    expect(claimed.displayNet).toBe(result.displayNet - 1_000_000_000n);
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
      usage: { input_tokens: 9, input_tokens_details: { cached_tokens: 4, cache_write_tokens: 1 }, output_tokens: 2, output_tokens_details: { reasoning_tokens: 1 } },
    }, "openai")).toMatchObject({ input: 4, cacheRead: 4, cacheWrite5m: 1, reasoning: 1 });
    expect(extractUsage({
      usageMetadata: { promptTokenCount: 50, cachedContentTokenCount: 40, candidatesTokenCount: 6, thoughtsTokenCount: 2 },
    }, "gemini")).toMatchObject({ input: 10, cacheRead: 40, output: 6, reasoning: 2, cacheWrite5m: 0 });
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

function proxyOutcome(over: Partial<TransformOutcome> = {}): TransformOutcome {
  return {
    body: Buffer.from("PREIMAGE"),
    notes: [{ filterId: "duplicate-file-remover", label: "Duplicate file removed", tokens: 10 }],
    rawByteTokens: 50,
    prefixTokens: 0,
    clientCaches: false,
    withinTtl: false,
    modified: true,
    model: "claude-sonnet-4.6",
    provider: "anthropic",
    conversationId: "conv",
    ...over,
  };
}

describe("proxy ledger", () => {
  it("counts the pre-image on the count endpoint and leaves bytes/4 off the headline", async () => {
    const file = path.join(os.tmpdir(), `sg-ledger-${Date.now()}-${process.pid}.sqlite`);
    const ledger = Ledger.open(file);
    const state = createTransformState();
    const calls: string[] = [];
    try {
      await recordProxyCompletion(ledger, state, {
        outcome: proxyOutcome(),
        usage: { usage: { input_tokens: 20, output_tokens: 9000 } },
        status: 200,
        preImage: Buffer.from("PREIMAGE-BODY"),
        countUrl: "https://api.anthropic.com/v1/messages/count_tokens",
        auth: { apiKey: "sk-test" },
        requestId: "req_1",
      }, {
        sampleRate: 1,
        fetchImpl: async (url, init) => {
          calls.push(String(url));
          expect(String(init?.body)).toContain("PREIMAGE-BODY");
          expect(isCountEndpoint(String(url))).toBe(true);
          return new Response(JSON.stringify({ input_tokens: 100 }), { status: 200 });
        },
      });
      const rows = ledger.list(10);
      expect(calls).toEqual(["https://api.anthropic.com/v1/messages/count_tokens"]);
      expect(rows.some((row) => row.raw_tokens_method === "provider-count" && Number(row.raw_tokens) === 100 && Number(row.verified) === 1)).toBe(true);
      expect(ledger.verifiedNetSince(0)).toBeGreaterThan(0n);
      await recordProxyCompletion(ledger, state, {
        outcome: proxyOutcome({ conversationId: "conv-3" }),
        usage: { usage: { input_tokens: 10, output_tokens: 4 } },
        status: 200,
      }, { sampleRate: 0 });
      const calibratedRow = ledger.list(10).find((row) => row.conversation_id === "conv-3");
      expect(calibratedRow?.raw_tokens_method).toBe("calibrated");
      expect(Number(calibratedRow?.raw_tokens)).toBe(100);
      expect(Number(calibratedRow?.verified)).toBe(0);
      expect(ledger.calibratedNetSince(0)).not.toBe(0n);
      const verifiedBefore = ledger.verifiedNetSince(0);
      const bare = Ledger.open(path.join(os.tmpdir(), `sg-ledger-byte-${Date.now()}-${process.pid}.sqlite`));
      try {
        let shadowed = false;
        await recordProxyCompletion(bare, createTransformState(), {
          outcome: proxyOutcome({ conversationId: "byte" }),
          usage: { usage: { input_tokens: 10, output_tokens: 1 } },
          status: 200,
          preImage: Buffer.from("again"),
          countUrl: "https://api.anthropic.com/v1/messages",
          auth: { apiKey: "sk-test" },
        }, {
          sampleRate: 1,
          fetchImpl: async () => {
            shadowed = true;
            throw new Error("shadow send");
          },
        });
        expect(shadowed).toBe(false);
        const byteRow = bare.list(1)[0];
        expect(byteRow?.raw_tokens_method).toBe("bytes/4");
        expect(Number(byteRow?.verified)).toBe(0);
        expect(bare.verifiedNetSince(0)).toBe(0n);
        expect(bare.calibratedNetSince(0)).toBe(0n);
      } finally {
        bare.close();
      }
      expect(ledger.verifiedNetSince(0)).toBe(verifiedBefore);
    } finally {
      ledger.close();
      fs.rmSync(file, { force: true });
    }
  });

  it("does not call a count endpoint for an unmodified request", async () => {
    const file = path.join(os.tmpdir(), `sg-ledger-same-${Date.now()}-${process.pid}.sqlite`);
    const ledger = Ledger.open(file);
    let called = false;
    try {
      await recordProxyCompletion(ledger, createTransformState(), {
        outcome: proxyOutcome({ modified: false, notes: [] }),
        usage: { usage: { input_tokens: 40, output_tokens: 3 } },
        status: 200,
        preImage: Buffer.from("same"),
        countUrl: "https://api.anthropic.com/v1/messages/count_tokens",
        auth: { apiKey: "sk-test" },
      }, {
        sampleRate: 1,
        fetchImpl: async () => {
          called = true;
          return new Response("{}", { status: 500 });
        },
      });
      expect(called).toBe(false);
      const row = ledger.list(1)[0];
      expect(row?.raw_tokens_method).toBe("provider-count");
      expect(Number(row?.raw_tokens)).toBe(40);
      expect(Number(row?.verified)).toBe(1);
    } finally {
      ledger.close();
      fs.rmSync(file, { force: true });
    }
  });

  it("builds count urls that are not generation endpoints", () => {
    expect(countUrlFor("anthropic", "https://api.anthropic.com/v1/messages")).toBe("https://api.anthropic.com/v1/messages/count_tokens");
    expect(isCountEndpoint("https://api.anthropic.com/v1/messages")).toBe(false);
    expect(countUrlFor("gemini", "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:countTokens",
    );
    expect(countUrlFor("openai", "https://api.openai.com/v1/responses")).toBeUndefined();
  });

  it("keeps input tokens when a later stream event only has output", async () => {
    const meta: ProviderMeta = {};
    mergeMeta(meta, readProviderMeta({ message: { id: "msg_1", usage: { input_tokens: 10, cache_read_input_tokens: 4 } } }));
    mergeMeta(meta, readProviderMeta({ usage: { output_tokens: 3 } }));
    mergeMeta(meta, readProviderMeta({ diagnostics: { cache_miss_reason: { type: "tools_changed", cache_missed_input_tokens: 80 } } }));
    expect(meta.usage).toMatchObject({ input_tokens: 10, cache_read_input_tokens: 4, output_tokens: 3 });
    expect(meta.responseId).toBe("msg_1");
    expect(meta.diagnosis).toEqual({ present: true, reason: "tools_changed", missedTokens: 80 });
    const file = path.join(os.tmpdir(), `sg-diag-${Date.now()}-${process.pid}.sqlite`);
    const ledger = Ledger.open(file);
    const state = createTransformState();
    try {
      await recordProxyCompletion(ledger, state, {
        outcome: proxyOutcome({ modified: false, notes: [] }),
        usage: meta.usage,
        status: 200,
        responseId: meta.responseId,
        diagnosis: meta.diagnosis,
      }, { sampleRate: 0 });
      expect(state.holds.get("conv")).toEqual({ system: false, tools: true, reason: "tools_changed" });
      expect(state.previousResponseId.get("conv")).toBe("msg_1");
      const again = createTransformState();
      ledger.attach(again);
      expect(again.holds.get("conv")?.tools).toBe(true);
      expect(again.previousResponseId.get("conv")).toBe("msg_1");
    } finally {
      ledger.close();
      fs.rmSync(file, { force: true });
    }
  });

  it("reports fold rates without mixing sqlite bigints into division", () => {
    const file = path.join(os.tmpdir(), `sg-tune-${Date.now()}-${process.pid}.sqlite`);
    const ledger = Ledger.open(file);
    try {
      const id = ledger.insertFold({
        ts: Date.now(), source: "mcp", path: "a.ts", ext: ".ts",
        totalLines: 200, shownLines: 20, fullTokens: 400, outlineTokens: 40, rev: "abc",
      });
      ledger.insertExpand({ ts: Date.now(), foldId: id, path: "a.ts", tokens: 30, secondsAfter: 1, fast: true });
      expect(ledger.foldRates()).toEqual([{ ext: ".ts", folds: 1, rate: 1 }]);
    } finally {
      ledger.close();
      fs.rmSync(file, { force: true });
    }
  });

  it("reloads a frozen decision after the process table is gone", () => {
    const file = path.join(os.tmpdir(), `sg-freeze-${Date.now()}-${process.pid}.sqlite`);
    const ledger = Ledger.open(file);
    const state = createTransformState();
    ledger.attach(state);
    const key = state.decisions.key("conv", "hash", 2);
    state.decisions.set(key, { filterId: "duplicate-file-remover", replacement: "kept", epoch: 1 });
    const next = createTransformState();
    ledger.attach(next);
    expect(next.decisions.get(key)?.replacement).toBe("kept");
    ledger.close();
    fs.rmSync(file, { force: true });
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
