# Security

Sharlie Gate runs on your computer. It reads workspace files the editor asks it to read, and the optional proxy sees the API requests you point at `127.0.0.1:8080`.

## Supported use

- Node.js 24.11 or newer
- The proxy listens on loopback only (`127.0.0.1` or `localhost`). A config that asks for any other host is rejected.

## Report a vulnerability

Do not open a public GitHub issue for a security report.

Use a private GitHub security advisory on [liviu-stefan-pit/sharlie-gate](https://github.com/liviu-stefan-pit/sharlie-gate/security/advisories/new). If that page is unavailable, contact the repository owner through GitHub instead of posting details in an issue.

Include what you ran, the Sharlie Gate version (`node dist/sharlie-gate.mjs --version`), and a minimal way to reproduce the problem. Please allow a reasonable time to respond before any public write-up.

## Out of scope

- A model ignoring the outline instructions and reading a file anyway. The instructions are guidance. `--enforce` plus `SHARLIE_GATE_ENFORCE=1` is the Cursor hook that can deny a large read.
- Traffic you deliberately send to a host other than this program.
- Secrets you commit yourself. Do not commit `.env` files, API keys, or `~/.sharlie-gate/ledger.sqlite`.

## Expectations

This software is provided as-is, without warranty, under the [MIT license](LICENSE). The authors and copyright holders are not liable for claims or damages arising from its use.
