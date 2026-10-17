import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/cli/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist/sharlie-gate.mjs",
  banner: { js: "#!/usr/bin/env node" },
  mainFields: ["module", "main"],
  external: [],
  logLevel: "info",
});

mkdirSync("dist/grammars", { recursive: true });
cpSync("src/1-editor-helper-tools/outline-builder/symbols/grammars", "dist/grammars", { recursive: true });
copyFileSync("node_modules/web-tree-sitter/web-tree-sitter.wasm", "dist/tree-sitter.wasm");
