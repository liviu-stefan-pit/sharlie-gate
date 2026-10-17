import { ensureSymbolRuntime, preloadGrammars } from "../src/1-editor-helper-tools/outline-builder/symbols/runtime.js";

await ensureSymbolRuntime();
preloadGrammars();
