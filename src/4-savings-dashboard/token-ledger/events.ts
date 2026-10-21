import path from "node:path";
import { log } from "../../core/logger.js";
import { ledgerPath } from "../../core/paths.js";
import { estimateTokens } from "../../core/tokens.js";
import { Ledger } from "./db.js";

export const FAST_EXPAND_SECONDS = 120;

export function recordFold(input: {
  filePath: string;
  project?: string;
  totalLines: number;
  shownLines: number;
  fullText: string;
  outlineText: string;
  rev: string;
}): void {
  const ledger = openQuiet();
  if (!ledger) return;
  try {
    ledger.insertFold({
      ts: Date.now(),
      source: "mcp",
      project: input.project ?? null,
      path: input.filePath,
      ext: path.extname(input.filePath).toLowerCase() || "(none)",
      totalLines: input.totalLines,
      shownLines: input.shownLines,
      fullTokens: estimateTokens(input.fullText),
      outlineTokens: estimateTokens(input.outlineText),
      rev: input.rev,
    });
  } finally {
    ledger.close();
  }
}

export function recordExpand(input: {
  filePath: string;
  text: string;
  startLine?: number;
  endLine?: number;
  rev?: string;
}): void {
  const ledger = openQuiet();
  if (!ledger) return;
  try {
    const fold = input.filePath ? ledger.latestFold(input.filePath) : undefined;
    const seconds = fold ? (Date.now() - fold.ts) / 1000 : undefined;
    const revOk = !input.rev || !fold?.rev || fold.rev === input.rev;
    const fast = Boolean(fold) && revOk && seconds !== undefined && seconds <= FAST_EXPAND_SECONDS;
    ledger.insertExpand({
      ts: Date.now(),
      foldId: fold?.id,
      path: input.filePath,
      startLine: input.startLine,
      endLine: input.endLine,
      tokens: estimateTokens(input.text),
      secondsAfter: seconds,
      fast,
    });
  } finally {
    ledger.close();
  }
}

function openQuiet(): Ledger | undefined {
  try {
    return Ledger.open(ledgerPath());
  } catch (error) {
    log("warn", "ledger unavailable", { error: String(error) });
    return undefined;
  }
}
