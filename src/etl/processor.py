from __future__ import annotations

from pathlib import Path

import duckdb

from src.etl.models import AggregationResult


def _collect_parquet_files(root: Path) -> list[str]:
    """Return sorted list of Parquet files under *root* (recursive glob)."""
    return sorted(str(p) for p in root.rglob("*.parquet"))


def parse_and_aggregate(
    csv_path: str | Path,
    output_dir: str | Path,
    partition_by: str = "contest_code",
) -> AggregationResult:
    csv_path_str = str(csv_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()
    try:
        # 1. Load CSV once into a materialised table
        con.execute(
            f"CREATE TABLE raw_data AS "
            f"SELECT * FROM read_csv_auto('{csv_path_str}')"
        )

        # 2. Aggregate once — after this, raw data is no longer needed
        con.execute(
            "CREATE TABLE agg_data AS "
            "SELECT "
            "precinct_code::VARCHAR AS precinct_code, "
            "contest_code::VARCHAR AS contest_code, "
            "candidate_name::VARCHAR AS candidate_name, "
            "party_code::VARCHAR AS party_code, "
            "SUM(CAST(votes_amount AS INTEGER)) AS total_votes, "
            "SUM(CAST(over_votes AS INTEGER)) AS total_over_votes, "
            "SUM(CAST(under_votes AS INTEGER)) AS total_under_votes "
            "FROM raw_data "
            "GROUP BY precinct_code, contest_code, candidate_name, party_code"
        )

        # 3. Collect summary totals from the aggregated table
        stats = con.execute(
            "SELECT "
            "COUNT(DISTINCT precinct_code) AS precinct_count, "
            "COUNT(DISTINCT contest_code) AS contest_count, "
            "COALESCE(SUM(total_votes), 0) AS total_votes "
            "FROM agg_data"
        ).fetchone()

        # Graceful empty-data path (header-only CSV, etc.)
        if stats[0] == 0:
            return AggregationResult()

        # 4. Single-pass partitioned Parquet write — DuckDB handles the loop
        con.execute(
            f"COPY agg_data TO '{output_dir}' "
            f"(FORMAT PARQUET, PARTITION_BY {partition_by})"
        )

        # 5. Collect what was written
        output_files = _collect_parquet_files(output_dir)

        return AggregationResult(
            total_votes=stats[2],
            precinct_count=stats[0],
            contest_count=stats[1],
            output_files=output_files,
        )
    finally:
        con.close()