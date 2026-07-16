export interface GeoStatusData {
  name: string;
  totalPrecincts: number;
  reportedPrecincts: number;
  completionRate: number;
}

export interface VoteShareCandidate {
  name: string;
  party: string;
  votes: number;
  percentage: number;
}

export interface VoteShareData {
  contest: string;
  contestName: string;
  totalVotes: number;
  candidates: VoteShareCandidate[];
}

export interface UndervoteData {
  totalVotes: number;
  totalUndervotes: number;
  totalOvervotes: number;
  undervoteRate: number;
  overvoteRate: number;
}