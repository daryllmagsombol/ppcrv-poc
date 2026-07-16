export interface RegionStatus {
  name: string;
  totalPrecincts: number;
  reportedPrecincts: number;
  completionRate: number;
}

export interface ProvinceStatus {
  name: string;
  totalPrecincts: number;
  reportedPrecincts: number;
  completionRate: number;
}

export interface CityStatus {
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

export interface VoteShareResponse {
  contest: string;
  contestName: string;
  totalVotes: number;
  candidates: VoteShareCandidate[];
}

export interface UndervoteResponse {
  totalVotes: number;
  totalUndervotes: number;
  totalOvervotes: number;
  undervoteRate: number;
  overvoteRate: number;
}

export interface GeoSelection {
  level: 'national' | 'region' | 'province' | 'city';
  region?: string;
  province?: string;
  city?: string;
}
