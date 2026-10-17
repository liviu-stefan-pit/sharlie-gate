import { describe, expect, it } from "vitest";
import { MARKER_RE } from "../../src/core/markers.js";
import { outlineText, sliceLines } from "../../src/1-editor-helper-tools/outline-builder/engine.js";
import { planIndentFolds } from "../../src/1-editor-helper-tools/outline-builder/outliners/indentation-fallback.js";
import { splitRaw } from "../../src/1-editor-helper-tools/outline-builder/scanner.js";

function methodFile(lines: number): string {
  const body = Array.from({ length: Math.max(4, lines - 6) }, (_, i) => `    const v${i} = ${i};`).join("\n");
  return `export class ReportExporter {\n  exportAll(filter: string): string {\n${body}\n    return "ok";\n  }\n}\n`;
}

function assertSections(text: string, total: number, sections: { start: number; end: number }[]) {
  let prev = 0;
  for (const section of sections) {
    expect(section.start).toBeGreaterThan(prev);
    expect(section.end).toBeGreaterThanOrEqual(section.start);
    expect(section.end).toBeLessThanOrEqual(total);
    prev = section.end;
  }
  const hidden = new Set<number>();
  for (const section of sections) {
    for (let n = section.start; n <= section.end; n++) {
      expect(hidden.has(n)).toBe(false);
      hidden.add(n);
    }
  }
  void text;
}

describe("outline engine", () => {
  it("returns files under 150 lines in full and folds 150+", () => {
    const small = outlineText(methodFile(140), "src/small.ts");
    expect(small.totalLines).toBeLessThan(150);
    expect(small.mode).toBe("full");
    expect(small.text.startsWith("export class")).toBe(true);

    const big = outlineText(methodFile(160), "src/report/ReportExport.ts");
    expect(big.totalLines).toBeGreaterThanOrEqual(150);
    expect(big.mode).toBe("outline");
    expect(big.text).toContain("[outline] src/report/ReportExport.ts");
    expect(big.sections.length).toBeGreaterThan(0);
  });

  it("covers every line exactly once and round-trips markers", () => {
    const source = methodFile(180);
    const result = outlineText(source, "src/report/ReportExport.ts");
    assertSections(result.text, result.totalLines, result.sections);
    for (const line of result.text.split("\n")) {
      if (line.includes("[Section hidden:")) expect(line).toMatch(MARKER_RE);
    }
    for (const section of result.sections) {
      const slice = sliceLines(source, section.start, section.end);
      expect(source.includes(slice)).toBe(true);
      expect(slice.length).toBeGreaterThan(0);
    }
  });

  it("preserves CRLF and a BOM in expanded slices", () => {
    const body = Array.from({ length: 20 }, (_, i) => `    const v${i} = ${i};`).join("\r\n");
    const source = `\uFEFFexport class Box {\r\n  run(): void {\r\n${body}\r\n  }\r\n}\r\n`;
    const result = outlineText(source, "Box.cs", { minLinesToFold: 1 });
    expect(result.sections.length).toBeGreaterThan(0);
    const section = result.sections[0];
    expect(section).toBeDefined();
    if (!section) return;
    const slice = sliceLines(source, section.start, section.end);
    expect(source.includes(slice)).toBe(true);
    expect(slice.includes("\r\n")).toBe(true);
    expect(sliceLines(source, 1, 1).startsWith("\uFEFF")).toBe(true);
  });

  it("never throws on broken or minified inputs", () => {
    const samples = [
      `const x = {`,
      "const t = `hello ${",
      "function a(){if(1){}}else{const z=1}",
      "\tfunction mixed(){\n    const a = 1;\n\t\tconst b = 2;\n\t\tconst c = 3;\n\t\tconst d = 4;\n\t}\n",
      "fn main() { let s = r#\" braces { } \"#; let x = 1;\n let y = 2;\n let z = 3;\n let w = 4;\n}\n",
      "def f():\n    s = ''' triple { '\n    x = 1\n    y = 2\n    z = 3\n    w = 4\n",
      "const view = <div>{items.map(v => <span>{v}</span>)}</div>;\n" + "const a = 1;\n".repeat(5),
      'var s = @"line { not a block";\n' + "public void M(){\n int a=1;\n int b=2;\n int c=3;\n int d=4;\n}\n",
      "const min = " + "x".repeat(2500) + ";",
    ];
    for (const sample of samples) {
      expect(() => outlineText(sample, "broken.ts", { minLinesToFold: 1 })).not.toThrow();
      const result = outlineText(sample, "broken.ts", { minLinesToFold: 1 });
      expect(["full", "outline", "minified", "head-tail"]).toContain(result.mode);
    }
  });

  it("uses the indentation fallback for yaml, makefiles, unknown dsl, and flat logs", () => {
    const yaml = ["root:", ...Array.from({ length: 30 }, (_, i) => `  key${i}: ${i}`), "other:", ...Array.from({ length: 10 }, (_, i) => `  v${i}: 1`)].join("\n");
    const yamlResult = outlineText(yaml + "\n", "config.yaml", { minLinesToFold: 1 });
    expect(yamlResult.profile).toBe("yaml");
    expect(yamlResult.mode === "outline" || yamlResult.mode === "full").toBe(true);

    const make = ["all:", ...Array.from({ length: 12 }, (_, i) => `\tstep ${i}`)].join("\n");
    expect(outlineText(make, "Makefile", { minLinesToFold: 1 }).profile).toBe("indent");

    const dsl = ["block", ...Array.from({ length: 12 }, () => "    inner")].join("\n");
    expect(() => outlineText(dsl, "thing.dsl", { minLinesToFold: 1 })).not.toThrow();

    const flat = Array.from({ length: 80 }, (_, i) => `log line ${i}`).join("\n");
    const flatResult = outlineText(flat, "out.log", { minLinesToFold: 1 });
    expect(flatResult.mode).toBe("full");

    const huge = Array.from({ length: 2100 }, (_, i) => `log ${i}`).join("\n");
    const hugeResult = outlineText(huge, "huge.log", { minLinesToFold: 1 });
    expect(hugeResult.mode).toBe("head-tail");
    expect(hugeResult.sections[0]).toEqual({ start: 51, end: 2050 });
  });

  it("keeps a top-level yaml key and folds the indented run", () => {
    const raw = splitRaw(["root:", ...Array.from({ length: 8 }, (_, i) => `  item${i}: 1`), "tail: 1"].join("\n"));
    const plan = planIndentFolds(raw, 4);
    expect(plan.flat).toBe(false);
    expect(plan.folds.length).toBeGreaterThan(0);
  });
});
