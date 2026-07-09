# USE: ETL Local Testing

## Prerequisites

```bash
pip install duckdb pytest pyarrow psycopg2-binary  # or:
pip install -e ".[dev]"
```

Postgres (`psycopg2-binary`) is only needed for loading reference data — the core DuckDB aggregation works without it.

---

## 1. Run Tests

```bash
pytest tests/etl/ -v
```

| Test | What it checks |
|------|---------------|
| `test_simple_aggregation` | 2 identical rows → SUM=300, 1 precinct, 1 contest |
| `test_multiple_precincts` | 10 rows, 3 precincts, 2 contests → SUM=1640 |
| `test_empty_csv` | Header-only → zero counts, no output files |
| `test_output_is_valid_parquet` | Parquet files readable with correct columns |
| `test_idempotent_output` | Same input → byte-identical output |
| `test_real_results_csv` | Real `sample-csv/results.csv` (all zeros → SUM=0) |

---

## 2. Aggregate CSV → Parquet

```python
from src.etl.processor import parse_and_aggregate

# Synthetic fixtures (you know the expected totals)
result = parse_and_aggregate("tests/etl/fixtures/multiple.csv", "output/")
print(result)
# AggregationResult(total_votes=1640, precinct_count=3, contest_count=2, ...)

# Real data
result = parse_and_aggregate("sample-csv/results.csv", "output/")
print(result)
```

One-liner:
```bash
python3 -c "from src.etl.processor import parse_and_aggregate; print(parse_and_aggregate('sample-csv/results.csv', 'output/'))"
```

---

## 3. Inspect Parquet Output

```bash
python3 -c "
import pyarrow.parquet as pq, glob
for f in sorted(glob.glob('output/**/*.parquet', recursive=True)):
    print(f'--- {f} ---')
    table = pq.ParquetFile(f).read()
    for col in table.column_names:
        print(f'  {col}: {table.column(col).to_pylist()}')
"
```

Example output:
```
--- output/contest_code=1199000/data.parquet ---
  precinct_code: ['1010017', '1010017', '1010017']
  contest_code: ['1199000', '1199000', '1199000']
  candidate_code: ['9900110002', '9900110001', '9900110003']
  party_code: ['9900110002', '9900110001', '9900110003']
  total_votes: [0.0, 0.0, 0.0]
  total_overvote: [0.0, 0.0, 0.0]
  total_undervote: [0.0, 0.0, 0.0]
```

> **Note:** Uses `ParquetFile().read()` + `to_pylist()` instead of `read_table()` + `to_pandas()` to avoid DuckDB dictionary encoding and missing pandas module issues.

---

## 4. Partition by a Different Column

```python
# Default: partition_by="contest_code"
parse_and_aggregate("data.csv", "out/")

# Partition by precinct instead
parse_and_aggregate("data.csv", "out/", partition_by="precinct_code")
```

Output directories: `out/precinct_code=001-A/data.parquet`, etc.

Works with any column present in the CSV.

---

## 5. Load Postgres Reference Data (Optional)

Requires a local Postgres instance with a `pprcv_local` database:

```bash
createdb pprcv_local
python3 scripts/load_ref_data.py
```

Loads 4 tables from `sample-csv/`:
| Table | Source | Rows |
|-------|--------|------|
| `ref_parties` | `sample-csv/parties.csv` | 339 |
| `ref_contests` | `sample-csv/contest.csv` | 5,645 |
| `ref_precincts` | `sample-csv/precincts.csv` | 93,629 |
| `ref_candidates` | `sample-csv/candidates.csv` | 41,647 |

Idempotent — safe to re-run (uses `DROP TABLE ... CASCADE` then recreate).

Note: Party-list candidates have empty `PARTIES_CODE`, which the script converts to SQL `NULL` to satisfy the foreign key constraint.

---

## 6. Clean Up

```bash
rm -rf output/
```

---

## Quick Reference

```bash
# Test
pytest tests/etl/ -v

# Run + inspect
python3 -c "from src.etl.processor import parse_and_aggregate; r=parse_and_aggregate('sample-csv/results.csv','output/'); print(r)"
python3 -c "import pyarrow.parquet as pq, glob; [print(f'--- {f} ---') or [print(f'  {c}: {table.column(c).to_pylist()}') for c in (table:=pq.ParquetFile(f).read()).column_names] for f in sorted(glob.glob('output/**/*.parquet', recursive=True))]"

# Load Postgres
python3 scripts/load_ref_data.py

# Clean
rm -rf output/
```
