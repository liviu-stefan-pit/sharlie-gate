# Contributing

Sharlie Gate is MIT-licensed. Contributions are welcome under the same license: you can use the project however you want, and by sending a change you agree that your contribution is also under the MIT license in [LICENSE](LICENSE).

## Setup

- Node.js 24.11 or newer
- Git

```bash
git clone https://github.com/liviu-stefan-pit/sharlie-gate.git
cd sharlie-gate
npm install
npm test
```

## Checks before a pull request

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

`npm test` covers the outline, the symbol grammars, the installer, the proxy, and the ledger. A change to editor install paths should say which files `init` writes and which files `uninstall` restores. The map lives in [docs/install-guide.html](docs/install-guide.html); update that page when the installer changes.

## What to send

- One change per pull request, with a short note on why it is needed.
- Tests for behavior you changed. A new editor target needs a test that the written file contains the Sharlie Gate entry and that uninstall puts the previous bytes back.
- No secrets, no `node_modules/`, no `dist/`, and no ledger databases. Those are gitignored.

## What stays local

The proxy binds to `127.0.0.1` only. Do not add a way to listen on a public address. Symbol parsing stays in-process with WebAssembly. Do not add a native addon that has to be compiled per operating system.

## Reporting bugs

Open a [GitHub issue](https://github.com/liviu-stefan-pit/sharlie-gate/issues) for a bug or idea that is safe to discuss in public. Use [SECURITY.md](SECURITY.md) for a vulnerability.
