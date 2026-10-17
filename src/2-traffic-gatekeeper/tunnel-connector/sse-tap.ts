export interface SseEvent {
  event: string;
  data: string;
}

export function createSseTap(onEvent: (event: SseEvent) => void): {
  push(chunk: Buffer | string): void;
  end(): void;
} {
  let buffer = "";
  const drain = (final: boolean) => {
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = final ? "" : (parts.pop() ?? "");
    for (const part of parts) emit(part, onEvent);
    if (final && buffer.trim()) emit(buffer, onEvent);
  };
  return {
    push(chunk) {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      drain(false);
    },
    end() {
      drain(true);
    },
  };
}

function emit(part: string, onEvent: (event: SseEvent) => void): void {
  let event = "message";
  const data: string[] = [];
  for (const line of part.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length) onEvent({ event, data: data.join("\n") });
}

export function parseUsageEvent(event: SseEvent): Record<string, unknown> | undefined {
  try {
    const json = JSON.parse(event.data) as Record<string, unknown>;
    if (event.event === "message_start" && json.message && typeof json.message === "object") {
      return ((json.message as { usage?: Record<string, unknown> }).usage) ?? undefined;
    }
    if (event.event === "message_delta" && json.usage && typeof json.usage === "object") return json.usage as Record<string, unknown>;
    if (event.event === "response.completed" && json.response && typeof json.response === "object") {
      return ((json.response as { usage?: Record<string, unknown> }).usage) ?? undefined;
    }
    if (json.usage && typeof json.usage === "object" && Array.isArray((json as { choices?: unknown }).choices) && ((json as { choices: unknown[] }).choices.length === 0)) {
      return json.usage as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
