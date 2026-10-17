import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createReader } from "../../src/1-editor-helper-tools/mcp-server/server.js";

describe("MCP reader", () => {
  it("lists the three tools and rejects a path outside the roots", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sg-mcp-"));
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
    await client.close();
    await server.close();
  });
});
