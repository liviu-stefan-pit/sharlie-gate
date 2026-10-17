const BUILTIN = [
  /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?\b/,
  /Today'?s date\b.*/i,
  /\b1[6-9]\d{11}\b/,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /^##\s+\S+.*(?:\.\.\.|ahead|behind)/,
  /^(?:M|A|D|\?\?)\s+\S+/,
];

export function normalizeSignature(line: string): string {
  return line.replace(/\b[0-9a-f]{6,}\b/gi, "#").replace(/\d+/g, "#");
}

export function volatileLines(text: string, learned: Set<string> = new Set()): number[] {
  const lines = text.split("\n");
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (BUILTIN.some((re) => re.test(line)) || learned.has(normalizeSignature(line))) hits.push(i);
  });
  return hits;
}

export function learnSignatures(previous: string, next: string): string[] {
  const a = previous.split("\n");
  const b = next.split("\n");
  const learned: string[] = [];
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i++) {
    const left = a[i] ?? "";
    const right = b[i] ?? "";
    if (left !== right && normalizeSignature(left) === normalizeSignature(right)) learned.push(normalizeSignature(right));
  }
  return learned;
}

export function extractVolatile(text: string, learned?: Set<string>): { stable: string; dynamic: string[] } {
  const lines = text.split("\n");
  const hit = new Set(volatileLines(text, learned));
  const dynamic = lines.filter((_, i) => hit.has(i));
  const stable = lines.filter((_, i) => !hit.has(i)).join("\n");
  return { stable, dynamic };
}
