import { parseMarker } from "../../core/markers.js";
import type { ContentStore } from "../../core/content-store.js";
import { outlineText, sliceLines } from "../outline-builder/engine.js";
import { closestSymbols } from "../outline-builder/symbol-table.js";

export interface ExpandInput {
  text?: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  ref?: string;
  rev?: string;
  maxLines?: number;
  store?: ContentStore;
}

export interface ExpandResult {
  text: string;
  rev: string;
  note?: string;
  nested: boolean;
  closest?: string[];
}

export function expandSection(input: ExpandInput): ExpandResult {
  const selectors = [input.startLine !== undefined || input.endLine !== undefined, Boolean(input.symbol), Boolean(input.ref)].filter(Boolean).length;
  if (selectors !== 1) throw new Error("Provide exactly one of a line range, a symbol, or a ref.");
  const maxLines = input.maxLines ?? 400;

  if (input.ref) {
    const stored = input.store?.get(input.ref);
    if (stored === undefined) throw new Error(`Unknown ref ${input.ref}`);
    return { text: stored, rev: input.rev ?? "", nested: false };
  }

  const text = input.text ?? "";
  const outlined = outlineText(text, input.filePath, { force: true, minLinesToFold: 1 });
  let note: string | undefined;
  if (input.rev && input.rev !== outlined.rev) note = "file changed";

  let start = input.startLine;
  let end = input.endLine;
  if (input.symbol) {
    const match = outlined.symbols.find((s) => s.qualified === input.symbol || s.name === input.symbol);
    if (!match) {
      return {
        text: "",
        rev: outlined.rev,
        note: note ?? "symbol not found",
        nested: false,
        closest: closestSymbols(outlined.symbols, input.symbol),
      };
    }
    start = match.start;
    end = match.end;
  }
  if (start === undefined || end === undefined) throw new Error("A line range needs start_line and end_line.");
  if (start < 1 || end < start) throw new Error("Invalid line range.");

  const span = end - start + 1;
  if (span > maxLines) {
    const slice = sliceLines(text, start, end);
    const nested = outlineText(slice, input.filePath, { force: true, minLinesToFold: 1, minFoldLines: 4 });
    const shifted = shiftMarkers(nested.text, start - 1);
    return {
      text: shifted,
      rev: outlined.rev,
      note: [note, `Nested outline of lines ${start}–${end}.`].filter(Boolean).join(" "),
      nested: true,
    };
  }
  return { text: sliceLines(text, start, end), rev: outlined.rev, note, nested: false };
}

function shiftMarkers(outline: string, offset: number): string {
  if (offset === 0) return outline;
  return outline
    .split("\n")
    .map((line) => {
      const parsed = parseMarker(line);
      if (!parsed) return line;
      const pad = line.match(/^\s*/)?.[0] ?? "";
      return `${pad}[Section hidden: Lines ${parsed.start + offset}–${parsed.end + offset}. Request this section to view or edit]`;
    })
    .join("\n");
}
