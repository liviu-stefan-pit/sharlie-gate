import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { hostAllowed } from "../../2-traffic-gatekeeper/tunnel-connector/router.js";
import { handleLedgerRequest } from "./ledger-page.js";

export const PROXY_LEDGER_URL = "http://127.0.0.1:8080/ledger";
export const DASHBOARD_PORT = 8731;

export function ledgerUrl(port: number): string {
  return `http://127.0.0.1:${port}/ledger`;
}

export async function ledgerResponding(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(700) });
    return response.ok;
  } catch {
    return false;
  }
}

export interface LedgerServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export function startLedgerServer(file: string, port = DASHBOARD_PORT): Promise<LedgerServer> {
  const server = http.createServer((req, res) => {
    if (!hostAllowed(req.headers.host)) {
      res.writeHead(403).end("forbidden host");
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      res.writeHead(302, { location: "/ledger" }).end();
      return;
    }
    if (handleLedgerRequest(req, res, file)) return;
    res.writeHead(404).end("not found");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : port;
      resolve({
        port: bound,
        url: ledgerUrl(bound),
        close: () => new Promise((done, fail) => server.close((err) => (err ? fail(err) : done()))),
      });
    });
  });
}

export function writeDashboardPid(pidFile: string, pid: number): void {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, `${pid}\n`);
}

export function clearDashboardPid(pidFile: string, pid: number): void {
  try {
    const current = Number(fs.readFileSync(pidFile, "utf8"));
    if (current === pid) fs.rmSync(pidFile, { force: true });
  } catch {
    // The pid file is already gone.
  }
}

export function openBrowser(url: string): void {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return;
  }
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [url], { detached: true, stdio: "ignore" }).unref();
}

export interface DashboardSession {
  url: string;
  started: boolean;
  close?: () => Promise<void>;
}

export async function openDashboard(opts: {
  ledgerFile: string;
  port?: number;
  proxyUrl?: string;
  pidFile?: string;
  open?: (url: string) => void;
  probe?: (url: string) => Promise<boolean>;
}): Promise<DashboardSession> {
  const port = opts.port ?? DASHBOARD_PORT;
  const probe = opts.probe ?? ledgerResponding;
  const open = opts.open ?? (() => undefined);
  const proxyUrl = opts.proxyUrl ?? PROXY_LEDGER_URL;
  if (await probe(proxyUrl)) {
    open(proxyUrl);
    return { url: proxyUrl, started: false };
  }
  const ownUrl = ledgerUrl(port);
  if (port !== 0 && await probe(ownUrl)) {
    open(ownUrl);
    return { url: ownUrl, started: false };
  }
  let server: LedgerServer;
  try {
    server = await startLedgerServer(opts.ledgerFile, port);
  } catch (error) {
    if (isAddrInUse(error) && await probe(ownUrl)) {
      open(ownUrl);
      return { url: ownUrl, started: false };
    }
    throw error;
  }
  if (opts.pidFile) writeDashboardPid(opts.pidFile, process.pid);
  open(server.url);
  return {
    url: server.url,
    started: true,
    close: async () => {
      if (opts.pidFile) clearDashboardPid(opts.pidFile, process.pid);
      await server.close();
    },
  };
}

function isAddrInUse(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EADDRINUSE");
}
