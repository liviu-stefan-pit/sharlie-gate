import http from "node:http";
import { loadConfig, type SharlieConfig } from "../../core/config.js";
import { log, redact } from "../../core/logger.js";
import { hostAllowed, routePath } from "./router.js";
import { forwardHeaders, forwardUpstream } from "./upstream.js";
import { isBypassed, setBypass } from "./control.js";
import { createSseTap, parseUsageEvent } from "./sse-tap.js";
import { createTransformState, transformBody, type TransformOutcome, type TransformState } from "./transform.js";
import { handleLedgerRequest } from "../../4-savings-dashboard/web/ledger-page.js";
import { ledgerPath } from "../../core/paths.js";
import { ensureSymbolRuntime } from "../../1-editor-helper-tools/outline-builder/symbols/runtime.js";

export interface ProxyHandle {
  port: number;
  url: string;
  close: () => Promise<void>;
  state: TransformState;
}

export interface ProxyOptions {
  port?: number;
  config?: SharlieConfig;
  anthropicBase?: string;
  openaiBase?: string;
  custom?: Record<string, string>;
  state?: TransformState;
  onComplete?: (info: { outcome: TransformOutcome; usage?: Record<string, unknown>; status: number; requestId?: string }) => void;
}

const HOP_RESPONSE = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length"]);

export async function startProxy(options: ProxyOptions = {}): Promise<ProxyHandle> {
  const cfg = options.config ?? loadConfig({});
  const port = options.port ?? cfg.proxyPort;
  if (cfg.proxyHost !== "127.0.0.1" && cfg.proxyHost !== "localhost") {
    throw new Error("Sharlie-Gate binds loopback only.");
  }
  const state = options.state ?? createTransformState();
  await ensureSymbolRuntime().catch(() => undefined);
  const server = http.createServer((req, res) => {
    void handle(req, res, cfg, options, state).catch((error) => {
      log("error", "proxy request failed", redact({ error: String(error) }));
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("bad gateway");
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const bound = typeof address === "object" && address ? address.port : port;
  return {
    port: bound,
    url: `http://127.0.0.1:${bound}`,
    state,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, cfg: SharlieConfig, options: ProxyOptions, state: TransformState): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const localPage = url.pathname.startsWith("/ledger") || url.pathname === "/healthz";
  if (!hostAllowed(req.headers.host)) {
    res.writeHead(403).end("forbidden host");
    return;
  }
  if (req.headers.origin && !localPage) {
    res.writeHead(403).end("browser origin rejected");
    return;
  }
  if (handleLedgerRequest(req, res, ledgerPath())) return;
  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, bypass: isBypassed() || state.bypass }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/control/bypass") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const on = body.includes("on") || body.includes("true");
    state.bypass = on;
    setBypass(on);
    res.writeHead(200).end(on ? "on" : "off");
    return;
  }
  const target = routePath(url.pathname, {
    anthropic: options.anthropicBase ?? "https://api.anthropic.com",
    openai: options.openaiBase ?? "https://api.openai.com",
    custom: { ...cfg.upstreams, ...options.custom },
    defaultProvider: cfg.defaultProvider,
  });
  if (!target) {
    res.writeHead(404).end("no upstream");
    return;
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    received += (chunk as Buffer).length;
    if (received > cfg.bodyLimitBytes) {
      res.writeHead(413).end("body too large");
      return;
    }
    chunks.push(chunk as Buffer);
  }
  const original = Buffer.concat(chunks);
  state.bypass = state.bypass || isBypassed();
  const outcome = transformBody(original, url.pathname, state, cfg);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  headers.delete("host");
  headers.delete("content-length");
  const controller = new AbortController();
  let idle = setTimeout(() => controller.abort(), cfg.idleTimeoutMs);
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), cfg.idleTimeoutMs);
    idle.unref?.();
  };
  req.on("aborted", () => controller.abort());
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  let upstream: Response;
  try {
    upstream = await forwardUpstream(target.url + url.search, {
      method: req.method,
      headers: forwardHeaders(headers),
      body: outcome.body.length ? new Uint8Array(outcome.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(idle);
    if (!res.headersSent) res.writeHead(502).end("upstream failed");
    log("warn", "upstream failed", { error: String(error) });
    return;
  }
  const responseHeaders: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    if (!HOP_RESPONSE.has(key.toLowerCase())) responseHeaders[key] = value;
  });
  res.writeHead(upstream.status, responseHeaders);
  if (typeof res.socket?.setNoDelay === "function") res.socket.setNoDelay(true);
  res.flushHeaders?.();
  const tap = createSseTap((event) => {
    const usage = parseUsageEvent(event);
    if (usage) lastUsage = usage;
  });
  let lastUsage: Record<string, unknown> | undefined;
  const reader = upstream.body?.getReader();
  if (!reader) {
    clearTimeout(idle);
    res.end();
    return;
  }
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      touch();
      const buf = Buffer.from(value);
      tap.push(decoder.decode(value, { stream: true }));
      if (!res.write(buf)) await new Promise((resolve) => res.once("drain", resolve));
    }
  } catch {
    /* client abort or upstream cancel */
  } finally {
    tap.end();
    clearTimeout(idle);
    res.end();
    options.onComplete?.({
      outcome,
      usage: lastUsage,
      status: upstream.status,
      requestId: upstream.headers.get("request-id") ?? upstream.headers.get("x-request-id") ?? undefined,
    });
  }
}
