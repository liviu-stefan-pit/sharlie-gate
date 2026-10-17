import fs from "node:fs";
import path from "node:path";
import { openDatabase, type SqliteDatabase } from "../../core/sqlite.js";

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
`;

export interface RequestRow {
  id: number | bigint;
  ts_start: number | bigint;
  source: string;
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
}

export class Ledger {
  constructor(readonly db: SqliteDatabase) {}

  static open(file: string): Ledger {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = openDatabase(file);
    db.exec(MIGRATION);
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

  close(): void {
    this.db.close();
  }
}
