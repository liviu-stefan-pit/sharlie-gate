import fs from "node:fs";
import path from "node:path";
import ignore from "ignore";
import { isBinary } from "./rg-backend.js";

export function listFiles(root: string, pathGlob?: string): string[] {
  const ig = ignore();
  const gitignore = path.join(root, ".gitignore");
  if (fs.existsSync(gitignore)) ig.add(fs.readFileSync(gitignore, "utf8"));
  ig.add(".git/\nnode_modules/");
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      if (ig.ignores(rel) || ig.ignores(`${rel}/`)) continue;
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) {
        if (pathGlob && !globMatch(rel, pathGlob)) continue;
        out.push(rel);
      }
    }
  };
  walk(root);
  return out.sort();
}

export function globMatch(rel: string, pattern: string): boolean {
  const normalized = pattern.replace(/\\/g, "/");
  const source = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*");
  const re = new RegExp(`^${source}$`, "i");
  return re.test(rel) || re.test(rel.split("/").pop() ?? rel);
}

export function matchLinesInFile(abs: string, query: string, opts: { isRegex?: boolean; caseSensitive?: boolean }): number[] {
  if (isBinary(abs)) return [];
  let text = "";
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    return [];
  }
  if (text.includes("\u0000")) return [];
  const lines = text.split(/\r?\n/);
  const flags = opts.caseSensitive ? "" : "i";
  let re: RegExp;
  try {
    re = new RegExp(opts.isRegex ? query : escapeRegExp(query), flags);
  } catch {
    return [];
  }
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (re.test(line)) hits.push(i + 1);
    re.lastIndex = 0;
  });
  return hits;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
