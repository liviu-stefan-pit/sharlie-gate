import { describe, expect, it } from "vitest";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startProxy } from "../../src/2-traffic-gatekeeper/tunnel-connector/server.js";
import { createTransformState, transformBody } from "../../src/2-traffic-gatekeeper/tunnel-connector/transform.js";
import { createSseTap } from "../../src/2-traffic-gatekeeper/tunnel-connector/sse-tap.js";
import { loadConfig } from "../../src/core/config.js";
import { geminiExplicitCacheAllowed } from "../../src/2-traffic-gatekeeper/adapters/gemini.js";

const big = Array.from({ length: 180 }, (_, i) => `const line${i} = ${i};`).join("\n");

function anthropic(date: string) {
  return {
    model: "claude-sonnet-4.6",
    system: `You are a coding agent.\nToday's date is ${date}`,
    messages: [
      { role: "user", content: [{ type: "text", text: "inspect src/a.ts" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "src/a.ts" } }, { type: "thinking", thinking: "secret", signature: "sig-keep" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: big }] },
      { role: "user", content: [{ type: "text", text: "and again" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "src/a.ts" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: big }] },
      { role: "user", content: [{ type: "text", text: "what is wrong with the current file?" }] },
    ],
  };
}

describe("gatekeeper", () => {
  it("fails open and keeps the current turn when filters throw or are disabled", () => {
    const original = Buffer.from(JSON.stringify(anthropic("2026-10-17T10:00:00Z")));
    const state = createTransformState();
    state.throwOnce = true;
    const failed = transformBody(original, "/anthropic/v1/messages", state, loadConfig({}));
    expect(failed.bypassReason).toBeTruthy();
    expect(failed.body.equals(original)).toBe(true);
    state.filtersEnabled = false;
    const passed = transformBody(original, "/anthropic/v1/messages", state, loadConfig({}));
    expect(passed.body.equals(original)).toBe(true);
  });

  it("removes an older duplicate read and does not rewrite the current question", () => {
    const payload = anthropic("2026-10-17T10:00:00Z");
    const state = createTransformState();
    const result = transformBody(Buffer.from(JSON.stringify(payload)), "/anthropic/v1/messages", state, loadConfig({ filters: { cachePrefixStabilizer: false } }));
    const parsed = JSON.parse(result.body.toString("utf8"));
    const first = JSON.stringify(parsed.messages[2]);
    const current = JSON.stringify(parsed.messages.at(-1));
    expect(first).toContain("Duplicate file view removed");
    expect(current).toContain("what is wrong with the current file?");
    expect(JSON.stringify(parsed.messages[1])).toContain("sig-keep");
  });

  it("stabilizes the system prefix when only the date changes", () => {
    const state = createTransformState();
    const cfg = loadConfig({});
    const first = transformBody(Buffer.from(JSON.stringify(anthropic("2026-10-17T10:00:00Z"))), "/v1/messages", state, cfg);
    const second = transformBody(Buffer.from(JSON.stringify(anthropic("2026-10-17T10:05:00Z"))), "/v1/messages", state, cfg);
    const a = JSON.parse(first.body.toString("utf8")).system as string;
    const b = JSON.parse(second.body.toString("utf8")).system as string;
    expect(a).toBe(b);
    expect(b).not.toContain("2026-10-17T10:05:00Z");
    expect(second.prefixDrift).toBe(false);
  });

  it("leaves the system alone after a system_changed miss", () => {
    const state = createTransformState();
    const cfg = loadConfig({});
    const first = transformBody(Buffer.from(JSON.stringify(anthropic("2026-10-17T10:00:00Z"))), "/v1/messages", state, cfg);
    expect(first.conversationId).toBeTruthy();
    state.holds.set(first.conversationId ?? "", { system: true, tools: false, reason: "system_changed" });
    const second = transformBody(Buffer.from(JSON.stringify(anthropic("2026-10-17T10:05:00Z"))), "/v1/messages", state, cfg);
    expect(JSON.parse(second.body.toString("utf8")).system).toContain("2026-10-17T10:05:00Z");
  });

  it("does not set a prompt cache key on GPT-5.6 unless accounting is isolated", () => {
    const modern = { model: "gpt-5.6", input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }] };
    const routed = transformBody(Buffer.from(JSON.stringify(modern)), "/openai/v1/responses", createTransformState(), loadConfig({}));
    const parsed = JSON.parse(routed.body.toString("utf8"));
    expect(parsed.prompt_cache_key).toBeUndefined();
    expect(parsed.prompt_cache_options.ttl).toBe("30m");
    const isolated = transformBody(Buffer.from(JSON.stringify(modern)), "/openai/v1/responses", createTransformState(), loadConfig({ isolateCacheAccounting: true }));
    expect(JSON.parse(isolated.body.toString("utf8")).prompt_cache_key).toBeTruthy();
    const older = transformBody(
      Buffer.from(JSON.stringify({ model: "gpt-5", messages: [{ role: "user", content: "hi" }] })),
      "/openai/v1/chat/completions",
      createTransformState(),
      loadConfig({}),
    );
    expect(JSON.parse(older.body.toString("utf8")).prompt_cache_key).toBeTruthy();
  });

  it("stabilizes a Gemini prefix and does not attach an explicit cache", () => {
    const body = {
      systemInstruction: { parts: [{ text: "You are a coding agent.\nToday's date is 2026-10-17T10:00:00Z" }] },
      contents: [
        { role: "user", parts: [{ text: "inspect" }] },
        { role: "model", parts: [{ text: "ok" }] },
        { role: "user", parts: [{ text: "what now?" }] },
      ],
    };
    const result = transformBody(
      Buffer.from(JSON.stringify(body)),
      "/gemini/v1beta/models/gemini-4-argon:generateContent",
      createTransformState(),
      loadConfig({}),
    );
    const parsed = JSON.parse(result.body.toString("utf8"));
    expect(parsed.cachedContent).toBeUndefined();
    expect(parsed.cached_content).toBeUndefined();
    expect(JSON.stringify(parsed.systemInstruction)).not.toContain("2026-10-17T10:00:00Z");
    expect(geminiExplicitCacheAllowed("gemini-4-argon")).toBe(false);
    expect(geminiExplicitCacheAllowed("gemini-2.5-flash")).toBe(true);
    expect(result.provider).toBe("gemini");
  });

  it("parses SSE usage across chunk boundaries", () => {
    const events: string[] = [];
    const tap = createSseTap((event) => events.push(`${event.event}:${event.data}`));
    const raw = "event: message_delta\r\ndata: {\"usage\":{\"input_tokens\":3}}\r\n\r\n";
    tap.push(raw.slice(0, 11));
    tap.push(raw.slice(11, 20));
    tap.push(raw.slice(20));
    tap.end();
    expect(events.join("")).toContain("input_tokens");
  });
});

describe("proxy pass-through", () => {
  it("forwards bytes and streams them back unchanged", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sg-"));
    process.env.SHARLIE_GATE_LEDGER = path.join(dir, "ledger.sqlite");
    process.env.SHARLIE_GATE_DATA = dir;
    let seen = Buffer.alloc(0);
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        seen = Buffer.concat(chunks);
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: {\"ok\":1}\n\n");
        res.end();
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
    const address = upstream.address();
    const upstreamPort = typeof address === "object" && address ? address.port : 0;
    const proxy = await startProxy({
      port: 0,
      anthropicBase: `http://127.0.0.1:${upstreamPort}`,
      state: Object.assign(createTransformState(), { filtersEnabled: false }),
    });
    const payload = JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] });
    const response = await fetch(`${proxy.url}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1" },
      body: payload,
    });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain("ok");
    expect(seen.toString("utf8")).toBe(payload);
    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((err) => (err ? reject(err) : resolve())));
  });
});
