import fs from "node:fs";
import path from "node:path";

export interface Manifest {
  version: 1;
  files: Record<string, string | null>;
}

export function readManifest(file: string): Manifest {
  if (!fs.existsSync(file)) return { version: 1, files: {} };
  return JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
}

export function writeManifest(file: string, manifest: Manifest): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
}

export function remember(manifest: Manifest, file: string): void {
  if (Object.prototype.hasOwnProperty.call(manifest.files, file)) return;
  manifest.files[file] = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

export function restore(manifest: Manifest): void {
  for (const [file, previous] of Object.entries(manifest.files)) {
    if (previous === null) {
      if (fs.existsSync(file)) fs.rmSync(file);
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, previous);
    }
  }
}
