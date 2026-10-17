import registry from "../../3-safety-rules-and-config/protection-rules/tool-registry.json" with { type: "json" };

export type ToolKind = "read" | "edit" | "shell" | "other";

export interface ToolSpec {
  names: string[];
  kind: ToolKind;
  pathArgs?: string[];
  commandArgs?: string[];
}

export function classifyTool(name: string): ToolSpec {
  const bare = name.split("__").pop() ?? name;
  const found = (registry.tools as ToolSpec[]).find((tool) =>
    tool.names.some((n) => n.toLowerCase() === bare.toLowerCase() || name.toLowerCase().endsWith(n.toLowerCase())),
  );
  return found ?? { names: [name], kind: "other" };
}

export function argValue(args: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!args) return undefined;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}
