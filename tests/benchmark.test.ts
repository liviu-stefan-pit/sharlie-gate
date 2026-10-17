import { describe, expect, it } from "vitest";
import { outlineText } from "../src/1-editor-helper-tools/outline-builder/engine.js";
import { runFilters } from "../src/2-traffic-gatekeeper/filters/pipeline.js";
import { parseAnthropic } from "../src/2-traffic-gatekeeper/adapters/anthropic-messages.js";
import { DecisionTable } from "../src/2-traffic-gatekeeper/conversation-state/frozen-decisions.js";

function methodFile(lines: number, name: string): string {
  const body = Array.from({ length: lines }, (_, i) => `    const value${i} = ${i};`).join("\n");
  return `export class ${name} {\n  run(input: string): string {\n${body}\n    return input;\n  }\n}\n`;
}

describe("benchmarks", () => {
  it("outlines a 10k-line file quickly and keeps the corpus under 40% at the median", () => {
    const big = methodFile(10_000, "Big");
    const started = performance.now();
    const result = outlineText(big, "src/Big.ts", { minLinesToFold: 1 });
    const elapsed = performance.now() - started;
    expect(result.mode).toBe("outline");
    expect(elapsed).toBeLessThan(250);

    const ratios: number[] = [];
    for (let n = 0; n < 30; n++) {
      const lines = 300 + n * 90;
      const source = methodFile(lines, `Sample${n}`);
      const outlined = outlineText(source, `src/Sample${n}.ts`, { minLinesToFold: 1 });
      ratios.push(outlined.text.length / source.length);
      expect(outlined.sections.every((section, i, all) => i === 0 || section.start > (all[i - 1]?.end ?? 0))).toBe(true);
    }
    ratios.sort((a, b) => a - b);
    const median = ratios[15] ?? 1;
    expect(median).toBeLessThanOrEqual(0.4);
  });

  it("prunes more than 30% of a long session without touching the current turn", () => {
    const file = Array.from({ length: 400 }, (_, i) => `const row${i} = ${i};`).join("\n");
    const log = Array.from({ length: 80 }, () => "Error: boom\nnpm ERR! failed").join("\n");
    const raw = {
      model: "claude-sonnet-4.6",
      system: "static instructions",
      messages: [
        { role: "user", content: [{ type: "text", text: "read it" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "src/a.ts" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "r1", content: file }] },
        { role: "assistant", content: [{ type: "tool_use", id: "s1", name: "Bash", input: { command: "npm test" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "s1", content: log }] },
        { role: "user", content: [{ type: "text", text: "again" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "r2", name: "Read", input: { file_path: "src/a.ts" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "r2", content: file }] },
        { role: "assistant", content: [{ type: "tool_use", id: "s2", name: "Bash", input: { command: "npm test" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "s2", content: "passed\n0 failed\n" }] },
        { role: "user", content: [{ type: "text", text: "current question stays" }] },
      ],
    };
    const before = JSON.stringify(raw).length;
    const clone = structuredClone(raw);
    const canon = parseAnthropic(clone);
    runFilters(canon, {
      store: { put: () => "sg:abc12345" },
      decisions: new DecisionTable(),
      conversationId: "bench",
      epoch: 1,
      epochOpen: true,
      enabled: { cachePrefixStabilizer: false },
    });
    const after = JSON.stringify(clone).length;
    expect(JSON.stringify(clone.messages.at(-1))).toContain("current question stays");
    expect(after).toBeLessThan(before * 0.7);
  });
});
