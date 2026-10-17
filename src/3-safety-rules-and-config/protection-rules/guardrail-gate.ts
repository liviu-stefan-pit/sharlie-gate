export interface GuardrailRules {
  minLinesToFold: number;
  currentTurn: number;
}

export interface ProposedEdit {
  turnIndex: number;
  lineCount: number;
  kind: "file-view" | "shell" | "other";
  isEditTargetLatest?: boolean;
  replacement: string;
  original: string;
}

export interface GateDecision {
  allow: boolean;
  rule?: string;
}

const RESOLVABLE =
  /\[Section hidden: Lines \d+–\d+\. Request this section to view or edit\]|\[Duplicate file view removed[^\]]*ref sg:[0-9a-f]+\]|\[Resolved error log hidden[^\]]*ref sg:[0-9a-f]+\]|\| ref sg:[0-9a-f]+\]/;

/** Filters propose edits. This gate is the only place a proposal becomes a mutation. */
export function reviewEdit(edit: ProposedEdit, rules: GuardrailRules): GateDecision {
  if (edit.turnIndex >= rules.currentTurn) return { allow: false, rule: "current-turn-immunity" };
  if (edit.kind === "file-view" && edit.lineCount < rules.minLinesToFold) return { allow: false, rule: "small-file-bypass" };
  if (edit.isEditTargetLatest) return { allow: false, rule: "edit-target-full-visibility" };
  if (edit.replacement === edit.original) return { allow: false, rule: "unchanged" };
  if (!RESOLVABLE.test(edit.replacement)) return { allow: false, rule: "on-demand-expansion" };
  return { allow: true };
}
