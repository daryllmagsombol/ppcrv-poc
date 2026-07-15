# Scan to Compare — Design Spec

**Date**: 2026-07-15
**Status**: Approved
**Author**: Team Leader (via brainstorming workflow)

## Overview

New `/compare` page for PPCRV volunteers to scan VCM (Vote Counting Machine) receipt QR codes, compare the scanned data against official election results in the database, and upload comparison records for audit.

## User Flow

1. User navigates to `/compare`
2. Clicks "Start Scanning" → device camera opens with a scan overlay
3. Scans QR codes sequentially (3 per receipt, typical VCM format)
4. After all 3 QR codes scanned, camera closes automatically
5. Comparison view loads: two tables side-by-side
6. Scanned QR data (left) vs official DB results (right)
7. Discrepancies highlighted in red (`#C41E3A` / `stamp`)
8. User clicks "Upload & Save" to persist everything to PostgreSQL
9. Optional: subsequent scans keep accumulating until user resets

## Tech Stack

- **Frontend**: Next.js 15 App Router (client component), `html5-qrcode` for camera
- **Backend**: New NestJS `ScanModule` with `ScanService` + `ScanController`
- **Storage**: PostgreSQL (`pg` npm package), reusing ETL's local `pprcv_local` database
- **Official results**: DuckDB/Parquet (reuse existing `ResultsService` patterns)
- **Styling**: Existing Tailwind theme (`ink`/`ballot`/`stamp`/`seal`/`field` tokens)

## Database Schema

PostgreSQL table on the existing `pprcv_local` instance (used by the ETL for `ref_*` tables):

```sql
CREATE TABLE scan_records (
  id                    SERIAL PRIMARY KEY,
  precinct_id           VARCHAR(20) NOT NULL,
  region                VARCHAR(100),
  province              VARCHAR(100),
  municipality          VARCHAR(100),
  barangay              VARCHAR(100),
  qr_raw_1              TEXT,
  qr_raw_2              TEXT,
  qr_raw_3              TEXT,
  qr_parsed             JSONB,
  db_results            JSONB,
  has_discrepancy       BOOLEAN DEFAULT FALSE,
  discrepancy_details   JSONB,
  scanned_by            VARCHAR(100),
  scanned_at            TIMESTAMP DEFAULT NOW()
);
```

## API Design

### New NestJS Module: `ScanModule`

Located at `apps/api/src/modules/scan/`.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /api/scan/compare` | POST | Receives scanned QR data + precinct, queries DuckDB for official results, returns comparison |
| `POST /api/scan/upload` | POST | Saves the full scan record to PostgreSQL |
| `GET /api/scan/history` | GET | Lists recent scan records (for audit trail) |

### POST /api/scan/compare

**Request**:
```json
{
  "precinct_id": "01010001",
  "qr_raw_1": "base64_or_json_string_1",
  "qr_raw_2": "base64_or_json_string_2",
  "qr_raw_3": "base64_or_json_string_3"
}
```

**Response**:
```json
{
  "precinct_id": "01010001",
  "qr_parsed": [{ "contest": "MAYOR", "candidates": [...] }],
  "db_results": [{ "contest": "MAYOR", "candidates": [...] }],
  "has_discrepancy": true,
  "discrepancy_details": [
    { "contest": "MAYOR", "candidate": "DEL CRUZ", "qr_votes": 150, "db_votes": 145 }
  ]
}
```

### POST /api/scan/upload

**Request**:
```json
{
  "precinct_id": "01010001",
  "region": "REGION NAME",
  "province": "PROVINCE NAME",
  "municipality": "MUN NAME",
  "barangay": "BRGY NAME",
  "qr_raw_1": "...",
  "qr_raw_2": "...",
  "qr_raw_3": "...",
  "qr_parsed": [...],
  "db_results": [...],
  "has_discrepancy": true,
  "discrepancy_details": [...],
  "scanned_by": "Volunteer Name"
}
```

**Response**: `{ "id": 1, "uploaded": true }`

## Frontend Structure

```
apps/web/src/app/compare/
  page.tsx                        # Main compare page ('use client')
  components/
    qr-scanner.tsx                # Camera QR scanner wrapper (html5-qrcode)
    comparison-view.tsx           # Side-by-side tables with red highlights
    scan-progress.tsx             # Progress indicator (QR 1/2/3 ✓)
```

### Component Responsibilities

- **`page.tsx`**: Manages scanning state machine (idle → scanning → comparing → uploading), orchestrates API calls
- **`qr-scanner.tsx`**: Initializes camera, emits decoded QR string on scan, shows scan overlay viewport
- **`comparison-view.tsx`**: Renders two tables side-by-side with discrepancy highlighting
- **`scan-progress.tsx`**: Shows QR slot indicators with checkmarks

### Comparison View Layout

```
┌──────────────────────────────────────────────┐
│  Precinct: 01010001  |  Brgy: ZONE 1 POB.   │
├──────────────────────┬───────────────────────┤
│  Scanned QR Data     │  Official Results     │
├──────────────────────┼───────────────────────┤
│  MAYOR               │  MAYOR                │
│  ┌────────┐──┬──┐   │  ┌────────┐──┬──┐    │
│  │ DEL C. │150│  │   │  │ DEL C. │145│🔴 │    │
│  │ SANTOS │200│  │   │  │ SANTOS │200│  │    │
│  └────────┘──┴──┘   │  └────────┘──┴──┘    │
├──────────────────────┴───────────────────────┤
│  [Upload & Save]                              │
└──────────────────────────────────────────────┘
```

Rows where votes differ get a red background on the differing cell.

## Comparison Logic

1. Try to parse each `qr_raw_*` as JSON → if successful, extract contests and candidate votes
2. If JSON parse fails, store raw text as-is (mark as "unparsable" in response)
3. Extract `precinct_id` from scanned data (fallback: use the one sent in the request)
4. Query DuckDB for official results at that precinct using geographic hierarchy
5. For each contest, match candidates by name between QR and DB
6. Compare `votes` values — if different, record in `discrepancy_details`
7. Return the full comparison to the frontend

## Error Handling

| Scenario | Handling |
|----------|----------|
| Camera permission denied | Show instructions for enabling permissions, offer text input fallback |
| QR code not recognized | Vibrate device, "Try again" prompt, stay on same slot |
| Precinct not found in DB | Warning message, allow manual geo selection |
| QR parse failure | Store raw text, mark as "Unparsed" in comparison view |
| Network error on upload | Retry button, data preserved in local React state |
| Less than 3 QR codes | "Done Scanning" button available after 1-2 scans |
| Database connection error | Graceful error message, no data loss |

## New Dependencies

- **`apps/api`**: `pg` (node-postgres) for PostgreSQL connection
- **`apps/web`**: `html5-qrcode` for camera-based QR code scanning

## Environment Variables

Add to existing API env config (or create `apps/api/.env`):

```
PGHOST=localhost
PGDATABASE=pprcv_local
PGUSER=daryllmagsombol
```

These match the existing ETL PostgreSQL connection in `apps/etl/.env`.

## Implementation Order

1. Add `pg` dependency to API + create `ScanModule` with schema creation on module init
2. Implement `ScanService.compare()` — query DuckDB for precinct results, build comparison
3. Implement `ScanController` — compare + upload + history endpoints
4. Add `html5-qrcode` to web app + build `qr-scanner.tsx` component
5. Build `scan-progress.tsx` and `comparison-view.tsx`
6. Build main `page.tsx` with state machine
7. Integration testing — end-to-end scan → compare → upload flow
