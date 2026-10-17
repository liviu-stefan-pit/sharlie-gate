import path from "node:path";

export interface RootSet {
  roots: string[];
  allowOutside: boolean;
}

export function fallbackRoots(): string[] {
  const fromEnv = process.env.SHARLIE_GATE_ROOT?.split(path.delimiter).map((s) => s.trim()).filter(Boolean);
  if (fromEnv && fromEnv.length) return fromEnv.map((r) => path.resolve(r));
  return [process.cwd()];
}

export function resolveInside(roots: RootSet, requested: string): { ok: true; abs: string } | { ok: false; error: string } {
  const abs = path.resolve(requested);
  if (roots.allowOutside) return { ok: true, abs };
  const allowed = roots.roots.some((root) => {
    const rel = path.relative(path.resolve(root), abs);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
  if (!allowed) return { ok: false, error: `Path is outside the workspace roots: ${requested}` };
  return { ok: true, abs };
}
