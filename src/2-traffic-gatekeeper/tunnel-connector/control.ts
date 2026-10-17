import fs from "node:fs";
import path from "node:path";
import { bypassFlagPath } from "../../core/paths.js";

export function isBypassed(): boolean {
  if (process.env.SHARLIE_GATE_BYPASS === "1") return true;
  try {
    return fs.existsSync(bypassFlagPath()) && fs.readFileSync(bypassFlagPath(), "utf8").trim() === "on";
  } catch {
    return false;
  }
}

export function setBypass(on: boolean): void {
  fs.mkdirSync(path.dirname(bypassFlagPath()), { recursive: true });
  if (on) fs.writeFileSync(bypassFlagPath(), "on");
  else if (fs.existsSync(bypassFlagPath())) fs.rmSync(bypassFlagPath());
}
