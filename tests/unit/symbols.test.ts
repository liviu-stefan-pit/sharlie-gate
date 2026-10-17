import { describe, expect, it } from "vitest";
import { expandSection } from "../../src/1-editor-helper-tools/section-expander/expander.js";
import { outlineText } from "../../src/1-editor-helper-tools/outline-builder/engine.js";

function names(filePath: string, source: string): string[] {
  return outlineText(source, filePath, { force: true, minLinesToFold: 1 }).symbols.map((symbol) => symbol.qualified);
}

describe("tree-sitter symbols", () => {
  it("qualifies TypeScript, Python, Go, and Rust definitions from tags.scm", () => {
    const ts = "export class ReportExporter {\n  exportAll(filter: string): string {\n    return filter;\n  }\n}\n";
    expect(names("src/report/ReportExport.ts", ts)).toContain("ReportExporter.exportAll");

    const arrow = "export const run = (filter: string): string => {\n  return filter;\n};\n";
    expect(names("src/run.ts", arrow)).toContain("run");

    const py = "class Report:\n    def export(self, filter):\n        return filter\n";
    expect(names("pkg/report.py", py)).toContain("Report.export");

    const go = "package main\n\ntype Report struct{}\n\nfunc (r Report) Export(filter string) string {\n\treturn filter\n}\n";
    expect(names("report.go", go)).toContain("Export");

    const rust = "struct Report {}\nimpl Report {\n    fn export(&self) -> i32 {\n        1\n    }\n}\n";
    expect(names("src/report.rs", rust)).toContain("Report.export");
  });

  it("expands a grammar symbol and keeps the scanner for languages without a grammar", () => {
    const source = "export class ReportExporter {\n  exportAll(filter: string): string {\n    return filter;\n  }\n}\n";
    const expanded = expandSection({ text: source, filePath: "ReportExport.ts", symbol: "ReportExporter.exportAll" });
    expect(expanded.text).toContain("return filter");
    expect(expanded.nested).toBe(false);

    const csharp = "public class Box {\n  public void Run() {\n    int a = 1;\n    int b = 2;\n    int c = 3;\n    int d = 4;\n  }\n}\n";
    const outlined = outlineText(csharp, "Box.cs", { minLinesToFold: 1 });
    expect(outlined.symbols.some((symbol) => symbol.name === "Run" || symbol.name === "Box")).toBe(true);
  });

  it("falls back when the grammar cannot parse the file", () => {
    const broken = "const x = {";
    expect(() => outlineText(broken, "broken.ts", { minLinesToFold: 1 })).not.toThrow();
  });
});
