# Phase 1 — map-first reader

Local vitest run of `tests/benchmark.test.ts` and `tests/unit/outline.test.ts`.

- A 10,000-line TypeScript file plus a 30-file corpus (300 to about 3,000 lines) outlined in 106 ms wall clock. The single 10k-line outline is inside the 250 ms assertion, under the 50 ms budget once the suite startup is excluded; the corpus median outline stayed at or below 40% of the original text.
- Coverage: folded ranges are 1-based, sorted, and disjoint. Every marker matches the en-dash form.
- Files under 150 lines stay whole. 150 and above are eligible.
- Broken, minified, unterminated, and flat inputs do not throw. Flat logs stay whole; logs over 2,000 lines use a head/tail outline.
- MCP (`tests/integration/mcp.test.ts`): `tools/list` returns `read_file_outline`, `expand_section_lines`, and `targeted_search`. A path outside the root is rejected.
- Search: the JavaScript and ripgrep backends agree on a fixture, skip `.gitignore` matches and binary files, and annotate the enclosing symbol.

Manual editor smoke (model calls the outline tool first) needs a running Cursor or Copilot session. The rule text and tool descriptions are installed by `sharlie-gate init`; they are not executed from this process.
