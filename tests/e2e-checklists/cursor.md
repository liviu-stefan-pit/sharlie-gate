# Cursor Desktop and Cursor CLI

Automated: MCP tool list, outline-first descriptions, rule render (`sharlie-gate.mdc`, `alwaysApply: true`).

Manual, after `sharlie-gate init`:

1. Reload Cursor. Settings should show the `sharlie-gate` MCP server from `~/.cursor/mcp.json`.
2. Ask the agent to inspect a file over 150 lines. It should call `read_file_outline` before a full read.
3. Ask it to edit that file. It should call `expand_section_lines` or pass `intent: "edit"`.
4. The status pill extension is `extensions/status-pill`. Install it with the Extensions: Install from Location command if you want the bottom-bar savings pill. It polls `http://127.0.0.1:8080/ledger/api/summary` only while the proxy is running.

Cursor Desktop does not send model traffic to `127.0.0.1`. v1 does not tunnel it.
