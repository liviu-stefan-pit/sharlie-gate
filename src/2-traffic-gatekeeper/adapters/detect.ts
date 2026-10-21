import { parseAnthropic } from "./anthropic-messages.js";
import { modelFromPath, parseGemini } from "./gemini.js";
import { parseOpenAIChat, parseOpenAIResponses } from "./openai-chat.js";
import type { CanonRequest } from "./canonical.js";

export type WireKind = "anthropic" | "openai-chat" | "openai-responses" | "gemini" | "other";

export function detectWire(pathname: string, body: Record<string, unknown>): WireKind {
  const geminiPath = pathname.includes(":generateContent") || pathname.includes(":streamGenerateContent") || pathname.includes("/gemini/");
  const geminiBody = Array.isArray(body.contents) && (geminiPath || body.systemInstruction !== undefined || body.system_instruction !== undefined);
  if (geminiPath || geminiBody) return "gemini";
  if (pathname.includes("/messages") || Array.isArray(body.messages) && body.system !== undefined) return "anthropic";
  if (pathname.includes("/responses") || Array.isArray(body.input)) return "openai-responses";
  if (pathname.includes("/chat/completions") || Array.isArray(body.messages)) return "openai-chat";
  return "other";
}

export function toCanon(kind: WireKind, body: Record<string, unknown>, pathname = ""): CanonRequest | undefined {
  if (kind === "anthropic") return parseAnthropic(body);
  if (kind === "openai-chat") return parseOpenAIChat(body);
  if (kind === "openai-responses") return parseOpenAIResponses(body);
  if (kind === "gemini") return parseGemini(body, modelFromPath(pathname));
  return undefined;
}

export function clientAlreadyCaches(originalText: string): boolean {
  return /"cache_control"|"prompt_cache_key"|"cachedContent"|"cached_content"/.test(originalText);
}
