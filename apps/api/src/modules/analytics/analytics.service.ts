import { Injectable, BadRequestException } from '@nestjs/common';
import { execFileSync } from 'child_process';
import * as path from 'path';

export interface RegionStatus {
  name: string;
  totalPrecincts: number;
  reportedPrecincts: number;
  completionRate: number;
}

interface ProvinceStatus {
  name: string;
  totalPrecincts: number;
  reportedPrecincts: number;
  completionRate: number;
}

interface CityStatus {
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

@Injectable()
export class AnalyticsService {
  private readonly parquetBase: string;

  constructor() {
    this.parquetBase =
      process.env.PARQUET_BASE_PATH ||
      path.resolve(__dirname, '..', '..', '..', '..', '..', 'apps', 'etl', 'output');
  }

  getGeographyStatus(): RegionStatus[] {
    const glob = `${this.parquetBase}/region/**/*.parquet`;
    const sql = `
      SELECT reg_name,
             COUNT(DISTINCT pollplace) as total_precincts,
             SUM(CASE WHEN total_votes > 0 THEN 1 ELSE 0 END) as reported_precincts
      FROM '${glob}'
      GROUP BY reg_name
      ORDER BY reg_name
    `.trim().replace(/\s+/g, ' ');

    let rows: any[];
    try {
      const output = execFileSync('duckdb', ['-json', '-c', sql], {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
      rows = JSON.parse(output);
    } catch {
      throw new BadRequestException('Failed to query geography status');
    }

    return rows.map(r => ({
      name: r.reg_name,
      totalPrecincts: Number(r.total_precincts),
      reportedPrecincts: Number(r.reported_precincts),
      completionRate: Number(r.total_precincts) > 0
        ? Math.round((Number(r.reported_precincts) / Number(r.total_precincts)) * 100)
        : 0,
    }));
  }

  getProvinceStatus(region: string): ProvinceStatus[] {
    const glob = `${this.parquetBase}/province/**/*.parquet`;
    const sql = `
      SELECT prv_name,
             COUNT(DISTINCT pollplace) as total_precincts,
             SUM(CASE WHEN total_votes > 0 THEN 1 ELSE 0 END) as reported_precincts
      FROM '${glob}'
      WHERE reg_name = '${region.replace(/'/g, "''")}'
      GROUP BY prv_name
      ORDER BY prv_name
    `.trim().replace(/\s+/g, ' ');

    let rows: any[];
    try {
      const output = execFileSync('duckdb', ['-json', '-c', sql], {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
      rows = JSON.parse(output);
    } catch {
      throw new BadRequestException(`Failed to query province status for region: ${region}`);
    }

    return rows.map(r => ({
      name: r.prv_name,
      totalPrecincts: Number(r.total_precincts),
      reportedPrecincts: Number(r.reported_precincts),
      completionRate: Number(r.total_precincts) > 0
        ? Math.round((Number(r.reported_precincts) / Number(r.total_precincts)) * 100)
        : 0,
    }));
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
      rows = JSON.parse(output);
    } catch {
      throw new BadRequestException('Failed to query vote share data');
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

  getCityStatus(region: string, province: string): CityStatus[] {
    const glob = `${this.parquetBase}/municipality/**/*.parquet`;
    const sql = `
      SELECT mun_name,
             COUNT(DISTINCT pollplace) as total_precincts,
             SUM(CASE WHEN total_votes > 0 THEN 1 ELSE 0 END) as reported_precincts
      FROM '${glob}'
      WHERE reg_name = '${region.replace(/'/g, "''")}'
        AND prv_name = '${province.replace(/'/g, "''")}'
      GROUP BY mun_name
      ORDER BY mun_name
    `.trim().replace(/\s+/g, ' ');

    let rows: any[];
    try {
      const output = execFileSync('duckdb', ['-json', '-c', sql], {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
      rows = JSON.parse(output);
    } catch {
      throw new BadRequestException(`Failed to query city status for province: ${province}`);
    }

    return rows.map(r => ({
      name: r.mun_name,
      totalPrecincts: Number(r.total_precincts),
      reportedPrecincts: Number(r.reported_precincts),
      completionRate: Number(r.total_precincts) > 0
        ? Math.round((Number(r.reported_precincts) / Number(r.total_precincts)) * 100)
        : 0,
    }));
  }
}
