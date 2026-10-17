import { assignTurns, callFrom, hashText, type CanonBlock, type CanonCall, type CanonRequest } from "./canonical.js";

export function parseAnthropic(raw: Record<string, unknown>): CanonRequest {
  const blocks: CanonBlock[] = [];
  const calls: CanonCall[] = [];
  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  const flags = messages.map((message) => ({ human: isHuman(message) }));
  const turns = assignTurns(flags);
  const current = turns[turns.length - 1]?.current ?? 0;
  pushSystem(raw, blocks, current);
  messages.forEach((message, index) => {
    const turn = turns[index]?.turn ?? 0;
    absorbMessage(message as Record<string, unknown>, turn, current, blocks, calls, index);
  });
  return { provider: "anthropic", model: String(raw.model ?? ""), raw, blocks, calls, currentTurn: current, changed: false };
}

function pushSystem(raw: Record<string, unknown>, blocks: CanonBlock[], current: number): void {
  const system = raw.system;
  if (typeof system === "string") {
    blocks.push(block("system", system, 0, current, hashText("system"), 0, (next) => {
      raw.system = next;
    }));
    return;
  }
  if (!Array.isArray(system)) return;
  system.forEach((part, idx) => {
    if (!part || typeof part !== "object") return;
    const node = part as Record<string, unknown>;
    if (typeof node.text !== "string") return;
    blocks.push(block("system", node.text, 0, current, hashText("system"), idx, (next) => {
      node.text = next;
    }));
  });
}

function absorbMessage(
  message: Record<string, unknown>,
  turn: number,
  current: number,
  blocks: CanonBlock[],
  calls: CanonCall[],
  msgIndex: number,
): void {
  const role = message.role === "assistant" ? "assistant" : "user";
  const content = message.content;
  const msgHash = hashText(JSON.stringify(content ?? ""));
  if (typeof content === "string") {
    blocks.push(block(role, content, turn, current, msgHash, 0, (next) => {
      message.content = next;
    }));
    return;
  }
  if (!Array.isArray(content)) return;
  content.forEach((part, idx) => {
    if (!part || typeof part !== "object") return;
    const node = part as Record<string, unknown>;
    const type = String(node.type ?? "text");
    if (type === "thinking" || type === "redacted_thinking") {
      blocks.push({ ...block(role, String(node.thinking ?? node.data ?? ""), turn, current, msgHash, idx, () => undefined), protectedKind: "thinking" });
      return;
    }
    if (type === "image" || type === "image_url") {
      blocks.push({ ...block(role, "", turn, current, msgHash, idx, () => undefined), protectedKind: "image" });
      return;
    }
    if (type === "tool_use") {
      const name = String(node.name ?? "");
      const args = (node.input as Record<string, unknown>) ?? {};
      const id = String(node.id ?? `${msgIndex}:${idx}`);
      calls.push(callFrom(name, args, id, turn, current));
      blocks.push({ ...block(role, "", turn, current, msgHash, idx, () => undefined), protectedKind: "tool_use", toolName: name, toolUseId: id });
      return;
    }
    if (type === "tool_result") {
      const text = toolResultText(node.content);
      blocks.push({
        ...block("tool", text, turn, current, msgHash, idx, (next) => {
          node.content = next;
        }),
        isToolResult: true,
        toolUseId: String(node.tool_use_id ?? ""),
      });
      return;
    }
    if (typeof node.text === "string") {
      blocks.push(block(role, node.text, turn, current, msgHash, idx, (next) => {
        node.text = next;
      }));
    }
  });
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (part && typeof part === "object" && typeof (part as { text?: string }).text === "string" ? (part as { text: string }).text : "")).join("\n");
}

function isHuman(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const node = message as { role?: string; content?: unknown };
  if (node.role !== "user") return false;
  if (typeof node.content === "string") return node.content.trim().length > 0;
  if (!Array.isArray(node.content)) return false;
  return node.content.some((part) => part && typeof part === "object" && (part as { type?: string }).type !== "tool_result" && typeof (part as { text?: string }).text === "string");
}

function block(
  role: CanonBlock["role"],
  text: string,
  turn: number,
  current: number,
  msgHash: string,
  blockIdx: number,
  setText: (next: string) => void,
): CanonBlock {
  return { role, text, turn, current: turn >= current && role !== "system", msgHash, blockIdx, setText };
}
