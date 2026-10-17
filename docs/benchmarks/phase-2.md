# Phase 2 — proxy and gatekeeper

- Pass-through: with filters off, the loopback proxy forwarded the request body byte-for-byte and streamed the SSE response (`tests/integration/proxy.test.ts`).
- Fail-open: an injected filter exception returns the original bytes and sets `bypassReason`.
- Current-turn text and thinking signatures survive the history filters. An older duplicate read is replaced with a resolvable marker.
- Prefix stabilizer: two requests that differ only by `Today's date` produce the same system text, so `prefixDrift` stays false.
- SSE tap: a `message_delta` usage event split across chunks still parses.
- Long-session fixture: history filters cut the JSON payload by more than 30% and left the current user message intact (`tests/benchmark.test.ts`).

Not measured here: a live Anthropic or OpenAI call. Cache-read rate depends on a provider key and is an opt-in check (`sharlie-gate proxy`, then point a local client at `http://127.0.0.1:8080`). No key was used during this build.
