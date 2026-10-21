import { assignTurns, hashText, type CanonBlock, type CanonRequest } from "./canonical.js";

/** Explicit context caches stop at Gemini 4. Argon and later are implicit-only. */
export function geminiExplicitCacheAllowed(model: string): boolean {
  const name = model.toLowerCase();
  if (name.includes("argon")) return false;
  if (/gemini-[4-9]/.test(name)) return false;
  return true;
}

export function modelFromPath(pathname: string): string {
  return /models\/([^/:]+)/.exec(pathname)?.[1] ?? "";
}

export function parseGemini(raw: Record<string, unknown>, modelFromUrl = ""): CanonRequest {
  const model = String(raw.model ?? modelFromUrl);
  const blocks: CanonBlock[] = [];
  const system = raw.systemInstruction ?? raw.system_instruction;
  const systemText = partsText(system && typeof system === "object" ? (system as { parts?: unknown }).parts : undefined);
  if (systemText) {
    blocks.push({
      role: "system",
      text: systemText,
      turn: 0,
      current: false,
      msgHash: hashText("system"),
      blockIdx: 0,
      setText: (next) => {
        const key = raw.systemInstruction !== undefined ? "systemInstruction" : "system_instruction";
        raw[key] = { parts: [{ text: next }] };
      },
    });
  }
  const contents = Array.isArray(raw.contents) ? raw.contents as Record<string, unknown>[] : [];
  const turns = assignTurns(contents.map((item) => ({ human: item.role !== "model" })));
  const current = turns.at(-1)?.current ?? 0;
  contents.forEach((item, index) => {
    const turn = turns[index]?.turn ?? 0;
    const text = partsText(item.parts);
    const role = item.role === "model" ? "assistant" : "user";
    blocks.push({
      role,
      text,
      turn,
      current: turn >= current,
      msgHash: hashText(`${index}:${text.slice(0, 80)}`),
      blockIdx: 0,
      setText: (next) => {
        item.parts = [{ text: next }];
      },
    });
  });
  return { provider: "gemini", model, raw, blocks, calls: [], currentTurn: current, changed: false };
}

function partsText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => (part && typeof part === "object" && typeof (part as { text?: string }).text === "string" ? (part as { text: string }).text : "")).join("\n");
}
