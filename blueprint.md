# **\# Sharlie-Gate: Master Blueprint**

# **1\. Executive Summary & Core Philosophy**

## **The Problem**

Modern desktop AI editors send massive amounts of redundant context on every turn of a conversation. Entire workspace files, duplicate history reads, resolved terminal error messages, and shifting system timestamps are packaged and re-transmitted repeatedly. This behavior creates three major operational bottlenecks:

* **Severe Token Inflation:** Transmitting 50,000+ tokens per turn rapidly drains usage tiers and inflates API billing.  
* **Increased Latency:** Large prompt payloads significantly increase Time-To-First-Token (TTFT) and overall generation duration.  
* **Degraded Intelligence:** Overloading the prompt window triggers the "lost in the middle" phenomenon, where the model misses critical logic buried under repetitive file dumps and stale context.

## **The Solution**

A hybrid, local-first system designed to sit transparently between your desktop editor and the AI provider. The system operates via two primary mechanisms:

1. **Local Context Pruner & Outliner:** Intercepts file reads and historical payloads on your local machine, stripping away unedited file interiors and obsolete transcript logs while leaving exact structural maps and programmatic retrieval hooks.  
2. **Cloud Cache Stabilizer:** Reorders and freezes the top of outgoing conversation packages, ensuring that cloud provider prompt-caching algorithms reliably achieve up to 90% cost and performance discounts turn after turn.

┌─────────────────┐       ┌────────────────────────────────────────────────────────┐       ┌─────────────────┐

│                 │       │                     LOCAL SYSTEM                       │       │                 │

│  Desktop Editor │ ────\> │  ┌──────────────────────┐    ┌──────────────────────┐  │ ────\> │   Cloud AI      │

│ (Cursor/VSCode) │       │  │  Smart Workspace     │ ──\>│  Outgoing Traffic    │  │       │   Provider      │

│                 │ \<──── │  │  Reader (Outlines)   │    │  Gatekeeper (Proxy)  │  │ \<──── │  (Anthropic/    │

└─────────────────┘       └─────────────────────────┴────┴──────────────────────┴──┘       │   OpenAI/etc.)  │

                                                                                           └─────────────────┘

## **The Golden Rule: Zero Quality Loss**

To prevent degradation in model reasoning or precision, the system avoids using smaller, lossy AI models to summarize workspace files. Secondary AI summaries frequently hallucinate, drop exact line definitions, and distort variable boundaries. Instead, this system uses **100% deterministic structural folding** combined with an **instant, on-demand zoom loop**.

---

# **2\. High-Level System Architecture**

The architecture runs locally as an integrated desktop service split into two specialized components:

## **Component A: The Smart Workspace Reader (Editor Helper)**

This component integrates directly with the editor's tool-use protocol. Rather than allowing the editor to dump entire 2,000-line files into the chat window upon inspection, it intercepts file access calls.

* **The Map-First Reader:** Returns a structural skeleton of the requested file or directory. The skeleton preserves top-level structures, entry points, interfaces, and function signatures, replacing internal block logic with explicit structural markers:  
  `[Section details hidden: Lines 40–120. Request this section if you need to edit or inspect it]`  
* **The Precision Zoom Tool:** Exposes a secondary programmatic tool to the assistant, allowing it to retrieve exact line spans or named sections on demand once it reviews the structural map.  
* **The Targeted Searcher:** Intercepts broad text searches, returning exact matching lines alongside three lines of surrounding context rather than embedding entire files that contain a query match.

## **Component B: The Outgoing Traffic Gatekeeper (Local Proxy)**

Operating as a local network proxy, this module intercepts raw HTTP/JSON payloads leaving the editor bound for external provider endpoints. It processes outgoing payloads through four sequential passes:

* **Pass 1: History Deduplication:** Scans the multi-turn message array. If a file was read in Turn 2, modified in Turn 5, and read again in Turn 8, the proxy strips the full file bodies from Turns 2 and 5, replacing them with a pointer:  
  `[Duplicate file view removed — see latest copy in Turn 8]`  
* **Pass 2: Resolved Error & Log Cleanup:** Identifies large terminal outputs or crash traces from prior turns. Once a subsequent turn indicates a successful compile or test execution, the proxy collapses the preceding multi-page log into a minimal reference entry:  
  `[Resolved error log hidden — 1,995 lines omitted. Outcome: Resolved in Turn 6]`  
* **Pass 3: Cache Prefix Locking:** Provider prompt caching requires identical prefix structures across sequential requests. Editors frequently inject dynamic elements—such as active system clocks, dynamic file trees, or reordered system prompts—at the top of the request payload. The gatekeeper isolates all dynamic variables, moves them to the tail end of the payload, and stabilizes the static header to guarantee prompt cache hits.  
* **Pass 4: Local Instant-Answer Vault:** Caches responses locally for invariant, deterministic requests (such as static lookup queries or repeated environment checks), returning results instantly without outbound network calls.

---

# **3\. How the "Zero Quality Loss" Guarantee Works in Practice**

To ensure complete safety and maintain full reasoning capabilities, the system enforces five strict guardrails:

| Safety Guardrail | Mechanics | Quality Preservation Impact |
| :---- | :---- | :---- |
| **1\. Current Turn Immunity** | Applies zero pruning or structural folding to user inputs or file attachments present in the active turn. | Ensures the model receives complete, unmodified context for the immediate task or query. |
| **2\. Structural Folding** | Collapses internal implementation blocks while preserving exact class names, function signatures, types, and module exports. | Maintains structural awareness; the model understands interfaces and contracts without consuming implementation bulk. |
| **3\. Self-Service Expansion** | Embeds explicit retrieval syntax within every folded section boundary. | Enables the model to dynamically request hidden lines if an answer depends on specific internal logic. |
| **4\. Edit-Target Full Visibility** | Automatically hydrates and expands folded sections to 100% full detail whenever the model initiates an edit tool call. | Prevents partial-context edits, syntax errors, or broken implementation references during code generation. |
| **5\. Automatic Fallback** | Bypasses folding entirely for documents under 150 lines or files lacking clear structural boundaries. | Avoids unnecessary retrieval turns on small payloads where token costs are negligible. |

---

# **4\. Step-by-Step Walkthrough of a Live Conversation Turn**

The sequence below illustrates payload transformations during a multi-turn session addressing a workspace defect:

## **Sequence of Execution**

1. **User Request Initiated:** The user asks: *"Why is the report export failing when the date filter is empty?"*  
2. **Editor Payload Packaging:** The desktop editor attempts to compile a **65,000-token** payload comprising 14 prior message turns, 3 full terminal logs, and 8 attached workspace files.  
3. **Local Gatekeeper Intercepts Payload:**  
   * **Deduplication:** Identifies identical file instances in Turns 3 and 7\. Older instances are replaced with pointer references (**\-12,000 tokens**).  
   * **Log Consolidation:** Detects a 1,800-line build failure log from Turn 4 that was resolved in Turn 5\. Collapses the log payload (**\-11,000 tokens**).  
   * **Structural Folding:** Converts 6 secondary reference files into structural skeletons while leaving the primary target file (`ReportExport.ts`) fully expanded (**\-22,500 tokens**).  
   * **Prefix Stabilization:** Strips the dynamic system timestamp from the header, appends it to the final message turn, and formats the static conversation block to match the provider's prompt cache layout.  
4. **Cloud AI Processing:**  
   * The provider receives a optimized **19,500-token** payload.  
   * 14,000 tokens match the static prefix and qualify for the **90% prompt caching discount**.  
   * Only 5,500 tokens are billed at standard rates.

## **Financial & Operational Metrics Impact**

Raw Payload:       \[==================================================\] 65,000 Tokens

Pruned Payload:    \[===============\>\] 19,500 Tokens (70% Direct Reduction)

Billed Equivalent: \[==\>\] 3,350 Effective Tokens (After 90% Cache Discount on 14k)

* **Effective Cost Reduction:** \>92% savings on the transaction.  
* **Latency Shift:** Time-To-First-Token reduced significantly due to reduced payload processing.  
* **Context Focus:** Eliminates irrelevant implementation noise, enabling the model to directly isolate the missing date-filter handling logic.

---

# **5\. Folder & Module Structure on Your PC**

The system is organized into modular components designed for local deployment and maintainability:Sharlie-Gate/

├── 1-editor-helper-tools/

│   ├── outline-builder/         \# Generates structural skeletons from target files

│   ├── section-expander/        \# Handles programmatic expansion of folded sections

│   └── smart-search/            \# Executes context-aware localized searching

├── 2-traffic-gatekeeper/

│   ├── history-cleaner/         \# Handles turn deduplication and log collapsing

│   ├── cache-aligner/           \# Normalizes headers and locks prompt cache prefixes

│   └── tunnel-connector/        \# Manages local proxy loopback endpoints

├── 3-safety-rules-and-config/

│   ├── protection-rules/        \# Enforces file size limits and current-turn immunity

│   └── editor-instructions/     \# System prompts instructing assistants to use maps

└── 4-savings-dashboard/

    └── token-ledger/            \# Logs raw vs. pruned token metrics and cost savings

## **Component Details**

### **`/1-editor-helper-tools`**

* `outline-builder`: Parses incoming files to strip implementation bodies while generating structural boundaries.  
* `section-expander`: Resolves line-range expansion queries submitted by the AI model.  
* `smart-search`: Provides narrow context windows for search queries to prevent full-file dumps.

### **`/2-traffic-gatekeeper`**

* `history-cleaner`: Scans the conversation array to purge duplicate historical file reads and obsolete console output.  
* `cache-aligner`: Standardizes payload structures by placing dynamic variables at the end of the request.  
* `tunnel-connector`: Runs a local loopback proxy (`http://127.0.0.1:8080`) that intercepts traffic transparently.

### **`/3-safety-rules-and-config`**

* `protection-rules`: Configuration parameters setting folding thresholds (e.g., minimum 150 lines) and edit-mode overrides.  
* `editor-instructions`: Instructions injected into the assistant's base prompt to direct usage of structural maps over full file reads.

### **`/4-savings-dashboard`**

* `token-ledger`: Maintains a local SQLite database logging request performance, cache efficiency, and token counts.

---

# **6\. Phased Implementation Roadmap**

┌──────────────────────────────────────────────────────────────────────────────────┐

│ PHASE 1: Map-First Editor Helper                                                 │

│ Focus: File-level structural folding via helper tools                            │

│ Impact: 40% – 60% Workspace Token Reduction                                      │

└──────────────────────────────────────────────────────────────────────────────────┘

                                        │

                                        ▼

┌──────────────────────────────────────────────────────────────────────────────────┐

│ PHASE 2: History Cleaner & Cache Stabilizer Proxy                                │

│ Focus: Multi-turn deduplication, log collapsing, and prefix locking              │

│ Impact: Cumulative 80% – 94% Total Cost Reduction                                │

└──────────────────────────────────────────────────────────────────────────────────┘

                                        │

                                        ▼

┌──────────────────────────────────────────────────────────────────────────────────┐

│ PHASE 3: Live Savings Tracker & Auto-Tuner                                       │

│ Focus: Telemetry dashboard, automated threshold tuning, and bypass controls      │

│ Impact: Operational visibility and fine-grained system control                   │

└──────────────────────────────────────────────────────────────────────────────────┘

## **Phase 1: The Map-First Editor Helper**

* **Goal:** Prevent the editor from loading full file contents into context during initial inspection turns.  
* **Implementation Steps:**  
  1. Deploy `outline-builder` and `section-expander` tools within the local environment.  
  2. Configure system rules to mandate structural inspection before requesting raw file contents.  
  3. Validate section expansion workflows to confirm seamless tool calls when details are required.  
* **Target Savings:** **40% to 60% reduction** in file-read token volume without network-level proxy requirements.

## **Phase 2: The History Cleaner & Cache Stabilizer Proxy**

* **Goal:** Eliminate redundant historical payload data and stabilize prompt structure for cloud caching.  
* **Implementation Steps:**  
  1. Initialize the local loopback proxy (`tunnel-connector`) and direct editor API traffic through it.  
  2. Implement `history-cleaner` pass to strip duplicate historical reads and collapse resolved error traces.  
  3. Deploy `cache-aligner` to isolate dynamic variables and freeze static prompt headers across sequential calls.  
* **Target Savings:** Cumulative **80% to 94% overall cost reduction** on extended development conversations.

## **Phase 3: The Live Savings Tracker & Auto-Tuner**

* **Goal:** Track performance metrics and allow dynamic adjustments to system thresholds.  
* **Implementation Steps:**  
  1. Build a local telemetry interface displaying real-time statistics: Raw Tokens, Pruned Tokens, Cache Hit %, and Estimated Cost Offset.  
  2. Implement an automated tuning controller that adjusts line-count folding thresholds based on model accuracy feedback.  
  3. Provide a hardware switch or system-tray toggle to instantly bypass proxy modifications for verification testing.

---

# **7\. Universal Multi-Editor & CLI Compatibility (Write Once, Run Everywhere)**

To ensure the system works seamlessly across desktop editors and terminal assistants without rebuilding it for each tool, it uses a **Single Core Engine \+ Thin Adapters** design. Almost every modern assistant—including **Cursor, VS Code, GitHub Copilot CLI, Cursor CLI, Claude Code, Windsurf, and OpenCode**—now shares the same universal tool standard (MCP) and rule file conventions.

## **How It Connects to Every Tool on Your PC**

| Assistant / Environment | How the Smart Workspace Reader Connects | How Rules & Habits Are Injected | How the Traffic Gatekeeper Connects |
| :---- | :---- | :---- | :---- |
| **Cursor (Desktop & CLI)** | Connects via the global `~/.cursor/mcp.json` or project `.cursor/mcp.json` configuration. | Uses a single rule file inside `.cursor/rules/context-saver.mdc`. | Routes custom provider keys through the local proxy address or uses tool-level pre-pruning for native plans. |
| **VS Code (Desktop)** | Connects natively via `.vscode/mcp.json` in Agent Mode. | Uses `.github/copilot-instructions.md` or shared workspace agent skills. | Uses VS Code's native proxy setting or tool-level pruning. |
| **GitHub Copilot CLI** | Plugs into Copilot CLI's built-in custom tool server registry and `preToolUse` / `postToolUse` lifecycle hooks. | Uses a shared Markdown Agent Skill file that works across both VS Code and Copilot CLI simultaneously. | Intercepts file reads and command outputs right inside the terminal via Copilot CLI's native hooks before tokens are sent. |
| **Other Terminal Agents (Claude Code, Codex CLI, OpenCode)** | Connects via their standard global tool configuration files on your machine. | Uses a universal `AGENTS.md` or `CLAUDE.md` instruction file synced automatically by the installer. | Points their environment base URL directly to `http://localhost:8080` (no tunnel needed for terminal tools\!). |

## **The "One-Command" Universal Installer (`sharlie-gate init`)**

Instead of configuring files manually in five different places, the system includes a simple setup wizard that you run once in your terminal or via a desktop shortcut:

* **Auto-Discovery:** The installer scans your PC to see which tools you actually use (Cursor, VS Code, Copilot CLI, Cursor CLI, etc.).  
* **Global Registration:** It registers the Smart Workspace Reader globally in your user profile so every project you open in any editor or terminal automatically gets the token-saving tools without cluttering individual project folders.  
* **Rule Syncing:** It maintains **one master instruction sheet** on your PC and automatically links it into the format each editor expects (Cursor `.mdc` rules, Copilot Agent Skills, and terminal agent guides).  
* **Terminal Hook Wiring:** For tools like **GitHub Copilot CLI**, it automatically sets up a "pre-tool" and "post-tool" safety net: if the terminal assistant runs a noisy command that spits out 5,000 lines of text, the hook catches and trims the output *before* the assistant even reads it.

---

# **8\. Built to Scale: Modular Plugin & Rule Engine Architecture**

To make sure you can improve, customize, and scale the system over time without ever rewriting the core engine, the entire project is built like a **conveyor belt with snap-in filters**.

## **1\. Snap-In Document Outliners (Adding New File Types in 5 Minutes)**

The Smart Workspace Reader does not hardcode how to fold every file type inside one giant file. Instead, it uses a `/outliners` folder:

* **How it scales:** Each file format (text documents, configuration files, diferentes project languages, data files) has its own small rule sheet defining what counts as a "Main Header" (to keep visible) and what counts as "Inner Bulk" (to fold).  
* **Universal Indentation Fallback:** If the system encounters a brand-new file type it has never seen before, it automatically falls back to a smart visual indentation scanner—keeping top-level lines and folding deeply indented blocks—so it works on day one with any file on earth.

## **2\. The Conveyor-Belt Filter Pipeline (Adding New Token Savers Easily)**

The Traffic Gatekeeper processes outgoing conversations through an ordered list of independent mini-filters inside a `/filters` folder:

* **Filter 1:** Duplicate File Remover  
* **Filter 2:** Resolved Error Log Cleaner  
* **Filter 3:** Noisy Terminal Command Trimmer  
* **Filter 4:** Cloud Cache Prefix Stabilizer  
* **How it scales:** Want to add a new idea later—like automatically trimming giant data tables or stripping repetitive status messages? You just drop a new filter rule into the `/filters` folder. If a filter ever misbehaves, you can turn it off with a single switch in your settings file without touching the rest of the system.

## **3\. Workspace-to-Workspace Shared Memory (Scaling Across Projects)**

As you use the system over weeks and months, it gets smarter without costing extra tokens:

* **Project Map Cache:** The system saves the structural outline of your folders on your local drive and watches for file saves. When you switch between Cursor Desktop and Copilot CLI, both tools share the exact same instant local map—zero re-scanning required.  
* **Auto-Tuning Feedback Loop:** Every time the AI has to ask to expand a hidden section immediately after reading an outline, the local dashboard logs a "Fast Expand." If a specific type of file gets expanded 90% of the time, the system tells you (or automatically adjusts its rule) to leave that file type expanded by default, saving an extra round-trip turn.

---

# **9\. The "Zero-BS" Penny-Accurate Savings Ledger & Dashboard**

Most token-saving tools inflate their numbers by claiming that if you folded a 5,000-token file once, you saved 5,000 tokens on the next 20 turns (claiming 100,000 tokens saved\!). That is fake math. To build real trust, the dashboard acts like a **strict bank ledger**: it only counts actual, verified savings on the exact turn they happen, deducts every overhead cost, and shows the real number—even if a small turn only saved **\$0.01** (or **\$0.0034**).

## **1\. The 4 Strict Anti-Inflation Accounting Rules**

To guarantee zero inflated numbers, the local ledger enforces four honest accounting rules on every single turn:

| Accounting Rule | What Fake Tools Do (BS Math) | What Our Ledger Does (Real Deal) |
| :---- | :---- | :---- |
| **1\. Single-Turn Attribution (No Compounding Hype)** | Claims a folded file in Turn 1 saves tokens on Turns 2 through 20 automatically. | Measures only the **exact bytes intercepted on the current turn**. If a file is folded once via the Smart Reader, it is counted once. |
| **2\. Mandatory "Zoom-In" Deduction** | Ignores the extra tokens spent when the AI has to ask to expand a hidden section. | If folding a file saved 4,000 tokens, but the AI immediately asked to expand a section costing 1,200 tokens (plus 300 tokens of conversation overhead), the ledger **subtracts 1,500 tokens** and records a **Net Saving of 2,500 tokens**. |
| **3\. Cloud Cache Write Penalty Deduction** | Pretends cloud caching is 100% free on the first turn. | Providers like Anthropic charge a **25% extra fee** to create a 5-minute cache entry on Turn 1 before giving a **90% discount** on Turn 2+. On Turn 1, the dashboard honestly displays a **red negative number (e.g., \-\$0.008 Cache Setup Fee)**, and then turns green on Turn 2+ as real cache hits pay it back. |
| **4\. Exact Provider Receipt Verification** | Guesses token counts using rough word estimates. | Reads the **official billing receipt** returned by the cloud provider at the end of every response (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) and compares it to the exact local token count before pruning. |

---

## **2\. How the Exact Math Works (Down to 4 Decimal Places)**

Because a single small turn might save \$0.0042, rounding everything to whole dollars hides real progress, while rounding up lies to the user. The dashboard displays **two numbers side-by-side**:

* **Headline Bank Number:** Rounded down to the nearest cent (e.g., **\$0.01 Saved** or **\$4.82 Saved Today**).  
* **Sub-Cent Precision Ticker:** Displayed right next to it in smaller text (e.g., `$0.0142`) so you can watch every single turn move the needle in real time.

### **The Net Savings Formula Per Turn:**

`Real Dollars Saved = [What You Would Have Paid] - [What You Actually Paid] - [Zoom-In Penalty]`

3. **Local Pruning Savings:** `(Raw Unpruned Tokens - Sent Tokens) × Model Input Price`  
4. **Cloud Cache Savings:** `(Verified Cache Hit Tokens × 90% Discount) - (Cache Creation Tokens × 25% Write Fee)`  
5. **Zoom-In Penalty:** `(Extra Tokens Used to Expand a Hidden Section + Tool Call Overhead) × Model Input Price`

---

## **3\. Live Receipt Breakdown (What You See on the Dashboard)**

Instead of a vague "You saved 75%\!" banner, clicking any turn in the dashboard opens an itemized **Turn Receipt** just like a grocery store bill:

```
======================================================================
TURN #4 RECEIPT — Model: Claude Sonnet 4.6 ($3.00 / 1M Input)
Time: 10:14:22 AM | Project: Report-Service | Source: Cursor Desktop
======================================================================
1. RAW PAYLOAD DETECTED ON PC:                 28,400 tokens ($0.0852)
----------------------------------------------------------------------
2. LOCAL INTERCEPTOR REDUCTIONS:
   - Duplicate file removed (from Turn #2):    -4,200 tokens (+$0.0126)
   - Old resolved terminal log collapsed:      -3,100 tokens (+$0.0093)
   - 2 background files folded to outlines:    -6,500 tokens (+$0.0195)
   - Zoom-In Penalty (1 section expanded):     +1,100 tokens (-$0.0033)
   -------------------------------------------------------------------
   NET TOKENS SENT TO CLOUD:                   15,700 tokens
   LOCAL PRUNING NET SAVED:                    12,700 tokens (+$0.0381)
----------------------------------------------------------------------
3. CLOUD CACHE RECEIPT (Verified from Provider):
   - Locked Prefix Cache Hit (90% off):        12,000 tokens (+$0.0324)
   - New Cache Write Fee (25% surcharge):       1,200 tokens (-$0.0009)
   - Standard Uncached Input:                   2,500 tokens ($0.0000)
   -------------------------------------------------------------------
   CLOUD CACHE NET SAVED:                                    (+$0.0315)
======================================================================
what you WOULD have paid without system:                      $0.0852
what you ACTUALLY paid on your bill:                          $0.0156
----------------------------------------------------------------------
REAL NET SAVED THIS TURN:                     +$0.0696 (Displayed: $0.06)
======================================================================
```

### **Example of a Tiny Turn (No Fake Inflation):**

If you ask a quick one-line question in GitHub Copilot CLI and the system only trims a small 3,500-token terminal output on a \$3.00/1M model:

* **Raw Cost:** \$0.0145  
* **Actual Cost:** \$0.0040  
* **Dashboard Shows:** **\+\$0.01 Saved** *(Exact: \+\$0.0105 | 3,500 tokens trimmed)*. No fake multipliers, just the exact cent you kept in your pocket.

---

## **4\. Three Ways to View Your Numbers (Zero Friction)**

You shouldn't have to keep a heavy browser tab open just to see if the system is working. The ledger outputs to three lightweight views simultaneously:

6. **Editor Status Bar Pill (Cursor & VS Code):** A tiny, quiet indicator at the very bottom-right of your editor window that updates after every message:  
   `🛡️ Saved Today: $1.42 (Last turn: +$0.01)`  
7. **Terminal One-Line Footer (Copilot CLI & Cursor CLI):** Prints a single dim summary line at the end of every terminal task:  
   `[Sharlie-Gate: -4.2k tokens pruned | 88% cache hit | +$0.02 saved ($0.0214)]`  
8. **Local Audit Web View (**`http://localhost:8080/ledger`): A clean, local-only page where you can inspect every Turn Receipt, filter by project or model, see whenever a Zoom-In Penalty happened, and export your raw numbers to CSV to cross-check against your monthly Anthropic or OpenAI invoice.