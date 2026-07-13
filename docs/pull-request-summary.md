# PPCRV POC — Multi-Level Aggregation, API, and UI

**Branch:** `feature/poc`

Proof-of-concept for the PPCRV election results dashboard — from raw CSV data through multi-level aggregation to a live queryable API and interactive web UI. Includes ETL pipeline (Python + DuckDB), NestJS API, Next.js frontend, and pnpm/Turborepo monorepo setup.

---

## What's Included

### ETL — Multi-Level Aggregation
- `src/etl/aggregator.py` — single-pass DuckDB aggregation at 6 geographic levels: national, region, province, municipality, barangay, precinct
- LPAD join on 8-char precinct codes links results to geo hierarchy
- Hive-partitioned Parquet output by `contest_code` (partition pruning on read)
- `scripts/run_aggregation.py` — CLI entry with `--sample N` flag
- 7 pytest tests covering all levels, edge cases, and idempotent output

### API — NestJS + DuckDB CLI
- `GET /api/results` — aggregated candidate results at any geographic level with filters (contest, region, province, municipality, barangay, voting center)
- `GET /api/contests` — list available contests
- Cascading geo endpoints: `/api/regions` → `/api/regions/:reg/provinces` → ... → `/api/barangays/:brgy/voting-centers`
- No database server — shells out to `duckdb` CLI to query Parquet files directly
- Input validation via `class-validator` DTOs + `ValidationPipe`
- Jest tests for controller and service

### UI — Next.js 14 + Tailwind CSS
- Results page with collapsible selection panel (6 cascading dropdowns)
- Geographic drill-down: selecting a parent enables the next level
- `ResultsTable` — candidate rankings with votes and percentages
- `BreadcrumbNav` — shows current geographic selection
- PPCRV brand colors (`#1B3A5C` ink-blue / `#F8F6F0` ballot-cream / `#C41E3A` stamp-red)
- Homepage with link to `/results`

### Monorepo — pnpm + Turborepo
- `pnpm dev` starts both API (port 3001) and web (port 3000) in parallel
- `turbo.json` with `tasks` config for dev/build/test
- `packages/shared` stub for shared TypeScript types

### Dev Docs
- `docs/DEV-SETUP.md` — full setup guide, project structure, troubleshooting
- `docs/CHANGES.md` — complete change log for the entire repository
- Dev setup section added to `README.md`

### Bug Fixes (post-setup)
- Fixed `parquetBase` path resolution (relative to project root, not `__dirname`)
- Changed DuckDB globs from `/*.parquet` to `/**/*.parquet` (Hive-partitioned directories)
- Untracked large files (`output.txt` 1.5 GB, `sample-csv/results.csv` 2 GB) from Git history via `git filter-repo`

---

## How to Test

```bash
pnpm install
pip install duckdb pytest
python3 scripts/run_aggregation.py sample-csv/results.csv sample-csv/precincts.csv output/multi-level --sample 100000
pnpm dev
```

Then open **http://localhost:3000/results**.

Select a contest to see national-level results, or drill down by region → province → municipality → barangay.

---

## Files Changed

| Area | Key Files |
|------|-----------|
| ETL | `src/etl/aggregator.py`, `src/etl/models.py`, `scripts/run_aggregation.py`, `tests/etl/test_aggregator.py` |
| API | `apps/api/src/modules/results/` (controller, service, DTOs, module, tests) |
| UI | `apps/web/src/app/results/` (page, components: selection-panel, cascading-dropdown, results-table, breadcrumb-nav) |
| Monorepo | `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `apps/*/package.json` |
| Docs | `docs/DEV-SETUP.md`, `docs/CHANGES.md`, `README.md`, `docs/pull-request-summary.md` |
