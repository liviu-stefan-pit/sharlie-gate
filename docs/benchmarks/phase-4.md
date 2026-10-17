# Phase 4 — installer and hooks

- `tests/unit/tools.test.ts` installs into a throwaway home, keeps the `// keep me` comment and the unrelated MCP server, produces no second-run diff, and restores the original file bytes on uninstall.
- Copilot `preToolUse` on garbage input returns `permissionDecision: allow` and always serializes to JSON. A 200-line `view` result is rewritten to an outline. Command hooks are wrapped so internal failures allow the tool, because Copilot treats a crashing `preToolUse` hook as a deny.
- Cursor enforce hooks (`beforeReadFile`, `preToolUse` command wrap, `postToolUse` MCP trim) are opt-in via `--enforce` / `SHARLIE_GATE_ENFORCE=1`.
- Live `sharlie-gate init --yes` against the real user profile is intentionally not run by the test suite. It would rewrite Cursor, Copilot, Claude, and Codex config. Run it yourself when you want the tools registered. `sharlie-gate init --dry-run` prints the diff first. `sharlie-gate uninstall` restores files recorded in the install manifest.
- Set `SHARLIE_GATE_RECORD=1` before a Copilot or Cursor hook to append sanitized payloads under `~/.sharlie-gate/recordings/`. Sample shapes live in `tests/fixtures/hook-stdin/`.
