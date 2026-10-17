# Phase 0 — scaffold

Measured on this machine (Node.js 24.11.1, Windows).

- `npm run build` produces `dist/sharlie-gate.mjs` (about 932 KB) in under a second.
- `node dist/sharlie-gate.mjs --version` prints `sharlie-gate 0.1.0`.
- `node:sqlite` opens without `--experimental-sqlite`. The runtime prints Node's own experimental warning; no native addon is compiled.
- Tests, typecheck, and the build run locally with npm. There is no GitHub Actions workflow.
