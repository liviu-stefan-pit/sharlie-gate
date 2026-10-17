import { parseAnthropic } from "./anthropic-messages.js";
import { parseOpenAIChat, parseOpenAIResponses } from "./openai-chat.js";
import type { CanonRequest } from "./canonical.js";

export type WireKind = "anthropic" | "openai-chat" | "openai-responses" | "other";

export function detectWire(pathname: string, body: Record<string, unknown>): WireKind {
  if (pathname.includes("/messages") || Array.isArray(body.messages) && body.system !== undefined) return "anthropic";
  if (pathname.includes("/responses") || Array.isArray(body.input)) return "openai-responses";
  if (pathname.includes("/chat/completions") || Array.isArray(body.messages)) return "openai-chat";
  return "other";
}

export function toCanon(kind: WireKind, body: Record<string, unknown>): CanonRequest | undefined {
  if (kind === "anthropic") return parseAnthropic(body);
  if (kind === "openai-chat") return parseOpenAIChat(body);
  if (kind === "openai-responses") return parseOpenAIResponses(body);
  return undefined;
}
