import { Injectable, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { ScanCompareDto } from './dto/scan-compare.dto';
import { ScanUploadDto } from './dto/scan-upload.dto';
import { ComparisonResult, ContestResult, CandidateVote, Discrepancy } from './interfaces';

@Injectable()
export class ScanService implements OnModuleInit {
  private pool: Pool;
  private readonly parquetBase: string;

  constructor() {
    this.pool = new Pool({
      host: process.env.PGHOST || 'localhost',
      database: process.env.PGDATABASE || 'pprcv_local',
      user: process.env.PGUSER || 'daryllmagsombol',
    });
    this.parquetBase =
      process.env.PARQUET_BASE_PATH ||
      path.resolve(__dirname, '..', '..', '..', '..', '..', 'apps', 'etl', 'output');
  }

  async onModuleInit() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS scan_records (
        id                    SERIAL PRIMARY KEY,
        precinct_id           VARCHAR(20) NOT NULL,
        region                VARCHAR(100),
        province              VARCHAR(100),
        municipality          VARCHAR(100),
        barangay              VARCHAR(100),
        qr_raw_1              TEXT,
        qr_raw_2              TEXT,
        qr_raw_3              TEXT,
        qr_parsed             JSONB,
        db_results            JSONB,
        has_discrepancy       BOOLEAN DEFAULT FALSE,
        discrepancy_details   JSONB,
        scanned_by            VARCHAR(100),
        scanned_at            TIMESTAMP DEFAULT NOW()
      )
    `);
  }

  getPool(): Pool {
    return this.pool;
  }

  async compare(dto: ScanCompareDto): Promise<ComparisonResult> {
    const qrParsed = this.parseQrData(dto);
    const dbResults = await this.queryPrecinctResults(dto.precinct_id);
    const discrepancies = this.findDiscrepancies(qrParsed, dbResults);

    return {
      precinct_id: dto.precinct_id,
      qr_parsed: qrParsed,
      db_results: dbResults,
      has_discrepancy: discrepancies.length > 0,
      discrepancy_details: discrepancies,
    };
  }

  async upload(dto: ScanUploadDto): Promise<{ id: number; uploaded: boolean }> {
    const result = await this.pool.query(
      `INSERT INTO scan_records 
       (precinct_id, region, province, municipality, barangay,
        qr_raw_1, qr_raw_2, qr_raw_3, qr_parsed, db_results,
        has_discrepancy, discrepancy_details, scanned_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        dto.precinct_id, dto.region || null, dto.province || null,
        dto.municipality || null, dto.barangay || null,
        dto.qr_raw_1 || null, dto.qr_raw_2 || null, dto.qr_raw_3 || null,
        dto.qr_parsed ? JSON.stringify(dto.qr_parsed) : null,
        dto.db_results ? JSON.stringify(dto.db_results) : null,
        dto.has_discrepancy || false,
        dto.discrepancy_details ? JSON.stringify(dto.discrepancy_details) : null,
        dto.scanned_by || null,
      ],
    );
    return { id: result.rows[0].id, uploaded: true };
  }

  async getHistory(limit: number = 50): Promise<any[]> {
    const result = await this.pool.query(
      'SELECT * FROM scan_records ORDER BY scanned_at DESC LIMIT $1',
      [limit],
    );
    return result.rows;
  }

  private parseQrData(dto: ScanCompareDto): ContestResult[] {
    const results: ContestResult[] = [];
    for (const raw of [dto.qr_raw_1, dto.qr_raw_2, dto.qr_raw_3]) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item.contest_code && item.candidates) {
            results.push({
              contest_code: String(item.contest_code).padStart(8, '0'),
              contest_name: item.contest_name || String(item.contest_code),
              category: item.category || 'Unknown',
              candidates: item.candidates.map((c: any) => ({
                candidate: c.candidate || c.name,
                party: c.party || '',
                votes: Number(c.votes) || 0,
              })),
            });
          }
        }
      } catch {
        results.push({
          contest_code: 'RAW',
          contest_name: 'Unparsed QR Data',
          category: 'Raw',
          candidates: [{ candidate: raw, party: '', votes: 0 }],
        });
      }
    }
    return results;
  }

  private async queryPrecinctResults(precinctId: string): Promise<ContestResult[]> {
    try {
      const glob = `${this.parquetBase}/precinct/**/*.parquet`;
      // Try matching by pollplace containing precinct ID, then fall back to any match
      const sql = `
        SELECT contest_code, candidate_name, party_code, SUM(total_votes) as votes
        FROM '${glob}'
        WHERE pollplace LIKE '%${precinctId.replace(/'/g, "''")}%'
        GROUP BY contest_code, candidate_name, party_code
        ORDER BY contest_code, votes DESC
      `.trim().replace(/\s+/g, ' ');

      const output = execFileSync('duckdb', ['-json', '-c', sql], {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
      const rows = JSON.parse(output);

      const contestMap = new Map<string, any[]>();
      for (const r of rows) {
        const code = String(r.contest_code).padStart(8, '0');
        if (!contestMap.has(code)) contestMap.set(code, []);
        contestMap.get(code)!.push(r);
      }

      const results: ContestResult[] = [];
      for (const [code, contestRows] of contestMap) {
        results.push({
          contest_code: code,
          contest_name: code,
          category: this.categoryFromCode(code),
          candidates: contestRows.map(r => ({
            candidate: r.candidate_name,
            party: r.party_code || '',
            votes: Number(r.votes),
          })),
        });
      }
      return results;
    } catch (e) {
      console.warn('Failed to query DuckDB for precinct:', e);
      return [];
    }
  }

  private categoryFromCode(contestCode: string): string {
    const prefix = contestCode.slice(0, 3);
    const map: Record<string, string> = {
      '003': 'Senator',
      '004': 'Governor',
      '005': 'Vice Governor',
      '006': 'Provincial Board',
      '007': 'House of Reps',
      '008': 'Mayor',
      '009': 'Vice Mayor',
      '010': 'Councilor',
      '011': 'Party List',
    };
    return map[prefix] || 'Unknown';
  }

  private findDiscrepancies(qr: ContestResult[], db: ContestResult[]): Discrepancy[] {
    const discrepancies: Discrepancy[] = [];
    for (const qrContest of qr) {
      const dbContest = db.find(c => c.contest_code === qrContest.contest_code);
      if (!dbContest) continue;
      for (const qrCandidate of qrContest.candidates) {
        if (qrCandidate.candidate === 'Unparsed QR Data') continue;
        const dbCandidate = dbContest.candidates.find(
          c => c.candidate === qrCandidate.candidate,
        );
        if (dbCandidate && dbCandidate.votes !== qrCandidate.votes) {
          discrepancies.push({
            contest_code: qrContest.contest_code,
            contest_name: qrContest.contest_name,
            candidate: qrCandidate.candidate,
            qr_votes: qrCandidate.votes,
            db_votes: dbCandidate.votes,
          });
        }
      }
    }
    return discrepancies;
  }
}
