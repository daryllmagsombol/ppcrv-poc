import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { RedisService } from '../redis/redis.service';

// --- Public response types (unchanged) ---

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

export interface UndervoteResponse {
  totalVotes: number;
  totalUndervotes: number;
  totalOvervotes: number;
  undervoteRate: number;
  overvoteRate: number;
}

export interface VoteShareResponse {
  contest: string;
  contestName: string;
  totalVotes: number;
  candidates: VoteShareCandidate[];
}

// --- Helpers ---

function buildGeoLevel(params: { reg?: string; prv?: string; mun?: string }): string {
  if (params.mun) return 'mun';
  if (params.prv) return 'prv';
  if (params.reg) return 'reg';
  return 'nat';
}

function buildGeoKey(level: string, params: { reg?: string; prv?: string; mun?: string }): string {
  switch (level) {
    case 'nat': return '';
    case 'reg': return `:reg:${params.reg}`;
    case 'prv': return `:prv:${params.prv}`;
    case 'mun': return `:mun:${params.mun}`;
    default: return '';
  }
}

// --- DuckDB fallback functions (kept from original for dev mode) ---

function duckdbQuery(sql: string): any[] {
  const output = execFileSync('duckdb', ['-json', '-c', sql], {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  });
  return output.trim() ? JSON.parse(output) : [];
}

function duckdbGeographyStatus(
  parquetBase: string,
  whereClause: string,
  selectCol: string,
): { name: string; totalPrecincts: number; reportedPrecincts: number; completionRate: number }[] {
  const glob = `${parquetBase}/precinct/**/*.parquet`;
  const sql = `
    SELECT ${selectCol},
           COUNT(*) as total_precincts,
           SUM(CASE WHEN has_votes > 0 THEN 1 ELSE 0 END) as reported_precincts
    FROM (
      SELECT ${selectCol}, pollplace, SUM(total_votes) as has_votes
      FROM '${glob}'
      ${whereClause}
      GROUP BY ${selectCol}, pollplace
    ) sub
    GROUP BY ${selectCol}
    ORDER BY ${selectCol}
  `.trim().replace(/\s+/g, ' ');

  let rows: any[];
  try {
    rows = duckdbQuery(sql);
  } catch {
    rows = [];
  }

  return rows.map((r: any) => ({
    name: r[selectCol],
    totalPrecincts: Number(r.total_precincts),
    reportedPrecincts: Number(r.reported_precincts),
    completionRate: Number(r.total_precincts) > 0
      ? Math.round((Number(r.reported_precincts) / Number(r.total_precincts)) * 100)
      : 0,
  }));
}

function duckdbVoteShare(
  parquetBase: string,
  params: { contest?: string; reg?: string; prv?: string; mun?: string },
): VoteShareResponse {
  const level = params.mun ? 'municipality' : params.prv ? 'province' : params.reg ? 'region' : 'national';
  const glob = `${parquetBase}/${level}/**/*.parquet`;

  const where: string[] = [];
  if (params.contest) where.push(`LPAD(CAST(contest_code AS VARCHAR), 8, '0') = '${params.contest.replace(/'/g, "''")}'`);
  if (params.reg) where.push(`reg_name = '${params.reg.replace(/'/g, "''")}'`);
  if (params.prv) where.push(`prv_name = '${params.prv.replace(/'/g, "''")}'`);
  if (params.mun) where.push(`mun_name = '${params.mun.replace(/'/g, "''")}'`);

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT candidate_name, party_code, SUM(total_votes) as votes
    FROM '${glob}'
    ${whereClause}
    GROUP BY candidate_name, party_code
    ORDER BY votes DESC
  `.trim().replace(/\s+/g, ' ');

  let rows: any[];
  try {
    rows = duckdbQuery(sql);
  } catch {
    rows = [];
  }

  const totalVotes = rows.reduce((sum: number, r: any) => sum + Number(r.votes || 0), 0);
  const candidates: VoteShareCandidate[] = rows.map((r: any) => ({
    name: r.candidate_name,
    party: r.party_code || '',
    votes: Number(r.votes),
    percentage: totalVotes > 0 ? Math.round((Number(r.votes) / totalVotes) * 1000) / 10 : 0,
  }));

  return { contest: params.contest || 'all', contestName: '', totalVotes, candidates };
}

function duckdbUndervotes(
  parquetBase: string,
  params: { contest?: string; reg?: string; prv?: string; mun?: string },
): UndervoteResponse {
  const level = params.mun ? 'municipality' : params.prv ? 'province' : params.reg ? 'region' : 'national';
  const glob = `${parquetBase}/${level}/**/*.parquet`;

  const where: string[] = [];
  if (params.contest) where.push(`LPAD(CAST(contest_code AS VARCHAR), 8, '0') = '${params.contest.replace(/'/g, "''")}'`);
  if (params.reg) where.push(`reg_name = '${params.reg.replace(/'/g, "''")}'`);
  if (params.prv) where.push(`prv_name = '${params.prv.replace(/'/g, "''")}'`);
  if (params.mun) where.push(`mun_name = '${params.mun.replace(/'/g, "''")}'`);

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT SUM(total_votes) as total_votes,
           MIN(total_under_votes) as total_under_votes,
           MIN(total_over_votes) as total_over_votes
    FROM '${glob}'
    ${whereClause}
  `.trim().replace(/\s+/g, ' ');

  let rows: any[];
  try {
    rows = duckdbQuery(sql);
  } catch {
    rows = [];
  }

  const totalVotes = Number(rows[0]?.total_votes || 0);
  const totalUndervotes = Number(rows[0]?.total_under_votes || 0);
  const totalOvervotes = Number(rows[0]?.total_over_votes || 0);

  return {
    totalVotes,
    totalUndervotes,
    totalOvervotes,
    undervoteRate: totalVotes > 0 ? Math.round((totalUndervotes / totalVotes) * 1000) / 10 : 0,
    overvoteRate: totalVotes > 0 ? Math.round((totalOvervotes / totalVotes) * 1000) / 10 : 0,
  };
}

// --- Main Service ---

@Injectable()
export class AnalyticsService implements OnModuleInit {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly parquetBase: string;
  private redisReady = false;

  constructor(private readonly redis: RedisService) {
    this.parquetBase =
      process.env.PARQUET_BASE_PATH ||
      path.resolve(__dirname, '..', '..', '..', '..', '..', 'apps', 'etl', 'output');
  }

  async onModuleInit(): Promise<void> {
    this.redisReady = await this.redis.isAvailable();
    if (this.redisReady) {
      this.logger.log('Redis available — serving analytics from Redis');
    } else {
      this.logger.warn('Redis unavailable — using DuckDB fallback');
    }
  }

  // --- Geography Status ---

  async getGeographyStatus(): Promise<RegionStatus[]> {
    if (this.redisReady) {
      const data = await this.redis.hgetallGeoStatus('analytics:geo:regions');
      return Object.entries(data).map(([name, d]) => ({ ...d, name }));
    }
    return duckdbGeographyStatus(this.parquetBase, '', 'reg_name');
  }

  async getProvinceStatus(region: string): Promise<ProvinceStatus[]> {
    if (this.redisReady) {
      const data = await this.redis.hgetallGeoStatus(`analytics:geo:province:${region}`);
      return Object.entries(data).map(([name, d]) => ({ ...d, name }));
    }
    const where = `WHERE reg_name = '${region.replace(/'/g, "''")}'`;
    return duckdbGeographyStatus(this.parquetBase, where, 'prv_name');
  }

  async getCityStatus(region: string, province: string): Promise<CityStatus[]> {
    if (this.redisReady) {
      const data = await this.redis.hgetallGeoStatus(`analytics:geo:city:${region}:${province}`);
      return Object.entries(data).map(([name, d]) => ({ ...d, name }));
    }
    const where = `WHERE reg_name = '${region.replace(/'/g, "''")}' AND prv_name = '${province.replace(/'/g, "''")}'`;
    return duckdbGeographyStatus(this.parquetBase, where, 'mun_name');
  }

  // --- Vote Share ---

  async getVoteShare(params: { contest?: string; reg?: string; prv?: string; mun?: string }): Promise<VoteShareResponse> {
    const level = buildGeoLevel(params);
    const geo = buildGeoKey(level, params);
    const contest = params.contest || 'all';
    const key = `analytics:votes:${contest}:${level}${geo}`;

    if (this.redisReady) {
      const data = await this.redis.getVoteShare(key);
      if (data) return data;
      // Key not found — return empty (graceful degradation)
      return { contest, contestName: '', totalVotes: 0, candidates: [] };
    }
    return duckdbVoteShare(this.parquetBase, params);
  }

  // --- Undervotes ---

  async getUndervotes(params: { contest?: string; reg?: string; prv?: string; mun?: string }): Promise<UndervoteResponse> {
    const level = buildGeoLevel(params);
    const geo = buildGeoKey(level, params);
    const contest = params.contest || 'all';
    const key = `analytics:undervotes:${contest}:${level}${geo}`;

    if (this.redisReady) {
      const data = await this.redis.getUndervotes(key);
      if (data) return data;
      return { totalVotes: 0, totalUndervotes: 0, totalOvervotes: 0, undervoteRate: 0, overvoteRate: 0 };
    }
    return duckdbUndervotes(this.parquetBase, params);
  }
}
