import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyWrites, hookCommand, planWrites } from "../../src/installer/apply.js";
import { purgeInstall } from "../../src/installer/purge.js";

describe("hook commands", () => {
  it("quotes paths that contain spaces and keeps plain paths bare", () => {
    const nodePath = "C:\\Program Files\\Sharlie-Gate\\node\\node.exe";
    const binPath = "C:\\Users\\A B\\.sharlie-gate\\bin\\sharlie-gate.mjs";
    expect(hookCommand(nodePath, binPath, "hook cursor preToolUse", "cmd")).toBe(
      `"${nodePath}" "${binPath}" hook cursor preToolUse`,
    );
    expect(hookCommand(nodePath, binPath, "hook copilot preToolUse", "powershell")).toBe(
      `& "${nodePath}" "${binPath}" hook copilot preToolUse`,
    );
    expect(hookCommand(nodePath, binPath, "hook copilot preToolUse", "bash")).toBe(
      `"${nodePath}" "${binPath}" hook copilot preToolUse`,
    );
    const plainNode = "C:\\node\\node.exe";
    const plainBin = "C:\\gate\\sharlie-gate.mjs";
    expect(hookCommand(plainNode, plainBin, "hook cursor preToolUse", "cmd")).toBe(
      `${plainNode} ${plainBin} hook cursor preToolUse`,
    );
    expect(hookCommand(plainNode, plainBin, "hook copilot preToolUse", "powershell")).toBe(
      `${plainNode} ${plainBin} hook copilot preToolUse`,
    );
  });

  it("points Cursor and Copilot hooks at that node.exe", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "sg-hooks-"));
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    fs.mkdirSync(path.join(home, ".copilot"), { recursive: true });
    const nodePath = "C:\\Program Files\\node\\node.exe";
    const binPath = "C:\\Users\\A B\\sharlie-gate.mjs";
    const writes = planWrites({
      home,
      nodePath,
      binPath,
      enforce: true,
      dataDir: path.join(home, "data"),
    });
    const cursor = writes.find((write) => write.file.endsWith(`${path.sep}hooks.json`));
    const copilot = writes.find((write) => write.file.endsWith(`${path.sep}sharlie-gate.json`));
    expect(cursor).toBeDefined();
    expect(copilot).toBeDefined();
    if (!cursor || !copilot) return;
    const cursorHooks = JSON.parse(cursor.next) as { hooks: { beforeReadFile: { command: string }[] } };
    const copilotHooks = JSON.parse(copilot.next) as {
      hooks: { preToolUse: { bash: string; powershell: string }[] };
    };
    expect(cursorHooks.hooks.beforeReadFile[0]?.command).toBe(
      hookCommand(nodePath, binPath, "hook cursor beforeReadFile", "cmd"),
    );
    expect(copilotHooks.hooks.preToolUse[0]?.powershell).toBe(
      hookCommand(nodePath, binPath, "hook copilot preToolUse", "powershell"),
    );
    expect(copilotHooks.hooks.preToolUse[0]?.bash).toBe(
      hookCommand(nodePath, binPath, "hook copilot preToolUse", "bash"),
    );
    expect(copilotHooks.hooks.preToolUse[0]?.bash.startsWith("node ")).toBe(false);
  });
});

describe("purge", () => {
  it("restores configs and deletes backups, empty install dirs, and the data folder", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "sg-purge-"));
    const dataDir = path.join(home, ".sharlie-gate");
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    fs.mkdirSync(path.join(home, ".copilot", "skills"), { recursive: true });
    const mcp = path.join(home, ".cursor", "mcp.json");
    const original = "{\"mcpServers\":{}}\n";
    fs.writeFileSync(mcp, original);
    const manifest = { version: 1 as const, files: {} };
    applyWrites(planWrites({
      home,
      nodePath: "C:\\Program Files\\node\\node.exe",
      binPath: "C:\\Users\\A B\\sharlie-gate.mjs",
      dataDir,
      enforce: true,
    }), manifest, false);
    const plugin = path.join(home, ".cursor", "plugins", "local", "sharlie-gate");
    expect(fs.existsSync(path.join(plugin, "rules", "sharlie-gate.mdc"))).toBe(true);
    expect(fs.existsSync(`${mcp}.sharlie-gate.bak`)).toBe(true);
    fs.writeFileSync(path.join(plugin, "notes.txt"), "keep");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "ledger.sqlite"), "x");
    let stopped = 0;
    let tasks = 0;
    purgeInstall({
      dataDir,
      manifest,
      selfPid: 42,
      stopProcesses: (pid) => { stopped = pid; },
      removeScheduledTask: () => { tasks += 1; },
    });
    expect(stopped).toBe(42);
    expect(tasks).toBe(1);
    expect(fs.readFileSync(mcp, "utf8")).toBe(original);
    expect(fs.existsSync(`${mcp}.sharlie-gate.bak`)).toBe(false);
    expect(fs.readFileSync(path.join(plugin, "notes.txt"), "utf8")).toBe("keep");
    expect(fs.existsSync(path.join(plugin, "rules"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".copilot", "skills", "sharlie-gate-reader"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".copilot", "hooks", "sharlie-gate.json"))).toBe(false);
    expect(fs.existsSync(dataDir)).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
