# Sharlie Gate

**Discontinued.** The source stays in this repository in case an editor later exposes the model request.

Sharlie Gate cannot lower a Cursor or GitHub Copilot bill. Those apps send the chat to their own service. The outline skill, the hooks, and the MCP tools are added inside that chat, so they increase the tokens those apps send. The proxy can prune a request only when a client is pointed at it with your own API key. Cursor and Copilot do not take that path.

The rest of this file describes how the program worked. Do not install it to save money on Cursor or Copilot.

Sharlie Gate is a local program that keeps coding agents from pasting whole files into the model. It outlines a file, expands only the lines you need, and can sit in front of API traffic to fold old file copies out of the conversation.

It runs on your machine. It does not create an account.

The license is [MIT](LICENSE). You can use, change, and ship it however you want. The authors provide it as-is and accept no liability.

## What you need

- Node.js 24.11 or newer (`node --version`)
- One of: Cursor, GitHub Copilot CLI, Claude Code, Codex CLI, OpenCode, or VS Code

Windows, macOS, and Linux use the same commands. Paths below use your home folder: `%USERPROFILE%` on Windows, `~` on macOS and Linux.

## Install

```bash
npm install
npm run build
node dist/sharlie-gate.mjs --version
node dist/sharlie-gate.mjs init --dry-run
node dist/sharlie-gate.mjs init
```

On Windows, `installer/build-win.ps1` builds `dist/installer/SharlieGate-Setup.exe`. The machine that builds it needs [Inno Setup 6.3](https://jrsoftware.org/isinfo.php) or newer. People who run the setup exe do not need Node.js. The installer copies a private Node 24 into `%LOCALAPPDATA%\Programs\Sharlie-Gate`, runs `init`, and adds a Start Menu shortcut named **Sharlie Gate Dashboard**. That shortcut opens the savings page in the browser. Uninstall from the Start Menu or from Apps & Features runs `uninstall --purge`, which restores editor files and deletes `%USERPROFILE%\.sharlie-gate`, including the ledger. The setup exe is unsigned, so Windows SmartScreen warns the first time someone else opens it.

`npm install` downloads this repo's libraries. `npm run build` writes `dist/sharlie-gate.mjs` plus the grammar files next to it. `init --dry-run` prints the editor files it would change and writes nothing. `init` copies the program to `~/.sharlie-gate/bin/` and configures every editor whose home folder already exists.

Add a repository so Cursor, Copilot, and agents that read `AGENTS.md` get the outline rule inside that project:

```bash
node dist/sharlie-gate.mjs init --project /path/to/your/repo
```

The full map of files, optional switches, and how to take it back out is in [docs/install-guide.html](docs/install-guide.html). Open that file in a browser.

## What init turns on

| Command | Effect |
| --- | --- |
| `init` | MCP server plus outline instructions for each detected editor |
| `init --project <dir>` | Also writes that repo's Cursor rule, Copilot instructions, and `AGENTS.md` block |
| `init --legacy-vscode --project <dir>` | Also writes `<dir>/.vscode/mcp.json` |
| `init --enforce` | Writes Cursor hooks. They stay idle until `SHARLIE_GATE_ENFORCE=1` |
| `init --with-proxy` | Points Claude Code at `http://127.0.0.1:8080/anthropic` and prints an autostart line. It does not start the proxy. |

Start the optional proxy yourself, and leave that terminal open:

```bash
node dist/sharlie-gate.mjs proxy
```

The proxy listens on `127.0.0.1:8080` only. The savings page is `http://127.0.0.1:8080/ledger`. `sharlie-gate dashboard` opens that page, or starts the same page on `http://127.0.0.1:8731/ledger` when the proxy is not running.

## How a chat uses it

The editor starts `sharlie-gate.mjs mcp` when a chat needs tools. The model is instructed to call `read_file_outline` first. Files under 150 lines come back whole. Longer files come back as signatures and line markers. `expand_section_lines` returns one hidden range or symbol. `targeted_search` returns matching lines with a little context. Before an edit, the model asks for the full file with `intent: "edit"`.

TypeScript, JavaScript, Python, Go, and Rust symbol names come from [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) (MIT). Other languages use the built-in scanner.

## Commands

```text
sharlie-gate <init|uninstall|doctor|mcp|proxy|dashboard|status|ledger|hook|run|tune|bypass>
```

| Command | What it does |
| --- | --- |
| `doctor` | Shows which editors were found and whether Node is missing |
| `dashboard` | Opens the savings page in the browser. Uses port 8731 when the proxy is not running |
| `status` | Prints a one-line savings summary from the local ledger |
| `bypass on` / `bypass off` | Lets proxy traffic through unchanged, or turns rewriting back on |
| `uninstall` | Restores every file `init` changed. `uninstall --purge` also deletes the data folder, backups, and the Windows logon task |

## Develop

```bash
npm test
npm run lint
npm run typecheck
```

`npm test` runs the unit, integration, and benchmark tests.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Report vulnerabilities the way [SECURITY.md](SECURITY.md) describes, not in a public issue.

## License

[MIT](LICENSE). Copyright (c) 2026 liviu-stefan-pit.

Vendored Tree-sitter grammar files under `src/1-editor-helper-tools/outline-builder/symbols/grammars/` stay under their upstream MIT licenses.
