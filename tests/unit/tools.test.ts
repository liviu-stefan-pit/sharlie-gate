import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyWrites, planWrites } from "../../src/installer/apply.js";
import { readManifest, restore, writeManifest } from "../../src/installer/manifest.js";
import { safeCopilot } from "../../src/hooks/copilot-hook.js";
import { expandSection } from "../../src/1-editor-helper-tools/section-expander/expander.js";
import { outlineText } from "../../src/1-editor-helper-tools/outline-builder/engine.js";
import { targetedSearch } from "../../src/1-editor-helper-tools/smart-search/search.js";
import { ContentStore } from "../../src/core/content-store.js";

describe("expander and search", () => {
  it("expands a range, rejects a stale rev, and caps a huge span", () => {
    const source = `export function run() {\n${Array.from({ length: 20 }, (_, i) => `  const v${i} = ${i};`).join("\n")}\n}\n`;
    const outlined = outlineText(source, "run.ts", { minLinesToFold: 1 });
    const section = outlined.sections[0];
    expect(section).toBeDefined();
    if (!section) return;
    const expanded = expandSection({ text: source, filePath: "run.ts", startLine: section.start, endLine: section.end });
    expect(source.includes(expanded.text)).toBe(true);
    const drifted = expandSection({ text: source, filePath: "run.ts", startLine: 1, endLine: 2, rev: "deadbeef" });
    expect(drifted.note).toContain("file changed");
    const huge = `export function big() {\n${Array.from({ length: 500 }, (_, i) => `  const v${i} = ${i};`).join("\n")}\n}\n`;
    const nested = expandSection({ text: huge, filePath: "big.ts", startLine: 1, endLine: 502, maxLines: 400 });
    expect(nested.nested).toBe(true);
    const missing = expandSection({ text: source, filePath: "run.ts", symbol: "doesNotExist" });
    expect(missing.closest).toBeDefined();
  });

  it("merges search context and skips gitignored and binary files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sg-search-"));
    fs.writeFileSync(path.join(root, ".gitignore"), "secret.txt\n");
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "app.ts"), "export class ReportExporter {\n  export() {\n    return needle;\n  }\n}\n");
    fs.writeFileSync(path.join(root, "secret.txt"), "needle\n");
    fs.writeFileSync(path.join(root, "bin.dat"), Buffer.from([0, 1, 2, 3]));
    const js = targetedSearch(root, { query: "needle", backend: "js", contextLines: 1 });
    const rg = targetedSearch(root, { query: "needle", backend: "rg", contextLines: 1 });
    expect(js.windows.map((w) => w.path)).toEqual(["src/app.ts"]);
    expect(rg.windows.map((w) => w.path)).toEqual(["src/app.ts"]);
    expect(js.windows[0]?.symbol).toContain("ReportExporter");
  });

  it("round-trips a stored ref", () => {
    const file = path.join(os.tmpdir(), `sg-store-${Date.now()}.sqlite`);
    const store = ContentStore.open(file);
    const ref = store.put("original body");
    const result = expandSection({ filePath: "", ref, store });
    expect(result.text).toBe("original body");
    store.close();
  });
});

describe("installer", () => {
  it("merges configs, keeps comments, and uninstalls back to the original bytes", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "sg-home-"));
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    fs.mkdirSync(path.join(home, ".copilot"), { recursive: true });
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
    const mcp = path.join(home, ".cursor", "mcp.json");
    fs.writeFileSync(mcp, '{\n  // keep me\n  "mcpServers": { "other": { "command": "other" } }\n}\n');
    const opts = {
      home,
      nodePath: process.execPath,
      binPath: path.join(home, "sharlie-gate.mjs"),
      dataDir: path.join(home, "data"),
    };
    const manifest = { version: 1 as const, files: {} };
    applyWrites(planWrites(opts), manifest, false);
    const once = fs.readFileSync(mcp, "utf8");
    expect(once).toContain("keep me");
    expect(once).toContain("other");
    expect(once).toContain("sharlie-gate");
    const second = applyWrites(planWrites(opts), manifest, true);
    expect(second).not.toContain("sharlie-gate.mjs");
    const manifestFile = path.join(home, "manifest.json");
    writeManifest(manifestFile, manifest);
    restore(readManifest(manifestFile));
    expect(fs.readFileSync(mcp, "utf8")).toBe('{\n  // keep me\n  "mcpServers": { "other": { "command": "other" } }\n}\n');
  });
});

describe("hooks", () => {
  it("always returns json for malformed input", () => {
    expect(() => JSON.stringify(safeCopilot("preToolUse", undefined))).not.toThrow();
    expect(safeCopilot("preToolUse", { toolName: "bash" }).permissionDecision).toBe("allow");
    const outlined = safeCopilot("postToolUse", {
      toolName: "view",
      toolArgs: { path: "big.ts" },
      toolResult: { resultType: "success", textResultForLlm: `export function f(){\n${"  return 1;\n".repeat(200)}}` },
    }) as { modifiedResult?: { textResultForLlm: string } };
    expect(outlined.modifiedResult?.textResultForLlm).toContain("Section hidden");
  });
});
