import { createRequire } from "node:module";

type Statement = {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  iterate(...params: unknown[]): IterableIterator<unknown>;
};

export type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
};

type DatabaseCtor = new (
  path: string,
  options?: { readBigInts?: boolean; timeout?: number },
) => SqliteDatabase;

/**
 * Node 24 exposes DatabaseSync. Node 26 renamed it to Database and kept
 * DatabaseSync as a deprecated alias. Either one works with no native addon.
 */
export function openDatabase(file: string, options?: { readOnly?: boolean }): SqliteDatabase {
  const require = createRequire(import.meta.url);
  const sqlite = require("node:sqlite") as {
    Database?: DatabaseCtor;
    DatabaseSync?: DatabaseCtor;
  };
  const Ctor = sqlite.Database ?? sqlite.DatabaseSync;
  if (!Ctor) throw new Error("node:sqlite is unavailable. Sharlie-Gate requires Node.js >= 24.11.");
  const db = new Ctor(file, { readBigInts: true, timeout: 2000 });
  if (!options?.readOnly) {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 2000;");
    db.exec("PRAGMA foreign_keys = ON;");
  }
  return db;
}
