import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { SERVER_VERSION, connectReader } from "../1-editor-helper-tools/mcp-server/server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startProxy } from "../2-traffic-gatekeeper/tunnel-connector/server.js";
import { createTransformState } from "../2-traffic-gatekeeper/tunnel-connector/transform.js";
import { recordProxyCompletion } from "../4-savings-dashboard/token-ledger/record.js";
import { setBypass, isBypassed } from "../2-traffic-gatekeeper/tunnel-connector/control.js";
import { Ledger } from "../4-savings-dashboard/token-ledger/db.js";
import { footerLine, summary } from "../4-savings-dashboard/web/ledger-page.js";
import { formatHeadline, signed } from "../4-savings-dashboard/token-ledger/money.js";
import { binDir, dashboardPidPath, dataDir, homeDir, ledgerPath, manifestPath } from "../core/paths.js";
import { log } from "../core/logger.js";
import { detect } from "../installer/detect.js";
import { applyWrites, planWrites } from "../installer/apply.js";
import { readManifest, restore, writeManifest } from "../installer/manifest.js";
import { installAutostart } from "../installer/autostart.js";
import { purgeInstall } from "../installer/purge.js";
import { openBrowser, openDashboard } from "../4-savings-dashboard/web/dashboard.js";
import { safeCopilot, safeCursor } from "../hooks/copilot-hook.js";
import { ContentStore } from "../core/content-store.js";
import { ensureSymbolRuntime } from "../1-editor-helper-tools/outline-builder/symbols/runtime.js";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    version: { type: "boolean" },
    yes: { type: "boolean" },
    "dry-run": { type: "boolean" },
    project: { type: "string" },
    "with-proxy": { type: "boolean" },
    enforce: { type: "boolean" },
    "legacy-vscode": { type: "boolean" },
    home: { type: "string" },
    port: { type: "string" },
    purge: { type: "boolean" },
    suggest: { type: "boolean" },
    statusline: { type: "boolean" },
    cache: { type: "boolean" },
  },
  allowPositionals: true,
  strict: false,
});

const command = positionals[0] ?? (values.version ? "version" : "help");

async function main(): Promise<void> {
  if (command === "version" || values.version) {
    process.stdout.write(`sharlie-gate ${SERVER_VERSION}\n`);
    return;
  }
  if (command === "mcp") {
    await connectReader(new StdioServerTransport());
    return;
  }
  if (command === "proxy") {
    const ledger = Ledger.open(ledgerPath());
    const state = createTransformState();
    ledger.attach(state);
    const handle = await startProxy({
      port: values.port ? Number(values.port) : undefined,
      state,
      onComplete: (info) => {
        void recordProxyCompletion(ledger, state, info).catch((error) => {
          log("warn", "ledger write failed", { error: String(error) });
        });
      },
    });
    log("info", `listening ${handle.url}`);
    const shutdown = () => {
      ledger.close();
      void handle.close().finally(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    await new Promise(() => undefined);
    return;
  }
  if (command === "init") return init();
  if (command === "uninstall") return uninstall();
  if (command === "doctor") return doctor();
  if (command === "status") return status();
  if (command === "dashboard") {
    await dashboard();
    return;
  }
  if (command === "ledger") {
    process.stdout.write(`ledger ${ledgerPath()}\nhttp://127.0.0.1:${values.port ?? 8080}/ledger\n`);
    return;
  }
  if (command === "bypass") return bypass();
  if (command === "hook") return hook();
  if (command === "run") return runWrapped();
  if (command === "tune") return tune();
  help();
}

function flagString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function flagBool(value: string | boolean | undefined): boolean {
  return value === true || value === "true";
}

function init(): void {
  const home = flagString(values.home) ?? homeDir();
  fs.mkdirSync(binDir(), { recursive: true });
  const dest = path.join(binDir(), "sharlie-gate.mjs");
  const self = process.argv[1] ? path.resolve(process.argv[1]) : dest;
  if (path.resolve(self) !== path.resolve(dest) && fs.existsSync(self)) {
    fs.copyFileSync(self, dest);
    copyBundledAssets(self, dest);
  }
  const found = detect(home);
  const writes = planWrites({
    home,
    nodePath: process.execPath,
    binPath: fs.existsSync(dest) ? dest : self,
    project: flagString(values.project),
    withProxy: flagBool(values["with-proxy"]),
    enforce: flagBool(values.enforce),
    legacyVscode: flagBool(values["legacy-vscode"]),
    dataDir: dataDir(),
  });
  const manifest = readManifest(manifestPath());
  const diff = applyWrites(writes, manifest, Boolean(values["dry-run"]));
  if (!values["dry-run"]) writeManifest(manifestPath(), manifest);
  process.stdout.write(`${JSON.stringify(found)}\n${diff}\n`);
  if (values["with-proxy"] && !values["dry-run"]) {
    process.stdout.write(`${installAutostart(process.execPath, dest)}\n`);
  }
}

function uninstall(): void {
  const manifest = readManifest(manifestPath());
  if (flagBool(values.purge)) {
    purgeInstall({ dataDir: dataDir(), manifest, pidFile: dashboardPidPath() });
    process.stdout.write("purged\n");
    return;
  }
  restore(manifest);
  writeManifest(manifestPath(), { version: 1, files: {} });
  process.stdout.write("uninstalled\n");
}

async function dashboard(): Promise<void> {
  const session = await openDashboard({
    ledgerFile: ledgerPath(),
    port: flagString(values.port) ? Number(flagString(values.port)) : undefined,
    pidFile: dashboardPidPath(),
    open: openBrowser,
  });
  process.stdout.write(`dashboard ${session.url}\n`);
  if (!session.started || !session.close) return;
  const shutdown = () => {
    void session.close?.().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => undefined);
}

function doctor(): void {
  const home = flagString(values.home) ?? homeDir();
  const found = detect(home);
  const problems: string[] = [];
  if (!fs.existsSync(process.execPath)) problems.push("node missing");
  process.stdout.write(`${JSON.stringify({ found, bypass: isBypassed(), problems })}\n`);
  if (problems.length) process.exitCode = 1;
}

function status(): void {
  const ledger = Ledger.open(ledgerPath());
  try {
    const snap = summary(ledger);
    if (values.statusline) {
      process.stdout.write(`${formatHeadline(snap.today)} ${signed(formatHeadline(snap.last))}\n`);
      return;
    }
    process.stdout.write(`${footerLine(0, 0, snap.today)}\n`);
  } finally {
    ledger.close();
  }
}

function bypass(): void {
  const mode = positionals[1];
  if (mode === "on") setBypass(true);
  else if (mode === "off") setBypass(false);
  process.stdout.write(`${isBypassed() ? "on" : "off"}\n`);
}

async function hook(): Promise<void> {
  await ensureSymbolRuntime().catch(() => undefined);
  const family = positionals[1] ?? "copilot";
  const raw = await readStdin();
  let payload: Record<string, unknown> = {};
  try {
    payload = raw.trim() ? JSON.parse(raw) as Record<string, unknown> : {};
  } catch {
    payload = {};
  }
  const event = positionals[2] ?? String(payload.hook_event_name ?? payload.hookEventName ?? "postToolUse");
  const enforce = process.env.SHARLIE_GATE_ENFORCE === "1" || flagBool(values.enforce);
  const result = family === "cursor" ? safeCursor(event, payload, enforce) : safeCopilot(event, payload);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function runWrapped(): void {
  const sep = process.argv.indexOf("--");
  const cmd = (sep >= 0 ? process.argv.slice(sep + 1) : positionals.slice(1)).join(" ");
  if (!cmd) {
    process.stderr.write("usage: sharlie-gate run -- <command>\n");
    process.exitCode = 1;
    return;
  }
  const result = spawnSync(cmd, { shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true });
  const store = ContentStore.open(ledgerPath());
  const ref = store.put(output);
  store.close();
  const lines = output.split(/\r?\n/);
  const shown = lines.length > 200 ? [...lines.slice(0, 30), `... | ref ${ref}`, ...lines.slice(-50)].join("\n") : output;
  process.stdout.write(shown);
  process.exitCode = result.status ?? 1;
}

function tune(): void {
  const ledger = Ledger.open(ledgerPath());
  try {
    const rows = ledger.foldRates();
    if (!rows.length) {
      process.stdout.write("no fold events yet. Suggestions only; nothing is changed automatically.\n");
      return;
    }
    for (const row of rows) {
      if (row.rate >= 0.9) process.stdout.write(`${row.ext}: expanded ${Math.round(row.rate * 100)}% of the time. Consider leaving this type expanded.\n`);
    }
  } finally {
    ledger.close();
  }
}

function copyBundledAssets(fromFile: string, toFile: string): void {
  const fromDir = path.dirname(fromFile);
  const toDir = path.dirname(toFile);
  if (path.resolve(fromDir) === path.resolve(toDir)) return;
  const wasm = path.join(fromDir, "tree-sitter.wasm");
  if (fs.existsSync(wasm)) fs.copyFileSync(wasm, path.join(toDir, "tree-sitter.wasm"));
  const grammars = path.join(fromDir, "grammars");
  if (fs.existsSync(grammars)) fs.cpSync(grammars, path.join(toDir, "grammars"), { recursive: true });
}

function help(): void {
  process.stdout.write("sharlie-gate <init|uninstall|doctor|mcp|proxy|dashboard|status|ledger|hook|run|tune|bypass>\n");
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    if (process.stdin.isTTY) resolve("");
  });
}

main().catch((error) => {
  log("error", String(error));
  process.exitCode = 1;
});
