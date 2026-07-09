# Multi-Level Vote Aggregation — Design Spec

**Date**: 2026-07-09
**Status**: Draft
**Stack**: DuckDB (ETL) + Python + NestJS (API) + Next.js (frontend) + PostgreSQL (reference data only)

---

## 1. Purpose & Scope

### What We're Building

Extend the existing PPCRV ETL pipeline to aggregate election results at multiple geographic levels (national → region → province → municipality → barangay → voting center/precinct), and build a NestJS + Next.js dashboard that lets users filter by geography and contest to view candidate vote totals.

### Data Flow (POC)

```
CSV Results + Precincts Ref ──► DuckDB (multi-level aggregation) ──► Parquet files ──► DuckDB (on-read query)
                                                                                         ▲
                                                                                    NestJS API
                                                                                         │
                                                                                         ▼
                                                                                   Next.js UI
```

### Out of Scope for POC

- Redis as the serving layer (production target, not POC)
- Authentication/authorization
- Real-time updates
- Anomaly detection

---

## 2. Aggregation Engine (DuckDB)

### Current State

`parse_and_aggregate()` in `src/etl/processor.py` aggregates at precinct level only:
- Groups by `(precinct_code, contest_code, candidate_name, party_code)`
- SUMs `votes_amount`, `over_votes`, `under_votes`
- Writes single partitioned Parquet output by `contest_code`

### Proposed Extension

**New function:** `aggregate_all_levels(csv_path, precincts_path, output_dir)` in a new file `src/etl/aggregator.py`.

**Step 1: Load & join with hierarchy**
Load results CSV and precincts reference into DuckDB, join on precinct identifier:

```sql
CREATE TABLE raw_with_hierarchy AS
SELECT
  r.contest_code,
  r.candidate_name,
  r.party_code,
  CAST(r.votes_amount AS INTEGER) AS votes_amount,
  CAST(r.over_votes AS INTEGER) AS over_votes,
  CAST(r.under_votes AS INTEGER) AS under_votes,
  p.reg_name,
  p.prv_name,
  p.mun_name,
  p.brgy_name,
  p.pollplace,
  p.clustered_prec
FROM read_csv_auto('{csv_path}') r
LEFT JOIN read_csv_auto('{precincts_path}') p
  ON LPAD(r.precinct_code, 8, '0') = LPAD(p.clustered_prec, 8, '0')
```

The `LPAD(..., 8, '0')` handles the format mismatch where results codes are sometimes 7 chars vs 8 chars in precincts.

**Step 2: Produce 6 aggregation levels**

Each level writes its own partitioned Parquet directory:

| Level | GROUP BY | Output Directory | Example Partition |
|-------|----------|-----------------|-------------------|
| `agg_national` | `contest_code, candidate_name, party_code` | `output/national/` | `contest_code=00399000/` |
| `agg_region` | `contest_code, reg_name, candidate_name, party_code` | `output/region/` | `contest_code=00399000/` |
| `agg_province` | `contest_code, reg_name, prv_name, candidate_name, party_code` | `output/province/` | `contest_code=00399000/` |
| `agg_municipality` | `contest_code, reg_name, prv_name, mun_name, candidate_name, party_code` | `output/municipality/` | `contest_code=00399000/` |
| `agg_brgy` | `contest_code, reg_name, prv_name, mun_name, brgy_name, candidate_name, party_code` | `output/brgy/` | `contest_code=00399000/` |
| `agg_precinct` | `contest_code, reg_name, prv_name, mun_name, brgy_name, pollplace, candidate_name, party_code` | `output/precinct/` | `contest_code=00399000/` |

Each level sums `votes_amount`, `over_votes`, `under_votes`. The `SUM` works because we're rolling up — national level sums all votes per candidate across all precincts.

**Single DuckDB pass:** The join table is materialized once, then each level is derived from it. No repeated CSV parsing.

**Return value:**

```python
@dataclass
class MultiLevelAggregationResult:
    levels: dict[str, LevelResult]  # "national" → LevelResult

@dataclass
class LevelResult:
    total_votes: int
    total_over_votes: int
    total_under_votes: int
    row_count: int
    output_files: list[str]
```

### Sampling for development

The full 24M-row CSV takes ~15 min to process. For fast iteration, include a `sample_size` parameter:

```python
aggregate_all_levels(csv_path, precincts_path, output_dir, sample=100000)
```

This wraps the CSV load in `SELECT * FROM read_csv_auto(...) USING SAMPLE {sample} ROWS` for quick feedback during development.

### Reference data for Parquet

The `precincts.csv` is loaded in the same DuckDB session as the join source. No separate reference data loading step needed for aggregation.

---

## 3. API Layer (NestJS)

### Module: `results`

The `results` module in the NestJS backend reads directly from Parquet files using DuckDB (via `duckdb` node package or shelling out to `duckdb` CLI).

### Endpoints

#### Dropdown options (populate cascading selection)

| Method | Endpoint | Returns | DuckDB Source |
|--------|----------|---------|---------------|
| GET | `/api/regions` | `["NCR", "CAR", ...]` | `SELECT DISTINCT reg_name FROM 'output/region/*.parquet' ORDER BY reg_name` |
| GET | `/api/regions/:reg/provinces` | `["ABRA", "BENGUET", ...]` | `SELECT DISTINCT prv_name FROM 'output/province/*.parquet' WHERE reg_name = :reg` |
| GET | `/api/regions/:reg/provinces/:prv/municipalities` | `["BANGUED", ...]` | Same pattern, deeper level |
| GET | `/api/regions/:reg/provinces/:prv/municipalities/:mun/barangays` | `["ZONE 1 POB.", ...]` | Same pattern |
| GET | `/api/barangays/:brgy/voting-centers` | `["SANTIAGO ST., ..."]` | From precinct level |
| GET | `/api/contests` | `[{code, name}]` | From `ref_contests` table in Postgres or contest Parquet partition names |

**POC decision: Geographic options are served from Parquet directly** via DuckDB DISTINCT queries on the relevant level. No Postgres dependency for POC.

#### Results query

| Method | Endpoint | Parameters | Returns |
|--------|----------|------------|---------|
| GET | `/api/results` | `level`, `reg`, `prv`, `mun`, `brgy`, `vc`, `contest` | Candidate list with votes, percentages |

**Query parameter details:**

| Param | Required | Description |
|-------|----------|-------------|
| `level` | yes | One of: `national`, `region`, `province`, `municipality`, `barangay`, `precinct` |
| `reg` | for region+ | Region name |
| `prv` | for province+ | Province name |
| `mun` | for municipality+ | Municipality name |
| `brgy` | for barangay+ | Barangay name |
| `vc` | for precinct | Voting center (pollplace) |
| `contest` | no | Contest code filter (defaults to national-level contest if omitted) |

#### DuckDB query by level

```sql
-- Region level example
SELECT candidate_name, party_code, SUM(total_votes) as votes
FROM 'output/region/*.parquet'
WHERE reg_name = 'NCR' AND contest_code = '00399000'
GROUP BY candidate_name, party_code
ORDER BY votes DESC
```

Partitioning by `contest_code` means DuckDB prunes irrelevant files for contest-filtered queries, keeping them fast.

#### Response format

```json
{
  "level": "region",
  "filters": {
    "region": "NCR",
    "contest": {
      "code": "00399000",
      "name": "SENATOR OF PHILIPPINES"
    }
  },
  "totalVotes": 1234567,
  "candidates": [
    {
      "rank": 1,
      "name": "ABALOS, BENHUR",
      "party": "PFP",
      "votes": 123456,
      "percentage": 15.2
    }
  ],
  "totals": {
    "votesCast": 1234567,
    "overVotes": 1234,
    "underVotes": 5678
  }
}
```

### DuckDB integration in NestJS

**POC approach: DuckDB CLI subprocess.**

NestJS calls `duckdb -json -c "SELECT ..."` and parses stdout. Simplest setup — `duckdb` CLI is already available from the ETL setup, no additional npm dependencies, and queries are plain SQL strings. Performance is sufficient for POC scale (thousands of requests, not millions).

Production path: Replace with Redis lookups. The Service layer is designed to swap data sources behind the same interface.

---

## 4. Frontend (Next.js)

### Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | Homepage | Regional overview, contest selector, results table |
| `/results` | ResultsPage | Full cascading selection + results display |

### Component Tree

```
app/
├── page.tsx                        # Homepage (Server Component)
├── results/
│   ├── page.tsx                    # Results page shell
│   └── components/
│       ├── SelectionPanel.tsx      # Client Component - cascading dropdowns
│       │   ├── CascadingDropdown.tsx  # Reusable dropdown with loading state
│       │   └── ContestSelector.tsx    # Contest picker
│       ├── ResultsTable.tsx        # Client Component - candidate results
│       └── BreadcrumbNav.tsx       # e.g. NCR > Metro Manila > Manila
```

### Selection Panel Behavior

The selection panel matches the UI from the spec image:

```
┌─────────────────────────────────────┐
│  SELECTION                    [▲]   │  ← Collapsible header
├─────────────────────────────────────┤
│  REGION:     [Select Region    ▼]   │  ← Starts enabled
│  PROVINCE:   [Select Province  ▼]   │  ← Enabled after region selected
│  MUNICIPALITY:[Select Mun.     ▼]   │  ← Enabled after province selected
│  BARANGAY:   [Select Barangay  ▼]   │  ← Enabled after municipality selected
│  VOTING CENTER:[Select VC      ▼]   │  ← Enabled after barangay selected
│  CONTEST:    [Select Contest   ▼]   │  ← Always enabled
└─────────────────────────────────────┘
```

- Each dropdown fetches its options from the API only when the previous level is selected
- Loading state shown while fetching (spinner or disabled text)
- Selecting a higher-level value resets all lower-level selections
- "Select X" placeholder shown when no selection made
- Any change in selection triggers a results re-fetch

### Results Display

```
┌─────────────────────────────────────────────┐
│  NCR › METRO MANILA › MANILA › ZONE 1 POB. │  ← Breadcrumb
├─────────────────────────────────────────────┤
│  SENATOR OF PHILIPPINES                     │
│                                             │
│  Rank │ Candidate         │ Party │ Votes   │
│  ─────┼───────────────────┼───────┼─────────┤
│  1    │ ABALOS, BENHUR   │ PFP   │ 12,345  │
│  2    │ ADONIS, JEROME   │ MKBYN │ 9,876   │
│  3    │ BINAY, ABBY      │ NPC   │ 8,543   │
│                                             │
│  Totals: 30,764 votes cast                  │
│  Overvotes: 123 │ Undervotes: 456          │
└─────────────────────────────────────────────┘
```

### Styling

Follow the "Balota" design from the existing spec:
- `ink-blue: #1B3A5C` — headers, primary text
- `ballot-cream: #F8F6F0` — backgrounds
- `stamp-red: #C41E3A` — accents
- `JetBrains Mono` — vote counts
- Responsive: tables → card stacks on mobile

### Data Fetching

- Uses Server Actions or plain fetch to the NestJS API
- No React Query or SWR for POC (simple useEffect + fetch is enough)
- Loading skeletons for results table while data loads

---

## 5. Error Handling & Edge Cases

### ETL

| Scenario | Behavior |
|----------|----------|
| Empty CSV | All levels produce zero-row Parquet files with correct schema |
| Missing precincts join | Unmatched precincts produce records with NULL geographic fields, grouped under "Unknown" |
| Very large CSV | Streaming via DuckDB `read_csv_auto`, sample mode for development |
| Duplicate rows | Same precinct+contest+candidate rows are summed (current behavior, preserved) |
| Corrupted CSV | DuckDB's `read_csv_auto` handles most variants; malformed rows are rejected with warning |

### API

| Scenario | Behavior |
|----------|----------|
| Invalid geography name | Return empty results array, not error |
| No contest filter | Default to most recent/national contest |
| Parquet file missing | Return empty results for that level |
| DuckDB query timeout | Configurable timeout (default 30s), return 504 if exceeded |

### UI

| Scenario | Behavior |
|----------|----------|
| API call fails | Show error state in results area, keep selection panel intact |
| No results for selection | Show "No results found for this selection" |
| Loading data | Skeleton rows in results table |
| Very long candidate list | Client-side pagination if > 100 candidates |

---

## 6. Testing

### ETL Tests (Python / pytest)

| Test | Description |
|------|-------------|
| `test_multi_level_sums_match` | For a known fixture, verify that national total == sum of all region totals |
| `test_join_with_precincts` | Verify LPAD join matches expected hierarchy |
| `test_level_partitions_valid` | Each level produces valid partitioned Parquet |
| `test_sample_mode` | Sampling produces subset with correct schema |
| `test_empty_hierarchy` | Unmatched precincts get NULL geographic fields |

### API Tests (NestJS / jest)

| Test | Description |
|------|-------------|
| `GET /api/regions` | Returns distinct, sorted regions |
| `GET /api/results?level=region&reg=NCR` | Correctly sums and returns candidates |
| `Invalid geography` | Returns empty results, not error |
| `DuckDB query integration` | Mock DuckDB responses for unit tests |

### UI Tests

| Test | Description |
|------|-------------|
| Selection panel cascade | Each dropdown enables/disables correctly |
| Level reset | Changing region resets province/municipality/barangay selections |
| Results render | Table displays correct data for each geography level |
| Empty state | "No results" shown when API returns empty |

---

## 7. Project File Changes

### New files

| File | Purpose |
|------|---------|
| `src/etl/aggregator.py` | `aggregate_all_levels()` — multi-level DuckDB aggregation |
| `src/etl/models.py` | Update with `MultiLevelAggregationResult`, `LevelResult` |
| `apps/api/src/modules/results/` | NestJS results module (controller, service, repository, DTOs) |
| `apps/web/src/app/results/` | Next.js results page and components |
| `tests/etl/test_aggregator.py` | Tests for multi-level aggregation |

### Modified files

| File | Change |
|------|--------|
| `src/etl/processor.py` | Keep existing `parse_and_aggregate()`; aggregator is a separate path |
| `pyproject.toml` | No new dependencies needed (DuckDB already listed) |
| (NestJS/Next.js project files) | Scaffold from existing dashboard design spec |

---

## 8. Future (Production)

- Replace DuckDB on-read queries with Redis lookups (same API interface, different service implementation)
- Pre-computed Redis sorted sets for leaderboards (`ZINCRBY contest:00399000 candidate_name total_votes`)
- Parquet files remain the source of truth for rebuilds