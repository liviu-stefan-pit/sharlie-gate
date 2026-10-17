import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { openDatabase, type SqliteDatabase } from "./sqlite.js";

export type StoredBlob = { ref: string; sha256: string; text: string };

export class ContentStore {
  constructor(private readonly db: SqliteDatabase) {}

  static open(file: string): ContentStore {
    const db = openDatabase(file);
    db.exec(`CREATE TABLE IF NOT EXISTS content_store(
      ref TEXT PRIMARY KEY,
      sha256 TEXT,
      bytes INTEGER,
      gz BLOB,
      created_at INTEGER,
      last_used_at INTEGER
    );`);
    return new ContentStore(db);
  }

  put(text: string): string {
    const sha256 = createHash("sha256").update(text).digest("hex");
    const ref = `sg:${sha256.slice(0, 8)}`;
    const now = Date.now();
    const gz = gzipSync(Buffer.from(text, "utf8"));
    this.db.prepare(
      `INSERT INTO content_store(ref, sha256, bytes, gz, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(ref) DO UPDATE SET last_used_at = excluded.last_used_at`,
    ).run(ref, sha256, Buffer.byteLength(text), gz, now, now);
    return ref;
  }

  get(ref: string): string | undefined {
    const row = this.db.prepare("SELECT gz FROM content_store WHERE ref = ?").get(ref) as
      | { gz: Buffer }
      | undefined;
    if (!row) return undefined;
    this.db.prepare("UPDATE content_store SET last_used_at = ? WHERE ref = ?").run(Date.now(), ref);
    return gunzipSync(row.gz).toString("utf8");
  }

  /** Drop entries older than ttlDays, then oldest until under maxBytes. */
  prune(ttlDays: number, maxBytes: number): void {
    const cutoff = Date.now() - ttlDays * 86_400_000;
    this.db.prepare("DELETE FROM content_store WHERE last_used_at < ?").run(cutoff);
    const rows = this.db.prepare(
      "SELECT ref, bytes FROM content_store ORDER BY last_used_at DESC",
    ).all() as { ref: string; bytes: number | bigint }[];
    let used = 0;
    const drop: string[] = [];
    for (const row of rows) {
      const size = Number(row.bytes);
      if (used + size > maxBytes) drop.push(row.ref);
      else used += size;
    }
    const stmt = this.db.prepare("DELETE FROM content_store WHERE ref = ?");
    for (const ref of drop) stmt.run(ref);
  }

  close(): void {
    this.db.close();
  }
}
