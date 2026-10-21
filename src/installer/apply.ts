import fs from "node:fs";
import path from "node:path";
import { upsertJson } from "./json-merge.js";
import { upsertTomlTable } from "./toml-merge.js";
import { managedBlock, renderInstructionsMd, renderMdc, renderSkill } from "../3-safety-rules-and-config/editor-instructions/render.js";
import { remember, type Manifest } from "./manifest.js";

export interface InstallOptions {
  home: string;
  nodePath: string;
  binPath: string;
  project?: string;
  withProxy?: boolean;
  enforce?: boolean;
  legacyVscode?: boolean;
  dataDir: string;
}

export interface PlannedWrite {
  file: string;
  next: string;
}

/** Quote a path for cmd, PowerShell, and bash when it contains spaces or quotes. */
export function quoteShell(value: string): string {
  if (!/[\s"]/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

export function hookCommand(nodePath: string, binPath: string, args: string, shell: "cmd" | "bash" | "powershell"): string {
  const node = quoteShell(nodePath);
  const bin = quoteShell(binPath);
  const exe = shell === "powershell" && node.startsWith('"') ? `& ${node}` : node;
  return `${exe} ${bin} ${args}`;
}

export function planWrites(opts: InstallOptions): PlannedWrite[] {
  const writes: PlannedWrite[] = [];
  const mcp = { command: opts.nodePath, args: [opts.binPath, "mcp"] };
  const cursor = path.join(opts.home, ".cursor");
  if (fs.existsSync(cursor)) {
    writes.push(jsonWrite(path.join(cursor, "mcp.json"), ["mcpServers", "sharlie-gate"], mcp));
    writes.push({ file: path.join(cursor, "plugins", "local", "sharlie-gate", ".cursor-plugin", "plugin.json"), next: JSON.stringify({ name: "sharlie-gate", displayName: "Sharlie-Gate", version: "0.1.0", description: "Outline-first workspace reader." }, null, 2) });
    writes.push({ file: path.join(cursor, "plugins", "local", "sharlie-gate", "rules", "sharlie-gate.mdc"), next: renderMdc() });
    writes.push({ file: path.join(cursor, "plugins", "local", "sharlie-gate", "skills", "sharlie-gate-reader", "SKILL.md"), next: renderSkill() });
    const settingsPath = path.join(cursor, "settings.json");
    const settings = readText(settingsPath);
    let plugins: string[] = [];
    try {
      plugins = (JSON.parse(settings || "{}") as { enabled_plugins?: string[] }).enabled_plugins ?? [];
    } catch {
      plugins = [];
    }
    if (!plugins.includes("sharlie-gate")) plugins = [...plugins, "sharlie-gate"];
    writes.push(jsonWrite(settingsPath, ["enabled_plugins"], plugins));
    if (opts.enforce) {
      const cursorHook = (event: string) => hookCommand(opts.nodePath, opts.binPath, `hook cursor ${event}`, "cmd");
      writes.push({
        file: path.join(cursor, "hooks.json"),
        next: JSON.stringify({
          version: 1,
          hooks: {
            beforeReadFile: [{ command: cursorHook("beforeReadFile") }],
            preToolUse: [{ command: cursorHook("preToolUse") }],
            postToolUse: [{ command: cursorHook("postToolUse") }],
          },
        }, null, 2),
      });
    }
  }
  const copilot = path.join(opts.home, ".copilot");
  if (fs.existsSync(copilot)) {
    writes.push(jsonWrite(path.join(copilot, "mcp-config.json"), ["mcpServers", "sharlie-gate"], mcp));
    writes.push({ file: path.join(copilot, "instructions", "sharlie-gate.instructions.md"), next: renderInstructionsMd() });
    writes.push({ file: path.join(copilot, "skills", "sharlie-gate-reader", "SKILL.md"), next: renderSkill() });
    const hookCmd = (event: string, timeoutSec: number) => ({
      type: "command",
      bash: hookCommand(opts.nodePath, opts.binPath, `hook copilot ${event}`, "bash"),
      powershell: hookCommand(opts.nodePath, opts.binPath, `hook copilot ${event}`, "powershell"),
      timeoutSec,
    });
    writes.push({
      file: path.join(copilot, "hooks", "sharlie-gate.json"),
      next: JSON.stringify({
        version: 1,
        hooks: {
          userPromptSubmitted: [hookCmd("userPromptSubmitted", 10)],
          preToolUse: [hookCmd("preToolUse", 15)],
          postToolUse: [hookCmd("postToolUse", 20)],
        },
      }, null, 2),
    });
  }
  const claude = path.join(opts.home, ".claude");
  if (fs.existsSync(claude) || fs.existsSync(path.join(opts.home, ".claude.json"))) {
    const claudeJson = path.join(opts.home, ".claude.json");
    writes.push(jsonWrite(claudeJson, ["mcpServers", "sharlie-gate"], mcp));
    const guide = path.join(claude, "CLAUDE.md");
    writes.push({ file: guide, next: upsertBlock(readText(guide), managedBlock()) });
    if (opts.withProxy) {
      const settings = path.join(claude, "settings.json");
      writes.push(jsonWrite(settings, ["env", "ANTHROPIC_BASE_URL"], "http://127.0.0.1:8080/anthropic"));
    }
  }
  const codex = path.join(opts.home, ".codex");
  if (fs.existsSync(codex)) {
    const toml = path.join(codex, "config.toml");
    const fields: Record<string, string> = { command: JSON.stringify(opts.nodePath), args: JSON.stringify([opts.binPath, "mcp"]) };
    writes.push({ file: toml, next: upsertTomlTable(readText(toml), "mcp_servers.sharlie-gate", fields) });
    const agents = path.join(codex, "AGENTS.md");
    writes.push({ file: agents, next: upsertBlock(readText(agents), managedBlock()) });
  }
  const opencode = path.join(opts.home, ".config", "opencode");
  if (fs.existsSync(opencode)) {
    writes.push(jsonWrite(path.join(opencode, "opencode.json"), ["mcp", "sharlie-gate"], { type: "local", command: [opts.nodePath, opts.binPath, "mcp"] }));
    const agents = path.join(opencode, "AGENTS.md");
    writes.push({ file: agents, next: upsertBlock(readText(agents), managedBlock()) });
  }
  if (opts.legacyVscode && opts.project) {
    writes.push(jsonWrite(path.join(opts.project, ".vscode", "mcp.json"), ["servers", "sharlie-gate"], mcp));
  }
  if (opts.project) {
    writes.push({ file: path.join(opts.project, ".cursor", "rules", "sharlie-gate.mdc"), next: renderMdc() });
    const copilotInstructions = path.join(opts.project, ".github", "copilot-instructions.md");
    writes.push({ file: copilotInstructions, next: upsertBlock(readText(copilotInstructions), managedBlock()) });
    const agents = path.join(opts.project, "AGENTS.md");
    writes.push({ file: agents, next: upsertBlock(readText(agents), managedBlock()) });
  }
  return writes;
}

export function applyWrites(writes: PlannedWrite[], manifest: Manifest, dryRun: boolean): string {
  const diffs: string[] = [];
  for (const write of writes) {
    const previous = fs.existsSync(write.file) ? fs.readFileSync(write.file, "utf8") : "";
    if (previous === write.next) continue;
    diffs.push(`--- ${write.file}\n+++ ${write.file}\n${write.next}`);
    if (!dryRun) {
      remember(manifest, write.file);
      const backup = `${write.file}.sharlie-gate.bak`;
      if (previous && !fs.existsSync(backup)) fs.writeFileSync(backup, previous);
      fs.mkdirSync(path.dirname(write.file), { recursive: true });
      fs.writeFileSync(write.file, write.next);
    }
  }
  return diffs.join("\n");
}

function jsonWrite(file: string, pointer: string[], value: unknown): PlannedWrite {
  return { file, next: upsertJson(readText(file), pointer, value) };
}

function readText(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function upsertBlock(existing: string, block: string): string {
  const begin = "<!-- sharlie-gate:begin -->";
  const end = "<!-- sharlie-gate:end -->";
  const start = existing.indexOf(begin);
  const stop = existing.indexOf(end);
  if (start >= 0 && stop > start) return `${existing.slice(0, start)}${block}${existing.slice(stop + end.length)}`;
  return existing.trim().length ? `${existing.trim()}\n\n${block}\n` : `${block}\n`;
}
