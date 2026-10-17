import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../core/paths.js";
import { outlineText } from "../1-editor-helper-tools/outline-builder/engine.js";
import { ContentStore } from "../core/content-store.js";
import { ledgerPath } from "../core/paths.js";

export interface HookResult {
  [key: string]: unknown;
}

export function safeCopilot(event: string, payload: unknown): HookResult {
  try {
    record("copilot", event, payload);
    return copilotHook(event, asRecord(payload));
  } catch {
    return event === "preToolUse" ? { permissionDecision: "allow" } : {};
  }
}

export function copilotHook(event: string, payload: Record<string, unknown>): HookResult {
  if (event === "userPromptSubmitted") {
    const prompt = String(payload.prompt ?? payload.userPrompt ?? "");
    const files = [...prompt.matchAll(/@([^\s]+)/g)].map((match) => match[1] ?? "");
    writeSession(String(payload.sessionId ?? payload.session_id ?? "default"), { immune: files });
    return {};
  }
  if (event === "preToolUse") {
    const name = toolName(payload);
    if (!/edit|create|replace/i.test(name)) return { permissionDecision: "allow" };
    const session = readSession(String(payload.sessionId ?? payload.session_id ?? "default"));
    if (!session.expanded) return { permissionDecision: "allow" };
    const args = toolArgs(payload);
    const file = String(args.path ?? args.file_path ?? "");
    if (file && session.immune?.includes(file)) return { permissionDecision: "allow" };
    if (file && session.needsExpand?.includes(file)) {
      return {
        permissionDecision: "deny",
        permissionDecisionReason: `Expand hidden lines before editing. Call expand_section_lines with path ${file}.`,
      };
    }
    return { permissionDecision: "allow" };
  }
  if (event === "postToolUse") {
    const name = toolName(payload);
    const result = toolResultText(payload);
    if (/^(view|read|read_file)$/i.test(name.split("__").pop() ?? name) && result.split(/\r?\n/).length >= 150) {
      const args = toolArgs(payload);
      const file = String(args.path ?? args.file_path ?? "file.txt");
      const session = readSession(String(payload.sessionId ?? "default"));
      if (session.immune?.some((item) => file.endsWith(item))) return {};
      const outlined = outlineText(result, file);
      if (outlined.mode === "full") return {};
      return { modifiedResult: { resultType: "success", textResultForLlm: outlined.text } };
    }
    if (/bash|powershell|shell/i.test(name) && result.split(/\r?\n/).length > 200) {
      const ref = remember(result);
      const lines = result.split(/\r?\n/);
      const trimmed = [...lines.slice(0, 30), `... | ref ${ref}`, ...lines.slice(-50)].join("\n");
      return { modifiedResult: { resultType: "success", textResultForLlm: trimmed } };
    }
  }
  return {};
}

export function safeCursor(event: string, payload: unknown, enforce: boolean): HookResult {
  try {
    if (!enforce) return {};
    const body = asRecord(payload);
    if (event === "beforeReadFile") {
      const file = String(body.file_path ?? body.filePath ?? body.path ?? "");
      const content = String(body.content ?? "");
      const lines = content ? content.split(/\r?\n/).length : 0;
      if (lines >= 150) {
        return {
          permission: "deny",
          agent_message: `File ${file} is ${lines} lines. Call read_file_outline instead of reading it whole.`,
        };
      }
    }
    if (event === "preToolUse") {
      const name = toolName(body);
      if (/shell|bash|powershell/i.test(name)) {
        const args = toolArgs(body);
        const command = String(args.command ?? "");
        if (command && !command.includes("sharlie-gate run")) {
          return { updated_input: { ...args, command: `sharlie-gate run -- ${command}` } };
        }
      }
    }
    if (event === "postToolUse") {
      const output = toolResultText(body);
      if (output.length > 4000 && /mcp/i.test(toolName(body))) {
        return { updated_mcp_tool_output: `${output.slice(0, 2000)}\n[truncated by sharlie-gate]` };
      }
    }
    return {};
  } catch {
    return {};
  }
}

function record(family: string, event: string, payload: unknown): void {
  if (process.env.SHARLIE_GATE_RECORD !== "1") return;
  const file = path.join(dataDir(), "recordings", `${family}-${event}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ event, payload })}\n`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function toolName(payload: Record<string, unknown>): string {
  return String(payload.toolName ?? payload.tool_name ?? "");
}

function toolArgs(payload: Record<string, unknown>): Record<string, unknown> {
  const raw = payload.toolArgs ?? payload.tool_input ?? payload.tool_args ?? {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return asRecord(raw);
}

function toolResultText(payload: Record<string, unknown>): string {
  const result = asRecord(payload.toolResult ?? payload.tool_result);
  return String(result.textResultForLlm ?? result.text_result_for_llm ?? payload.output ?? "");
}

function sessionFile(id: string): string {
  return path.join(dataDir(), "sessions", `${id.replace(/[^\w.-]/g, "_")}.json`);
}

function readSession(id: string): { immune?: string[]; needsExpand?: string[]; expanded?: boolean } {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(id), "utf8")) as { immune?: string[] };
  } catch {
    return {};
  }
}

function writeSession(id: string, value: unknown): void {
  const file = sessionFile(id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function remember(text: string): string {
  fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true });
  const store = ContentStore.open(ledgerPath());
  try {
    return store.put(text);
  } finally {
    store.close();
  }
}
