import { getEncoding } from "js-tiktoken";

let encoder: ReturnType<typeof getEncoding> | undefined;

function enc() {
  encoder ??= getEncoding("o200k_base");
  return encoder;
}

/** Exact o200k count. Off the proxy hot path. */
export function countTokens(text: string): number {
  if (!text) return 0;
  return enc().encode(text).length;
}

/** Byte estimate used on the proxy hot path. No tokenizer. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}
