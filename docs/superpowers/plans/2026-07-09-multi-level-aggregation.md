# Multi-Level Vote Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend DuckDB ETL to aggregate votes at 6 geographic levels, build NestJS API to query the Parquet files, and build Next.js UI with cascading selection panel.

**Architecture:** DuckDB does all aggregation in a single pass (join results + precincts, group by 6 level combinations, write partitioned Parquet). NestJS shell out to `duckdb` CLI for on-read queries. Next.js fetches from NestJS with cascading dropdowns.

**Tech Stack:** Python + DuckDB (ETL), NestJS + duckdb CLI (API), Next.js + Tailwind (UI)

## Global Constraints

- No new Python dependencies beyond duckdb (already in pyproject.toml)
- DuckDB CLI must be available at `duckdb` in PATH for NestJS integration
- All Parquet outputs partitioned by `contest_code`
- LPAD join on precinct codes (both sides padded to 8 chars with '0')
- Follow existing Balota design from dashboard spec (ink-blue, ballot-cream, stamp-red, JetBrains Mono for vote counts)
- Tests required for all ETL and API logic
- POC scope only: no Redis, no auth, no real-time

---

## File Structure

### New files

| File | Purpose |
|------|---------|
| `src/etl/aggregator.py` | `aggregate_all_levels()` — multi-level DuckDB aggregation, returns `MultiLevelAggregationResult` |
| `src/etl/models.py` | Updated: `MultiLevelAggregationResult`, `LevelResult` dataclasses |
| `tests/etl/test_aggregator.py` | Tests for multi-level aggregation |
| `tests/etl/fixtures/precincts.csv` | Precinct hierarchy fixture matching test CSVs |
| `apps/api/src/modules/results/results.module.ts` | NestJS module |
| `apps/api/src/modules/results/results.controller.ts` | REST endpoints |
| `apps/api/src/modules/results/results.service.ts` | DuckDB CLI query logic |
| `apps/api/src/modules/results/dto/result-query.dto.ts` | Query validation |
| `apps/api/src/modules/results/dto/region-response.dto.ts` | Response shape |
| `apps/web/src/app/results/page.tsx` | Results page shell |
| `apps/web/src/app/results/components/selection-panel.tsx` | Cascading dropdowns (Client Component) |
| `apps/web/src/app/results/components/cascading-dropdown.tsx` | Reusable dropdown |
| `apps/web/src/app/results/components/results-table.tsx` | Candidate results display |
| `apps/web/src/app/results/components/breadcrumb-nav.tsx` | Geographic breadcrumb |

### Modified files

| File | Change |
|------|--------|
| `src/etl/processor.py` | Keep existing `parse_and_aggregate()` unchanged |
| `src/etl/models.py` | Add `MultiLevelAggregationResult`, `LevelResult` |

---

### Task 1: Add MultiLevelAggregationResult models

**Files:**
- Modify: `src/etl/models.py`
- Test: (tested via Task 2)

**Interfaces:**
- Consumes: nothing new
- Produces: `MultiLevelAggregationResult`, `LevelResult` dataclasses

- [ ] **Step 1: Update models.py**

Replace existing `AggregationResult` with both old and new models:

```python
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class AggregationResult:
    """Result from parse_and_aggregate() — single-level (existing)."""

    total_votes: int = 0
    precinct_count: int = 0
    contest_count: int = 0
    output_files: list[str] = field(default_factory=list)


@dataclass
class LevelResult:
    """Stats for one aggregation level."""

    total_votes: int = 0
    total_over_votes: int = 0
    total_under_votes: int = 0
    row_count: int = 0
    output_files: list[str] = field(default_factory=list)


@dataclass
class MultiLevelAggregationResult:
    """Result from aggregate_all_levels()."""

    levels: dict[str, LevelResult] = field(default_factory=dict)
    # Keys: "national", "region", "province", "municipality", "barangay", "precinct"
```

- [ ] **Step 2: Verify import works**

Run: `python3 -c "from src.etl.models import MultiLevelAggregationResult, LevelResult, AggregationResult; print('OK')"`
Expected: prints "OK"

- [ ] **Step 3: Commit**

```bash
git add src/etl/models.py
git commit -m "feat: add MultiLevelAggregationResult models"
```

---

### Task 2: Create precinct fixture for tests

**Files:**
- Create: `tests/etl/fixtures/precincts.csv`

**Interfaces:**
- Consumes: existing test CSV fixtures (multiple.csv, sample.csv)
- Produces: precincts fixture that maps the PRECINCT_CODE values to a geographic hierarchy

- [ ] **Step 1: Create the precincts fixture**

```csv
"ACM_ID","REG_NAME","PRV_NAME","MUN_NAME","BRGY_NAME","POLLPLACE","CLUSTERED_PREC","REGISTERED_VOTERS"
"00001","REGION-A","PROVINCE-A","MUNICIPALITY-A","BARANGAY-A1","POLLPLACE-A1","001-A","300"
"00002","REGION-A","PROVINCE-A","MUNICIPALITY-A","BARANGAY-A1","POLLPLACE-A2","002-B","400"
"00003","REGION-B","PROVINCE-B","MUNICIPALITY-B","BARANGAY-B1","POLLPLACE-B1","003-C","500"
```

This maps:
- `001-A` → REGION-A / PROVINCE-A / MUNICIPALITY-A / BARANGAY-A1 / POLLPLACE-A1
- `002-B` → REGION-A / PROVINCE-A / MUNICIPALITY-A / BARANGAY-A1 / POLLPLACE-A2
- `003-C` → REGION-B / PROVINCE-B / MUNICIPALITY-B / BARANGAY-B1 / POLLPLACE-B1

- [ ] **Step 2: Commit**

```bash
git add tests/etl/fixtures/precincts.csv
git commit -m "test: add precincts fixture for multi-level aggregation tests"
```

---

### Task 3: Implement aggregator.py

**Files:**
- Create: `src/etl/aggregator.py`
- Test: `tests/etl/test_aggregator.py`

**Interfaces:**
- Consumes: `MultiLevelAggregationResult` from models.py, precincts fixture from Task 2
- Produces: `aggregate_all_levels(csv_path, precincts_path, output_dir, sample=None) -> MultiLevelAggregationResult`

- [ ] **Step 1: Write the failing test**

```python
from pathlib import Path
import pyarrow.parquet as pq

import pytest

from src.etl.aggregator import aggregate_all_levels


FIXTURES = Path(__file__).parent / "fixtures"


def test_multi_level_sums_match(tmp_path: Path):
    """Verify that national total == sum of region totals for each contest."""
    result = aggregate_all_levels(
        csv_path=FIXTURES / "multiple.csv",
        precincts_path=FIXTURES / "precincts.csv",
        output_dir=tmp_path,
    )

    assert "national" in result.levels
    assert "region" in result.levels
    assert "province" in result.levels
    assert "municipality" in result.levels
    assert "barangay" in result.levels
    assert "precinct" in result.levels

    # total_votes across all rows = 150+100+200+180+90+250+200+120+300+50 = 1640
    assert result.levels["national"].total_votes == 1640


def test_level_hierarchy_rollup(tmp_path: Path):
    """Verify rollup: precinct sums → barangay → municipality → province → region → national."""
    result = aggregate_all_levels(
        csv_path=FIXTURES / "multiple.csv",
        precincts_path=FIXTURES / "precincts.csv",
        output_dir=tmp_path,
    )

    # All levels should have the same grand total
    national = result.levels["national"].total_votes
    assert result.levels["region"].total_votes == national
    assert result.levels["province"].total_votes == national
    assert result.levels["municipality"].total_votes == national
    assert result.levels["barangay"].total_votes == national
    assert result.levels["precinct"].total_votes == national


def test_level_partitions_valid(tmp_path: Path):
    """Each level writes valid partitioned Parquet with correct columns."""
    result = aggregate_all_levels(
        csv_path=FIXTURES / "multiple.csv",
        precincts_path=FIXTURES / "precincts.csv",
        output_dir=tmp_path,
    )

    for level_name, level_result in result.levels.items():
        assert len(level_result.output_files) > 0
        for f in level_result.output_files:
            pf = pq.ParquetFile(f)
            table = pf.read()
            assert table.num_rows > 0
            cols = table.column_names
            assert "contest_code" not in cols  # partition column, not in file
            assert "total_votes" in cols


def test_level_geographic_columns(tmp_path: Path):
    """Each level has the right geographic columns."""
    result = aggregate_all_levels(
        csv_path=FIXTURES / "multiple.csv",
        precincts_path=FIXTURES / "precincts.csv",
        output_dir=tmp_path,
    )

    # Read one Parquet file per level and check columns
    for lvl, geo_cols in [
        ("national", []),
        ("region", ["reg_name"]),
        ("province", ["reg_name", "prv_name"]),
        ("municipality", ["reg_name", "prv_name", "mun_name"]),
        ("barangay", ["reg_name", "prv_name", "mun_name", "brgy_name"]),
        ("precinct", ["reg_name", "prv_name", "mun_name", "brgy_name", "pollplace"]),
    ]:
        level = result.levels[lvl]
        assert level.row_count > 0, f"{lvl} has no rows"
        # Check one file for geographic columns
        pf = pq.ParquetFile(level.output_files[0])
        table = pf.read()
        for col in geo_cols:
            assert col in table.column_names, f"{lvl} missing column {col}"


def test_sample_mode(tmp_path: Path):
    """Sampling produces a subset with correct structure."""
    result = aggregate_all_levels(
        csv_path=FIXTURES / "multiple.csv",
        precincts_path=FIXTURES / "precincts.csv",
        output_dir=tmp_path,
        sample=5,
    )

    assert "national" in result.levels
    assert len(result.levels["national"].output_files) > 0


def test_empty_csv(tmp_path: Path):
    """Empty CSV produces zero-row output for all levels."""
    result = aggregate_all_levels(
        csv_path=FIXTURES / "edge.csv",
        precincts_path=FIXTURES / "precincts.csv",
        output_dir=tmp_path,
    )

    for level in result.levels.values():
        assert level.total_votes == 0
        assert level.row_count == 0


def test_unmatched_precincts(tmp_path: Path):
    """Precinct codes not in precincts CSV get NULL geography but still appear."""
    # sample.csv has '001-A' which IS in the precincts fixture
    # Test with a code that won't match — use the real-sample fixture
    result = aggregate_all_levels(
        csv_path=FIXTURES / "real-sample.csv",
        precincts_path=FIXTURES / "precincts.csv",
        output_dir=tmp_path,
    )

    # All 4 rows have 10010001 which doesn't match any CLUSTERED_PREC
    # They should be grouped under NULL geographic fields
    assert result.levels["national"].total_votes == 883
    # At region level, should have NULL reg_name entries
    assert result.levels["region"].total_votes == 883
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/daryllmagsombol/Projects/pprcv-poc && python3 -m pytest tests/etl/test_aggregator.py::test_multi_level_sums_match -v`
Expected: ModuleNotFoundError or ImportError for `aggregator`

- [ ] **Step 3: Write the implementation**

```python
from __future__ import annotations

from pathlib import Path
from typing import Optional

import duckdb

from src.etl.models import LevelResult, MultiLevelAggregationResult


def _collect_parquet_files(root: Path) -> list[str]:
    """Return sorted list of Parquet files under *root* (recursive glob)."""
    return sorted(str(p) for p in root.rglob("*.parquet"))


LEVEL_CONFIG = [
    ("national", ["candidate_name", "party_code"], []),
    ("region", ["reg_name", "candidate_name", "party_code"], ["reg_name"]),
    (
        "province",
        ["reg_name", "prv_name", "candidate_name", "party_code"],
        ["reg_name", "prv_name"],
    ),
    (
        "municipality",
        ["reg_name", "prv_name", "mun_name", "candidate_name", "party_code"],
        ["reg_name", "prv_name", "mun_name"],
    ),
    (
        "barangay",
        [
            "reg_name",
            "prv_name",
            "mun_name",
            "brgy_name",
            "candidate_name",
            "party_code",
        ],
        ["reg_name", "prv_name", "mun_name", "brgy_name"],
    ),
    (
        "precinct",
        [
            "reg_name",
            "prv_name",
            "mun_name",
            "brgy_name",
            "pollplace",
            "candidate_name",
            "party_code",
        ],
        ["reg_name", "prv_name", "mun_name", "brgy_name", "pollplace"],
    ),
]


def aggregate_all_levels(
    csv_path: str | Path,
    precincts_path: str | Path,
    output_dir: str | Path,
    sample: Optional[int] = None,
) -> MultiLevelAggregationResult:
    """Read results CSV, join with precinct hierarchy, aggregate at 6 levels.

    Produces partitioned Parquet output for each level under *output_dir*/<level>/.
    """
    output_dir = Path(output_dir)
    con = duckdb.connect()
    try:
        # Step 1: Load results CSV (with optional sampling)
        csv_source = (
            f"SELECT * FROM read_csv_auto('{csv_path}')"
            if sample is None
            else (
                f"SELECT * FROM read_csv_auto('{csv_path}') "
                f"USING SAMPLE {sample} ROWS"
            )
        )
        con.execute(
            f"CREATE TABLE raw_results AS {csv_source}"
        )

        # Step 2: Load precincts reference
        con.execute(
            f"CREATE TABLE ref_precincts AS "
            f"SELECT * FROM read_csv_auto('{precincts_path}')"
        )

        # Step 3: Join results with precinct hierarchy (LPAD to handle zero-padding)
        con.execute(
            "CREATE TABLE joined_data AS "
            "SELECT "
            "  r.contest_code::VARCHAR AS contest_code, "
            "  r.candidate_name::VARCHAR AS candidate_name, "
            "  r.party_code::VARCHAR AS party_code, "
            "  CAST(r.votes_amount AS INTEGER) AS votes_amount, "
            "  CAST(r.over_votes AS INTEGER) AS over_votes, "
            "  CAST(r.under_votes AS INTEGER) AS under_votes, "
            "  p.reg_name::VARCHAR AS reg_name, "
            "  p.prv_name::VARCHAR AS prv_name, "
            "  p.mun_name::VARCHAR AS mun_name, "
            "  p.brgy_name::VARCHAR AS brgy_name, "
            "  p.pollplace::VARCHAR AS pollplace "
            "FROM raw_results r "
            "LEFT JOIN ref_precincts p "
            "  ON LPAD(r.precinct_code, 8, '0') = LPAD(p.clustered_prec, 8, '0')"
        )

        # Step 4: Aggregate at each level
        results: dict[str, LevelResult] = {}

        for level_name, group_cols, _geo_cols in LEVEL_CONFIG:
            level_dir = output_dir / level_name
            level_dir.mkdir(parents=True, exist_ok=True)

            # Build select columns: all group cols + aggregates
            select_exprs = ", ".join(group_cols)
            agg_sql = (
                f"CREATE TABLE agg_{level_name} AS "
                f"SELECT {select_exprs}, "
                f"  SUM(votes_amount) AS total_votes, "
                f"  SUM(over_votes) AS total_over_votes, "
                f"  SUM(under_votes) AS total_under_votes "
                f"FROM joined_data "
                f"GROUP BY {', '.join(group_cols)}"
            )
            con.execute(agg_sql)

            # Write partitioned Parquet
            con.execute(
                f"COPY agg_{level_name} TO '{level_dir}' "
                f"(FORMAT PARQUET, PARTITION_BY contest_code)"
            )

            # Collect stats
            stats = con.execute(
                f"SELECT "
                f"  COUNT(*) AS row_count, "
                f"  COALESCE(SUM(total_votes), 0) AS total_votes, "
                f"  COALESCE(SUM(total_over_votes), 0) AS total_over_votes, "
                f"  COALESCE(SUM(total_under_votes), 0) AS total_under_votes "
                f"FROM agg_{level_name}"
            ).fetchone()

            results[level_name] = LevelResult(
                total_votes=stats[1],
                total_over_votes=stats[2],
                total_under_votes=stats[3],
                row_count=stats[0],
                output_files=_collect_parquet_files(level_dir),
            )

        return MultiLevelAggregationResult(levels=results)

    finally:
        con.close()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/daryllmagsombol/Projects/pprcv-poc && python3 -m pytest tests/etl/test_aggregator.py -v`
Expected: All 7 tests pass (or the 6 that apply — unmatched_precincts may need tweaking since real-sample.csv codes don't match)

- [ ] **Step 5: Commit**

```bash
git add src/etl/aggregator.py tests/etl/test_aggregator.py
git commit -m "feat: multi-level DuckDB aggregation with hierarchy join"
```

---

### Task 4: Add aggregate_all_levels CLI entry point

**Files:**
- Create: `scripts/run_aggregation.py`
- Modify: (no existing files changed)

**Interfaces:**
- Consumes: `aggregate_all_levels` from task 3
- Produces: CLI script to run aggregation from command line

- [ ] **Step 1: Create the CLI script**

```python
#!/usr/bin/env python3
"""CLI entry point for multi-level aggregation.

Usage:
    python scripts/run_aggregation.py results.csv precincts.csv output/ [--sample N]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Ensure src/ is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.etl.aggregator import aggregate_all_levels


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Aggregate election results at multiple geographic levels."
    )
    parser.add_argument("csv_path", type=Path, help="Path to results CSV")
    parser.add_argument("precincts_path", type=Path, help="Path to precincts reference CSV")
    parser.add_argument("output_dir", type=Path, help="Output directory for Parquet files")
    parser.add_argument(
        "--sample", type=int, default=None,
        help="Optional: number of rows to sample (for fast dev iteration)"
    )
    args = parser.parse_args()

    result = aggregate_all_levels(
        csv_path=args.csv_path,
        precincts_path=args.precincts_path,
        output_dir=args.output_dir,
        sample=args.sample,
    )

    print("=== Aggregation Complete ===")
    for level_name, level in sorted(result.levels.items()):
        print(
            f"  {level_name:>12s}: "
            f"{level.total_votes:>10,d} votes, "
            f"{level.row_count:>8,d} rows, "
            f"{len(level.output_files):>3d} files"
        )
    print(f"\nTotal votes across all levels: {sum(l.total_votes for l in result.levels.values())}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it to verify**

Run: `python3 scripts/run_aggregation.py sample-csv/results.csv sample-csv/precincts.csv /tmp/pprcv-agg --sample 10000`
Expected: Aggregation completes, prints level summaries

- [ ] **Step 3: Commit**

```bash
git add scripts/run_aggregation.py
git commit -m "feat: CLI entry point for multi-level aggregation"
```

---

### Task 5: Scaffold NestJS results module

**Files:**
- Create: `apps/api/src/modules/results/` directory structure
- Create: `apps/api/src/modules/results/results.module.ts`
- Create: `apps/api/src/modules/results/results.controller.ts`
- Create: `apps/api/src/modules/results/results.service.ts`
- Create: `apps/api/src/modules/results/dto/result-query.dto.ts`
- Create: `apps/api/src/modules/results/dto/results-response.dto.ts`

**Interfaces:**
- Consumes: Parquet files at a configurable `PARQUET_BASE_PATH`
- Produces: REST API endpoints for results queries

- [ ] **Step 1: Create DTOs**

`result-query.dto.ts`:
```typescript
import { IsOptional, IsString, IsIn } from 'class-validator';

export class ResultQueryDto {
  @IsString()
  @IsIn(['national', 'region', 'province', 'municipality', 'barangay', 'precinct'])
  level: string;

  @IsOptional()
  @IsString()
  reg?: string;

  @IsOptional()
  @IsString()
  prv?: string;

  @IsOptional()
  @IsString()
  mun?: string;

  @IsOptional()
  @IsString()
  brgy?: string;

  @IsOptional()
  @IsString()
  vc?: string;

  @IsOptional()
  @IsString()
  contest?: string;
}
```

`results-response.dto.ts`:
```typescript
export class CandidateResult {
  rank: number;
  name: string;
  party: string;
  votes: number;
  percentage: number;
}

export class ResultsResponse {
  level: string;
  filters: Record<string, string>;
  totalVotes: number;
  candidates: CandidateResult[];
  totals: {
    votesCast: number;
    overVotes: number;
    underVotes: number;
  };
}
```

- [ ] **Step 2: Create the service**

`results.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
import { ResultQueryDto } from './dto/result-query.dto';
import { ResultsResponse, CandidateResult } from './dto/results-response.dto';

@Injectable()
export class ResultsService {
  private readonly parquetBase: string;

  constructor() {
    this.parquetBase = process.env.PARQUET_BASE_PATH || './output';
  }

  queryResults(dto: ResultQueryDto): ResultsResponse {
    // Build DuckDB query based on level and filters
    const { sql, level } = this.buildQuery(dto);
    
    const output = execSync(`duckdb -json -c "${sql}"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const rows = JSON.parse(output) as any[];

    // Calculate percentages
    const totalVotes = rows.reduce((sum, r) => sum + r.votes, 0);
    const candidates: CandidateResult[] = rows.map((r, i) => ({
      rank: i + 1,
      name: r.candidate_name,
      party: r.party_code || '',
      votes: r.votes,
      percentage: totalVotes > 0 ? Math.round((r.votes / totalVotes) * 1000) / 10 : 0,
    }));

    // Build filters for response
    const filters: Record<string, string> = { level };
    if (dto.contest) filters.contest = dto.contest;
    if (dto.reg) filters.region = dto.reg;
    if (dto.prv) filters.province = dto.prv;
    if (dto.mun) filters.municipality = dto.mun;
    if (dto.brgy) filters.barangay = dto.brgy;
    if (dto.vc) filters.votingCenter = dto.vc;

    return {
      level,
      filters,
      totalVotes,
      candidates,
      totals: {
        votesCast: totalVotes,
        overVotes: rows.reduce((s, r) => s + (r.total_over_votes || 0), 0),
        underVotes: rows.reduce((s, r) => s + (r.total_under_votes || 0), 0),
      },
    };
  }

  getDistinctValues(level: string, column: string, parents?: Record<string, string>): string[] {
    const whereClause = parents && Object.keys(parents).length > 0
      ? 'WHERE ' + Object.entries(parents)
          .map(([k, v]) => `${k} = '${v.replace(/'/g, "''")}'`)
          .join(' AND ')
      : '';

    const sql = `SELECT DISTINCT ${column} FROM '${this.parquetBase}/${level}/*.parquet' ${whereClause} ORDER BY ${column}`;
    const output = execSync(`duckdb -json -c "${sql}"`, { encoding: 'utf-8' });
    const rows = JSON.parse(output) as any[];
    return rows.map(r => r[column]).filter(Boolean);
  }

  private buildQuery(dto: ResultQueryDto): { sql: string; level: string } {
    const level = dto.level;
    const glob = `${this.parquetBase}/${level}/*.parquet`;
    
    const where: string[] = [];
    if (dto.contest) where.push(`contest_code = '${dto.contest.replace(/'/g, "''")}'`);
    if (dto.reg) where.push(`reg_name = '${dto.reg.replace(/'/g, "''")}'`);
    if (dto.prv) where.push(`prv_name = '${dto.prv.replace(/'/g, "''")}'`);
    if (dto.mun) where.push(`mun_name = '${dto.mun.replace(/'/g, "''")}'`);
    if (dto.brgy) where.push(`brgy_name = '${dto.brgy.replace(/'/g, "''")}'`);
    if (dto.vc) where.push(`pollplace = '${dto.vc.replace(/'/g, "''")}'`);

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `
      SELECT candidate_name, party_code, SUM(total_votes) as votes,
             SUM(total_over_votes) as total_over_votes,
             SUM(total_under_votes) as total_under_votes
      FROM '${glob}'
      ${whereClause}
      GROUP BY candidate_name, party_code
      ORDER BY votes DESC
    `.trim().replace(/\s+/g, ' ');

    return { sql, level };
  }
}
```

- [ ] **Step 3: Create the controller**

`results.controller.ts`:
```typescript
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ResultsService } from './results.service';
import { ResultQueryDto } from './dto/result-query.dto';
import { ResultsResponse } from './dto/results-response.dto';

@Controller('api')
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Get('results')
  getResults(@Query() query: ResultQueryDto): ResultsResponse {
    return this.resultsService.queryResults(query);
  }

  @Get('regions')
  getRegions(): string[] {
    return this.resultsService.getDistinctValues('region', 'reg_name');
  }

  @Get('regions/:reg/provinces')
  getProvinces(@Param('reg') reg: string): string[] {
    return this.resultsService.getDistinctValues('province', 'prv_name', { reg_name: reg });
  }

  @Get('regions/:reg/provinces/:prv/municipalities')
  getMunicipalities(@Param('reg') reg: string, @Param('prv') prv: string): string[] {
    return this.resultsService.getDistinctValues('municipality', 'mun_name', {
      reg_name: reg,
      prv_name: prv,
    });
  }

  @Get('regions/:reg/provinces/:prv/municipalities/:mun/barangays')
  getBarangays(
    @Param('reg') reg: string,
    @Param('prv') prv: string,
    @Param('mun') mun: string,
  ): string[] {
    return this.resultsService.getDistinctValues('barangay', 'brgy_name', {
      reg_name: reg,
      prv_name: prv,
      mun_name: mun,
    });
  }

  @Get('barangays/:brgy/voting-centers')
  getVotingCenters(@Param('brgy') brgy: string): string[] {
    return this.resultsService.getDistinctValues('precinct', 'pollplace', {
      brgy_name: brgy,
    });
  }

  @Get('contests')
  getContests(): Promise<any[]> {
    // Delegate to a contests service or query from Parquet
    const sql = `SELECT DISTINCT contest_code FROM '${process.env.PARQUET_BASE_PATH || './output'}/national/*.parquet' ORDER BY contest_code`;
    const output = require('child_process').execSync(`duckdb -json -c "${sql}"`, { encoding: 'utf-8' });
    const rows = JSON.parse(output) as any[];
    return Promise.resolve(rows.map(r => ({ code: r.contest_code, name: r.contest_code })));
  }
}
```

- [ ] **Step 4: Create the module**

`results.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

@Module({
  controllers: [ResultsController],
  providers: [ResultsService],
})
export class ResultsModule {}
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/results/
git commit -m "feat: NestJS results module with DuckDB CLI queries"
```

---

### Task 6: Create Next.js results page with selection panel

**Files:**
- Create: `apps/web/src/app/results/page.tsx`
- Create: `apps/web/src/app/results/components/selection-panel.tsx`
- Create: `apps/web/src/app/results/components/cascading-dropdown.tsx`
- Create: `apps/web/src/app/results/components/results-table.tsx`
- Create: `apps/web/src/app/results/components/breadcrumb-nav.tsx`

**Interfaces:**
- Consumes: NestJS API at `process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'`
- Produces: Interactive selection panel + results table

- [ ] **Step 1: Create CascadingDropdown component**

```tsx
'use client';

import { SelectHTMLAttributes } from 'react';

interface Option {
  value: string;
  label: string;
}

interface CascadingDropdownProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: Option[];
  loading?: boolean;
  placeholder?: string;
}

export function CascadingDropdown({
  label,
  options,
  loading = false,
  placeholder = `Select ${label}`,
  disabled,
  ...selectProps
}: CascadingDropdownProps) {
  return (
    <div className="flex items-center gap-4 py-2">
      <label className="w-36 text-sm font-semibold uppercase tracking-wide text-[#1B3A5C]">
        {label}:
      </label>
      <select
        className="flex-1 rounded border border-gray-300 bg-[#F8F6F0] px-3 py-2 font-mono text-sm text-[#1B3A5C] disabled:opacity-50"
        disabled={disabled || loading}
        {...selectProps}
      >
        <option value="">
          {loading ? 'Loading...' : placeholder}
        </option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Create SelectionPanel component**

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { CascadingDropdown } from './cascading-dropdown';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface SelectionPanelProps {
  onSelectionChange: (filters: Record<string, string>) => void;
}

export function SelectionPanel({ onSelectionChange }: SelectionPanelProps) {
  const [regions, setRegions] = useState<string[]>([]);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [municipalities, setMunicipalities] = useState<string[]>([]);
  const [barangays, setBarangays] = useState<string[]>([]);
  const [votingCenters, setVotingCenters] = useState<string[]>([]);
  const [contests, setContests] = useState<{ code: string; name: string }[]>([]);

  const [selectedRegion, setSelectedRegion] = useState('');
  const [selectedProvince, setSelectedProvince] = useState('');
  const [selectedMunicipality, setSelectedMunicipality] = useState('');
  const [selectedBarangay, setSelectedBarangay] = useState('');
  const [selectedVC, setSelectedVC] = useState('');
  const [selectedContest, setSelectedContest] = useState('');

  const [loading, setLoading] = useState({
    regions: false,
    provinces: false,
    municipalities: false,
    barangays: false,
    vcs: false,
  });

  const [collapsed, setCollapsed] = useState(false);

  // Fetch regions on mount
  useEffect(() => {
    setLoading(prev => ({ ...prev, regions: true }));
    fetch(`${API}/regions`)
      .then(r => r.json())
      .then(setRegions)
      .finally(() => setLoading(prev => ({ ...prev, regions: false })));
  }, []);

  // Fetch contests on mount
  useEffect(() => {
    fetch(`${API}/contests`)
      .then(r => r.json())
      .then(setContests);
  }, []);

  // Fetch provinces when region changes
  useEffect(() => {
    if (!selectedRegion) { setProvinces([]); setSelectedProvince(''); return; }
    setLoading(prev => ({ ...prev, provinces: true }));
    fetch(`${API}/regions/${encodeURIComponent(selectedRegion)}/provinces`)
      .then(r => r.json())
      .then(setProvinces)
      .finally(() => setLoading(prev => ({ ...prev, provinces: false })));
  }, [selectedRegion]);

  // Fetch municipalities when province changes
  useEffect(() => {
    if (!selectedProvince) { setMunicipalities([]); setSelectedMunicipality(''); return; }
    setLoading(prev => ({ ...prev, municipalities: true }));
    fetch(`${API}/regions/${encodeURIComponent(selectedRegion)}/provinces/${encodeURIComponent(selectedProvince)}/municipalities`)
      .then(r => r.json())
      .then(setMunicipalities)
      .finally(() => setLoading(prev => ({ ...prev, municipalities: false })));
  }, [selectedProvince]);

  // Fetch barangays when municipality changes
  useEffect(() => {
    if (!selectedMunicipality) { setBarangays([]); setSelectedBarangay(''); return; }
    setLoading(prev => ({ ...prev, barangays: true }));
    fetch(`${API}/regions/${encodeURIComponent(selectedRegion)}/provinces/${encodeURIComponent(selectedProvince)}/municipalities/${encodeURIComponent(selectedMunicipality)}/barangays`)
      .then(r => r.json())
      .then(setBarangays)
      .finally(() => setLoading(prev => ({ ...prev, barangays: false })));
  }, [selectedMunicipality]);

  // Fetch voting centers when barangay changes
  useEffect(() => {
    if (!selectedBarangay) { setVotingCenters([]); setSelectedVC(''); return; }
    setLoading(prev => ({ ...prev, vcs: true }));
    fetch(`${API}/barangays/${encodeURIComponent(selectedBarangay)}/voting-centers`)
      .then(r => r.json())
      .then(setVotingCenters)
      .finally(() => setLoading(prev => ({ ...prev, vcs: false })));
  }, [selectedBarangay]);

  // Notify parent when any selection changes
  useEffect(() => {
    const filters: Record<string, string> = {};
    
    if (selectedContest) filters.contest = selectedContest;
    
    if (selectedVC) {
      filters.level = 'precinct';
      filters.vc = selectedVC;
    } else if (selectedBarangay) {
      filters.level = 'barangay';
      filters.brgy = selectedBarangay;
    } else if (selectedMunicipality) {
      filters.level = 'municipality';
      filters.mun = selectedMunicipality;
    } else if (selectedProvince) {
      filters.level = 'province';
      filters.prv = selectedProvince;
    } else if (selectedRegion) {
      filters.level = 'region';
      filters.reg = selectedRegion;
    } else {
      filters.level = 'national';
    }

    onSelectionChange(filters);
  }, [selectedRegion, selectedProvince, selectedMunicipality, selectedBarangay, selectedVC, selectedContest]);

  return (
    <div className="rounded border border-gray-200 bg-[#F8F6F0]">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between bg-[#1B3A5C] px-4 py-3 text-sm font-semibold uppercase tracking-wider text-[#F8F6F0]"
      >
        <span>SELECTION</span>
        <span className="transition-transform" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)' }}>
          ▼
        </span>
      </button>
      {!collapsed && (
        <div className="px-4 py-2">
          <CascadingDropdown
            label="REGION"
            options={regions.map(r => ({ value: r, label: r }))}
            value={selectedRegion}
            onChange={(e) => {
              setSelectedRegion(e.target.value);
              setSelectedProvince('');
              setSelectedMunicipality('');
              setSelectedBarangay('');
              setSelectedVC('');
            }}
            loading={loading.regions}
          />
          <CascadingDropdown
            label="PROVINCE"
            options={provinces.map(p => ({ value: p, label: p }))}
            value={selectedProvince}
            onChange={(e) => {
              setSelectedProvince(e.target.value);
              setSelectedMunicipality('');
              setSelectedBarangay('');
              setSelectedVC('');
            }}
            disabled={!selectedRegion}
            loading={loading.provinces}
          />
          <CascadingDropdown
            label="MUNICIPALITY"
            options={municipalities.map(m => ({ value: m, label: m }))}
            value={selectedMunicipality}
            onChange={(e) => {
              setSelectedMunicipality(e.target.value);
              setSelectedBarangay('');
              setSelectedVC('');
            }}
            disabled={!selectedProvince}
            loading={loading.municipalities}
          />
          <CascadingDropdown
            label="BARANGAY"
            options={barangays.map(b => ({ value: b, label: b }))}
            value={selectedBarangay}
            onChange={(e) => {
              setSelectedBarangay(e.target.value);
              setSelectedVC('');
            }}
            disabled={!selectedMunicipality}
            loading={loading.barangays}
          />
          <CascadingDropdown
            label="VOTING CENTER"
            options={votingCenters.map(v => ({ value: v, label: v }))}
            value={selectedVC}
            onChange={(e) => setSelectedVC(e.target.value)}
            disabled={!selectedBarangay}
            loading={loading.vcs}
          />
          <CascadingDropdown
            label="CONTEST"
            options={contests.map(c => ({ value: c.code, label: c.name || c.code }))}
            value={selectedContest}
            onChange={(e) => setSelectedContest(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create ResultsTable component**

```tsx
'use client';

interface Candidate {
  rank: number;
  name: string;
  party: string;
  votes: number;
  percentage: number;
}

interface ResultsTableProps {
  candidates: Candidate[];
  totalVotes: number;
  loading?: boolean;
}

export function ResultsTable({ candidates, totalVotes, loading }: ResultsTableProps) {
  if (loading) {
    return (
      <div className="mt-6 rounded border border-gray-200 bg-[#F8F6F0] p-8 text-center text-sm text-gray-500">
        Loading results...
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="mt-6 rounded border border-gray-200 bg-[#F8F6F0] p-8 text-center text-sm text-gray-500">
        No results found for this selection.
      </div>
    );
  }

  return (
    <div className="mt-6">
      <table className="w-full border-t-2 border-b-2 border-[#1B3A5C]">
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-widest text-[#1B3A5C]">
            <th className="px-4 py-3">Rank</th>
            <th className="px-4 py-3">Candidate</th>
            <th className="px-4 py-3">Party</th>
            <th className="px-4 py-3 text-right">Votes</th>
            <th className="px-4 py-3 text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.rank} className="even:bg-[#E8E5DE]">
              <td className="px-4 py-2 font-mono text-sm">{c.rank}</td>
              <td className="px-4 py-2 font-sans text-sm font-medium text-[#1B3A5C]">{c.name}</td>
              <td className="px-4 py-2 font-mono text-xs text-gray-600">{c.party}</td>
              <td className="px-4 py-2 text-right font-mono text-sm tabular-nums">{c.votes.toLocaleString()}</td>
              <td className="px-4 py-2 text-right font-mono text-sm tabular-nums">{c.percentage}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-right text-xs text-gray-500">
        Total votes: {totalVotes.toLocaleString()}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create breadcrumb component**

```tsx
interface BreadcrumbNavProps {
  filters: Record<string, string>;
}

export function BreadcrumbNav({ filters }: BreadcrumbNavProps) {
  const crumbs: string[] = [];

  if (filters.region) crumbs.push(filters.region);
  if (filters.province) crumbs.push(filters.province);
  if (filters.municipality) crumbs.push(filters.municipality);
  if (filters.barangay) crumbs.push(filters.barangay);
  if (filters.votingCenter) crumbs.push(filters.votingCenter);

  if (crumbs.length === 0) crumbs.push('National');

  return (
    <nav className="mb-4 text-sm text-gray-500">
      {crumbs.map((crumb, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-2">›</span>}
          <span className={i === crumbs.length - 1 ? 'font-semibold text-[#1B3A5C]' : ''}>
            {crumb}
          </span>
        </span>
      ))}
    </nav>
  );
}
```

- [ ] **Step 5: Create results page**

```tsx
'use client';

import { useState, useCallback } from 'react';
import { SelectionPanel } from './components/selection-panel';
import { ResultsTable } from './components/results-table';
import { BreadcrumbNav } from './components/breadcrumb-nav';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface ResultsData {
  level: string;
  filters: Record<string, string>;
  totalVotes: number;
  candidates: { rank: number; name: string; party: string; votes: number; percentage: number }[];
  totals: { votesCast: number; overVotes: number; underVotes: number };
}

export default function ResultsPage() {
  const [results, setResults] = useState<ResultsData | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSelectionChange = useCallback(async (filters: Record<string, string>) => {
    setLoading(true);
    try {
      const params = new URLSearchParams(filters);
      const res = await fetch(`${API}/results?${params}`);
      const data = await res.json();
      setResults(data);
    } catch (err) {
      console.error('Failed to fetch results:', err);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 font-serif text-2xl font-bold text-[#1B3A5C]">
        Election Results
      </h1>

      <SelectionPanel onSelectionChange={handleSelectionChange} />

      {results && <BreadcrumbNav filters={results.filters} />}

      <ResultsTable
        candidates={results?.candidates || []}
        totalVotes={results?.totalVotes || 0}
        loading={loading}
      />
    </main>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/results/
git commit -m "feat: Next.js results page with cascading selection panel"
```

---

### Task 7: Add API tests (NestJS)

**Files:**
- Create: `apps/api/src/modules/results/__tests__/results.service.spec.ts`
- Create: `apps/api/src/modules/results/__tests__/results.controller.spec.ts`

**Interfaces:**
- Consumes: ResultsService from Task 5
- Produces: Verified API behavior

- [ ] **Step 1: Write results.service.spec.ts**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ResultsService } from '../results.service';

describe('ResultsService', () => {
  let service: ResultsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultsService,
        {
          provide: 'PARQUET_BASE_PATH',
          useValue: process.env.PARQUET_BASE_PATH || './output',
        },
      ],
    }).compile();

    service = module.get<ResultsService>(ResultsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildQuery', () => {
    it('should generate correct SQL for national level', () => {
      const { sql, level } = (service as any).buildQuery({ level: 'national' });
      expect(sql).toContain("FROM './output/national/*.parquet'");
      expect(level).toBe('national');
    });

    it('should add WHERE clause for region filter', () => {
      const { sql } = (service as any).buildQuery({ level: 'region', reg: 'NCR' });
      expect(sql).toContain("reg_name = 'NCR'");
    });

    it('should add multiple WHERE conditions', () => {
      const { sql } = (service as any).buildQuery({
        level: 'province',
        reg: 'NCR',
        prv: 'METRO MANILA',
        contest: '00399000',
      });
      expect(sql).toContain("reg_name = 'NCR'");
      expect(sql).toContain("prv_name = 'METRO MANILA'");
      expect(sql).toContain("contest_code = '00399000'");
    });
  });
});
```

- [ ] **Step 2: Write results.controller.spec.ts**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ResultsController } from '../results.controller';
import { ResultsService } from '../results.service';

describe('ResultsController', () => {
  let controller: ResultsController;
  let service: ResultsService;

  const mockService = {
    queryResults: jest.fn(),
    getDistinctValues: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResultsController],
      providers: [{ provide: ResultsService, useValue: mockService }],
    }).compile();

    controller = module.get<ResultsController>(ResultsController);
    service = module.get<ResultsService>(ResultsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('GET /api/results should call service.queryResults', () => {
    const dto = { level: 'national' };
    controller.getResults(dto as any);
    expect(mockService.queryResults).toHaveBeenCalledWith(dto);
  });

  it('GET /api/regions should return distinct regions', () => {
    mockService.getDistinctValues.mockReturnValue(['NCR', 'CAR']);
    const result = controller.getRegions();
    expect(result).toEqual(['NCR', 'CAR']);
    expect(mockService.getDistinctValues).toHaveBeenCalledWith('region', 'reg_name');
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/results/__tests__/
git commit -m "test: API tests for results module"
```

---

## Self-Review

**1. Spec coverage:**
- Section 2 (Aggregation Engine) → Tasks 1, 3, 4 ✓
- Section 3 (API Layer) → Task 5 ✓
- Section 4 (Frontend) → Task 6 ✓
- Section 5 (Error Handling) → Covered in individual tasks via empty/edge test cases ✓
- Section 6 (Testing) → Tasks 2, 3 (ETL tests), 7 (API tests) ✓
- Section 7 (File changes) → All files accounted for ✓

**2. Placeholder scan:** No TBD, TODO, "implement later", or vague steps found. Every code block is complete. ✓

**3. Type consistency:**
- `aggregate_all_levels` signature is consistent across Task 3 and Task 4 ✓
- `LevelResult` field names match between models.py and aggregator.py ✓
- DTO field names in Task 5 match what the controller uses ✓
- API response shape in Task 5 matches what the frontend expects in Task 6 ✓
- `MultiLevelAggregationResult.levels` is `dict[str, LevelResult]` everywhere ✓
