import { Injectable, BadRequestException } from '@nestjs/common';
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

function padContestCode(code: string | number): string {
  // DuckDB returns contest_code as a number (399000), but JSON map uses 8-digit keys (00399000)
  return String(code).padStart(8, '0');
}

/** Strip leading zeros and parse as integer. */
function cleanContestCode(code: string): number {
  return parseInt(code, 10) || 0;
}

/** Escape single quotes for DuckDB SQL string literals. */
function esc(val: string): string {
  return val.replace(/'/g, "''");
}

@Injectable()
export class ResultsService {
  private readonly parquetBase: string;
  private contestNames: Record<string, string> = {};

  constructor() {
    // Default: resolve relative to project root (2 levels up from apps/api/)
    this.parquetBase =
      process.env.PARQUET_BASE_PATH ||
      path.resolve(__dirname, '..', '..', '..', '..', '..', 'output');

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

    // Group rows by contest_code (padded to 8 digits for JSON map lookup)
    const contestMap = new Map<string, any[]>();
    for (const r of rows) {
      const code = padContestCode(r.contest_code);
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

    return rows.map(r => {
      const code = padContestCode(r.contest_code);
      return {
        code,
        name: this.contestNames[code] || code,
        category: this.categoryFromCode(code),
      };
    });
  }

  private buildContestQuery(params: ContestQueryParams): { sql: string; level: string } {
    const filters: string[] = [];
    let level = 'national';

    // M4: Validate partial geo params — reject incomplete ancestor chains
    if (params.brgy && (!params.mun || !params.prv || !params.reg)) {
      throw new BadRequestException(
        'barangay filter requires mun, prv, and reg params',
      );
    }
    if (params.mun && (!params.prv || !params.reg)) {
      throw new BadRequestException(
        'municipality filter requires prv and reg params',
      );
    }
    if (params.prv && !params.reg) {
      throw new BadRequestException(
        'province filter requires reg param',
      );
    }

    if (params.brgy) {
      level = 'barangay';
      filters.push(`brgy_name = '${esc(params.brgy)}'`);
      filters.push(`mun_name = '${esc(params.mun!)}'`);
      filters.push(`prv_name = '${esc(params.prv!)}'`);
      filters.push(`reg_name = '${esc(params.reg!)}'`);
    } else if (params.mun) {
      level = 'municipality';
      filters.push(`mun_name = '${esc(params.mun)}'`);
      filters.push(`prv_name = '${esc(params.prv!)}'`);
      filters.push(`reg_name = '${esc(params.reg!)}'`);
    } else if (params.prv) {
      level = 'province';
      filters.push(`prv_name = '${esc(params.prv)}'`);
      filters.push(`reg_name = '${esc(params.reg!)}'`);
    } else if (params.reg) {
      level = 'region';
      filters.push(`reg_name = '${esc(params.reg)}'`);
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
          .map(([k, v]) => `${k} = '${esc(v)}'`)
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
    if (dto.national_only === 'true') {
      where.push(
        "(LPAD(CAST(contest_code AS VARCHAR), 8, '0') LIKE '003%'"
        + " OR LPAD(CAST(contest_code AS VARCHAR), 8, '0') LIKE '011%')"
      );
    }
    // M1: Compare contest_code as integer (strip leading zeros)
    if (dto.contest) where.push(`contest_code = ${cleanContestCode(dto.contest)}`);
    if (dto.reg) where.push(`reg_name = '${esc(dto.reg)}'`);
    if (dto.prv) where.push(`prv_name = '${esc(dto.prv)}'`);
    if (dto.mun) where.push(`mun_name = '${esc(dto.mun)}'`);
    if (dto.brgy) where.push(`brgy_name = '${esc(dto.brgy)}'`);
    if (dto.vc) where.push(`pollplace = '${esc(dto.vc)}'`);

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
