#!/usr/bin/env python3
"""CLI entry point for multi-level aggregation.

Usage:
    python scripts/run_aggregation.py results.csv precincts.csv output/ [--sample N]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.etl.aggregator import aggregate_all_levels


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Aggregate election results at multiple geographic levels."
    )
    parser.add_argument("csv_path", type=Path, help="Path to results CSV")
    parser.add_argument("precincts_path", type=Path, help="Path to precincts reference CSV")
    parser.add_argument("output_dir", type=Path, help="Output directory for Parquet files")
    parser.add_argument(
        "--sample", type=int, default=None,
        help="Optional: number of rows to sample (for fast dev iteration)"
    )
    args = parser.parse_args()

    result = aggregate_all_levels(
        csv_path=args.csv_path,
        precincts_path=args.precincts_path,
        output_dir=args.output_dir,
        sample=args.sample,
    )

    print("=== Aggregation Complete ===")
    for level_name, level in sorted(result.levels.items()):
        print(
            f"  {level_name:>12s}: "
            f"{int(round(level.total_votes)):>10,d} votes, "
            f"{level.row_count:>8,d} rows, "
            f"{len(level.output_files):>3d} files"
        )
    national = result.levels.get("national")
    if national:
        print(f"\nTotal votes (national): {national.total_votes:,}")


if __name__ == "__main__":
    main()
