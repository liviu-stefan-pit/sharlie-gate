# VS Code and GitHub Copilot CLI

Automated: shared MCP entry shape (`mcpServers.sharlie-gate`), instructions file, skill, and hook JSON with both `bash` and `powershell`.

Manual:

1. `sharlie-gate init` writes `~/.copilot/mcp-config.json`, `~/.copilot/instructions/sharlie-gate.instructions.md`, the skill, and `~/.copilot/hooks/sharlie-gate.json`.
2. In Copilot CLI, a `view` of a file of 150 lines or more should come back as an outline (`postToolUse`).
3. A shell result over 200 lines should be trimmed and keep a `sg:` ref.
4. `.vscode/mcp.json` is written only with `--legacy-vscode`.
