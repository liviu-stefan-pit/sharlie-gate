import type { Block } from "./blocks.js";

export interface SymbolInfo {
  name: string;
  qualified: string;
  kind: string;
  start: number;
  end: number;
  parent?: string;
}

export function symbolTable(blocks: Block[]): SymbolInfo[] {
  const symbols: SymbolInfo[] = blocks.map((block) => ({
    name: block.name,
    qualified: block.name,
    kind: block.kind,
    start: block.headerStart + 1,
    end: block.closeLine + 1,
    parent: undefined as string | undefined,
  }));
  blocks.forEach((block, i) => {
    if (block.parent === undefined) return;
    const parent = symbols[block.parent];
    const self = symbols[i];
    if (!parent || !self) return;
    self.parent = parent.qualified;
    if (self.name !== "(anonymous)") self.qualified = `${parent.qualified}.${self.name}`;
  });
  return symbols.filter((s) => s.name !== "(anonymous)");
}

export function symbolAtLine(symbols: SymbolInfo[], line: number): SymbolInfo | undefined {
  const hits = symbols.filter((s) => s.start <= line && line <= s.end);
  hits.sort((a, b) => a.end - a.start - (b.end - b.start));
  return hits[0];
}

export function closestSymbols(symbols: SymbolInfo[], query: string, limit = 5): string[] {
  const q = query.toLowerCase();
  return symbols
    .map((s) => ({ name: s.qualified, score: scoreName(s.qualified.toLowerCase(), q) }))
    .filter((s) => s.score < 100)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s) => s.name);
}

function scoreName(name: string, query: string): number {
  if (name === query) return 0;
  if (name.endsWith(`.${query}`) || name.endsWith(query)) return 1;
  if (name.includes(query)) return 2;
  return levenshtein(name, query) + 10;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((cur[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j] ?? 0;
  }
  return prev[b.length] ?? 0;
}
