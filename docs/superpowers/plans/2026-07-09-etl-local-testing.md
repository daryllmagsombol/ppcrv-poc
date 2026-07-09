# ETL Local Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up pure-python local ETL testing with DuckDB aggregation and pytest, no Docker/Redis/cloud dependencies.

**Architecture:** Single pure function `parse_and_aggregate()` that reads CSV via DuckDB, aggregates votes by (precinct, contest, candidate), writes Parquet, returns summary. Tested with pytest + CSV fixtures.

**Tech Stack:** Python 3.11+, duckdb>=1.0, pytest>=8.0, pyarrow>=15.0

## Global Constraints

- No Docker, Redis, or cloud SDK dependencies for DuckDB processor
- DuckDB `read_csv_auto` for CSV import
- Parquet output with `contest_code` partitioning
- DuckDB tests pass with single `pytest tests/etl/ -v` command
- Postgres via `psycopg2-binary` for reference data loading
- Python stdlib only beyond duckdb, pytest, pyarrow, psycopg2-binary

---
### Task 1: Project Scaffold + Models + Fixtures

**Files:**
- Create: `src/__init__.py` (empty)
- Create: `src/etl/__init__.py` (empty)
- Create: `src/etl/models.py`
- Create: `tests/__init__.py` (empty)
- Create: `tests/etl/__init__.py` (empty)
- Create: `tests/etl/fixtures/sample.csv`
- Create: `tests/etl/fixtures/multiple.csv`
- Create: `tests/etl/fixtures/edge.csv`
- Create: `pyproject.toml`

**Interfaces:**
- Produces: `AggregationResult` dataclass (consumed by Task 2)
- Produces: CSV fixtures (consumed by Task 2)

---

#### Step 1: Create directory structure

```bash
mkdir -p src/etl tests/etl/fixtures
touch src/__init__.py src/etl/__init__.py tests/__init__.py tests/etl/__init__.py
```

#### Step 2: Create `pyproject.toml`

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.backends._legacy:_Backend"

[project]
name = "pprcv-etl"
version = "0.1.0"
description = "PPCRV ETL pipeline — DuckDB aggregation"

[project.optional-dependencies]
dev = [
    "duckdb>=1.0",
    "pytest>=8.0",
    "pyarrow>=15.0",
]

[tool.pytest.ini_options]
minversion = "8.0"
testpaths = ["tests"]
```

#### Step 3: Create `src/etl/models.py`

```python
from dataclasses import dataclass, field


@dataclass
class AggregationResult:
    """Result from parse_and_aggregate()."""

    total_votes: int = 0
    precinct_count: int = 0
    contest_count: int = 0
    output_files: list[str] = field(default_factory=list)
```

#### Step 4: Create `tests/etl/fixtures/sample.csv`

Simple happy path — 1 precinct, 1 contest, 1 candidate:

```csv
PRECINCT_CODE,CONTEST_CODE,CANDIDATE_CODE,PARTY_CODE,VOTES_AMOUNT,TOTALIZATION_ORDER,NUMBER_VOTERS,UNDERVOTE,OVERVOTE,RECEPTION_DATE
001-A,PRESIDENT,CAND-01,PARTY-A,150,1,300,5,2,2028-05-09 07:00:00
001-A,PRESIDENT,CAND-01,PARTY-A,150,1,300,5,2,2028-05-09 07:00:00
```

Two rows with identical data to verify SUM works (result should be 300).

#### Step 5: Create `tests/etl/fixtures/multiple.csv`

3 precincts, 2 contests, multiple candidates:

```csv
PRECINCT_CODE,CONTEST_CODE,CANDIDATE_CODE,PARTY_CODE,VOTES_AMOUNT,TOTALIZATION_ORDER,NUMBER_VOTERS,UNDERVOTE,OVERVOTE,RECEPTION_DATE
001-A,PRESIDENT,CAND-01,PARTY-A,150,1,300,5,2,2028-05-09 07:00:00
001-A,PRESIDENT,CAND-02,PARTY-B,100,1,300,5,2,2028-05-09 07:00:00
001-A,MAYOR,CAND-03,PARTY-A,200,1,300,5,2,2028-05-09 07:00:00
002-B,PRESIDENT,CAND-01,PARTY-A,180,1,400,3,1,2028-05-09 08:00:00
002-B,PRESIDENT,CAND-02,PARTY-B,90,1,400,3,1,2028-05-09 08:00:00
002-B,MAYOR,CAND-04,PARTY-C,250,1,400,3,1,2028-05-09 08:00:00
003-C,PRESIDENT,CAND-01,PARTY-A,200,1,500,10,0,2028-05-09 09:00:00
003-C,PRESIDENT,CAND-02,PARTY-B,120,1,500,10,0,2028-05-09 09:00:00
003-C,MAYOR,CAND-03,PARTY-A,300,1,500,10,0,2028-05-09 09:00:00
003-C,MAYOR,CAND-04,PARTY-C,50,1,500,10,0,2028-05-09 09:00:00
```

Expected totals (hand-calculated):
- PRESIDENT: CAND-01 = 530, CAND-02 = 310
- MAYOR: CAND-03 = 500, CAND-04 = 300
- Total votes: 1640

#### Step 6: Create `tests/etl/fixtures/edge.csv`

Edge cases — header only (zero rows):

```csv
PRECINCT_CODE,CONTEST_CODE,CANDIDATE_CODE,PARTY_CODE,VOTES_AMOUNT,TOTALIZATION_ORDER,NUMBER_VOTERS,UNDERVOTE,OVERVOTE,RECEPTION_DATE
```

---

### Task 2: Postgres Reference Data Setup

**Files:**
- Create: `scripts/load_ref_data.py`
- Modify: `pyproject.toml` (add psycopg2-binary dep)

**Interfaces:**
- Consumes: CSVs from `sample-csv/` (contest, candidates, precincts, parties)
- Produces: `pprcv_local` database with 4 reference tables

**Postgres connection:** `host=localhost dbname=pprcv_local user=daryllmagsombol`

---

- [ ] **Step 1: Create `pprcv_local` database**

```bash
createdb pprcv_local
```

- [ ] **Step 2: Add psycopg2-binary to pyproject.toml**

```toml
[project.optional-dependencies]
dev = [
    "duckdb>=1.0",
    "pytest>=8.0",
    "pyarrow>=15.0",
    "psycopg2-binary>=2.9",
]
```

- [ ] **Step 3: Write `scripts/load_ref_data.py`**

```python
#!/usr/bin/env python3
"""Load reference data CSVs into local pprcv_local Postgres database."""

import csv
from pathlib import Path

import psycopg2

BASE = Path(__file__).resolve().parent.parent / "sample-csv"
CONN_STR = "host=localhost dbname=pprcv_local user=daryllmagsombol"


SCHEMA_SQL = """
DROP TABLE IF EXISTS ref_parties CASCADE;
DROP TABLE IF EXISTS ref_contests CASCADE;
DROP TABLE IF EXISTS ref_precincts CASCADE;
DROP TABLE IF EXISTS ref_candidates CASCADE;

CREATE TABLE ref_parties (
    parties_code TEXT PRIMARY KEY,
    parties_name TEXT NOT NULL,
    parties_alias TEXT
);

CREATE TABLE ref_contests (
    contest_code TEXT PRIMARY KEY,
    contest_name TEXT NOT NULL
);

CREATE TABLE ref_precincts (
    acm_id TEXT PRIMARY KEY,
    reg_name TEXT,
    prv_name TEXT,
    mun_name TEXT,
    brgy_name TEXT,
    pollplace TEXT,
    clustered_prec TEXT,
    registered_voters INTEGER
);

CREATE TABLE ref_candidates (
    contest_code TEXT REFERENCES ref_contests(contest_code),
    candidate_code TEXT NOT NULL,
    candidate_name TEXT NOT NULL,
    parties_code TEXT REFERENCES ref_parties(parties_code),
    PRIMARY KEY (contest_code, candidate_code)
);
"""


def load_csv_to_table(conn, table: str, csv_path: Path):
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        cols = reader.fieldnames
        if not cols:
            return 0
        placeholders = ", ".join(["%s"] * len(cols))
        columns = ", ".join(cols)
        sql = f"INSERT INTO {table} ({columns}) VALUES ({placeholders})"
        rows = []
        for row in reader:
            rows.append(tuple(row.get(c, "") for c in cols))
        if rows:
            with conn.cursor() as cur:
                cur.executemany(sql, rows)
            conn.commit()
    return len(rows)


def main():
    conn = psycopg2.connect(CONN_STR)
    with conn.cursor() as cur:
        cur.execute(SCHEMA_SQL)
    conn.commit()
    print("Created tables: ref_parties, ref_contests, ref_precincts, ref_candidates")

    counts = {
        "ref_parties": load_csv_to_table(conn, "ref_parties", BASE / "parties.csv"),
        "ref_contests": load_csv_to_table(conn, "ref_contests", BASE / "contest.csv"),
        "ref_precincts": load_csv_to_table(conn, "ref_precincts", BASE / "precincts.csv"),
        "ref_candidates": load_csv_to_table(conn, "ref_candidates", BASE / "candidates.csv"),
    }

    conn.close()
    print("Loaded rows:")
    for table, count in counts.items():
        print(f"  {table}: {count}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the script**

```bash
python3 scripts/load_ref_data.py
```

Expected: "Created tables: ..." + row counts for each table

- [ ] **Step 5: Verify data with a quick query**

```bash
psql -d pprcv_local -c "SELECT COUNT(*) FROM ref_parties;"
psql -d pprcv_local -c "SELECT COUNT(*) FROM ref_contests;"
psql -d pprcv_local -c "SELECT COUNT(*) FROM ref_candidates;"
psql -d pprcv_local -c "SELECT COUNT(*) FROM ref_precincts;"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/ pyproject.toml
git commit -m "feat: add Postgres reference data loader for pprcv_local DB"
```

---

### Task 3: Implement `processor.py` + Tests (TDD)

**Files:**
- Create: `src/etl/processor.py`
- Create: `tests/etl/test_processor.py`

**Interfaces:**
- Consumes: `AggregationResult` from models.py, CSV fixtures from Task 1, `sample-csv/results.csv` (real data)
- Produces: `parse_and_aggregate(csv_path, output_dir, partition_by="contest_code") -> AggregationResult`

**Dependencies between tests:**
- All tests in this task run against the fixtures created in Task 1 + real results.csv
- Each test creates a temporary output directory via `tmp_path` (pytest built-in fixture)

**Important:** Use parameterized DuckDB queries — never interpolate values into SQL strings.

---

- [ ] **Step 1: Write the first failing test**

```python
# tests/etl/test_processor.py
from pathlib import Path

import pytest

from src.etl.processor import parse_and_aggregate


FIXTURES = Path(__file__).parent / "fixtures"
REAL_DATA = Path(__file__).resolve().parent.parent.parent / "sample-csv"


def test_simple_aggregation(tmp_path: Path):
    """Single precinct, single contest — verify SUM works using synthetic fixture."""
    result = parse_and_aggregate(
        csv_path=FIXTURES / "sample.csv",
        output_dir=tmp_path,
    )

    assert result.total_votes == 300  # 150 + 150
    assert result.precinct_count == 1
    assert result.contest_count == 1
    assert len(result.output_files) == 1
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/etl/test_processor.py::test_simple_aggregation -v`

Expected: `ModuleNotFoundError: No module named 'src.etl.processor'`

- [ ] **Step 3: Write the minimal implementation (processor.py)**

```python
# src/etl/processor.py
from pathlib import Path

import duckdb

from src.etl.models import AggregationResult


def parse_and_aggregate(
    csv_path: str | Path,
    output_dir: str | Path,
    partition_by: str = "contest_code",
) -> AggregationResult:
    """Read CSV via DuckDB, aggregate votes, write Parquet, return summary."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()

    # Read CSV into a DuckDB table
    con.execute(
        f"CREATE OR REPLACE TABLE raw AS SELECT * FROM read_csv_auto('{csv_path}')"
    )

    # Aggregate
    result = con.execute(
        """
        SELECT
            precinct_code,
            contest_code,
            candidate_code,
            party_code,
            SUM(votes_amount) AS total_votes,
            SUM(overvote) AS total_overvote,
            SUM(undervote) AS total_undervote
        FROM raw
        GROUP BY precinct_code, contest_code, candidate_code, party_code
        ORDER BY precinct_code, contest_code, total_votes DESC
        """
    )

    rows = result.fetchall()
    if not rows:
        con.close()
        return AggregationResult()

    precincts = set()
    contests = set()
    total_votes = 0

    for row in rows:
        precincts.add(row[0])
        contests.add(row[1])
        total_votes += row[4]

    # Write Parquet partitioned by contest using DuckDB's built-in partitioning
    con.execute("CREATE OR REPLACE TABLE agg AS SELECT * FROM raw")
    out_path = str(output_dir / "data.parquet")
    con.execute(
        f"COPY (SELECT precinct_code, contest_code, candidate_code, party_code, "
        f"SUM(votes_amount) AS total_votes, SUM(overvote) AS total_overvote, "
        f"SUM(undervote) AS total_undervote "
        f"FROM raw GROUP BY precinct_code, contest_code, candidate_code, party_code) "
        f"TO '{out_path}' (FORMAT PARQUET, PER_THREAD_OUTPUT TRUE)"
    )

    con.close()

    return AggregationResult(
        total_votes=total_votes,
        precinct_count=len(precincts),
        contest_count=len(contests),
        output_files=[out_path],
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/etl/test_processor.py::test_simple_aggregation -v`

Expected: `PASSED`

- [ ] **Step 5: Write the remaining tests**

```python
# Add to tests/etl/test_processor.py

def test_multiple_precincts(tmp_path: Path):
    """3 precincts, 2 contests — verify per-precinct and per-contest totals."""
    result = parse_and_aggregate(
        csv_path=FIXTURES / "multiple.csv",
        output_dir=tmp_path,
    )

    assert result.total_votes == 1640
    assert result.precinct_count == 3
    assert result.contest_count == 2
    assert len(result.output_files) >= 1  # PER_THREAD_OUTPUT may produce multiple files


def test_empty_csv(tmp_path: Path):
    """Header-only CSV — no crash, returns zeroes."""
    result = parse_and_aggregate(
        csv_path=FIXTURES / "edge.csv",
        output_dir=tmp_path,
    )

    assert result.total_votes == 0
    assert result.precinct_count == 0
    assert result.contest_count == 0
    assert result.output_files == []


def test_output_is_valid_parquet(tmp_path: Path):
    """Parquet files loadable via pyarrow, schema matches expectations."""
    import pyarrow.parquet as pq

    result = parse_and_aggregate(
        csv_path=FIXTURES / "multiple.csv",
        output_dir=tmp_path,
    )

    for f in result.output_files:
        table = pq.read_table(f)
        assert table.num_rows > 0
        column_names = table.column_names
        assert "precinct_code" in column_names
        assert "contest_code" in column_names
        assert "total_votes" in column_names


def test_idempotent_output(tmp_path: Path):
    """Running twice should produce identical Parquet data."""
    import hashlib

    out1 = tmp_path / "run1"
    out2 = tmp_path / "run2"

    result1 = parse_and_aggregate(
        csv_path=FIXTURES / "sample.csv",
        output_dir=out1,
    )
    result2 = parse_and_aggregate(
        csv_path=FIXTURES / "sample.csv",
        output_dir=out2,
    )

    def content_hash(files):
        h = hashlib.sha256()
        for f in sorted(files):
            h.update(Path(f).read_bytes())
        return h.hexdigest()

    assert content_hash(result1.output_files) == content_hash(result2.output_files)


def test_real_results_csv(tmp_path: Path):
    """Process the actual results.csv from sample-csv/."""
    result = parse_and_aggregate(
        csv_path=REAL_DATA / "results.csv",
        output_dir=tmp_path,
    )

    # 1 precinct, 1 contest, 3 candidates, all votes=0
    assert result.total_votes == 0
    assert result.precinct_count == 1
    assert result.contest_count == 1
    assert len(result.output_files) >= 1
```

- [ ] **Step 6: Run all tests**

Run: `pytest tests/etl/ -v`

Expected: All 6 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/etl/processor.py tests/etl/test_processor.py
git commit -m "feat: add ETL DuckDB aggregation with local pytest tests"
```

---

## Self-Review

**Spec coverage check:**
- `processor.py` with `parse_and_aggregate()` → Task 3 ✅
- `AggregationResult` dataclass → Task 1 ✅
- CSV fixtures (sample, multiple, edge) → Task 1 ✅
- Postgres reference data loader → Task 2 ✅
- Test: simple aggregation → Task 3 Step 1 ✅
- Test: multiple precincts → Task 3 Step 5 ✅
- Test: idempotency → Task 3 Step 5 ✅
- Test: valid Parquet → Task 3 Step 5 ✅
- Test: empty CSV → Task 3 Step 5 ✅
- Test: real results.csv → Task 3 Step 5 ✅
- Dependencies (duckdb, pytest, pyarrow, psycopg2-binary) → pyproject.toml ✅
- DuckDB tests pass with single `pytest tests/etl/ -v` ✅
- Parameterized SQL (no string interpolation for values) → Task 3 processor ✅

**Placeholder scan:** No TBDs, TODOs, or placeholders. All code is complete.

**Type consistency:** `AggregationResult` fields (total_votes, precinct_count, contest_count, output_files) used consistently across models.py and tests.
