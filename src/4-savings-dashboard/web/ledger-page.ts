import type http from "node:http";
import { formatHeadline, formatTicker, signed } from "../token-ledger/money.js";
import { Ledger, type RequestRow } from "../token-ledger/db.js";

export interface LedgerHeadline {
  today: bigint;
  last: bigint;
  verifiedOnly: true;
  calibratedToday: bigint;
  tokensRemoved: number;
  fastExpandRate: number;
}

export function summary(ledger: Ledger): LedgerHeadline {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return {
    today: ledger.verifiedNetSince(start.getTime()),
    last: ledger.lastVerifiedNet(),
    verifiedOnly: true,
    calibratedToday: ledger.calibratedNetSince(start.getTime()),
    tokensRemoved: ledger.tokensRemoved(),
    fastExpandRate: ledger.fastExpandRate(),
  };
}

export function footerLine(prunedTokens: number, cacheHit: number, savedPico: bigint): string {
  const pruned = prunedTokens >= 1000 ? `-${(prunedTokens / 1000).toFixed(1)}k` : `-${prunedTokens}`;
  return `[Sharlie-Gate: ${pruned} tokens pruned | ${cacheHit}% cache hit | ${signed(formatHeadline(savedPico))} saved (${formatTicker(savedPico)})]`;
}

export function statusPill(today: bigint, last: bigint): string {
  return `$(shield) Saved Today: ${formatHeadline(today)} (Last turn: ${signed(formatHeadline(last))})`;
}

export function ledgerHtml(rows: RequestRow[], detail?: string, headline?: Partial<LedgerHeadline> & { today: bigint; last: bigint }): string {
  const body = rows.map((row) => {
    const saved = BigInt(row.display_net_pico ?? 0);
    const zoom = Number(row.usage_cache_write_5m ?? 0) > 0 ? " zoom" : "";
    return `<tr class="${saved < 0n ? "neg" : "pos"}${zoom}"><td>${new Date(Number(row.ts_start)).toISOString()}</td><td>${escape(row.source)}</td><td>${escape(row.model)}</td><td>${escape(row.client)}</td><td>${escape(kindLabel(row))}</td><td>${formatTicker(saved)}</td></tr>`;
  }).join("");
  const stats = headline
    ? `<p><strong>Saved today</strong> ${escape(formatHeadline(headline.today))}</p><p><strong>Last turn</strong> ${escape(signed(formatHeadline(headline.last)))}</p>${extraStats(headline)}`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sharlie-Gate ledger</title>
<style>body{font:14px/1.4 ui-sans-serif,system-ui;margin:24px;background:#111;color:#eee}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #333;padding:6px;text-align:left}.neg{color:#f88}.pos{color:#8f8}a{color:#9cf}</style></head>
<body><h1>Sharlie-Gate ledger</h1>${stats}<p>Verified totals are input-only and never include estimated or bytes/4 rows. Output tokens are not part of the saving. API-equivalent dollars are calibrated, not an invoice. Cache credit is the cache portion of a verified row, not a second saving.</p>
<p><a href="/ledger/export.csv">Export CSV</a></p>
<table><thead><tr><th>Time</th><th>Source</th><th>Model</th><th>Client</th><th>Kind</th><th>Net</th></tr></thead><tbody>${body}</tbody></table>
<pre>${escape(detail ?? "")}</pre></body></html>`;
}

function extraStats(headline: Partial<LedgerHeadline>): string {
  const parts: string[] = [];
  if (headline.calibratedToday !== undefined) {
    parts.push(`<p><strong>API-equivalent today</strong> ${escape(formatHeadline(headline.calibratedToday))} (calibrated, not an invoice)</p>`);
  }
  if (headline.tokensRemoved !== undefined) {
    const rate = Math.round((headline.fastExpandRate ?? 0) * 100);
    parts.push(`<p><strong>Tokens not returned</strong> ${headline.tokensRemoved.toLocaleString("en-US")} (fast-expand ${rate}%)</p>`);
  }
  return parts.join("");
}

function kindLabel(row: RequestRow): string {
  if (row.raw_tokens_method === "provider-count" && row.verified) return "verified";
  if (row.raw_tokens_method === "calibrated") return "API-equivalent";
  if (row.verified) return "verified";
  return "estimated";
}

export function ledgerCsv(rows: RequestRow[]): string {
  const header = "id,ts_start,source,client,provider,model,verified,raw_tokens,raw_tokens_method,display_net_pico,cache_credit_pico,counterfactual,provider_request_id,net_ticker";
  const lines = rows.map((row) => {
    const pico = BigInt(row.display_net_pico ?? 0);
    const credit = BigInt(row.cache_credit_pico ?? 0);
    return [row.id, row.ts_start, row.source, row.client ?? "", row.provider ?? "", row.model ?? "", row.verified, row.raw_tokens ?? "", row.raw_tokens_method ?? "", pico.toString(), credit.toString(), row.counterfactual ?? "", row.provider_request_id ?? "", formatTicker(pico)].join(",");
  });
  return [header, ...lines].join("\n");
}

export function handleLedgerRequest(req: http.IncomingMessage, res: http.ServerResponse, file: string): boolean {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/ledger")) return false;
  let ledger: Ledger | undefined;
  try {
    ledger = Ledger.open(file);
    if (url.pathname === "/ledger/api/summary") {
      const snap = summary(ledger);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        todayPico: snap.today.toString(),
        lastPico: snap.last.toString(),
        today: formatHeadline(snap.today),
        last: formatHeadline(snap.last),
        calibratedToday: formatHeadline(snap.calibratedToday),
        tokensRemoved: snap.tokensRemoved,
        fastExpandRate: snap.fastExpandRate,
        verifiedOnly: true,
      }));
      return true;
    }
    if (url.pathname === "/ledger/export.csv") {
      res.writeHead(200, { "content-type": "text/csv" });
      res.end(ledgerCsv(ledger.list(100000)));
      return true;
    }
    if (url.pathname === "/ledger/events") {
      const snap = summary(ledger);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ today: formatHeadline(snap.today), last: formatHeadline(snap.last) })}\n\n`);
      return true;
    }
    const rows = ledger.list(500);
    const snap = summary(ledger);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(ledgerHtml(rows, undefined, snap));
    return true;
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(error));
    return true;
  } finally {
    ledger?.close();
  }
}

function escape(value: unknown): string {
  return String(value ?? "").replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch] ?? ch);
}
