import { z } from "zod";

export const ENGINE_VERSION = "1";

export const configSchema = z.object({
  minLinesToFold: z.number().int().positive().default(150),
  minFoldLines: z.number().int().positive().default(4),
  maxExpandLines: z.number().int().positive().default(400),
  outlineTokenRatioMax: z.number().min(0).max(1).default(0.7),
  contractKeepLines: z.number().int().positive().default(60),
  importKeepLines: z.number().int().positive().default(15),
  proxyHost: z.string().default("127.0.0.1"),
  proxyPort: z.number().int().positive().default(8080),
  pipelineBudgetMs: z.number().int().positive().default(250),
  bodyLimitBytes: z.number().int().positive().default(64 * 1024 * 1024),
  idleTimeoutMs: z.number().int().positive().default(10 * 60 * 1000),
  exactRawCount: z.boolean().default(true),
  countSampleRate: z.number().min(0).max(1).default(0.1),
  isolateCacheAccounting: z.boolean().default(false),
  contentStoreMaxBytes: z.number().int().positive().default(500 * 1024 * 1024),
  contentStoreTtlDays: z.number().int().positive().default(14),
  allowOutsideRoots: z.boolean().default(false),
  defaultProvider: z.enum(["anthropic", "openai"]).default("anthropic"),
  upstreams: z.record(z.string()).default({}),
  filters: z.object({
    duplicateFileRemover: z.boolean().default(true),
    backgroundFileFolder: z.boolean().default(true),
    resolvedErrorLogCleaner: z.boolean().default(true),
    noisyTerminalTrimmer: z.boolean().default(true),
    cachePrefixStabilizer: z.boolean().default(true),
  }).default({}),
});

export type SharlieConfig = z.infer<typeof configSchema>;

export function loadConfig(overrides: unknown = {}): SharlieConfig {
  return configSchema.parse(overrides ?? {});
}
