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

    con.execute(
        f"CREATE OR REPLACE VIEW csv_data AS "
        f"SELECT * FROM read_csv_auto('{csv_path_str}')"
    )

    rows = con.execute(
        """
        SELECT
            precinct_code,
            contest_code,
            candidate_code,
            party_code,
            SUM(CAST(votes_amount AS INTEGER)) AS total_votes,
            SUM(CAST(overvote AS INTEGER)) AS total_overvote,
            SUM(CAST(undervote AS INTEGER)) AS total_undervote
        FROM csv_data
        GROUP BY precinct_code, contest_code, candidate_code, party_code
        ORDER BY precinct_code, contest_code, total_votes DESC
        """
    ).fetchall()

    if not rows:
        con.close()
        return AggregationResult()

    precincts = set()
    contests = set()
    total_votes_count = 0

    for row in rows:
        precincts.add(row[0])
        contests.add(row[1])
        total_votes_count += row[4]

    output_files = []
    for contest in contests:
        out_path = output_dir / f"{partition_by}={contest}" / "data.parquet"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        con.execute(
            f"COPY ("
            f"SELECT precinct_code::VARCHAR AS precinct_code, "
            f"contest_code::VARCHAR AS contest_code, "
            f"candidate_code::VARCHAR AS candidate_code, "
            f"party_code::VARCHAR AS party_code, "
            f"SUM(CAST(votes_amount AS INTEGER)) AS total_votes, "
            f"SUM(CAST(overvote AS INTEGER)) AS total_overvote, "
            f"SUM(CAST(undervote AS INTEGER)) AS total_undervote "
            f"FROM csv_data WHERE contest_code = ? "
            f"GROUP BY precinct_code, contest_code, candidate_code, party_code"
            f") TO '{out_path}' (FORMAT PARQUET)",
            [contest],
        )
        output_files.append(str(out_path))

    con.close()

    return AggregationResult(
        total_votes=total_votes_count,
        precinct_count=len(precincts),
        contest_count=len(contests),
        output_files=sorted(output_files),
    )