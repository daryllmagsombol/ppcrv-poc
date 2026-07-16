# Analytics Redis Serving Layer

**Date:** 2026-07-16  
**Status:** Draft  
**Context:** Replaces direct DuckDB shell-out queries with a DuckDB pre-compute → Redis serving architecture to support thousands of concurrent users in production.

---

## Problem

The current analytics page (`/analytics`) shells out to DuckDB via `execFileSync` on every request. DuckDB must scan 162K+ tiny Parquet files (678 MB) per query. This is:

- **Slow:** DuckDB cold-start + glob scan per request.
- **Unscalable:** Single-node, per-request process spawning cannot handle concurrent users.
- **Wasteful:** Election result data is read-only during serving — re-computing the same aggregations is unnecessary.

## Goal

Pre-compute all analytics queries at deploy time using DuckDB (ETL), load results into Redis, and serve all API responses from Redis only. No runtime DuckDB queries in production.

---

## Architecture Overview

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Parquet     │     │  DuckDB      │     │  Redis       │     │  NestJS API  │
│  (source)    │ ──► │  (ETL/agg)   │ ──► │  (serving)   │ ──► │  (analytics) │
│  678 MB      │     │  run once    │     │  ~50-100 MB  │     │  GET only    │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

### Flow

1. **Build/deploy:** ETL script runs DuckDB against all Parquet files, produces aggregated pre-compute Parquet files.
2. **Cache warm:** Script reads the pre-computed DuckDB output and loads it into Redis.
3. **Serving:** NestJS analytics service reads solely from Redis (no DuckDB runtime dependency).
4. **Fallback:** If a Redis key is missing, return empty/null gracefully (no cold query).

---

## Data Model

### 1. Contest List

| Key | Type | Content |
|---|---|---|
| `analytics:contests` | Hash | `{ "00399000": "SENATOR OF PHILIPPINES", ... }` (5,645 entries) |

### 2. Geography Status

| Key | Type | Content |
|---|---|---|
| `analytics:geo:regions` | Hash | `{ "NCR": "{total_tpc:5000,rpc:4200,cr:84.0}", ... }` (17 entries) |
| `analytics:geo:province:{region}` | Hash | `{ "MANILA": "{...}", ... }` |
| `analytics:geo:city:{region}:{province}` | Hash | `{ "MANILA|CITY": "{...}", ... }` |

Each value is a compact JSON string with `totalPrecincts`, `reportedPrecincts`, and `completionRate`.

### 3. Vote Share

| Key | Type | Content |
|---|---|---|
| `analytics:votes:{contest}:nat` | String | JSON: `{ contestName, totalVotes, candidates: [{name,party,votes,rank}] }` |
| `analytics:votes:{contest}:reg:{region}` | String | Same shape, region-level |
| `analytics:votes:{contest}:prv:{province}` | String | Same shape, province-level |
| `analytics:votes:{contest}:mun:{city}` | String | Same shape, city-level |

### 4. Undervotes / Overvotes

| Key | Type | Content |
|---|---|---|
| `analytics:undervotes:{contest}:nat` | String | JSON: `{ totalVotes, totalUnderVotes, underRate, totalOverVotes, overRate }` |
| `analytics:undervotes:{contest}:reg:{region}` | String | Same shape |
| `analytics:undervotes:{contest}:prv:{province}` | String | Same shape |
| `analytics:undervotes:{contest}:mun:{city}` | String | Same shape |

### Key Naming Convention

- Contest codes use 8-digit padded format (e.g., `00399000`).
- Geography names are stored as-is from the source data (spaces allowed in Redis hash fields).
- No TTL (data is immutable during the election period).

---

## Memory Estimate

| Data | Keys | Size per Key | Total |
|---|---|---|---|
| Contest list | 1 hash × 5,645 fields | ~100 B avg | ~560 KB |
| Geo status (regions) | 1 hash × 17 fields | ~100 B | ~2 KB |
| Geo status (provinces) | ~17 hashes × ~6 fields | ~100 B | ~10 KB |
| Geo status (cities) | ~17 × ~6 hashes × ~16 fields | ~100 B | ~160 KB |
| Vote share (national) | ~5,624 keys (only populated contests) | ~300 B | ~1.7 MB |
| Vote share (region) | ~17 × ~5,624 keys (mostly empty) | ~300 B | ~5 MB |
| Vote share (province) | ~100 × ~5,624 keys (many empty) | ~300 B | ~15 MB |
| Vote share (city) | ~1,600 × ~5,624 keys (most empty) | ~300 B | ~50 MB |
| Undervotes | Same key count as vote share, smaller values | ~100 B | ~10 MB |
| **Total** | | | **~80-100 MB** |

**Reality:** Most contest × geography combinations are empty (no candidates ran there). Pre-compute only stores non-empty results, so the actual memory is likely **30-50 MB**.

---

## ETL Script

A single CLI script in the API project that runs during deploy:

```
scripts/seed-redis.ts
```

### Steps

1. **Connect to DuckDB** using `@duckdb/node-api` (persistent connection, no shell-out).
2. **Aggregate geography status** at all 4 levels into a temporary DuckDB table or export directly.
3. **Aggregate vote share** per contest per geography level — write only non-empty results.
4. **Aggregate undervotes** per contest per geography level.
5. **Connect to Redis** using `ioredis`.
6. **Pipeline-load** all data in batches using Redis `pipeline()` for performance.
7. **Log summary:** total keys loaded, memory used, time taken.

### Config

```
REDIS_URL=redis://localhost:6379
```

Null-safe: if `REDIS_URL` is not set, the script logs a warning and exits gracefully.

---

## API Changes (analytics.service.ts)

### Before (current)

All methods shell out to DuckDB:
```ts
execFileSync('duckdb', ['-json', '-c', sql], ...)
```

### After

All methods read from Redis:
```ts
const data = await this.redis.hgetall(`analytics:geo:regions`);
```

| Method | Redis Operation | Fallback |
|---|---|---|
| `getGeographyStatus()` | `HGETALL analytics:geo:regions` | `[]` |
| `getProvinceStatus(reg)` | `HGETALL analytics:geo:province:{reg}` | `[]` |
| `getCityStatus(reg, prv)` | `HGETALL analytics:geo:city:{reg}:{prv}` | `[]` |
| `getVoteShare(contest, geo)` | `GET analytics:votes:{contest}:{level}:{geo}` | `null` |
| `getUndervotes(contest, geo)` | `GET analytics:undervotes:{contest}:{level}:{geo}` | `null` |
| `getContests()` | `HGETALL analytics:contests` | `{}` (empty) |

### Level Mapping

| `geoSelection.level` | Redis key prefix | Example |
|---|---|---|
| `national` | `nat` | `analytics:votes:00399000:nat` |
| `region` | `reg:{region}` | `analytics:votes:00399000:reg:NCR` |
| `province` | `prv:{province}` | `analytics:votes:00399000:prv:NCR|MANILA` |
| `city` | `mun:{city}` | `analytics:votes:00399000:mun:NCR|MANILA|CITY` |

### Dependencies

- Add `ioredis` to `apps/api/package.json`.
- Add `@duckdb/node-api` to `apps/api/package.json` (dev or tools dependency, used only during ETL).

---

## Frontend

No changes required. The API contract (`/api/analytics/...` responses) remains identical. The frontend will simply receive faster responses.

Optional enhancement (separate, lower priority): add React Query or SWR on the frontend for stale-while-revalidate UX. Not required for this design — the Redis layer alone makes responses near-instant.

---

## Development Mode

During local development, DuckDB is still acceptable (no Redis required). Option to fall back:

```ts
if (process.env.REDIS_URL) {
  // production: read from Redis
} else {
  // development: read from DuckDB
}
```

This keeps the dev workflow simple while using Redis in production.

---

## Non-Goals

- Real-time data refresh (election data is batch-loaded; re-seed Redis when new results arrive).
- Precinct-level queries (not in scope for the analytics page UI).
- Ad-hoc query API (the analytics page has a fixed set of query patterns).
- Redis Cluster / Sentinel (single Redis instance is sufficient at this scale).

---

## Risks

| Risk | Mitigation |
|---|---|
| Redis outage during serving | API returns empty/default responses, frontend shows "data unavailable" gracefully |
| ETL takes too long | Run asynchronously with health-check flag; API stays healthy during seeding |
| Data mismatch between DuckDB and Redis | Seed from the same Parquet source; no dual-write |
| Redis key count explosion | Only write non-empty results; skip empty contest × geo combinations |
