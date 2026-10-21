import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createReader } from "../../src/1-editor-helper-tools/mcp-server/server.js";
import { Ledger } from "../../src/4-savings-dashboard/token-ledger/db.js";

describe("MCP reader", () => {
  it("lists the three tools and rejects a path outside the roots", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sg-mcp-"));
    const previousLedger = process.env.SHARLIE_GATE_LEDGER;
    process.env.SHARLIE_GATE_LEDGER = path.join(root, "ledger.sqlite");
    const file = path.join(root, "ReportExport.ts");
    fs.writeFileSync(file, `export class ReportExporter {\n  export() {\n${"    return 1;\n".repeat(160)}  }\n}\n`);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createReader({ roots: [root], allowOutside: false });
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["expand_section_lines", "read_file_outline", "targeted_search"]);
    const outlined = await client.callTool({ name: "read_file_outline", arguments: { path: file } });
    expect(JSON.stringify(outlined)).toContain("Section hidden");
    const denied = await client.callTool({ name: "read_file_outline", arguments: { path: path.join(os.tmpdir(), "nope.ts") } });
    expect(JSON.stringify(denied)).toContain("outside the workspace");
    const expanded = await client.callTool({
      name: "expand_section_lines",
      arguments: { path: file, start_line: 1, end_line: 4 },
    });
    expect(JSON.stringify(expanded)).toContain("export class");
    const ledger = Ledger.open(process.env.SHARLIE_GATE_LEDGER);
    try {
      expect(ledger.tokensRemoved()).toBeGreaterThan(0);
      expect(ledger.fastExpandRate()).toBeGreaterThan(0);
    } finally {
      ledger.close();
    }
    await client.close();
    await server.close();
    if (previousLedger === undefined) delete process.env.SHARLIE_GATE_LEDGER;
    else process.env.SHARLIE_GATE_LEDGER = previousLedger;
  });
});
