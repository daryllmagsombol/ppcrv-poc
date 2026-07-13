import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ResultQueryDto } from './dto/result-query.dto';
import { ResultsResponse, CandidateResult, ContestGroup } from './dto/results-response.dto';
import { ContestInfo } from './dto/contest-info.dto';

const CATEGORY_MAP: Record<string, string> = {
  '003': 'Senator',
  '004': 'Governor',
  '005': 'Vice Governor',
  '006': 'Provincial Board',
  '007': 'House of Reps',
  '008': 'Mayor',
  '009': 'Vice Mayor',
  '010': 'Councilor',
  '011': 'Party List',
  '012': 'BARMM Party Rep',
  '014': 'BARMM Parliament',
};

interface ContestQueryParams {
  reg?: string;
  prv?: string;
  mun?: string;
  brgy?: string;
}

@Injectable()
export class ResultsService {
  private readonly parquetBase: string;
  private contestNames: Record<string, string> = {};

  constructor() {
    // Default: resolve relative to project root (2 levels up from apps/api/)
    this.parquetBase =
      process.env.PARQUET_BASE_PATH ||
      path.resolve(__dirname, '..', '..', '..', '..', '..', 'output', 'multi-level');

    try {
      const namesPath = path.resolve(__dirname, '..', '..', '..', '..', '..', 'data', 'contest-names.json');
      this.contestNames = JSON.parse(fs.readFileSync(namesPath, 'utf-8'));
    } catch {
      console.warn('contest-names.json not found, falling back to contest_code as name');
    }
  }

  queryResults(dto: ResultQueryDto): ResultsResponse {
    const { sql, level } = this.buildQuery(dto);

    const output = execSync(`duckdb -json -c "${sql}"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const rows = JSON.parse(output) as any[];

    // Group rows by contest_code
    const contestMap = new Map<string, any[]>();
    for (const r of rows) {
      const code = String(r.contest_code);
      if (!contestMap.has(code)) contestMap.set(code, []);
      contestMap.get(code)!.push(r);
    }

    const filters: Record<string, string> = { level };
    if (dto.contest) filters.contest = dto.contest;
    if (dto.reg) filters.region = dto.reg;
    if (dto.prv) filters.province = dto.prv;
    if (dto.mun) filters.municipality = dto.mun;
    if (dto.brgy) filters.barangay = dto.brgy;
    if (dto.vc) filters.votingCenter = dto.vc;

    const contests: ContestGroup[] = [];

    for (const [code, contestRows] of contestMap) {
      // Sort by votes descending within contest
      contestRows.sort((a, b) => b.votes - a.votes);

      const totalVotes = contestRows.reduce((sum, r) => sum + Number(r.votes || 0), 0);
      const overVotes = contestRows.reduce((s, r) => s + Number(r.total_over_votes || 0), 0);
      const underVotes = contestRows.reduce((s, r) => s + Number(r.total_under_votes || 0), 0);

      const candidates: CandidateResult[] = contestRows.map((r, i) => ({
        rank: i + 1,
        name: r.candidate_name,
        party: r.party_code || '',
        votes: Number(r.votes),
        percentage: totalVotes > 0 ? Math.round((Number(r.votes) / totalVotes) * 1000) / 10 : 0,
      }));

      contests.push({
        code,
        name: this.contestNames[code] || code,
        category: this.categoryFromCode(code),
        totalVotes,
        candidates,
        totals: { votesCast: totalVotes, overVotes, underVotes },
      });
    }

    return { level, filters, contests };
  }

  getContestsByGeography(params: ContestQueryParams): ContestInfo[] {
    const { sql } = this.buildContestQuery(params);
    const output = execSync(`duckdb -json -c "${sql}"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const rows = JSON.parse(output) as { contest_code: string | number }[];

    return rows.map(r => ({
      code: String(r.contest_code),
      name: this.contestNames[String(r.contest_code)] || String(r.contest_code),
      category: this.categoryFromCode(r.contest_code),
    }));
  }

  private buildContestQuery(params: ContestQueryParams): { sql: string; level: string } {
    const filters: string[] = [];
    let level = 'national';

    if (params.brgy && params.mun && params.prv && params.reg) {
      level = 'barangay';
      filters.push(`brgy_name = '${params.brgy.replace(/'/g, "''")}'`);
      filters.push(`mun_name = '${params.mun.replace(/'/g, "''")}'`);
      filters.push(`prv_name = '${params.prv.replace(/'/g, "''")}'`);
      filters.push(`reg_name = '${params.reg.replace(/'/g, "''")}'`);
    } else if (params.mun && params.prv && params.reg) {
      level = 'municipality';
      filters.push(`mun_name = '${params.mun.replace(/'/g, "''")}'`);
      filters.push(`prv_name = '${params.prv.replace(/'/g, "''")}'`);
      filters.push(`reg_name = '${params.reg.replace(/'/g, "''")}'`);
    } else if (params.prv && params.reg) {
      level = 'province';
      filters.push(`prv_name = '${params.prv.replace(/'/g, "''")}'`);
      filters.push(`reg_name = '${params.reg.replace(/'/g, "''")}'`);
    } else if (params.reg) {
      level = 'region';
      filters.push(`reg_name = '${params.reg.replace(/'/g, "''")}'`);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const glob = `${this.parquetBase}/${level}/**/*.parquet`;

    const sql = `SELECT DISTINCT contest_code FROM '${glob}' ${whereClause} ORDER BY contest_code`
      .trim().replace(/\s+/g, ' ');

    return { sql, level };
  }

  getDistinctValues(level: string, column: string, parents?: Record<string, string>): string[] {
    const whereClause = parents && Object.keys(parents).length > 0
      ? 'WHERE ' + Object.entries(parents)
          .map(([k, v]) => `${k} = '${v.replace(/'/g, "''")}'`)
          .join(' AND ')
      : '';

    const sql = `SELECT DISTINCT ${column} FROM '${this.parquetBase}/${level}/**/*.parquet' ${whereClause} ORDER BY ${column}`;
    const output = execSync(`duckdb -json -c "${sql}"`, { encoding: 'utf-8' });
    const rows = JSON.parse(output) as any[];
    return rows.map(r => r[column]).filter(Boolean);
  }

  private categoryFromCode(contestCode: string | number): string {
    const prefix = String(contestCode).slice(0, 3);
    return CATEGORY_MAP[prefix] || 'Unknown';
  }

  private buildQuery(dto: ResultQueryDto): { sql: string; level: string } {
    const level = dto.level;
    const glob = `${this.parquetBase}/${level}/**/*.parquet`;

    const where: string[] = [];
    if (dto.contest) where.push(`contest_code = '${dto.contest.replace(/'/g, "''")}'`);
    if (dto.reg) where.push(`reg_name = '${dto.reg.replace(/'/g, "''")}'`);
    if (dto.prv) where.push(`prv_name = '${dto.prv.replace(/'/g, "''")}'`);
    if (dto.mun) where.push(`mun_name = '${dto.mun.replace(/'/g, "''")}'`);
    if (dto.brgy) where.push(`brgy_name = '${dto.brgy.replace(/'/g, "''")}'`);
    if (dto.vc) where.push(`pollplace = '${dto.vc.replace(/'/g, "''")}'`);

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `
      SELECT contest_code, candidate_name, party_code, SUM(total_votes) as votes,
             SUM(total_over_votes) as total_over_votes,
             SUM(total_under_votes) as total_under_votes
      FROM '${glob}'
      ${whereClause}
      GROUP BY contest_code, candidate_name, party_code
      ORDER BY contest_code, votes DESC
    `.trim().replace(/\s+/g, ' ');

    return { sql, level };
  }
}
