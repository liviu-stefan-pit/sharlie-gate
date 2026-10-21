import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ledgerHtml } from "../../src/4-savings-dashboard/web/ledger-page.js";
import { DASHBOARD_PORT, PROXY_LEDGER_URL, ledgerUrl, openDashboard, startLedgerServer } from "../../src/4-savings-dashboard/web/dashboard.js";

function removeSqlite(file: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) fs.rmSync(`${file}${suffix}`, { force: true });
}

describe("dashboard", () => {
  it("shows saved today and the last turn on the ledger page", () => {
    const html = ledgerHtml([], undefined, { today: 60_000_000_000n, last: 10_000_000_000n });
    expect(html).toContain("<strong>Saved today</strong> $0.06");
    expect(html).toContain("<strong>Last turn</strong> +$0.01");
  });

  it("serves that headline from the loopback ledger", async () => {
    const file = path.join(os.tmpdir(), `sg-dash-${Date.now()}-${process.pid}.sqlite`);
    const server = await startLedgerServer(file, 0);
    try {
      const response = await fetch(server.url);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("<strong>Saved today</strong>");
      expect(html).toContain("<strong>Last turn</strong>");
    } finally {
      await server.close();
      removeSqlite(file);
    }
  });

  it("opens the proxy ledger when the proxy is already up", async () => {
    const opened: string[] = [];
    const session = await openDashboard({
      ledgerFile: path.join(os.tmpdir(), "unused.sqlite"),
      probe: async (url) => url === PROXY_LEDGER_URL,
      open: (url) => opened.push(url),
    });
    expect(session.started).toBe(false);
    expect(session.url).toBe(PROXY_LEDGER_URL);
    expect(opened).toEqual([PROXY_LEDGER_URL]);
  });

  it("reuses a dashboard that is already listening", async () => {
    const opened: string[] = [];
    const session = await openDashboard({
      ledgerFile: path.join(os.tmpdir(), "unused.sqlite"),
      port: DASHBOARD_PORT,
      probe: async (url) => url === ledgerUrl(DASHBOARD_PORT),
      open: (url) => opened.push(url),
    });
    expect(session.started).toBe(false);
    expect(opened).toEqual([ledgerUrl(DASHBOARD_PORT)]);
  });

  it("starts a ledger server and records its pid when nothing is listening", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sg-dash-pid-"));
    const file = path.join(dir, "ledger.sqlite");
    const pidFile = path.join(dir, "dashboard.pid");
    const opened: string[] = [];
    const session = await openDashboard({
      ledgerFile: file,
      port: 0,
      pidFile,
      probe: async () => false,
      open: (url) => opened.push(url),
    });
    try {
      expect(session.started).toBe(true);
      expect(opened).toEqual([session.url]);
      const html = await (await fetch(session.url)).text();
      expect(html).toContain("<strong>Saved today</strong>");
      expect(fs.readFileSync(pidFile, "utf8").trim()).toBe(String(process.pid));
    } finally {
      await session.close?.();
      expect(fs.existsSync(pidFile)).toBe(false);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
