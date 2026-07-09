from dataclasses import dataclass, field


@dataclass
class AggregationResult:
    """Result from parse_and_aggregate()."""

    total_votes: int = 0
    precinct_count: int = 0
    contest_count: int = 0
    output_files: list[str] = field(default_factory=list)
