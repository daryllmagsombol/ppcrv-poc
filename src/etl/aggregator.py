from __future__ import annotations

from pathlib import Path
from typing import Optional

import duckdb

from src.etl.models import LevelResult, MultiLevelAggregationResult


def _collect_parquet_files(root: Path) -> list[str]:
    """Return sorted list of Parquet files under *root* (recursive glob)."""
    return sorted(str(p) for p in root.rglob("*.parquet"))


LEVEL_CONFIG = [
    ("national", ["contest_code", "candidate_name", "party_code"], []),
    ("region", ["contest_code", "reg_name", "candidate_name", "party_code"], ["reg_name"]),
    (
        "province",
        ["contest_code", "reg_name", "prv_name", "candidate_name", "party_code"],
        ["reg_name", "prv_name"],
    ),
    (
        "municipality",
        ["contest_code", "reg_name", "prv_name", "mun_name", "candidate_name", "party_code"],
        ["reg_name", "prv_name", "mun_name"],
    ),
    (
        "barangay",
        [
            "contest_code",
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
            "contest_code",
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

        con.execute(
            f"CREATE TABLE ref_precincts AS "
            f"SELECT * FROM read_csv_auto('{precincts_path}')"
        )

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
            "  ON LPAD(r.precinct_code::VARCHAR, 8, '0') = LPAD(p.clustered_prec::VARCHAR, 8, '0')"
        )

        results: dict[str, LevelResult] = {}

        for level_name, group_cols, _geo_cols in LEVEL_CONFIG:
            level_dir = output_dir / level_name
            level_dir.mkdir(parents=True, exist_ok=True)

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

            con.execute(
                f"COPY agg_{level_name} TO '{level_dir}' "
                f"(FORMAT PARQUET, PARTITION_BY contest_code)"
            )

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