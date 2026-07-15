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

export interface VcmMetadata {
  /** VCM device type (e.g., "12") */
  type: string;
  /** Precinct ID from the report */
  precinct_id: string;
  /** SHA hash of the full printed report */
  report_hash: string;
  /** SHA hash of just the election results */
  result_hash: string;
  /** Voter turnout statistics */
  registered_voters: number;
  cast_ballots: number;
  remaining_ballots: number;
  voter_turnout_pct: number;
}

export interface ComparisonResult {
  precinct_id: string;
  region?: string;
  province?: string;
  municipality?: string;
  barangay?: string;
  pollplace?: string;
  qr_parsed: ContestResult[];
  db_results: ContestResult[];
  has_discrepancy: boolean;
  discrepancy_details: Discrepancy[];
  /** Parsed metadata from QR3, if available */
  qr_metadata?: VcmMetadata;
}
