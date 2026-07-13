export class CandidateResult {
  rank!: number;
  name!: string;
  party!: string;
  votes!: number;
  percentage!: number;
}

export class ContestGroup {
  code!: string;
  name!: string;
  category!: string;
  totalVotes!: number;
  candidates!: CandidateResult[];
  totals!: {
    votesCast: number;
    overVotes: number;
    underVotes: number;
  };
}

export class ResultsResponse {
  level!: string;
  filters!: Record<string, string>;
  contests!: ContestGroup[];
}
