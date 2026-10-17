import type { Block } from "../blocks.js";
import type { RawLine } from "../scanner.js";

const HEADER = /^(?:async\s+def|def|class)\s+([A-Za-z_]\w*)/;

export function pythonBlocks(raw: RawLine[]): Block[] {
  const frames: { indent: number; headerStart: number; headerEnd: number; kind: Block["kind"]; name: string }[] = [];
  const blocks: Block[] = [];
  const close = (endLine: number) => {
    const frame = frames.pop();
    if (!frame) return;
    blocks.push({
      name: frame.name,
      kind: frame.kind,
      headerStart: frame.headerStart,
      headerEnd: frame.headerEnd,
      bodyStart: frame.headerEnd + 1,
      bodyEnd: endLine,
      closeLine: endLine,
      depth: frames.length,
    });
  };
  raw.forEach((line, i) => {
    const t = line.text.trim();
    if (t.length === 0 || t.startsWith("#")) return;
    while (frames.length && line.indent <= (frames[frames.length - 1]?.indent ?? -1)) close(i - 1);
    const match = HEADER.exec(t);
    if (match && t.endsWith(":")) {
      let headerStart = i;
      let docs = 0;
      for (let d = i - 1; d >= 0 && docs < 3; d--) {
        const prev = raw[d]?.text.trim() ?? "";
        if (prev.startsWith("@")) {
          headerStart = d;
          docs += 1;
          continue;
        }
        break;
      }
      frames.push({
        indent: line.indent,
        headerStart,
        headerEnd: i,
        kind: t.startsWith("class") ? "container" : "callable",
        name: match[1] ?? "(anonymous)",
      });
    }
  });
  while (frames.length) close(raw.length - 1);
  return blocks;
}
