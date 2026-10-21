import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { loadConfig } from "../../core/config.js";
import { log } from "../../core/logger.js";
import { READER_INSTRUCTIONS } from "./instructions.js";
import { EXPAND_DESCRIPTION, expandSchema, OUTLINE_DESCRIPTION, outlineSchema, READ_ONLY, SEARCH_DESCRIPTION, searchSchema } from "./tool-schemas.js";
import { fallbackRoots, resolveInside, type RootSet } from "./roots.js";
import { outlineText } from "../outline-builder/engine.js";
import { ensureSymbolRuntime } from "../outline-builder/symbols/runtime.js";
import { expandSection } from "../section-expander/expander.js";
import { targetedSearch } from "../smart-search/search.js";
import { listFiles } from "../smart-search/js-backend.js";
import { ContentStore } from "../../core/content-store.js";
import { ledgerPath } from "../../core/paths.js";
import { recordExpand, recordFold } from "../../4-savings-dashboard/token-ledger/events.js";

export const SERVER_NAME = "Sharlie-Gate-Reader";
export const SERVER_VERSION = "0.1.0";

let store: ContentStore | undefined;

function contentStore(): ContentStore | undefined {
  try {
    fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true });
    store ??= ContentStore.open(ledgerPath());
    return store;
  } catch (error) {
    log("warn", "content store unavailable", { error: String(error) });
    return undefined;
  }
}

export function createReader(roots?: RootSet): McpServer {
  const cfg = loadConfig({});
  const rootSet: RootSet = roots ?? { roots: fallbackRoots(), allowOutside: cfg.allowOutsideRoots };
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: READER_INSTRUCTIONS },
  );

  server.registerTool(
    "read_file_outline",
    { description: OUTLINE_DESCRIPTION, inputSchema: outlineSchema, annotations: READ_ONLY },
    async ({ path: filePath, intent, max_depth }) => {
      const resolved = resolveInside(rootSet, filePath);
      if (!resolved.ok) return text(resolved.error, true);
      const stat = fs.existsSync(resolved.abs) ? fs.statSync(resolved.abs) : undefined;
      if (!stat) return text(`No such file: ${filePath}`, true);
      if (stat.isDirectory()) {
        const body = directoryTree(resolved.abs, rootSet.roots[0] ?? resolved.abs, max_depth ?? 2);
        return text(body);
      }
      const raw = fs.readFileSync(resolved.abs, "utf8");
      const full = intent === "edit" || raw.split(/\r?\n/).length < cfg.minLinesToFold;
      if (full) {
        return {
          content: [{ type: "text" as const, text: raw }],
          structuredContent: { rev: outlineText(raw, filePath, { force: true, minLinesToFold: Number.MAX_SAFE_INTEGER }).rev, totalLines: raw.split(/\r?\n/).length, sections: [], symbols: [], full: true },
        };
      }
      const outlined = outlineText(raw, filePath);
      if (outlined.mode !== "full") {
        recordFold({
          filePath,
          project: rootSet.roots[0],
          totalLines: outlined.totalLines,
          shownLines: outlined.shownLines,
          fullText: raw,
          outlineText: outlined.text,
          rev: outlined.rev,
        });
      }
      return {
        content: [{ type: "text" as const, text: outlined.text }],
        structuredContent: {
          rev: outlined.rev,
          totalLines: outlined.totalLines,
          sections: outlined.sections,
          symbols: outlined.symbols.map((s) => ({ name: s.qualified, kind: s.kind, start: s.start, end: s.end })),
          full: outlined.mode === "full",
        },
      };
    },
  );

  server.registerTool(
    "expand_section_lines",
    { description: EXPAND_DESCRIPTION, inputSchema: expandSchema, annotations: READ_ONLY },
    async ({ path: filePath, start_line, end_line, symbol, ref, rev }) => {
      if (ref && !filePath) {
        try {
          const result = expandSection({ filePath: "", ref, rev, store: contentStore() });
          recordExpand({ filePath: "", text: result.text, rev });
          return text(result.note ? `${result.note}\n${result.text}` : result.text);
        } catch (error) {
          return text(String(error instanceof Error ? error.message : error), true);
        }
      }
      if (!filePath) return text("path is required unless ref is set", true);
      const resolved = resolveInside(rootSet, filePath);
      if (!resolved.ok) return text(resolved.error, true);
      if (!fs.existsSync(resolved.abs) || !fs.statSync(resolved.abs).isFile()) return text(`No such file: ${filePath}`, true);
      const raw = fs.readFileSync(resolved.abs, "utf8");
      try {
        const result = expandSection({
          text: raw,
          filePath,
          startLine: start_line,
          endLine: end_line,
          symbol,
          ref,
          rev,
          store: contentStore(),
        });
        const prefix = [result.note, result.closest?.length ? `Closest symbols: ${result.closest.join(", ")}` : ""]
          .filter(Boolean)
          .join("\n");
        recordExpand({
          filePath,
          text: result.text,
          startLine: start_line,
          endLine: end_line,
          rev,
        });
        return {
          content: [{ type: "text" as const, text: prefix ? `${prefix}\n${result.text}` : result.text }],
          structuredContent: { rev: result.rev, nested: result.nested, note: result.note ?? null },
        };
      } catch (error) {
        return text(String(error instanceof Error ? error.message : error), true);
      }
    },
  );

  server.registerTool(
    "targeted_search",
    { description: SEARCH_DESCRIPTION, inputSchema: searchSchema, annotations: READ_ONLY },
    async ({ query, is_regex, path_glob, case_sensitive, context_lines, max_results }) => {
      const root = rootSet.roots[0] ?? process.cwd();
      const result = targetedSearch(root, {
        query,
        isRegex: is_regex,
        pathGlob: path_glob,
        caseSensitive: case_sensitive,
        contextLines: context_lines,
        maxResults: max_results,
      });
      const lines = result.windows.map((w) => {
        const where = w.symbol ? ` in ${w.symbol}` : "";
        return `${w.path}:${w.startLine}-${w.endLine}${where}\n${w.text}`;
      });
      if (result.truncated) lines.push(`Truncated: ${result.truncated} further hits not shown.`);
      if (!lines.length) lines.push("No matches.");
      return text(lines.join("\n\n"));
    },
  );

  void listFiles;
  return server;
}

export async function connectReader(transport: Transport, roots?: RootSet): Promise<McpServer> {
  await ensureSymbolRuntime().catch(() => undefined);
  const server = createReader(roots);
  await server.connect(transport);
  try {
    const listed = await server.server.listRoots();
    const found = (listed.roots ?? []).map((r: { uri: string }) => r.uri.replace(/^file:\/\//, "")).filter(Boolean);
    if (found.length) log("info", `workspace roots ${found.join(",")}`);
  } catch {
    /* client did not advertise roots */
  }
  return server;
}

function directoryTree(dir: string, root: string, depth: number): string {
  const lines: string[] = [path.relative(root, dir).replace(/\\/g, "/") || "."];
  const walk = (current: string, level: number, prefix: string) => {
    if (level > depth) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        walk(abs, level + 1, prefix + "  ");
      } else {
        let count = 0;
        try {
          count = fs.readFileSync(abs, "utf8").split(/\r?\n/).length;
        } catch {
          count = 0;
        }
        lines.push(`${prefix}${entry.name} (${count} lines)`);
      }
    }
  };
  walk(dir, 1, "  ");
  return lines.join("\n");
}

function text(value: string, isError = false) {
  return { content: [{ type: "text" as const, text: value }], isError };
}
