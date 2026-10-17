export function claudeStatusline(today: string, last: string): string {
  return JSON.stringify({ command: "sharlie-gate", args: ["status", "--statusline"] }) + `\n# ${today} ${last}\n`;
}

export function cursorStatuslineSnippet(): string {
  return "sharlie-gate status --statusline";
}
