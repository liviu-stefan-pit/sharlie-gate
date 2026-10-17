export interface RawLine {
  text: string;
  terminator: string;
  indent: number;
}

export function splitRaw(text: string): RawLine[] {
  if (text.length === 0) return [];
  const lines: RawLine[] = [];
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && text.charCodeAt(j) !== 10 && text.charCodeAt(j) !== 13) j++;
    let terminator = "";
    let next = j;
    if (j < text.length && text.charCodeAt(j) === 13 && text.charCodeAt(j + 1) === 10) {
      terminator = "\r\n";
      next = j + 2;
    } else if (j < text.length) {
      terminator = text[j] ?? "";
      next = j + 1;
    }
    const raw = text.slice(i, j);
    lines.push({ text: raw, terminator, indent: measureIndent(raw) });
    i = next;
  }
  return lines;
}

export function joinRaw(lines: RawLine[], start = 0, end = lines.length - 1): string {
  let out = "";
  for (let i = start; i <= end && i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    out += line.text + line.terminator;
  }
  return out;
}

export function measureIndent(text: string): number {
  let n = 0;
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const ch of body) {
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 4;
    else break;
  }
  return n;
}

export interface LineScan {
  depthStart: number;
  depthEnd: number;
  parenEnd: number;
  blank: boolean;
  commentOnly: boolean;
}

export interface BraceEvent {
  line: number;
  kind: "open" | "close";
}

export interface ScanStyle {
  slashLine: boolean;
  hashLine: boolean;
  block: boolean;
  blockNest: boolean;
  quotes: boolean;
  template: boolean;
  triples: boolean;
  verbatim: boolean;
  rawRust: boolean;
}

export const BRACE_STYLE: ScanStyle = {
  slashLine: true,
  hashLine: false,
  block: true,
  blockNest: false,
  quotes: true,
  template: true,
  triples: false,
  verbatim: false,
  rawRust: false,
};

export interface ScanResult {
  lines: LineScan[];
  events: BraceEvent[];
  unreliable: boolean;
  minified: boolean;
}

type Mode = "code" | "line" | "block" | "sq" | "dq" | "tpl" | "triple" | "verb";

export function scanLines(raw: RawLine[], style: ScanStyle): ScanResult {
  const lines: LineScan[] = [];
  const events: BraceEvent[] = [];
  let depth = 0;
  let paren = 0;
  let anomalies = 0;
  let mode: Mode = "code";
  let blockDepth = 1;
  let tripleQuote = "";
  const templateBase: number[] = [];
  let totalChars = 0;
  let nonempty = 0;
  let minified = false;

  raw.forEach((rawLine, lineNo) => {
    const text = rawLine.text.charCodeAt(0) === 0xfeff ? rawLine.text.slice(1) : rawLine.text;
    if (text.length > 2000) minified = true;
    if (text.trim().length > 0) {
      nonempty += 1;
      totalChars += text.length;
    }
    const depthStart = depth;
    let codeChars = 0;
    let i = 0;
    while (i < text.length) {
      const ch = text[i] ?? "";
      const next = text[i + 1] ?? "";
      const two = ch + next;
      const three = text.slice(i, i + 3);

      if (mode === "line") break;
      if (mode === "block") {
        if (style.blockNest && two === "/*") {
          blockDepth += 1;
          i += 2;
          continue;
        }
        if (two === "*/") {
          blockDepth -= 1;
          i += 2;
          if (blockDepth <= 0) mode = "code";
          continue;
        }
        i += 1;
        continue;
      }
      if (mode === "sq" || mode === "dq" || mode === "verb") {
        if (ch === "\\" && mode !== "verb") {
          i += 2;
          continue;
        }
        if (mode === "verb" && two === '""') {
          i += 2;
          continue;
        }
        const closer = mode === "sq" ? "'" : '"';
        if (ch === closer) mode = "code";
        i += 1;
        continue;
      }
      if (mode === "triple") {
        if (three === tripleQuote) {
          mode = "code";
          i += 3;
          continue;
        }
        i += 1;
        continue;
      }
      if (mode === "tpl") {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (two === "${") {
          templateBase.push(depth);
          mode = "code";
          i += 2;
          continue;
        }
        if (ch === "`") mode = "code";
        i += 1;
        continue;
      }

      if (style.slashLine && two === "//") {
        mode = "line";
        break;
      }
      if (style.hashLine && ch === "#" && codeChars === 0) {
        mode = "line";
        break;
      }
      if (style.block && two === "/*") {
        mode = "block";
        blockDepth = 1;
        i += 2;
        continue;
      }
      if (style.triples && (three === '"""' || three === "'''")) {
        mode = "triple";
        tripleQuote = three;
        i += 3;
        continue;
      }
      if (style.rawRust && (ch === "r" || (ch === "b" && next === "r"))) {
        const base = ch === "b" ? i + 1 : i;
        const consumed = text[base] === "r" ? consumeRustRaw(text, base) : 0;
        if (consumed > 0) {
          i = base + consumed;
          continue;
        }
      }
      if (style.verbatim && two === '@"') {
        mode = "verb";
        i += 2;
        continue;
      }
      if (style.quotes && (ch === '"' || ch === "'")) {
        mode = ch === "'" ? "sq" : "dq";
        i += 1;
        continue;
      }
      if (style.template && ch === "`") {
        mode = "tpl";
        i += 1;
        continue;
      }
      if (ch === "{") {
        depth += 1;
        events.push({ line: lineNo, kind: "open" });
        codeChars += 1;
        i += 1;
        continue;
      }
      if (ch === "}") {
        const base = templateBase[templateBase.length - 1];
        if (base !== undefined && depth === base) {
          templateBase.pop();
          mode = "tpl";
          i += 1;
          continue;
        }
        if (depth === 0) anomalies += 1;
        else {
          depth -= 1;
          events.push({ line: lineNo, kind: "close" });
        }
        codeChars += 1;
        i += 1;
        continue;
      }
      if (ch === "(") paren += 1;
      else if (ch === ")") {
        if (paren === 0) anomalies += 1;
        else paren -= 1;
      }
      if (!/\s/.test(ch)) codeChars += 1;
      i += 1;
    }
    if (mode === "line") mode = "code";
    const blank = text.trim().length === 0;
    lines.push({
      depthStart,
      depthEnd: depth,
      parenEnd: paren,
      blank,
      commentOnly: !blank && codeChars === 0,
    });
  });

  if (mode !== "code" || templateBase.length > 0) anomalies += 1;
  if (depth !== 0 || paren !== 0) anomalies += 1;
  if (nonempty > 0 && totalChars / nonempty > 300) minified = true;
  return { lines, events, unreliable: anomalies > 0, minified };
}

function consumeRustRaw(text: string, rIndex: number): number {
  if (text[rIndex] !== "r") return 0;
  let i = rIndex + 1;
  let hashes = 0;
  while (text[i] === "#") {
    hashes += 1;
    i += 1;
  }
  if (text[i] !== '"') return 0;
  i += 1;
  const end = `"${"#".repeat(hashes)}`;
  const at = text.indexOf(end, i);
  if (at < 0) return text.length - rIndex;
  return at + end.length - rIndex;
}
