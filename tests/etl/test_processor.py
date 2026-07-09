from pathlib import Path

import pytest

from src.etl.processor import parse_and_aggregate


FIXTURES = Path(__file__).parent / "fixtures"


def test_simple_aggregation(tmp_path: Path):
    result = parse_and_aggregate(
        csv_path=FIXTURES / "sample.csv",
        output_dir=tmp_path,
    )

    assert result.total_votes == 300
    assert result.precinct_count == 1
    assert result.contest_count == 1
    assert len(result.output_files) == 1


def test_multiple_precincts(tmp_path: Path):
    result = parse_and_aggregate(
        csv_path=FIXTURES / "multiple.csv",
        output_dir=tmp_path,
    )

    assert result.total_votes == 1640
    assert result.precinct_count == 3
    assert result.contest_count == 2
    assert len(result.output_files) == 2


def test_empty_csv(tmp_path: Path):
    result = parse_and_aggregate(
        csv_path=FIXTURES / "edge.csv",
        output_dir=tmp_path,
    )

    assert result.total_votes == 0
    assert result.precinct_count == 0
    assert result.contest_count == 0
    assert result.output_files == []


def test_output_is_valid_parquet(tmp_path: Path):
    import pyarrow.parquet as pq

    result = parse_and_aggregate(
        csv_path=FIXTURES / "multiple.csv",
        output_dir=tmp_path,
    )

    for f in result.output_files:
        pf = pq.ParquetFile(f)
        table = pf.read()
        assert table.num_rows > 0
        column_names = table.column_names
        assert "precinct_code" in column_names
        assert "contest_code" in column_names
        assert "total_votes" in column_names


def test_idempotent_output(tmp_path: Path):
    import hashlib

    out1 = tmp_path / "run1"
    out2 = tmp_path / "run2"

    result1 = parse_and_aggregate(
        csv_path=FIXTURES / "sample.csv",
        output_dir=out1,
    )
    result2 = parse_and_aggregate(
        csv_path=FIXTURES / "sample.csv",
        output_dir=out2,
    )

    def content_hash(files):
        h = hashlib.sha256()
        for f in sorted(files):
            h.update(Path(f).read_bytes())
        return h.hexdigest()

    assert content_hash(result1.output_files) == content_hash(result2.output_files)


def test_real_results_csv(tmp_path: Path):
    """Real-data sample: 4 rows, same precinct/contest, 4 candidates.
    Expected: SUM=242+234+217+190=883, 1 precinct, 1 contest.
    """
    result = parse_and_aggregate(
        csv_path=FIXTURES / "real-sample.csv",
        output_dir=tmp_path,
    )

    assert result.total_votes == 883
    assert result.precinct_count == 1
    assert result.contest_count == 1
    # Use >= 1 to tolerate DuckDB splitting a partition into multiple files
    assert len(result.output_files) >= 1