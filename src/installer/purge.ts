import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { dashboardPidPath } from "../core/paths.js";
import { restore, type Manifest } from "./manifest.js";
import { removeScheduledTask } from "./autostart.js";

const OWNED_DIR_NAMES = new Set(["sharlie-gate", "sharlie-gate-reader"]);

export interface PurgeOptions {
  dataDir: string;
  manifest: Manifest;
  selfPid?: number;
  pidFile?: string;
  stopProcesses?: (selfPid: number) => void;
  removeScheduledTask?: () => void;
}

export function purgeInstall(opts: PurgeOptions): void {
  const selfPid = opts.selfPid ?? process.pid;
  const stop = opts.stopProcesses ?? ((pid) => stopInstallProcesses(pid, opts.pidFile));
  const removeTask = opts.removeScheduledTask ?? removeScheduledTask;
  stop(selfPid);
  removeTask();
  restore(opts.manifest);
  removeBackups(opts.manifest);
  removeOwnedEmptyDirs(Object.keys(opts.manifest.files));
  removeDataDir(opts.dataDir);
}

export function stopInstallProcesses(selfPid: number, pidFile = dashboardPidPath()): void {
  stopRecordedPid(pidFile, selfPid);
  if (process.platform !== "win32") return;
  const command = [
    `$self = ${String(selfPid)}`,
    "Get-CimInstance Win32_Process | Where-Object {",
    "$_.ProcessId -ne $self -and $_.CommandLine -and",
    "($_.CommandLine -like '*sharlie-gate.mjs*') -and",
    "($_.CommandLine -match '(^|\\s)(dashboard|proxy)(\\s|$)')",
    "} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
  ].join(" ");
  spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true,
    stdio: "ignore",
  });
}

export function removeBackups(manifest: Manifest): void {
  for (const file of Object.keys(manifest.files)) {
    const backup = `${file}.sharlie-gate.bak`;
    if (fs.existsSync(backup)) fs.rmSync(backup, { force: true });
  }
}

/** Outermost directory named sharlie-gate or sharlie-gate-reader that contains this file. */
export function ownedInstallDir(file: string): string | undefined {
  let dir = path.dirname(path.resolve(file));
  let found: string | undefined;
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    if (OWNED_DIR_NAMES.has(path.basename(dir))) found = dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return found;
}

export function removeOwnedEmptyDirs(files: string[]): void {
  const roots = new Set<string>();
  for (const file of files) {
    const root = ownedInstallDir(file);
    if (root) roots.add(root);
  }
  for (const root of roots) removeEmptyTree(root);
}

function stopRecordedPid(pidFile: string, selfPid: number): void {
  if (!fs.existsSync(pidFile)) return;
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  if (!Number.isInteger(pid) || pid <= 0 || pid === selfPid) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The dashboard process has already exited.
  }
}

function removeEmptyTree(dir: string): boolean {
  if (!fs.existsSync(dir)) return true;
  if (!fs.statSync(dir).isDirectory()) return false;
  let empty = true;
  for (const name of fs.readdirSync(dir)) {
    const child = path.join(dir, name);
    if (fs.statSync(child).isDirectory()) {
      if (!removeEmptyTree(child)) empty = false;
    } else {
      empty = false;
    }
  }
  if (!empty) return false;
  fs.rmdirSync(dir);
  return true;
}

function removeDataDir(dir: string): void {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      last = error;
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
      sleepMs(100);
    }
  }
  throw last;
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
