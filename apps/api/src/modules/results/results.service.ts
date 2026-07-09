import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
import * as path from 'path';
import { ResultQueryDto } from './dto/result-query.dto';
import { ResultsResponse, CandidateResult } from './dto/results-response.dto';

@Injectable()
export class ResultsService {
  private readonly parquetBase: string;

  constructor() {
    // Default: resolve relative to project root (2 levels up from apps/api/)
    this.parquetBase =
      process.env.PARQUET_BASE_PATH ||
      path.resolve(__dirname, '..', '..', '..', '..', '..', 'output', 'multi-level');
  }

  queryResults(dto: ResultQueryDto): ResultsResponse {
    const { sql, level } = this.buildQuery(dto);

    const output = execSync(`duckdb -json -c "${sql}"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const rows = JSON.parse(output) as any[];

    const totalVotes = rows.reduce((sum, r) => sum + r.votes, 0);
    const candidates: CandidateResult[] = rows.map((r, i) => ({
      rank: i + 1,
      name: r.candidate_name,
      party: r.party_code || '',
      votes: r.votes,
      percentage: totalVotes > 0 ? Math.round((r.votes / totalVotes) * 1000) / 10 : 0,
    }));

    const filters: Record<string, string> = { level };
    if (dto.contest) filters.contest = dto.contest;
    if (dto.reg) filters.region = dto.reg;
    if (dto.prv) filters.province = dto.prv;
    if (dto.mun) filters.municipality = dto.mun;
    if (dto.brgy) filters.barangay = dto.brgy;
    if (dto.vc) filters.votingCenter = dto.vc;

    return {
      level,
      filters,
      totalVotes,
      candidates,
      totals: {
        votesCast: totalVotes,
        overVotes: rows.reduce((s, r) => s + (r.total_over_votes || 0), 0),
        underVotes: rows.reduce((s, r) => s + (r.total_under_votes || 0), 0),
      },
    };
  }

  getContests(): { code: string; name: string }[] {
    const sql = `SELECT DISTINCT contest_code FROM '${this.parquetBase}/national/**/*.parquet' ORDER BY contest_code`;
    const output = execSync(`duckdb -json -c "${sql}"`, { encoding: 'utf-8' });
    const rows = JSON.parse(output) as any[];
    return rows.map(r => ({ code: r.contest_code, name: r.contest_code }));
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
      SELECT candidate_name, party_code, SUM(total_votes) as votes,
             SUM(total_over_votes) as total_over_votes,
             SUM(total_under_votes) as total_under_votes
      FROM '${glob}'
      ${whereClause}
      GROUP BY candidate_name, party_code
      ORDER BY votes DESC
    `.trim().replace(/\s+/g, ' ');

    return { sql, level };
  }
}
