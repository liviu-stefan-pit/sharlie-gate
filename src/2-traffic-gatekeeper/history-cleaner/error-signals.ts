const FAILURE = /error TS\d+|Traceback|npm ERR!|\bFAILED\b|panic:|Exception/g;
const SUCCESS = /\b(pass(ed)?|ok|success|0 failed)\b/i;

export function failureScore(text: string): number {
  return [...text.matchAll(FAILURE)].length;
}

export function isFailure(text: string, exitCode?: number, isError?: boolean): boolean {
  if (isError) return true;
  if (exitCode !== undefined && exitCode !== 0) return true;
  return failureScore(text) >= 2;
}

export function isSuccess(text: string, exitCode?: number): boolean {
  if (exitCode === 0) return true;
  return SUCCESS.test(text) && failureScore(text) === 0;
}

export function commandClass(command: string | undefined): string {
  if (!command) return "unknown";
  const cleaned = command
    .replace(/\b[A-Za-z_][A-Za-z0-9_]*=\S+/g, "")
    .replace(/(?:[A-Za-z]:)?[\\/][^\s]+/g, "")
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const bin = (parts[0] ?? "cmd").split(/[\\/]/).pop() ?? "cmd";
  const sub = parts[1] && !parts[1].startsWith("-") ? parts[1] : "";
  return `${bin} ${sub}`.trim();
}

export function errorSignatures(text: string, limit = 3): string[] {
  return text.split(/\r?\n/).filter((line) => /error|exception|failed|panic|traceback/i.test(line)).slice(0, limit);
}
