/** 8-line fingerprints. A block is a duplicate when 90% of its fingerprints appear later. */
export function fingerprints(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i + 8 <= lines.length; i += 8) {
    out.push(lines.slice(i, i + 8).join("\n"));
  }
  return out;
}

export function mostlySeenLater(older: string, laterTexts: string[]): boolean {
  const prints = fingerprints(older);
  if (older.split(/\r?\n/).length < 80 || prints.length === 0) return false;
  const later = new Set(laterTexts.flatMap(fingerprints));
  const hit = prints.filter((p) => later.has(p)).length;
  return hit / prints.length >= 0.9;
}
