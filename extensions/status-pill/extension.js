const vscode = require("vscode");
const http = require("node:http");

function activate(context) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  item.name = "Sharlie-Gate";
  item.command = "sharlie-gate.openLedger";
  item.show();
  const refresh = () => {
    const req = http.get("http://127.0.0.1:8080/ledger/api/summary", (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          item.text = `$(shield) Saved Today: ${body.today} (Last turn: ${body.last})`;
        } catch {
          item.text = "$(shield) Sharlie-Gate";
        }
      });
    });
    req.on("error", () => {
      item.text = "$(shield) Sharlie-Gate off";
    });
  };
  refresh();
  const timer = setInterval(refresh, 2000);
  context.subscriptions.push(item, { dispose: () => clearInterval(timer) });
  context.subscriptions.push(vscode.commands.registerCommand("sharlie-gate.openLedger", () => {
    vscode.env.openExternal(vscode.Uri.parse("http://127.0.0.1:8080/ledger"));
  }));
  context.subscriptions.push(vscode.commands.registerCommand("sharlie-gate.toggleBypass", () => {
    const req = http.request("http://127.0.0.1:8080/control/bypass", { method: "POST" }, () => refresh());
    req.on("error", () => undefined);
    req.end("on");
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };
