import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BEGIN = "<!-- sharlie-gate:begin -->";
const END = "<!-- sharlie-gate:end -->";

const FALLBACK = `# Sharlie-Gate reader

Prefer structural outlines over full file reads.

- Call \`read_file_outline\` before reading a file.
- Call \`expand_section_lines\` for a hidden range or symbol before you rely on that code.
- Pass \`intent: "edit"\` before writing or editing so the target file is returned in full.
- Use \`targeted_search\` instead of broad reads when you are looking for a string.
- Do not re-read a file that was already shown in the current turn.
`;

export function masterInstructions(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return fs.readFileSync(path.join(here, "master-instructions.md"), "utf8").trim();
  } catch {
    return FALLBACK.trim();
  }
}

export function renderMdc(body = masterInstructions()): string {
  return `---\ndescription: Prefer Sharlie-Gate outlines over full file reads\nalwaysApply: true\n---\n\n${body.trim()}\n`;
}

export function renderSkill(body = masterInstructions()): string {
  return `---\nname: sharlie-gate-reader\ndescription: Read workspace files as outlines first, then expand only the lines you need.\n---\n\n${body.trim()}\n`;
}

export function renderInstructionsMd(body = masterInstructions()): string {
  return `${body.trim()}\n`;
}

export function managedBlock(body = masterInstructions(), version = "0.1.0"): string {
  return `${BEGIN} v${version}\n${body.trim()}\n${END}`;
}

export function upsertManagedBlock(existing: string, body = masterInstructions()): string {
  const block = managedBlock(body);
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  if (start >= 0 && end > start) {
    return `${existing.slice(0, start)}${block}${existing.slice(end + END.length)}`;
  }
  const trimmed = existing.replace(/\s*$/, "");
  return trimmed.length ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}
