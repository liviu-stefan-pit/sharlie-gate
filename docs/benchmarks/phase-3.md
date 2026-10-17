# Phase 3 — penny ledger

`tests/unit/ledger.test.ts` checks the blueprint numbers against integer picodollar arithmetic.

- Turn 4, Claude Sonnet at $3.00 / 1M input: raw `$0.0852`, actual `$0.0156`, net `$0.0696`, headline `$0.06`.
- Tiny turn: raw `$0.0145`, actual `$0.0040`, exact `$0.0105`, headline `$0.01`.
- Negative `$0.008` floors to `-$0.01` on the headline and `-$0.0080` on the ticker.
- `A + B - C - D = net` held across fast-check integer cases.
- Unknown models stay unpriced and are not added into a verified total. `summary()` sums only `verified = 1`.
- `/ledger`, `/ledger/api/summary`, `/ledger/export.csv`, and `/ledger/events` are served by the loopback proxy.
