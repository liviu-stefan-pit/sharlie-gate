import { z } from "zod";

export const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

export const outlineSchema = {
  path: z.string().describe("File or directory path, absolute or relative to the workspace root."),
  intent: z.enum(["inspect", "edit"]).optional().describe("Use edit before changing a file. Edit returns the full file."),
  max_depth: z.number().int().min(0).max(6).optional().describe("Directory listing depth. Default 2."),
};

export const expandSchema = {
  path: z.string().optional().describe("File path. Required unless ref is set."),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  symbol: z.string().optional().describe("Qualified symbol, for example ReportExporter.export."),
  ref: z.string().optional().describe("Content-store reference sg:<hash> from a collapsed history marker."),
  rev: z.string().optional().describe("Outline rev. A mismatch means the file changed."),
};

export const searchSchema = {
  query: z.string(),
  is_regex: z.boolean().optional(),
  path_glob: z.string().optional(),
  case_sensitive: z.boolean().optional(),
  context_lines: z.number().int().min(0).max(10).optional(),
  max_results: z.number().int().min(1).max(200).optional(),
};

export const OUTLINE_DESCRIPTION =
  "PREFERRED FIRST STEP for reading any file or directory. Returns a structural outline with exact line markers instead of a full file dump. Use this instead of a full read, then call expand_section_lines for a hidden range. Files under 150 lines, and intent=edit, return the full text.";

export const EXPAND_DESCRIPTION =
  "Fetch one hidden range, symbol, or sg: reference produced by read_file_outline or the traffic gatekeeper. Returns the exact original text. Ranges over 400 lines come back as a nested outline.";

export const SEARCH_DESCRIPTION =
  "PREFERRED over opening whole files to find text. Returns matching lines with a few lines of context and the enclosing symbol. Does not dump files that merely contain a hit.";
