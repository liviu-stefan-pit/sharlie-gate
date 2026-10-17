export function upsertTomlTable(text: string, table: string, fields: Record<string, string>): string {
  const body = Object.entries(fields).map(([key, value]) => `${key} = ${value}`).join("\n");
  const block = `[${table}]\n${body}\n`;
  const pattern = new RegExp(`\\[${escapeRegExp(table)}\\][\\s\\S]*?(?=\\n\\[|$)`);
  if (pattern.test(text)) return text.replace(pattern, block);
  const trimmed = text.replace(/\s*$/, "");
  return `${trimmed.length ? `${trimmed}\n\n` : ""}${block}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
