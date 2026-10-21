import fs from "node:fs";
import path from "node:path";
import { log } from "../../core/logger.js";
import { openDatabase, type SqliteDatabase } from "../../core/sqlite.js";
import type { FrozenDecision } from "../../2-traffic-gatekeeper/conversation-state/frozen-decisions.js";
import type { TransformState } from "../../2-traffic-gatekeeper/tunnel-connector/transform.js";
import type { ModelPrice } from "./pricing.js";

export const MIGRATION = `
CREATE TABLE IF NOT EXISTS price_snapshots(
  id INTEGER PRIMARY KEY, provider TEXT, model_pattern TEXT, input_e6 INTEGER, output_e6 INTEGER,
  cache_read_e6 INTEGER, cache_write_5m_e6 INTEGER, cache_write_1h_e6 INTEGER, min_cacheable INTEGER, effective_from TEXT
);
CREATE TABLE IF NOT EXISTS conversations(
  id TEXT PRIMARY KEY, client TEXT, project TEXT, provider TEXT, model TEXT,
  started_at INTEGER, last_seen_at INTEGER, prefix_hash TEXT, compaction_epoch INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS turns(
  id INTEGER PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id), turn_index INTEGER,
  started_at INTEGER, UNIQUE(conversation_id, turn_index)
);
CREATE TABLE IF NOT EXISTS requests(
  id INTEGER PRIMARY KEY, turn_id INTEGER REFERENCES turns(id), conversation_id TEXT,
  source TEXT CHECK(source IN ('proxy','mcp','hook')), client TEXT, provider TEXT, model TEXT, endpoint TEXT,
  provider_request_id TEXT, http_status INTEGER, stream INTEGER, bypass_reason TEXT,
  ts_start INTEGER, ts_first_byte INTEGER, ts_end INTEGER,
  raw_tokens INTEGER, raw_tokens_method TEXT, zoom_in_tokens INTEGER, zoom_out_tokens INTEGER,
  usage_input INTEGER, usage_cache_read INTEGER, usage_cache_write_5m INTEGER, usage_cache_write_1h INTEGER, usage_output INTEGER,
  baseline_cache_read INTEGER, baseline_cache_write INTEGER, price_snapshot_id INTEGER REFERENCES price_snapshots(id),
  baseline_nocache_pico INTEGER, baseline_pico INTEGER, actual_in_pico INTEGER, actual_out_pico INTEGER,
  zoom_extra_pico INTEGER, net_saved_pico INTEGER, display_net_pico INTEGER, verified INTEGER NOT NULL,
  prefix_hash TEXT, prefix_drift INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS receipt_lines(
  id INTEGER PRIMARY KEY, request_id INTEGER REFERENCES requests(id), seq INTEGER,
  filter_id TEXT, kind TEXT, label TEXT, tokens INTEGER, pico INTEGER, ref TEXT
);
CREATE TABLE IF NOT EXISTS fold_events(
  id INTEGER PRIMARY KEY, ts INTEGER, source TEXT, client TEXT, project TEXT, path TEXT, ext TEXT,
  total_lines INTEGER, shown_lines INTEGER, full_tokens INTEGER, outline_tokens INTEGER, rev TEXT, attributed_request_id INTEGER
);
CREATE TABLE IF NOT EXISTS expand_events(
  id INTEGER PRIMARY KEY, ts INTEGER, fold_event_id INTEGER REFERENCES fold_events(id),
  path TEXT, start_line INTEGER, end_line INTEGER, tokens INTEGER, seconds_after_fold REAL, fast_expand INTEGER
);
CREATE TABLE IF NOT EXISTS content_store(
  ref TEXT PRIMARY KEY, sha256 TEXT, bytes INTEGER, gz BLOB, created_at INTEGER, last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS frozen_decisions(
  conversation_id TEXT, msg_hash TEXT, block_idx INTEGER, filter_id TEXT, replacement TEXT,
  epoch INTEGER, PRIMARY KEY(conversation_id, msg_hash, block_idx)
);
CREATE TABLE IF NOT EXISTS volatile_signatures(
  client_fp TEXT, signature TEXT, hits INTEGER, last_seen INTEGER, PRIMARY KEY(client_fp, signature)
);
CREATE TABLE IF NOT EXISTS outline_cache(
  path TEXT, mtime_ms INTEGER, size INTEGER, sha1 TEXT, engine_version TEXT, config_hash TEXT,
  outline TEXT, symbols_json TEXT, PRIMARY KEY(path, engine_version, config_hash)
);
CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests(ts_start);
CREATE INDEX IF NOT EXISTS idx_requests_conv ON requests(conversation_id);
CREATE INDEX IF NOT EXISTS idx_fold_ext ON fold_events(ext);
CREATE TABLE IF NOT EXISTS count_calibration(
  provider TEXT PRIMARY KEY, samples INTEGER NOT NULL, ratio_e6 INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_cache(
  conversation_id TEXT PRIMARY KEY, previous_response_id TEXT, miss_reason TEXT,
  hold_system INTEGER NOT NULL DEFAULT 0, hold_tools INTEGER NOT NULL DEFAULT 0,
  prefix_hash TEXT, updated_at INTEGER
);
`;

export interface RequestRow {
  id: number | bigint;
  ts_start: number | bigint;
  source: string;
  conversation_id?: string | null;
  client: string | null;
  provider: string | null;
  model: string | null;
  project?: string | null;
  verified: number | bigint;
  raw_tokens: number | bigint | null;
  net_saved_pico: number | bigint | null;
  display_net_pico: number | bigint | null;
  usage_input: number | bigint | null;
  usage_cache_read: number | bigint | null;
  usage_cache_write_5m: number | bigint | null;
  usage_output: number | bigint | null;
  bypass_reason: string | null;
  raw_tokens_method?: string | null;
  cache_credit_pico?: number | bigint | null;
  counterfactual?: string | null;
  provider_request_id?: string | null;
}

export class Ledger {
  constructor(readonly db: SqliteDatabase) {}

  static open(file: string): Ledger {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = openDatabase(file);
    db.exec(MIGRATION);
    ensureColumn(db, "requests", "usage_reasoning", "INTEGER");
    ensureColumn(db, "requests", "cache_credit_pico", "INTEGER");
    ensureColumn(db, "requests", "counterfactual", "TEXT");
    return new Ledger(db);
  }

  insertRequest(row: Record<string, string | number | bigint | null>): number {
    const keys = Object.keys(row);
    const sql = `INSERT INTO requests(${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`;
    const result = this.db.prepare(sql).run(...keys.map((key) => row[key]));
    return Number(result.lastInsertRowid);
  }

  insertReceiptLine(requestId: number, seq: number, label: string, tokens: number, pico: bigint, filterId = ""): void {
    this.db.prepare(
      "INSERT INTO receipt_lines(request_id, seq, filter_id, kind, label, tokens, pico) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(requestId, seq, filterId, "note", label, tokens, pico);
  }

  list(limit = 100, where = "1=1", params: unknown[] = []): RequestRow[] {
    return this.db.prepare(`SELECT * FROM requests WHERE ${where} ORDER BY ts_start DESC LIMIT ?`).all(...params, limit) as RequestRow[];
  }

  verifiedNetSince(start: number): bigint {
    const row = this.db.prepare(
      "SELECT COALESCE(SUM(display_net_pico), 0) AS total FROM requests WHERE verified = 1 AND ts_start >= ?",
    ).get(start) as { total: bigint | number };
    return BigInt(row.total);
  }

  lastVerifiedNet(): bigint {
    const row = this.db.prepare(
      "SELECT display_net_pico AS total FROM requests WHERE verified = 1 ORDER BY ts_start DESC LIMIT 1",
    ).get() as { total: bigint | number } | undefined;
    return row ? BigInt(row.total) : 0n;
  }

  calibratedNetSince(start: number): bigint {
    const row = this.db.prepare(
      "SELECT COALESCE(SUM(display_net_pico), 0) AS total FROM requests WHERE raw_tokens_method = 'calibrated' AND ts_start >= ?",
    ).get(start) as { total: bigint | number };
    return BigInt(row.total);
  }

  ensurePrice(price: ModelPrice): number {
    const found = this.db.prepare(
      `SELECT id FROM price_snapshots
       WHERE provider = ? AND model_pattern = ? AND input_e6 = ? AND output_e6 = ?
         AND cache_read_e6 = ? AND cache_write_5m_e6 = ? AND cache_write_1h_e6 = ? AND min_cacheable = ?`,
    ).get(
      price.provider, price.pattern, price.inputE6, price.outputE6,
      price.cacheReadE6, price.cacheWrite5mE6, price.cacheWrite1hE6, price.minCacheable,
    ) as { id: number | bigint } | undefined;
    if (found) return Number(found.id);
    const result = this.db.prepare(
      `INSERT INTO price_snapshots(
        provider, model_pattern, input_e6, output_e6, cache_read_e6, cache_write_5m_e6, cache_write_1h_e6, min_cacheable, effective_from
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      price.provider, price.pattern, price.inputE6, price.outputE6,
      price.cacheReadE6, price.cacheWrite5mE6, price.cacheWrite1hE6, price.minCacheable,
      new Date().toISOString(),
    );
    return Number(result.lastInsertRowid);
  }

  calibration(provider: string): { samples: number; ratioE6: number } | undefined {
    const row = this.db.prepare(
      "SELECT samples, ratio_e6 FROM count_calibration WHERE provider = ?",
    ).get(provider) as { samples: number | bigint; ratio_e6: number | bigint } | undefined;
    if (!row || Number(row.samples) <= 0) return undefined;
    return { samples: Number(row.samples), ratioE6: Number(row.ratio_e6) };
  }

  noteCalibration(provider: string, providerTokens: number, byteTokens: number): void {
    if (!provider || byteTokens <= 0 || providerTokens < 0) return;
    const sample = Math.round((providerTokens * 1_000_000) / byteTokens);
    const prev = this.calibration(provider);
    const now = Date.now();
    if (!prev) {
      this.db.prepare(
        "INSERT INTO count_calibration(provider, samples, ratio_e6, updated_at) VALUES (?, 1, ?, ?)",
      ).run(provider, sample, now);
      return;
    }
    const samples = prev.samples + 1;
    const ratio = Math.round((prev.ratioE6 * prev.samples + sample) / samples);
    this.db.prepare(
      "UPDATE count_calibration SET samples = ?, ratio_e6 = ?, updated_at = ? WHERE provider = ?",
    ).run(samples, ratio, now, provider);
  }

  insertFold(row: {
    ts: number; source: string; client?: string | null; project?: string | null; path: string; ext: string;
    totalLines: number; shownLines: number; fullTokens: number; outlineTokens: number; rev: string;
  }): number {
    const result = this.db.prepare(
      `INSERT INTO fold_events(
        ts, source, client, project, path, ext, total_lines, shown_lines, full_tokens, outline_tokens, rev
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.ts, row.source, row.client ?? null, row.project ?? null, row.path, row.ext, row.totalLines, row.shownLines, row.fullTokens, row.outlineTokens, row.rev);
    return Number(result.lastInsertRowid);
  }

  latestFold(filePath: string): { id: number; ts: number; rev: string } | undefined {
    const row = this.db.prepare(
      "SELECT id, ts, rev FROM fold_events WHERE path = ? ORDER BY ts DESC LIMIT 1",
    ).get(filePath) as { id: number | bigint; ts: number | bigint; rev: string } | undefined;
    if (!row) return undefined;
    return { id: Number(row.id), ts: Number(row.ts), rev: row.rev };
  }

  insertExpand(row: {
    ts: number; foldId?: number; path: string; startLine?: number; endLine?: number;
    tokens: number; secondsAfter?: number; fast: boolean;
  }): void {
    this.db.prepare(
      `INSERT INTO expand_events(
        ts, fold_event_id, path, start_line, end_line, tokens, seconds_after_fold, fast_expand
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.ts, row.foldId ?? null, row.path, row.startLine ?? null, row.endLine ?? null,
      row.tokens, row.secondsAfter ?? null, row.fast ? 1 : 0,
    );
  }

  tokensRemoved(): number {
    const row = this.db.prepare(
      `SELECT
         COALESCE((SELECT SUM(full_tokens - outline_tokens) FROM fold_events), 0)
         - COALESCE((SELECT SUM(tokens) FROM expand_events), 0) AS net`,
    ).get() as { net: number | bigint };
    return Number(row.net);
  }

  fastExpandRate(): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS folds,
         COALESCE(SUM(CASE WHEN id IN (SELECT fold_event_id FROM expand_events WHERE fast_expand = 1) THEN 1 ELSE 0 END), 0) AS fast
       FROM fold_events`,
    ).get() as { folds: number | bigint; fast: number | bigint };
    const folds = Number(row.folds);
    if (!folds) return 0;
    return Number(row.fast) / folds;
  }

  foldRates(): { ext: string; folds: number; rate: number }[] {
    const rows = this.db.prepare(
      `SELECT ext, COUNT(*) AS folds,
         COALESCE(SUM(CASE WHEN id IN (SELECT fold_event_id FROM expand_events WHERE fast_expand = 1) THEN 1 ELSE 0 END), 0) AS fast
       FROM fold_events GROUP BY ext`,
    ).all() as { ext: string; folds: number | bigint; fast: number | bigint }[];
    return rows.map((row) => {
      const folds = Number(row.folds);
      const fast = Number(row.fast);
      return { ext: row.ext, folds, rate: folds ? fast / folds : 0 };
    });
  }

  attach(state: TransformState): void {
    const decisions = this.db.prepare(
      "SELECT conversation_id, msg_hash, block_idx, filter_id, replacement, epoch FROM frozen_decisions",
    ).all() as { conversation_id: string; msg_hash: string; block_idx: number | bigint; filter_id: string; replacement: string; epoch: number | bigint }[];
    for (const row of decisions) {
      state.decisions.seed(state.decisions.key(row.conversation_id, row.msg_hash, Number(row.block_idx)), {
        filterId: row.filter_id,
        replacement: row.replacement,
        epoch: Number(row.epoch),
      });
    }
    state.decisions.onSet = (key, decision) => {
      try {
        this.persistDecision(key, decision);
      } catch (error) {
        log("warn", "decision persist failed", { error: String(error) });
      }
    };
    const caches = this.db.prepare(
      "SELECT conversation_id, previous_response_id, miss_reason, hold_system, hold_tools FROM conversation_cache",
    ).all() as { conversation_id: string; previous_response_id: string | null; miss_reason: string | null; hold_system: number | bigint; hold_tools: number | bigint }[];
    for (const row of caches) {
      if (row.previous_response_id) state.previousResponseId.set(row.conversation_id, row.previous_response_id);
      if (Number(row.hold_system) || Number(row.hold_tools)) {
        state.holds.set(row.conversation_id, {
          system: Number(row.hold_system) === 1,
          tools: Number(row.hold_tools) === 1,
          reason: row.miss_reason ?? undefined,
        });
      }
    }
  }

  persistDecision(key: string, decision: FrozenDecision): void {
    const [conversationId, msgHash, blockIdx] = key.split("|");
    if (!conversationId || !msgHash || blockIdx === undefined) return;
    this.db.prepare(
      `INSERT INTO frozen_decisions(conversation_id, msg_hash, block_idx, filter_id, replacement, epoch)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id, msg_hash, block_idx) DO UPDATE SET
         filter_id = excluded.filter_id, replacement = excluded.replacement, epoch = excluded.epoch`,
    ).run(conversationId, msgHash, Number(blockIdx), decision.filterId, decision.replacement, decision.epoch);
  }

  saveConversationCache(row: {
    conversationId: string;
    previousResponseId?: string;
    missReason?: string | null;
    holdSystem: boolean;
    holdTools: boolean;
    prefixHash?: string;
  }): void {
    this.db.prepare(
      `INSERT INTO conversation_cache(
        conversation_id, previous_response_id, miss_reason, hold_system, hold_tools, prefix_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        previous_response_id = COALESCE(excluded.previous_response_id, conversation_cache.previous_response_id),
        miss_reason = excluded.miss_reason,
        hold_system = excluded.hold_system,
        hold_tools = excluded.hold_tools,
        prefix_hash = COALESCE(excluded.prefix_hash, conversation_cache.prefix_hash),
        updated_at = excluded.updated_at`,
    ).run(
      row.conversationId,
      row.previousResponseId ?? null,
      row.missReason ?? null,
      row.holdSystem ? 1 : 0,
      row.holdTools ? 1 : 0,
      row.prefixHash ?? null,
      Date.now(),
    );
  }

  close(): void {
    this.db.close();
  }
}

function ensureColumn(db: SqliteDatabase, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((col) => col.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
