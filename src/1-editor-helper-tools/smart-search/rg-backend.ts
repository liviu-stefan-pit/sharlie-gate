import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let cached: string | null | undefined;

export function findRg(): string | undefined {
  if (cached !== undefined) return cached ?? undefined;
  const bundled = [
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "cursor", "resources", "app", "node_modules", "@vscode", "ripgrep", "bin", "rg.exe"),
    "/usr/bin/rg",
  ];
  for (const candidate of ["rg", ...bundled]) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) {
      cached = candidate;
      return candidate;
    }
  }
  cached = null;
  return undefined;
}

export function rgMatchLines(root: string, opts: {
  query: string;
  isRegex?: boolean;
  pathGlob?: string;
  caseSensitive?: boolean;
  maxResults: number;
}): Map<string, number[]> {
  const bin = findRg();
  if (!bin) throw new Error("rg is not available");
  const args = ["-n", "--no-heading", "-H", "--color", "never", "--glob", "!.git/**", "--glob", "!node_modules/**"];
  const ignoreFile = path.join(root, ".gitignore");
  if (fs.existsSync(ignoreFile)) args.push("--ignore-file", ignoreFile);
  if (!opts.caseSensitive) args.push("-i");
  if (!opts.isRegex) args.push("-F");
  if (opts.pathGlob) args.push("--glob", opts.pathGlob);
  args.push("--", opts.query, ".");
  const proc = spawnSync(bin, args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (proc.status !== 0 && proc.status !== 1) {
    throw new Error(proc.stderr || `rg exited ${proc.status}`);
  }
  const map = new Map<string, number[]>();
  let count = 0;
  for (const line of (proc.stdout ?? "").split(/\r?\n/)) {
    if (!line) continue;
    const match = /^(.+?):(\d+):/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const rel = match[1].replace(/\\/g, "/").replace(/^\.\//, "");
    const list = map.get(rel) ?? [];
    list.push(Number(match[2]));
    map.set(rel, list);
    count += 1;
    if (count >= opts.maxResults) break;
  }
  return map;
}

export function isBinary(file: string): boolean {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(8000);
    const n = fs.readSync(fd, buf, 0, 8000, 0);
    return buf.subarray(0, n).includes(0);
  } finally {
    fs.closeSync(fd);
  }
}
