from pathlib import Path
import pyarrow.parquet as pq

import pytest

from src.etl.aggregator import aggregate_all_levels


FIXTURES = Path(__file__).parent / "fixtures"


def test_multi_level_sums_match(tmp_path: Path):
    """Verify that national total == sum of region totals for each contest."""
    result = aggregate_all_levels(
        csv_path=FIXTURES / "multiple.csv",
        precincts_path=FIXTURES / "precincts.csv",
        output_dir=tmp_path,
    )

    assert "national" in result.levels
    assert "region" in result.levels
    assert "province" in result.levels
    assert "municipality" in result.levels
    assert "barangay" in result.levels
    assert "precinct" in result.levels

    # total_votes across all rows = 150+100+200+180+90+250+200+120+300+50 = 1640
    assert result.levels["national"].total_votes == 1640


def test_level_hierarchy_rollup(tmp_path: Path):
    """Verify rollup: precinct sums -> barangay -> municipality -> province -> region -> national."""
    result = aggregate_all_levels(
        csv_path=FIXTURES / "multiple.csv",
        precincts_path=FIXTURES / "precincts.csv",
        output_dir=tmp_path,
    )

    national = result.levels["national"].total_votes
    assert result.levels["region"].total_votes == national
    assert result.levels["province"].total_votes == national
    assert result.levels["municipality"].total_votes == national
    assert result.levels["barangay"].total_votes == national
    assert result.levels["precinct"].total_votes == national


def test_level_partitions_valid(tmp_path: Path):
    """Each level writes valid partitioned Parquet with correct columns."""
    result = aggregate_all_levels(
        csv_path=FIXTURES / "multiple.csv",
        precincts_path=FIXTURES / "precincts.csv",
        output_dir=tmp_path,
    )

    for level_name, level_result in result.levels.items():
        assert len(level_result.output_files) > 0
        for f in level_result.output_files:
            pf = pq.ParquetFile(f)
            table = pf.read()
            assert table.num_rows > 0
            cols = table.column_names
            assert "contest_code" not in cols  # partition column, not in file
            assert "total_votes" in cols


def test_level_geographic_columns(tmp_path: Path):
    """Each level has the right geographic columns."""
    result = aggregate_all_levels(
        csv_path=FIXTURES / "multiple.csv",
        precincts_path=FIXTURES / "precincts.csv",
        output_dir=tmp_path,
    )

    for lvl, geo_cols in [
        ("national", []),
        ("region", ["reg_name"]),
        ("province", ["reg_name", "prv_name"]),
        ("municipality", ["reg_name", "prv_name", "mun_name"]),
        ("barangay", ["reg_name", "prv_name", "mun_name", "brgy_name"]),
        ("precinct", ["reg_name", "prv_name", "mun_name", "brgy_name", "pollplace"]),
    ]:
        level = result.levels[lvl]
        assert level.row_count > 0, f"{lvl} has no rows"
        pf = pq.ParquetFile(level.output_files[0])
        table = pf.read()
        for col in geo_cols:
            assert col in table.column_names, f"{lvl} missing column {col}"


def test_sample_mode(tmp_path: Path):
    """Sampling produces a subset with correct structure."""
    result = aggregate_all_levels(
        csv_path=FIXTURES / "multiple.csv",
        precincts_path=FIXTURES / "precincts.csv",
        output_dir=tmp_path,
        sample=5,
    )

    assert "national" in result.levels
    assert len(result.levels["national"].output_files) > 0


def test_empty_csv(tmp_path: Path):
    """Empty CSV produces zero-row output for all levels."""
    result = aggregate_all_levels(
        csv_path=FIXTURES / "edge.csv",
        precincts_path=FIXTURES / "precincts.csv",
        output_dir=tmp_path,
    )

    for level in result.levels.values():
        assert level.total_votes == 0
        assert level.row_count == 0


def test_unmatched_precincts(tmp_path: Path):
    """Precinct codes not in precincts CSV get NULL geography but still appear."""
    result = aggregate_all_levels(
        csv_path=FIXTURES / "real-sample.csv",
        precincts_path=FIXTURES / "precincts.csv",
        output_dir=tmp_path,
    )

    # All 4 rows have 10010001 which doesn't match any CLUSTERED_PREC
    # They should be grouped under NULL geographic fields
    assert result.levels["national"].total_votes == 883
    assert result.levels["region"].total_votes == 883