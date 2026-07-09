from __future__ import annotations

from pathlib import Path

import duckdb

from src.etl.models import AggregationResult


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
        # Materialize CSV once — avoids re-scanning the file per partition
        con.execute(
            f"CREATE TABLE raw_data AS "
            f"SELECT * FROM read_csv_auto('{csv_path_str}')"
        )

        # Aggregate once into a temporary table, lowercase columns for Parquet compat
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

        rows = con.execute(
            "SELECT * FROM agg_data "
            "ORDER BY precinct_code, contest_code, total_votes DESC"
        ).fetchall()

        if not rows:
            return AggregationResult()

        precincts = set()
        contests = set()
        total_votes_count = 0

        for row in rows:
            precincts.add(row[0])
            contests.add(row[1])
            total_votes_count += row[4]

        # Derive partition values from the aggregated table
        distinct_values = con.execute(
            f"SELECT DISTINCT {partition_by} FROM agg_data ORDER BY 1"
        ).fetchall()
        distinct_values = [r[0] for r in distinct_values]

        output_files = []
        for val in distinct_values:
            out_path = output_dir / f"{partition_by}={val}" / "data.parquet"
            out_path.parent.mkdir(parents=True, exist_ok=True)
            con.execute(
                f"COPY ("
                f"SELECT * FROM agg_data WHERE {partition_by} = ?"
                f") TO '{out_path}' (FORMAT PARQUET)",
                [val],
            )
            output_files.append(str(out_path))

        return AggregationResult(
            total_votes=total_votes_count,
            precinct_count=len(precincts),
            contest_count=len(contests),
            output_files=sorted(output_files),
        )
    finally:
        con.close()