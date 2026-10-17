import { assignTurns, callFrom, hashText, type CanonBlock, type CanonRequest } from "./canonical.js";

export function parseOpenAIChat(raw: Record<string, unknown>): CanonRequest {
  const messages = Array.isArray(raw.messages) ? (raw.messages as Record<string, unknown>[]) : [];
  const flags = messages.map((message) => ({ human: message.role === "user" && typeof message.content === "string" }));
  const turns = assignTurns(flags);
  const current = turns.at(-1)?.current ?? 0;
  const blocks: CanonBlock[] = [];
  const calls: CanonRequest["calls"] = [];
  messages.forEach((message, index) => {
    const turn = turns[index]?.turn ?? 0;
    const role = message.role === "system" ? "system" : message.role === "assistant" ? "assistant" : message.role === "tool" ? "tool" : "user";
    const text = typeof message.content === "string" ? message.content : "";
    const msgHash = hashText(`${index}:${text.slice(0, 80)}`);
    blocks.push({
      role,
      text,
      turn,
      current: role !== "system" && turn >= current,
      msgHash,
      blockIdx: 0,
      isToolResult: role === "tool",
      toolUseId: typeof message.tool_call_id === "string" ? message.tool_call_id : undefined,
      setText: (next) => {
        message.content = next;
      },
    });
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    for (const call of toolCalls) {
      if (!call || typeof call !== "object") continue;
      const node = call as { id?: string; function?: { name?: string; arguments?: string } };
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(node.function?.arguments ?? "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      calls.push(callFrom(String(node.function?.name ?? ""), args, String(node.id ?? index), turn, current));
    }
  });
  return { provider: "openai-chat", model: String(raw.model ?? ""), raw, blocks, calls, currentTurn: current, changed: false };
}

export function parseOpenAIResponses(raw: Record<string, unknown>): CanonRequest {
  const input = Array.isArray(raw.input) ? (raw.input as Record<string, unknown>[]) : [];
  const flags = input.map((item) => ({
    human: item.role === "user" && JSON.stringify(item.content ?? "").length > 0 && !JSON.stringify(item).includes("tool_result"),
  }));
  const turns = assignTurns(flags);
  const current = turns.at(-1)?.current ?? 0;
  const blocks: CanonBlock[] = [];
  input.forEach((item, index) => {
    const turn = turns[index]?.turn ?? 0;
    const text = responseText(item.content);
    const msgHash = hashText(`${index}:${text.slice(0, 80)}`);
    blocks.push({
      role: item.role === "assistant" ? "assistant" : item.role === "system" ? "system" : "user",
      text,
      turn,
      current: item.role !== "system" && turn >= current,
      msgHash,
      blockIdx: 0,
      setText: (next) => {
        item.content = [{ type: "input_text", text: next }];
      },
    });
  });
  return { provider: "openai-responses", model: String(raw.model ?? ""), raw, blocks, calls: [], currentTurn: current, changed: false };
}

function responseText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (part && typeof part === "object" && typeof (part as { text?: string }).text === "string" ? (part as { text: string }).text : "")).join("\n");
}
