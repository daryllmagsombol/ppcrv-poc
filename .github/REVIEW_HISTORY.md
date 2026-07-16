# Review History — Previously Resolved Issues

This file is read by the AI reviewer before each PR review. Do not re-flag
these items — they have been verified as fixed.

## Round 1 (July 15)

| Issue | Fix |
|-------|-----|
| Reject-then-rescan: `lastConfirmedRef` set on rejection | `lastConfirmedRef` only written in `handleConfirm` wrapper |
| `limit?=abc` causes 500 | `isNaN(parsed) \|\| parsed < 1 ? 50 : parsed` guard in `scan.controller.ts` |
| `findDiscrepancies` one-way (only QR→DB) | Two-way check: both QR→DB and DB→QR. Zero-vote DB candidates skipped. |
| `classifyQr` hardcodes contest codes `00399000` / `01199000` | Extracts category label from VCM format instead ("NATIONAL" / "PARTY LIST") |
| `parseMetadataQr` dead code (unused `parts`, `type`, etc.) | Single clean parse, no duplicate. All variables consumed. |
| DuckDB SQL via `-c` string argument | SQL piped via stdin instead (`{ input: sql }`) |
| CI: scan tests fail — no PostgreSQL | `postgres:17` service container + `itDb` helper skips when DB unreachable |
| CI: `pending is not defined` in Jest | Replaced `beforeEach(pending())` with `itDb` conditional wrapper |

## Round 2 (July 15)

| Issue | Fix |
|-------|-----|
| Auto-detect failure leaks `'auto-detect'` string as precinct ID | Falls back to `'unknown'` + sets `warning` message |
| DuckDB errors return `[]` indistinguishable from empty results | Errors propagate to `warning` field, displayed in orange banner in UI |
| `extractPrecinctFromQr` regex mismatch (`{8}` vs `{8,}`) | Both now use `{8,}` |
| Zero-vote DB candidates flood false discrepancies | `if (dbCandidate.votes === 0) continue` in DB→QR check |
| RAW entries participate in discrepancy check | `if (qrContest.contest_code === 'RAW') continue` in QR→DB check |
