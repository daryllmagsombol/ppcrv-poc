export class CandidateResult {
  rank: number;
  name: string;
  party: string;
  votes: number;
  percentage: number;
}

export class ResultsResponse {
  level: string;
  filters: Record<string, string>;
  totalVotes: number;
  candidates: CandidateResult[];
  totals: {
    votesCast: number;
    overVotes: number;
    underVotes: number;
  };
}
