# ETL Local Testing — Design Spec

**Date:** 2026-07-09
**Status:** Approved
**Project:** PPCRV v3 Election Monitoring Platform

---

## Problem

The ETL pipeline processes 32M+ CSV rows per election using DuckDB for in-memory aggregation. We need a fast, dependency-free local testing setup to validate the core aggregation logic before layering on Redis queue integration, cloud storage, and container orchestration.

## Scope

**In scope:** Pure DuckDB CSV parsing → aggregation → Parquet output. pytest-based tests with CSV fixtures.

**Out of scope:** Redis queue lifecycle (BRPOP, LPUSH, pub/sub), S3/GCS/Blob storage, Docker containers, Lambda triggers, production deployment.

---

## File Layout

```
src/
  etl/
    __init__.py
    processor.py          # parse_and_aggregate() — pure DuckDB logic
    models.py             # Data classes (shared, if not already present)

tests/
  etl/
    __init__.py
    fixtures/
      sample.csv          # 1 precinct, 1 contest, 1 candidate — happy path
      multiple.csv        # 3 precincts, 2 contests, multiple candidates
      edge.csv            # Zero votes, missing optional columns
    test_processor.py     # pytest tests
```

---

## Core Function

### `processor.py`

```python
def parse_and_aggregate(
    csv_path: str | Path,
    output_dir: str | Path,
    partition_by: str = "contest_code"
) -> AggregationResult:
    """
    Read CSV via DuckDB, aggregate votes by (precinct, contest, candidate),
    write Parquet to output_dir, return summary with row counts and file paths.
    """
```

Return type:

```python
@dataclass
class AggregationResult:
    total_votes: int
    precinct_count: int
    contest_count: int
    output_files: list[str]
```

**SQL logic:**
```sql
SELECT
    precinct_code,
    contest_code,
    candidate_code,
    party_code,
    SUM(votes_amount) AS total_votes,
    SUM(overvote) AS total_overvote,
    SUM(undervote) AS total_undervote
FROM read_csv_auto(:csv_path)
GROUP BY precinct_code, contest_code, candidate_code, party_code
ORDER BY precinct_code, contest_code, total_votes DESC
```

---

## Test Plan

| Test | Fixture | Assertion |
|------|---------|-----------|
| `test_simple_aggregation` | `sample.csv` (1 prec, 1 contest, 1 candidate) | total_votes == hand-calculated sum |
| `test_multiple_precincts` | `multiple.csv` (3 prec, 2 contests, 5 candidates) | Per-precinct totals + per-contest totals match |
| `test_idempotent_output` | `sample.csv` run twice | Output files identical (checksum) |
| `test_output_is_valid_parquet` | Any fixture | Parquet files loadable via pyarrow, schema matches |
| `test_empty_csv` | CSV with header only | AggregationResult with zero counts, no crash |
| `test_optional_columns` | CSV missing overvote/undervote | Graceful handling (default 0 or column absent) |

---

## Dependencies

Add to project:

```
duckdb>=1.0
pytest>=8.0
pyarrow>=15.0    # only needed for test assertions
```

No Docker, no Redis, no cloud SDKs.

---

## CI Compatibility

Tests run with a single `pytest tests/etl/ -v` command. No services, no Docker daemon, no cloud credentials. Suitable for pre-commit hooks and GitHub Actions.

---

## Out of Scope (Future Phases)

- Redis integration tests (ETL worker loop with `redis-py`)
- StorageClient interface tests (MinIO or moto)
- Container-level integration tests (Docker Compose)
- Performance / benchmark tests
