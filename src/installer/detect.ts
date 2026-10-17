import fs from "node:fs";
import path from "node:path";

export interface Detected {
  cursor: boolean;
  copilot: boolean;
  claude: boolean;
  codex: boolean;
  opencode: boolean;
  vscode: boolean;
}

export function detect(home: string): Detected {
  const exists = (rel: string) => fs.existsSync(path.join(home, rel));
  return {
    cursor: exists(".cursor") || exists(path.join("AppData", "Local", "Programs", "cursor")),
    copilot: exists(".copilot"),
    claude: exists(".claude") || exists(".claude.json"),
    codex: exists(".codex"),
    opencode: exists(path.join(".config", "opencode")),
    vscode: exists(path.join("AppData", "Roaming", "Code", "User")) || exists(".vscode"),
  };
}
