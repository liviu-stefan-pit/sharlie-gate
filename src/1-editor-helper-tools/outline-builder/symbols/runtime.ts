import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Language, Parser, Query, type Node } from "web-tree-sitter";
import { linkParents, type Block, type BlockKind } from "../blocks.js";
import { GO_TAGS, JAVASCRIPT_TAGS, PYTHON_TAGS, RUST_TAGS, TYPESCRIPT_TAGS } from "./queries.js";

type Dialect = "javascript" | "typescript" | "tsx" | "python" | "go" | "rust";

interface GrammarSpec {
  wasm: string;
  query: string;
}

interface LoadedGrammar {
  language: Language;
  query: Query;
}

const GRAMMARS: Record<Dialect, GrammarSpec> = {
  javascript: { wasm: "tree-sitter-javascript.wasm", query: JAVASCRIPT_TAGS },
  typescript: { wasm: "tree-sitter-typescript.wasm", query: `${JAVASCRIPT_TAGS}\n${TYPESCRIPT_TAGS}` },
  tsx: { wasm: "tree-sitter-tsx.wasm", query: `${JAVASCRIPT_TAGS}\n${TYPESCRIPT_TAGS}` },
  python: { wasm: "tree-sitter-python.wasm", query: PYTHON_TAGS },
  go: { wasm: "tree-sitter-go.wasm", query: GO_TAGS },
  rust: { wasm: "tree-sitter-rust.wasm", query: RUST_TAGS },
};

const loaded = new Map<Dialect, LoadedGrammar | null>();
let parser: Parser | undefined;
let ready = false;
let starting: Promise<void> | undefined;

export function ensureSymbolRuntime(): Promise<void> {
  starting ??= (async () => {
    await Parser.init({
      locateFile(scriptName: string) {
        return scriptName.endsWith(".wasm") ? runtimeWasmPath() : scriptName;
      },
    });
    parser = new Parser();
    ready = true;
  })();
  return starting;
}

/** Compile every shipped grammar. Tests use this so timed outlines exclude the one-time load. */
export function preloadGrammars(): void {
  if (!ready) return;
  for (const dialect of Object.keys(GRAMMARS) as Dialect[]) loadDialect(dialect);
}

export function grammarBlocks(text: string, filePath: string): Block[] | null {
  if (!ready || !parser) {
    void ensureSymbolRuntime();
    return null;
  }
  const dialect = dialectFor(filePath);
  if (!dialect) return null;
  try {
    const grammar = loadDialect(dialect);
    if (!grammar) return null;
    parser.setLanguage(grammar.language);
    const tree = parser.parse(text);
    if (!tree) return null;
    try {
      if (tree.rootNode.hasError) return null;
      const blocks = blocksFromQuery(grammar.query, tree.rootNode);
      return blocks.length ? blocks : null;
    } finally {
      tree.delete();
    }
  } catch {
    return null;
  }
}

function dialectFor(filePath: string): Dialect | null {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  const ext = base.includes(".") ? (base.split(".").pop() ?? "").toLowerCase() : "";
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return "javascript";
    case "ts":
    case "mts":
    case "cts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "py":
    case "pyi":
      return "python";
    case "go":
      return "go";
    case "rs":
      return "rust";
    default:
      return null;
  }
}

function loadDialect(dialect: Dialect): LoadedGrammar | null {
  const cached = loaded.get(dialect);
  if (cached !== undefined) return cached;
  try {
    const spec = GRAMMARS[dialect];
    const bytes = fs.readFileSync(grammarWasmPath(spec.wasm));
    const language = Language.loadSync(compileGrammar(bytes));
    const query = new Query(language, spec.query);
    const grammar = { language, query };
    loaded.set(dialect, grammar);
    return grammar;
  } catch {
    loaded.set(dialect, null);
    return null;
  }
}

function blocksFromQuery(query: Query, root: Node): Block[] {
  const blocks: Block[] = [];
  const seen = new Set<string>();
  for (const match of query.matches(root)) {
    const role = match.captures.find((cap) => cap.name.startsWith("definition.") || cap.name === "reference.implementation");
    if (!role) continue;
    const nameNode = match.captures.find((cap) => cap.name === "name");
    const name = cleanName(nameNode?.node.text ?? "(anonymous)");
    const node = role.node;
    const key = `${node.startIndex}:${node.endIndex}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const span = spanOf(node);
    blocks.push({
      name,
      kind: kindFor(role.name),
      headerStart: span.headerStart,
      headerEnd: span.headerEnd,
      bodyStart: span.bodyStart,
      bodyEnd: span.bodyEnd,
      closeLine: span.closeLine,
      depth: 0,
    });
  }
  linkParents(blocks);
  setDepth(blocks);
  return blocks;
}

function kindFor(capture: string): BlockKind {
  if (capture === "reference.implementation") return "container";
  if (capture === "definition.class" || capture === "definition.module") return "container";
  if (capture === "definition.interface" || capture === "definition.type") return "contract";
  if (capture === "definition.function" || capture === "definition.method") return "callable";
  return "other";
}

function spanOf(node: Node): { headerStart: number; headerEnd: number; bodyStart: number; bodyEnd: number; closeLine: number } {
  const headerStart = node.startPosition.row;
  const closeLine = node.endPosition.row;
  const body = findBody(node);
  if (!body) {
    return { headerStart, headerEnd: headerStart, bodyStart: headerStart + 1, bodyEnd: headerStart, closeLine };
  }
  if (isBraceBody(body)) {
    const headerEnd = body.startPosition.row;
    const braceEnd = body.endPosition.row;
    return { headerStart, headerEnd, bodyStart: headerEnd + 1, bodyEnd: braceEnd - 1, closeLine };
  }
  const bodyStart = body.startPosition.row;
  const headerEnd = Math.max(headerStart, bodyStart - 1);
  if (bodyStart <= headerEnd) {
    return { headerStart, headerEnd: closeLine, bodyStart: closeLine + 1, bodyEnd: closeLine, closeLine };
  }
  return { headerStart, headerEnd, bodyStart, bodyEnd: body.endPosition.row, closeLine };
}

function findBody(node: Node): Node | null {
  const direct = node.childForFieldName("body");
  if (direct) return direct;
  const value = node.childForFieldName("value");
  return value?.childForFieldName("body") ?? null;
}

function isBraceBody(body: Node): boolean {
  if (body.type === "statement_block") return true;
  return body.firstChild?.text === "{";
}

function cleanName(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  const trimmed = line.trim();
  return trimmed.length ? trimmed : "(anonymous)";
}

function setDepth(blocks: Block[]): void {
  for (const block of blocks) {
    let depth = 0;
    let parent = block.parent;
    const seen = new Set<number>();
    while (parent !== undefined && !seen.has(parent)) {
      seen.add(parent);
      depth += 1;
      parent = blocks[parent]?.parent;
    }
    block.depth = depth;
  }
}

function compileGrammar(bytes: Buffer): Parameters<typeof Language.loadSync>[0] {
  const host = globalThis as unknown as {
    WebAssembly: { Module: new (bytes: Buffer) => Parameters<typeof Language.loadSync>[0] };
  };
  return new host.WebAssembly.Module(bytes);
}

function runtimeWasmPath(): string {
  const beside = fileURLToPath(new URL("./tree-sitter.wasm", import.meta.url));
  if (fs.existsSync(beside)) return beside;
  const require = createRequire(fileURLToPath(import.meta.url));
  return require.resolve("web-tree-sitter/web-tree-sitter.wasm");
}

function grammarWasmPath(file: string): string {
  const beside = fileURLToPath(new URL(`./grammars/${file}`, import.meta.url));
  if (fs.existsSync(beside)) return beside;
  throw new Error(`missing grammar ${file}`);
}
