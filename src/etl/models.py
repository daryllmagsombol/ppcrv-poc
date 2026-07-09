from dataclasses import dataclass, field
from typing import Optional


@dataclass
class AggregationResult:
    """Result from parse_and_aggregate() — single-level (existing)."""

    total_votes: int = 0
    precinct_count: int = 0
    contest_count: int = 0
    output_files: list[str] = field(default_factory=list)


@dataclass
class LevelResult:
    """Stats for one aggregation level."""

    total_votes: int = 0
    total_over_votes: int = 0
    total_under_votes: int = 0
    row_count: int = 0
    output_files: list[str] = field(default_factory=list)


@dataclass
class MultiLevelAggregationResult:
    """Result from aggregate_all_levels()."""

    levels: dict[str, LevelResult] = field(default_factory=dict)
