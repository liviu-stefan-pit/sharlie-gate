import { estimateTokens } from "../../core/tokens.js";
import { loadConfig } from "../../core/config.js";
import { splitRaw, scanLines, joinRaw, type RawLine } from "./scanner.js";
import { buildBraceBlocks, foldImportRuns, planFolds, type Block, type FoldRange } from "./blocks.js";
import { planIndentFolds } from "./outliners/indentation-fallback.js";
import { csvFolds, keywordEndBlocks, markdownFolds } from "./outliners/keyword-end.js";
import { pythonBlocks } from "./outliners/python.js";
import { detectProfile, filterByDepth, profileFor, styleForPath, type ProfileId } from "./outliners/registry.js";
import { fileRev, renderHeadTail, renderMinified, renderOutline } from "./render.js";
import { symbolTable, type SymbolInfo } from "./symbol-table.js";
import { grammarBlocks } from "./symbols/runtime.js";

export interface OutlineOptions {
  minLinesToFold?: number;
  minFoldLines?: number;
  outlineTokenRatioMax?: number;
  contractKeepLines?: number;
  importKeepLines?: number;
  /** Skip the small-file gate. Used by nested expansion. */
  force?: boolean;
}

export interface OutlineResult {
  text: string;
  mode: "full" | "outline" | "minified" | "head-tail";
  rev: string;
  totalLines: number;
  shownLines: number;
  sections: { start: number; end: number }[];
  symbols: SymbolInfo[];
  profile: ProfileId;
  raw: RawLine[];
}

export function outlineText(text: string, filePath: string, options: OutlineOptions = {}): OutlineResult {
  const cfg = loadConfig({});
  const minLinesToFold = options.minLinesToFold ?? cfg.minLinesToFold;
  const minFoldLines = options.minFoldLines ?? cfg.minFoldLines;
  const ratioMax = options.outlineTokenRatioMax ?? cfg.outlineTokenRatioMax;
  const contractKeep = options.contractKeepLines ?? cfg.contractKeepLines;
  const importKeep = options.importKeepLines ?? cfg.importKeepLines;
  const raw = splitRaw(text);
  const rev = fileRev(text);
  const profile = detectProfile(filePath, text);
  const base: OutlineResult = {
    text,
    mode: "full",
    rev,
    totalLines: raw.length,
    shownLines: raw.length,
    sections: [],
    symbols: [],
    profile,
    raw,
  };
  if (raw.length === 0) return base;
  if (!options.force && raw.length < minLinesToFold) return base;

  const scanned = scanLines(raw, styleForPath(filePath));
  if (scanned.minified && profile !== "markdown" && profile !== "csv") {
    return {
      ...base,
      mode: "minified",
      text: renderMinified(filePath, raw, rev),
      shownLines: 0,
      sections: [{ start: 1, end: raw.length }],
    };
  }

  const built = buildForProfile(profile, raw, scanned, minFoldLines, contractKeep, importKeep, text, filePath);
  let folds = built.folds;
  let flat = false;
  if (!built.fromGrammar && scanned.unreliable && usesBraces(profile)) {
    const indent = planIndentFolds(raw, minFoldLines);
    folds = indent.folds;
    flat = indent.flat;
  } else if (profile === "indent" || profile === "yaml" || profile === "toml" || profile === "shell" || profile === "sql") {
    const indent = planIndentFolds(raw, minFoldLines);
    folds = mergeFolds(indent.folds, built.folds);
    flat = indent.flat && built.folds.length === 0;
  }

  if (flat) {
    if (raw.length > 2000) {
      const head = renderHeadTail(filePath, raw, rev);
      return { ...base, mode: "head-tail", text: head.text, sections: head.sections, shownLines: 100, symbols: built.symbols };
    }
    return { ...base, symbols: built.symbols };
  }

  if (folds.length === 0) return { ...base, symbols: built.symbols };
  const rendered = renderOutline({ filePath, raw, folds, rev });
  const originalTokens = Math.max(1, estimateTokens(text));
  if (estimateTokens(rendered.text) > originalTokens * ratioMax) return { ...base, symbols: built.symbols };
  return {
    ...base,
    mode: "outline",
    text: rendered.text,
    shownLines: rendered.shown,
    sections: rendered.sections,
    symbols: built.symbols,
  };
}

function usesBraces(profile: ProfileId): boolean {
  return profile === "c-family" || profile === "json" || profile === "markup";
}

function buildForProfile(
  profile: ProfileId,
  raw: RawLine[],
  scanned: ReturnType<typeof scanLines>,
  minFoldLines: number,
  contractKeep: number,
  importKeep: number,
  text: string,
  filePath: string,
): { folds: FoldRange[]; symbols: SymbolInfo[]; fromGrammar: boolean } {
  const parsed = grammarBlocks(text, filePath);
  if (parsed) {
    const folds = planFolds(parsed, minFoldLines, contractKeep);
    const imports = profile === "c-family" || profile === "shell" ? foldImportRuns(raw, importKeep, minFoldLines, folds) : [];
    return { folds: mergeFolds(folds, imports), symbols: symbolTable(parsed), fromGrammar: true };
  }
  if (profile === "python") {
    const blocks = pythonBlocks(raw);
    return { folds: planFolds(blocks, minFoldLines, contractKeep), symbols: symbolTable(blocks), fromGrammar: false };
  }
  if (profile === "keyword-end") {
    const blocks = keywordEndBlocks(raw);
    return { folds: planFolds(blocks, minFoldLines, contractKeep), symbols: symbolTable(blocks), fromGrammar: false };
  }
  if (profile === "markdown") {
    return { folds: markdownFolds(raw, minFoldLines), symbols: [], fromGrammar: false };
  }
  if (profile === "csv") {
    return { folds: csvFolds(raw, minFoldLines), symbols: [], fromGrammar: false };
  }
  if (profile === "indent" || profile === "yaml" || profile === "toml") {
    return { folds: [], symbols: [], fromGrammar: false };
  }
  const spec = profileFor(profile);
  let blocks: Block[] = [];
  if (!scanned.unreliable) {
    blocks = filterByDepth(buildBraceBlocks(raw, scanned.lines, scanned.events), spec.minFoldDepth);
  }
  const folds = scanned.unreliable ? [] : planFolds(blocks, minFoldLines, contractKeep);
  const imports = profile === "c-family" || profile === "shell" ? foldImportRuns(raw, importKeep, minFoldLines, folds) : [];
  return { folds: mergeFolds(folds, imports), symbols: symbolTable(blocks), fromGrammar: false };
}

function mergeFolds(a: FoldRange[], b: FoldRange[]): FoldRange[] {
  const all = [...a, ...b].sort((x, y) => x.start - y.start || y.end - x.end);
  const kept: FoldRange[] = [];
  for (const fold of all) {
    if (kept.some((k) => k.start <= fold.end && fold.start <= k.end)) continue;
    kept.push(fold);
  }
  return kept;
}

export function sliceLines(text: string, startLine: number, endLine: number): string {
  const raw = splitRaw(text);
  const start = Math.max(1, startLine);
  const end = Math.min(raw.length, endLine);
  if (start > end || raw.length === 0) return "";
  return joinRaw(raw, start - 1, end - 1);
}

export { joinRaw, splitRaw };
