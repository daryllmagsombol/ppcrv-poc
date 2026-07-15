export interface CandidateVote {
  candidate: string;
  party: string;
  votes: number;
}

export interface ContestResult {
  contest_code: string;
  contest_name: string;
  category: string;
  candidates: CandidateVote[];
}

export interface Discrepancy {
  contest_code: string;
  contest_name: string;
  candidate: string;
  qr_votes: number;
  db_votes: number;
}

export interface ComparisonResult {
  precinct_id: string;
  qr_parsed: ContestResult[];
  db_results: ContestResult[];
  has_discrepancy: boolean;
  discrepancy_details: Discrepancy[];
}
