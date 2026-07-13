from __future__ import annotations

from pathlib import Path
from typing import Optional

import duckdb

from src.etl.models import LevelResult, MultiLevelAggregationResult


def _collect_parquet_files(root: Path) -> list[str]:
    """Return sorted list of Parquet files under *root* (recursive glob)."""
    return sorted(str(p) for p in root.rglob("*.parquet"))


LEVEL_CONFIG = [
    ("national", ["contest_code", "candidate_name", "party_code"]),
    ("region", ["contest_code", "reg_name", "candidate_name", "party_code"]),
    (
        "province",
        ["contest_code", "reg_name", "prv_name", "candidate_name", "party_code"],
    ),
    (
        "municipality",
        ["contest_code", "reg_name", "prv_name", "mun_name", "candidate_name", "party_code"],
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
    ),
]


def _join_query(csv_path: str | Path, precincts_path: str | Path, sample: Optional[int] = None) -> str:
    """Return a SQL subquery that joins results with precincts on the fly."""
    csv_source = (
        f"read_csv_auto('{csv_path}')"
        if sample is None
        else f"(SELECT * FROM read_csv_auto('{csv_path}') USING SAMPLE {sample} ROWS)"
    )
    return (
        f"SELECT "
        f"  r.contest_code::VARCHAR AS contest_code, "
        f"  r.candidate_name::VARCHAR AS candidate_name, "
        f"  r.party_code::VARCHAR AS party_code, "
        f"  CAST(r.votes_amount AS INTEGER) AS votes_amount, "
        f"  CAST(r.over_votes AS INTEGER) AS over_votes, "
        f"  CAST(r.under_votes AS INTEGER) AS under_votes, "
        f"  p.reg_name::VARCHAR AS reg_name, "
        f"  p.prv_name::VARCHAR AS prv_name, "
        f"  p.mun_name::VARCHAR AS mun_name, "
        f"  p.brgy_name::VARCHAR AS brgy_name, "
        f"  p.pollplace::VARCHAR AS pollplace "
        f"FROM {csv_source} r "
        f"LEFT JOIN read_csv_auto('{precincts_path}') p "
        f"  ON LPAD(r.precinct_code::VARCHAR, 8, '0') = LPAD(p.clustered_prec::VARCHAR, 8, '0')"
    )


def aggregate_all_levels(
    csv_path: str | Path,
    precincts_path: str | Path,
    output_dir: str | Path,
    sample: Optional[int] = None,
) -> MultiLevelAggregationResult:
    """Read results CSV, join with precinct hierarchy, aggregate at 6 levels.

    Memory-efficient: streams CSV→JOIN→GROUP BY→Parquet without staging tables.
    Each level is processed independently, dropping intermediate state after COPY.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    temp_dir = output_dir / "_duckdb_temp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    results: dict[str, LevelResult] = {}

    for level_name, group_cols in LEVEL_CONFIG:
        level_dir = output_dir / level_name
        level_dir.mkdir(parents=True, exist_ok=True)

        # Fresh connection per level to avoid accumulating memory
        con = duckdb.connect()
        try:
            con.execute("SET memory_limit='6GB'")
            con.execute("SET threads=2")
            con.execute("SET preserve_insertion_order=false")
            con.execute(f"SET temp_directory='{str(temp_dir).replace(chr(39), chr(39)*2)}'")

            select_exprs = ", ".join(group_cols)
            join_source = _join_query(csv_path, precincts_path, sample)

            agg_and_copy_sql = (
                f"COPY ("
                f"  SELECT {select_exprs}, "
                f"    SUM(votes_amount) AS total_votes, "
                f"    SUM(over_votes) AS total_over_votes, "
                f"    SUM(under_votes) AS total_under_votes "
                f"  FROM ({join_source}) sub "
                f"  GROUP BY {', '.join(group_cols)}"
                f") TO '{level_dir}' "
                f"(FORMAT PARQUET, PARTITION_BY contest_code)"
            )
            con.execute(agg_and_copy_sql)

            # Compute stats from the written Parquet files
            parquet_files = _collect_parquet_files(level_dir)
            if parquet_files:
                stats = con.execute(
                    f"SELECT "
                    f"  COUNT(*) AS row_count, "
                    f"  CAST(COALESCE(SUM(total_votes), 0) AS BIGINT) AS total_votes, "
                    f"  CAST(COALESCE(SUM(total_over_votes), 0) AS BIGINT) AS total_over_votes, "
                    f"  CAST(COALESCE(SUM(total_under_votes), 0) AS BIGINT) AS total_under_votes "
                    f"FROM read_parquet('{level_dir}/**/*.parquet')"
                ).fetchone()
            else:
                stats = (0, 0, 0, 0)

            results[level_name] = LevelResult(
                total_votes=stats[1],
                total_over_votes=stats[2],
                total_under_votes=stats[3],
                row_count=stats[0],
                output_files=parquet_files,
            )

        finally:
            con.close()

    return MultiLevelAggregationResult(levels=results)
