import { formatHeadline, formatTicker, signed } from "../token-ledger/money.js";
import type { AccountResult } from "../token-ledger/accountant.js";

export interface ReceiptView {
  turn: number;
  model: string;
  priceLabel: string;
  time: string;
  project: string;
  source: string;
  lines: { label: string; tokens?: number; pico?: bigint }[];
  account: AccountResult;
}

export function renderReceipt(view: ReceiptView): string {
  const a = view.account;
  const bar = "=".repeat(70);
  const dash = "-".repeat(70);
  const rows = [
    bar,
    `TURN #${view.turn} RECEIPT — Model: ${view.model} (${view.priceLabel})`,
    `Time: ${view.time} | Project: ${view.project} | Source: ${view.source}`,
    bar,
    line("1. RAW PAYLOAD DETECTED ON PC:", undefined, a.displayWould),
    dash,
    "2. LOCAL INTERCEPTOR REDUCTIONS:",
    ...view.lines.map((row) => line(`   - ${row.label}:`, row.tokens, row.pico)),
    "   " + "-".repeat(67),
    line("   NET TOKENS SENT TO CLOUD:", a.sent),
    line("   LOCAL PRUNING NET SAVED:", view.lines.reduce((n, row) => n + (row.tokens ?? 0), 0) * -1 === 0 ? a.sent : undefined),
    dash,
    "3. CLOUD CACHE RECEIPT (Verified from Provider):",
    line("   CLOUD CACHE NET (B):", undefined, a.B),
    line("   CLIENT-NATIVE CACHE (C):", undefined, a.C),
    line("   ZOOM EXTRAS (D):", undefined, a.D),
    bar,
    `what you WOULD have paid without system:                      ${formatTicker(a.displayWould)}`,
    `what you ACTUALLY paid on your bill:                          ${formatTicker(a.displayActual)}`,
    dash,
    `REAL NET SAVED THIS TURN:                     ${signed(formatTicker(a.displayNet))} (Displayed: ${signed(formatHeadline(a.displayNet))})`,
    bar,
  ];
  return rows.join("\n");
}

function line(label: string, tokens?: number, pico?: bigint): string {
  const tokenText = tokens === undefined ? "" : `${tokens.toLocaleString("en-US")} tokens`;
  const money = pico === undefined ? "" : signed(formatTicker(pico));
  return `${label.padEnd(48, " ")}${tokenText.padStart(16, " ")}${money ? ` (${money})` : ""}`.trimEnd();
}
