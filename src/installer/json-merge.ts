import { applyEdits, modify } from "jsonc-parser";

export function upsertJson(text: string, pointer: (string | number)[], value: unknown): string {
  const source = text.trim().length ? text : "{\n}\n";
  const edits = modify(source, pointer, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  return applyEdits(source, edits);
}
