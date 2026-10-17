export const MARKER_RE =
  /^\s*\[Section hidden: Lines (\d+)–(\d+)\. Request this section to view or edit\]$/;

export const EN_DASH = "–";

export function sectionMarker(startLine: number, endLine: number, indent = 0): string {
  const pad = " ".repeat(Math.max(0, indent));
  return `${pad}[Section hidden: Lines ${startLine}${EN_DASH}${endLine}. Request this section to view or edit]`;
}

export function parseMarker(line: string): { start: number; end: number } | undefined {
  const match = MARKER_RE.exec(line);
  if (!match?.[1] || !match[2]) return undefined;
  return { start: Number(match[1]), end: Number(match[2]) };
}
