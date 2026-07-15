# DEV-SETUP

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | ≥22 | `node --version` |
| pnpm | ≥9 | `pnpm --version` |
| Python | ≥3.9 | `python3 --version` (macOS/Linux) or `python --version` (Windows) |
| pip | — | `pip --version` |
| DuckDB CLI | ≥1.0 | `duckdb --version` |
| PostgreSQL | ≥16 | `psql --version` |

> **Platform note:** On Windows, use `python` instead of `python3` in all commands below. On macOS/Linux, use `python3`.

**Install DuckDB CLI:**

```bash
# macOS
brew install duckdb

# Linux — download from https://duckdb.org/docs/installation/

# Windows — download from https://duckdb.org/docs/installation/ and add to PATH
```

**Google Drive:** Download `results.csv` (2 GB) and place it at `sample-csv/results.csv`. The file is gitignored — you need to obtain it separately.

---

## Project Structure

```
pprcv-poc/
├── apps/
│   ├── api/                        # NestJS backend
│   │   └── src/
│   │       └── modules/results/
│   │           ├── dto/            # DTOs with class-validator
│   │           ├── __tests__/      # Jest tests (19 tests)
│   │           ├── results.service.ts    # DuckDB CLI queries
│   │           └── results.controller.ts # REST endpoints
│   │
│   ├── etl/                        # ETL pipeline
│   │   ├── src/etl/
│   │   │   ├── aggregator.py       # Multi-level aggregation
│   │   │   ├── models.py           # Dataclass models
│   │   │   └── processor.py        # Simple aggregation
│   │   ├── scripts/
│   │   │   ├── run_aggregation.py        # CLI entry point
│   │   │   ├── load_ref_data.py          # Postgres loader
│   │   │   └── generate-contest-names.mjs
│   │   ├── tests/                  # Pytest (13 tests)
│   │   │   └── fixtures/
│   │   ├── output/                 # Generated Parquet (gitignored)
│   │   ├── .env.example
│   │   └── pyproject.toml
│   │
│   └── web/                        # Next.js frontend
│       └── src/app/results/
│           └── components/         # SelectionPanel, ResultsTable, etc.
│
├── data/
│   └── contest-names.json          # Contest name lookup
│
├── sample-csv/                     # Source CSV files
│   ├── candidates.csv              # 2.2 MB
│   ├── contest.csv                 # 326 KB
│   ├── parties.csv                 # 16 KB
│   ├── precincts.csv               # 10 MB
│   └── results.csv                 # 2 GB (gitignored, download separately)
│
├── docs/
│   ├── v1/ v2/ v3/                 # Architecture docs by version
│   ├── superpowers/                # Design specs & plans
│   ├── CHANGES.md
│   └── DEV-SETUP.md
│
├── package.json                    # Turborepo root
├── pnpm-workspace.yaml
└── turbo.json
```

---

## Quick Start

```bash
# 1. Clone and install dependencies
pnpm install
pip install duckdb pytest pyarrow psycopg2-binary python-dotenv

# 2. Configure Postgres connection
cp apps/etl/.env.example apps/etl/.env          # macOS/Linux
# copy apps\etl\.env.example apps\etl\.env       # Windows
# Edit apps/etl/.env — set PGUSER to your system username

# 3. Scaffold reference database
python3 apps/etl/scripts/load_ref_data.py

# 4. Run ETL to generate Parquet output (full CSV, ~1m 40s)
python3 apps/etl/scripts/run_aggregation.py \
  sample-csv/results.csv \
  sample-csv/precincts.csv \
  apps/etl/output

# For dev iteration (100k rows, ~5s), add --sample 100000:
# python3 apps/etl/scripts/run_aggregation.py \
#   sample-csv/results.csv \
#   sample-csv/precincts.csv \
#   apps/etl/output --sample 100000

# 5. Start API + Frontend
pnpm dev
```

Open http://localhost:3000/results in your browser.

---

## 1. Database Scaffold (PostgreSQL)

Sets up a local Postgres database with reference data (parties, contests, precincts, candidates).

### Install & start PostgreSQL

```bash
# macOS
brew install postgresql@16
brew services start postgresql@16

# Windows — download from https://www.postgresql.org/download/windows/ and add bin/ to PATH

# Verify
psql -U $(whoami) -d postgres -c "SELECT 1"       # macOS/Linux
# psql -U %USERNAME% -d postgres -c "SELECT 1"    # Windows (cmd)
```

### Create database

```bash
createdb pprcv_local
```

### Configure connection

```bash
cp apps/etl/.env.example apps/etl/.env            # macOS/Linux
# copy apps\etl\.env.example apps\etl\.env         # Windows
```

Default `.env`:

```
PGHOST=localhost
PGDATABASE=pprcv_local
PGUSER=daryllmagsombol
```

Change `PGUSER` to match your system username (`whoami`). On macOS, your system user is usually already a Postgres superuser — no password needed.

### Load reference data

```bash
python3 apps/etl/scripts/load_ref_data.py
```

Expected output:

```
Created tables (first run)
Loaded rows:
  ref_parties: 339
  ref_contests: 5645
  ref_precincts: 93629
  ref_candidates: 41647
```

Re-run with `--fresh` to drop and reload:

```bash
python3 apps/etl/scripts/load_ref_data.py --fresh
```

---

## 2. ETL Pipeline (apps/etl)

Aggregates the 2 GB results CSV into per-level Parquet files that the API queries.

### Install

```bash
pip install duckdb pytest pyarrow psycopg2-binary python-dotenv
```

### Run aggregation

Full run (~1m 40s for 24M rows):

```bash
python3 apps/etl/scripts/run_aggregation.py \
  sample-csv/results.csv \
  sample-csv/precincts.csv \
  apps/etl/output
```

Dev iteration (100k rows, ~5s):

```bash
python3 apps/etl/scripts/run_aggregation.py \
  sample-csv/results.csv \
  sample-csv/precincts.csv \
  apps/etl/output --sample 100000
```

Use `--refresh` to wipe the output directory first (clean slate after code changes):

```bash
python3 apps/etl/scripts/run_aggregation.py \
  sample-csv/results.csv \
  sample-csv/precincts.csv \
  apps/etl/output --refresh
```

### Verify

```bash
ls apps/etl/output/national/*.parquet
# → e.g. output/national/00399000_0.parquet
```

Six level directories are created:

```
apps/etl/output/
├── national/
├── region/
├── province/
├── municipality/
├── barangay/
└── precinct/
```

### Tests

```bash
cd apps/etl && pytest tests/ -v
# → 13 passed
```

---

## 3. Backend (apps/api)

NestJS API that queries Parquet files via DuckDB CLI.

### How it runs

`pnpm dev` from project root starts both the API and frontend via Turborepo. The API starts automatically — no separate command needed.

### Configuration

| Env var | Default | Description |
|---|---|---|
| `PORT` | `3001` | API listen port |
| `PARQUET_BASE_PATH` | `apps/etl/output` | Path to Parquet output |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001/api` | Frontend → API URL (set in web env) |

The Parquet path resolves relative to the project root. If you moved `output/` elsewhere, set `PARQUET_BASE_PATH`.

### Verify

```bash
# List regions
curl http://localhost:3001/api/regions
# → ["NCR", "CAR", "Region I", ...]

# List contests (national level)
curl http://localhost:3001/api/contests
# → [{"code": "00399000", "name": "SENATOR", ...}, ...]

# Fetch results (national level)
curl "http://localhost:3001/api/results?level=national"
# → { "level": "national", "contests": [...] }

# Geographic cascade
curl http://localhost:3001/api/regions/NCR/provinces
curl http://localhost:3001/api/regions/NCR/provinces/MANILA/municipalities
```

### Tests

```bash
cd apps/api && pnpm test
# → 19 passed
```

---

## 4. Frontend (apps/web)

Next.js frontend that displays election results with geographic filtering.

### How it runs

Starts automatically via `pnpm dev` from the project root.

### Configuration

| Env var | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001/api` | API endpoint |

### Verify

Open http://localhost:3000/results in a browser. You should see:

- A geographic selection panel (Region → Province → Municipality → Barangay → Precinct)
- Contest category tabs (All, Senator, Governor, etc.)
- Vote counts per candidate

---

## 5. Run Everything

```bash
# Single command — starts both API (port 3001) + Frontend (port 3000)
pnpm dev
```

This uses Turborepo to run `dev` in both `apps/api` and `apps/web` concurrently.

### Service summary

| Service | Location | Port | Start command |
|---|---|---|---|
| Frontend | `apps/web/` | 3000 | `pnpm dev` (from root) |
| Backend | `apps/api/` | 3001 | `pnpm dev` (from root) |
| ETL | `apps/etl/` | — | `python3 apps/etl/scripts/run_aggregation.py ...` |
| DB | Postgres local | 5432 | `brew services start postgresql@16` |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `duckdb: command not found` | DuckDB CLI not installed | `brew install duckdb` (macOS) or download from duckdb.org (Windows) |
| `No files found matching the pattern` | Parquet files missing or wrong path | Run ETL or set `PARQUET_BASE_PATH` |
| `could not connect to server: Connection refused` | Postgres not running | `brew services start postgresql@16` (macOS) or start PostgreSQL service via Windows Services panel |
| `FATAL: role "X" does not exist` | Postgres user mismatch | `createuser -s $(whoami)` or set `PGUSER` in `apps/etl/.env` |
| `database "pprcv_local" does not exist` | Database not created | `createdb pprcv_local` |
| Frontend shows blank page / 404 | API not running | Wait for `pnpm dev` to finish starting both services |
| `Module not found: Can't resolve` | Node deps not installed | `pnpm install` |
| API returns stale results | DuckDB querying old Parquet | Re-run ETL aggregation |
| `python: command not found` | macOS has no `python` alias by default | Use `python3` instead of `python` |
| `'cp' is not recognized` | Windows uses `copy` instead of `cp` | Use `copy apps\etl\.env.example apps\etl\.env` |
| `'createdb' is not recognized` | PostgreSQL `bin/` not in PATH | Add `C:\Program Files\PostgreSQL\16\bin` to your system PATH |
| `psycopg2` import error | Python deps missing | `pip install psycopg2-binary python-dotenv` |
