import { Injectable, BadRequestException } from '@nestjs/common';
import { execFileSync } from 'child_process';
import * as path from 'path';

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

@Injectable()
export class AnalyticsService {
  private readonly parquetBase: string;

  constructor() {
    this.parquetBase =
      process.env.PARQUET_BASE_PATH ||
      path.resolve(__dirname, '..', '..', '..', '..', '..', 'apps', 'etl', 'output');
  }

  private queryGeographyStatus(
    whereClause: string,
    selectCol: string,
  ): { name: string; totalPrecincts: number; reportedPrecincts: number; completionRate: number }[] {
    const glob = `${this.parquetBase}/precinct/**/*.parquet`;
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
      const output = execFileSync('duckdb', ['-json', '-c', sql], {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
      rows = output.trim() ? JSON.parse(output) : [];
    } catch (e: any) {
      if (e instanceof SyntaxError) {
        rows = [];
      } else {
        throw new BadRequestException('Failed to query geography status');
      }
    }

    return rows.map(r => ({
      name: r[selectCol],
      totalPrecincts: Number(r.total_precincts),
      reportedPrecincts: Number(r.reported_precincts),
      completionRate: Number(r.total_precincts) > 0
        ? Math.round((Number(r.reported_precincts) / Number(r.total_precincts)) * 100)
        : 0,
    }));
  }

  getGeographyStatus(): RegionStatus[] {
    return this.queryGeographyStatus('', 'reg_name');
  }

  getProvinceStatus(region: string): ProvinceStatus[] {
    const where = `WHERE reg_name = '${region.replace(/'/g, "''")}'`;
    return this.queryGeographyStatus(where, 'prv_name');
  }

  getVoteShare(params: { contest?: string; reg?: string; prv?: string; mun?: string }): VoteShareResponse {
    const level = params.mun ? 'municipality' : params.prv ? 'province' : params.reg ? 'region' : 'national';
    const glob = `${this.parquetBase}/${level}/**/*.parquet`;

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
      const output = execFileSync('duckdb', ['-json', '-c', sql], {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
      rows = output.trim() ? JSON.parse(output) : [];
    } catch (e: any) {
      if (e instanceof SyntaxError) {
        rows = [];
      } else {
        throw new BadRequestException('Failed to query vote share data');
      }
    }

    const totalVotes = rows.reduce((sum: number, r: any) => sum + Number(r.votes || 0), 0);
    const candidates: VoteShareCandidate[] = rows.map((r: any) => ({
      name: r.candidate_name,
      party: r.party_code || '',
      votes: Number(r.votes),
      percentage: totalVotes > 0 ? Math.round((Number(r.votes) / totalVotes) * 1000) / 10 : 0,
    }));

    return {
      contest: params.contest || 'all',
      contestName: '',
      totalVotes,
      candidates,
    };
  }

  getUndervotes(params: { contest?: string; reg?: string; prv?: string; mun?: string }): UndervoteResponse {
    const level = params.mun ? 'municipality' : params.prv ? 'province' : params.reg ? 'region' : 'national';
    const glob = `${this.parquetBase}/${level}/**/*.parquet`;

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
      const output = execFileSync('duckdb', ['-json', '-c', sql], {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
      rows = output.trim() ? JSON.parse(output) : [];
    } catch (e: any) {
      if (e instanceof SyntaxError) {
        rows = [];
      } else {
        throw new BadRequestException('Failed to query undervote data');
      }
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

  getCityStatus(region: string, province: string): CityStatus[] {
    const where = `WHERE reg_name = '${region.replace(/'/g, "''")}' AND prv_name = '${province.replace(/'/g, "''")}'`;
    return this.queryGeographyStatus(where, 'mun_name');
  }
}
