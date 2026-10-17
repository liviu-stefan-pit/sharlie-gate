import { spawnSync } from "node:child_process";
import path from "node:path";

/** Opt-in. A dead proxy must not be the default, so autostart is only used with --with-proxy. */
export function installAutostart(nodeBin: string, gateBin: string): string {
  const command = `"${nodeBin}" "${gateBin}" proxy`;
  if (process.platform === "win32") {
    const task = `schtasks /Create /F /TN SharlieGate /SC ONLOGON /TR ${command}`;
    return task;
  }
  if (process.platform === "darwin") {
    return `launchctl bootstrap gui/${process.getuid?.() ?? 0} ${path.join(process.env.HOME ?? "", "Library/LaunchAgents/sharlie-gate.plist")}`;
  }
  return "systemctl --user enable --now sharlie-gate.service";
}

export function autostartAvailable(): boolean {
  if (process.platform === "win32") return spawnSync("schtasks", ["/?"], { encoding: "utf8" }).status === 0;
  return true;
}
