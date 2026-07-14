# USE: ETL Local Testing

## Prerequisites

```bash
pip install duckdb pytest pyarrow psycopg2-binary  # or:
pip install -e ".[dev]"
```

Postgres (`psycopg2-binary`) is only needed for loading reference data — the core DuckDB aggregation works without it.

---

## 1. Aggregate CSV → Parquet (6 Geographic Levels)

The multi-level aggregator reads results + precincts CSVs, joins on precinct code, and aggregates votes at 6 levels:

```bash
python3 scripts/run_aggregation.py sample-csv/results.csv sample-csv/precincts.csv output/
```

**Output:** `output/national/`, `output/region/`, `output/province/`, `output/municipality/`, `output/barangay/`, `output/precinct/` — each Hive-partitioned by `contest_code`.

### Sample mode (fast dev iteration)

```bash
python3 scripts/run_aggregation.py sample-csv/results.csv sample-csv/precincts.csv output/ --sample 100000
```

### Performance notes

| Dataset | Time | Memory |
|---------|------|--------|
| Full 24M rows, 1.14B votes, 6 levels | ~1 min 40 s | ~6 GB |
| Sample 100K rows | ~5 s | Minimal |

The aggregator streams CSV→JOIN→GROUP BY→Parquet without materializing intermediate tables. Each level gets its own DuckDB connection so memory is freed between levels.

Memory tuning (set in `aggregator.py`):
- `SET memory_limit='6GB'`
- `SET threads=2`
- `SET preserve_insertion_order=false`
- `SET temp_directory='<output>/\_duckdb_temp'`

---

## 2. Run Tests

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
| `test_sample_mode` | `sample=5` → only 5 rows processed |
| `test_invalid_precinct_join` | 0% precinct match → no crash, 0 votes |
| `test_no_duplicate_rows_multi_level` | Duplicate rows → only aggregated once |
| `test_full_multi_level_happy_path` | 5 rows, 2 precincts, 2 contests → checks all 6 levels |

---

## 3. Inspect Parquet Output

### Quick summary (fast — one pass)

```bash
python3 -c "
import duckdb
con = duckdb.connect()
for row in con.execute(\"\"\"
    SELECT contest_code, COUNT(*) AS rows, SUM(total_votes) AS votes
    FROM read_parquet('output/national/**/*.parquet')
    GROUP BY contest_code ORDER BY contest_code
\"\"\").fetchall():
    print(f'  contest={row[0]:>10}  rows={row[1]:>6}  votes={row[2]:>10}')
con.close()
"
```

### Check a specific level

```bash
# National level
duckdb -c "SELECT COUNT(*), ROUND(SUM(total_votes)) FROM read_parquet('output/national/**/*.parquet')"

# Region level
duckdb -c "SELECT COUNT(*), ROUND(SUM(total_votes)) FROM read_parquet('output/region/**/*.parquet')"
```

### Compare against raw CSV total

```bash
# Raw CSV total
duckdb -c "SELECT SUM(CAST(votes_amount AS BIGINT)) FROM read_csv_auto('sample-csv/results.csv')"

# Parquet national total (should match)
duckdb -c "SELECT ROUND(SUM(total_votes)) FROM read_parquet('output/national/**/*.parquet')"
```

All 6 levels should have the same total votes — only the row granularity differs:

| Level | Rows (approx) |
|-------|--------------|
| national | 41K |
| region | 46K |
| province | 62K |
| municipality | 439K |
| barangay | 10.7M |
| precinct | 11.3M |

---

## 4. Output Structure

```
output/
├── national/            ← 41K rows, 1 level of grouping
│   ├── contest_code=00399000/
│   │   └── data_0.parquet
│   ├── contest_code=00401000/
│   │   └── data_0.parquet
│   └── ...
├── region/              ← 46K rows, adds reg_name
├── province/            ← 62K rows, adds reg_name + prv_name
├── municipality/        ← 439K rows, adds reg_name + prv_name + mun_name
├── barangay/            ← 10.7M rows, adds brgy_name
└── precinct/            ← 11.3M rows, adds pollplace (voting center)
```

---

## 5. API Integration

The NestJS API reads the **national-level** Parquet files at `output/national/`:

```
NestJS → execSync("duckdb -json -c \"SELECT ... FROM 'output/national/**/*.parquet'\"")
```

Set `PARQUET_BASE_PATH` env var to override the default (project root `output/`).

---

## 6. Load Postgres Reference Data (Optional)

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

## 7. Clean Up

```bash
rm -rf output/
```

---

## Quick Reference

```bash
# Test
pytest tests/etl/ -v

# Run (full dataset, 6 levels)
python3 scripts/run_aggregation.py sample-csv/results.csv sample-csv/precincts.csv output/

# Run (sample)
python3 scripts/run_aggregation.py sample-csv/results.csv sample-csv/precincts.csv output/ --sample 100000

# Inspect national total
duckdb -c "SELECT ROUND(SUM(total_votes)) FROM read_parquet('output/national/**/*.parquet')"

# Compare with CSV
duckdb -c "SELECT SUM(CAST(votes_amount AS BIGINT)) FROM read_csv_auto('sample-csv/results.csv')"

# Load Postgres
python3 scripts/load_ref_data.py          # skip if loaded
python3 scripts/load_ref_data.py --fresh   # force reload

# Clean
rm -rf output/
```
