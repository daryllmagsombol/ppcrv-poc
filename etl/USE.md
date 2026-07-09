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
| `test_real_results_csv` | Real-data sample (4 rows, 4 candidates → SUM=883, 1 precinct) |

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
--- output/contest_code=1010010/data.parquet ---
  precinct_code: ['10010001', '10010001', '10010001', '10010001']
  contest_code: ['1010010', '1010010', '1010010', '1010010']
  candidate_name: ['ANDAL, GLENN (LAKAS)', 'BALBA, JAY JAY (LAKAS)', 'CACAO, VIONG (NPC)', 'CARINGAL, KIDLAT (NPC)']
  party_code: ['28', '28', '34', '34']
  total_votes: [242.0, 234.0, 217.0, 190.0]
  total_over_votes: [16.0, 16.0, 16.0, 16.0]
  total_under_votes: [748.0, 748.0, 748.0, 748.0]
```

> **Note:** Uses `ParquetFile().read()` + `to_pylist()` instead of `read_table()` + `to_pandas()` to avoid DuckDB dictionary encoding and missing pandas issues.

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
python3 scripts/load_ref_data.py          # skip if already loaded
python3 scripts/load_ref_data.py --fresh   # force drop + reload
```

Loads 4 tables from `sample-csv/`:
| Table | Source | Rows |
|-------|--------|------|
| `ref_parties` | `sample-csv/parties.csv` | 339 |
| `ref_contests` | `sample-csv/contest.csv` | 5,645 |
| `ref_precincts` | `sample-csv/precincts.csv` | 93,629 |
| `ref_candidates` | `sample-csv/candidates.csv` | 41,647 |

Default (no flag) checks if data already exists — skips if loaded.  
Use `--fresh` to drop, recreate, and reload from scratch.

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
python3 scripts/load_ref_data.py          # skip if loaded
python3 scripts/load_ref_data.py --fresh   # force reload

# Clean
rm -rf output/
```
