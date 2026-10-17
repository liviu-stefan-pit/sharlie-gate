/** Logs go to stderr only. stdout is reserved for MCP JSON-RPC. */
export function log(level: "debug" | "info" | "warn" | "error", message: string, extra?: unknown): void {
  if (level === "debug" && process.env.SHARLIE_GATE_DEBUG !== "1") return;
  const line = extra === undefined ? message : `${message} ${safe(extra)}`;
  process.stderr.write(`[sharlie-gate] ${level} ${line}\n`);
}

function safe(value: unknown): string {
  try {
    return JSON.stringify(redact(value));
  } catch {
    return String(value);
  }
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/authorization|api[-_]?key|x-api-key|token|secret|password/i.test(k)) out[k] = "[redacted]";
      else out[k] = redact(v);
    }
    return out;
  }
  if (typeof value === "string" && /sk-[A-Za-z0-9]{8,}|Bearer\s+\S+/i.test(value)) {
    return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  }
  return value;
}
