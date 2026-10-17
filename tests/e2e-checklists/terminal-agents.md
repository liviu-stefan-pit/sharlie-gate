# Claude Code, Codex CLI, OpenCode

Automated: installer plans for `~/.claude.json`, `~/.claude/CLAUDE.md`, `~/.codex/config.toml`, and OpenCode `opencode.json`, each behind a directory-exists check.

Manual, only with `--with-proxy` (this also prints the autostart command, because a dead proxy would break the client):

1. Claude Code: `ANTHROPIC_BASE_URL=http://127.0.0.1:8080/anthropic`.
2. Codex: provider base URL `http://127.0.0.1:8080/openai/v1`.
3. Start `sharlie-gate proxy` first, then run a short task. `sharlie-gate doctor` should show the tools it detected.
4. `GET http://127.0.0.1:8080/healthz` returns `{ "ok": true }`.
