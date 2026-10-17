import { homedir } from "node:os";
import path from "node:path";

/** Override the user profile root in tests. Production uses os.homedir(). */
export function homeDir(): string {
  return process.env.SHARLIE_GATE_HOME?.trim() || homedir();
}

export function dataDir(): string {
  return process.env.SHARLIE_GATE_DATA?.trim() || path.join(homeDir(), ".sharlie-gate");
}

export function binDir(): string {
  return path.join(dataDir(), "bin");
}

export function ledgerPath(): string {
  return process.env.SHARLIE_GATE_LEDGER?.trim() || path.join(dataDir(), "ledger.sqlite");
}

export function pricingOverridePath(): string {
  return path.join(dataDir(), "pricing.json");
}

export function manifestPath(): string {
  return path.join(dataDir(), "install-manifest.json");
}

export function bypassFlagPath(): string {
  return path.join(dataDir(), "bypass");
}

export function sessionDir(): string {
  return path.join(dataDir(), "sessions");
}

export function copilotHome(): string {
  return process.env.COPILOT_HOME?.trim() || path.join(homeDir(), ".copilot");
}

export function cursorHome(): string {
  return path.join(homeDir(), ".cursor");
}

export function claudeHome(): string {
  return path.join(homeDir(), ".claude");
}

export function codexHome(): string {
  return path.join(homeDir(), ".codex");
}

export function opencodeConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg || path.join(homeDir(), ".config");
  return path.join(base, "opencode");
}
