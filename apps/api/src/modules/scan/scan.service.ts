import { Injectable, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { ScanCompareDto } from './dto/scan-compare.dto';
import { ScanUploadDto } from './dto/scan-upload.dto';
import { ComparisonResult, ContestResult, CandidateVote, Discrepancy, VcmMetadata } from './interfaces';

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
    // Auto-detect precinct from QR if not provided
    let precinctId = dto.precinct_id;
    if (precinctId === 'auto-detect' || !precinctId) {
      const detected = this.extractPrecinctFromQr(dto);
      if (detected) precinctId = detected;
    }

    const qrParsed = this.parseQrData(dto);
    const dbResults = await this.queryPrecinctResults(precinctId);

    // Resolve VCM position numbers to real candidate names
    await this.resolveQrPositions(qrParsed);

    const discrepancies = this.findDiscrepancies(qrParsed, dbResults);

    // Parse metadata QR (try all 3, pick the first match)
    const qrMetadata =
      this.parseMetadataQr(dto.qr_raw_1 || '') ??
      this.parseMetadataQr(dto.qr_raw_2 || '') ??
      this.parseMetadataQr(dto.qr_raw_3 || '') ??
      undefined;

    // Look up geography for the response
    let region, province, municipality, barangay, pollplace;
    try {
      const geo = await this.pool.query(
        `SELECT reg_name, prv_name, mun_name, brgy_name, pollplace
         FROM ref_precincts WHERE acm_id = $1`,
        [precinctId],
      );
      if (geo.rows.length > 0) {
        region = geo.rows[0].reg_name;
        province = geo.rows[0].prv_name;
        municipality = geo.rows[0].mun_name;
        barangay = geo.rows[0].brgy_name;
        pollplace = geo.rows[0].pollplace;
      }
    } catch {
      // Geography lookup is best-effort
    }

    return {
      precinct_id: precinctId,
      region,
      province,
      municipality,
      barangay,
      pollplace,
      qr_parsed: qrParsed,
      qr_metadata: qrMetadata,
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

      // Skip metadata QR — it's parsed separately as VcmMetadata
      if (this.parseMetadataQr(raw)) continue;

      // Try VCM format: "CATEGORY\ncontest_code:pos=votes|pos=votes|..."
      const vcmResult = this.parseVcmFormat(raw);
      if (vcmResult) {
        results.push(vcmResult);
        continue;
      }

      // Try JSON format (legacy/test data)
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
        // Store raw if nothing else works
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

  /**
   * Parse VCM report metadata QR (QR3).
   * Format: type,precinct_id,report_hash,result_hash,RV=x|CB=x|RB=x|VT=x
   * Example: 12,10120012,BFB59…,CF765…,RV=922|CB=3|RB=0|VT=0.33
   */
  private parseMetadataQr(raw: string): VcmMetadata | null {
    const text = raw.trim();

    // Format: [type, precinct_id, report_hash, result_hash, RV=x|CB=x|RB=x|VT=x]
    const parts = text.split(',');
    if (parts.length < 5) return null;

    const precinctId = parts[1].trim();
    const reportHash = parts[2]?.trim() || '';
    const resultHash = parts[3]?.trim() || '';
    const statsStr = parts.slice(4).join(',').trim();
    const type = parts[0].trim();

    // Validate: precinct must look like a precinct ID (8+ digits)
    if (!/^\d{8,}$/.test(precinctId)) return null;

    // Parse stats: RV=x|CB=x|RB=x|VT=x
    const stats: Record<string, number> = { RV: 0, CB: 0, RB: 0, VT: 0 };
    const statPairs = statsStr.split('|');
    for (const pair of statPairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const key = pair.slice(0, eqIdx).trim();
      const val = parseFloat(pair.slice(eqIdx + 1).trim());
      if (!isNaN(val) && key in stats) {
        stats[key] = val;
      }
    }

    return {
      type,
      precinct_id: precinctId,
      report_hash: reportHash,
      result_hash: resultHash,
      registered_voters: stats.RV,
      cast_ballots: stats.CB,
      remaining_ballots: stats.RB,
      voter_turnout_pct: stats.VT,
    };
  }

  /**
   * Parse VCM receipt QR format.
   *
   * Supported formats:
   *   Format A (two lines):
   *     Line 1: Category name (e.g., "NATIONAL", "PARTY LIST")
   *     Line 2: contest_code:position=votes|position=votes|...
   *
   *   Format B (single line):
   *     "CATEGORY contest_code:position=votes|..."
   */
  private parseVcmFormat(raw: string): ContestResult | null {
    const text = raw.trim();
    let category = '';
    let dataLine = '';

    const lines = text.split('\n');

    if (lines.length >= 2) {
      // Format A: category on line 1, data on line 2
      category = lines[0].trim();
      dataLine = lines[1].trim();
    } else {
      // Format B: single line — find where "contest_code:" starts
      const colonMatch = text.match(/\s(\d+:[0-9|=|]+)$/);
      if (!colonMatch) return null;

      const colonIndex = text.lastIndexOf(colonMatch[0]);
      category = text.slice(0, colonIndex).trim();
      dataLine = text.slice(colonIndex).trim();
    }

    // Match: contest_code:pos1=votes1|pos2=votes2|...
    const match = dataLine.match(/^(\d+):(.+)$/);
    if (!match) return null;

    const contestCode = match[1].padStart(8, '0');
    const pairs = match[2].split('|');

    const candidates = pairs
      .map(pair => {
        const [pos, votes] = pair.split('=');
        const positionNum = parseInt(pos, 10);
        return {
          candidate: `Position ${pos}`,
          party: '',
          votes: Number(votes) || 0,
          position: isNaN(positionNum) ? undefined : positionNum,
        };
      })
      .filter(c => c.votes > 0);

    return {
      contest_code: contestCode,
      contest_name: category,
      category: this.categoryFromCode(contestCode),
      candidates,
    };
  }

  /**
   * Extract precinct ID from VCM metadata QR code.
   * Format: type,precinct_id,report_hash,result_hash,RV=...|CB=...|...
   */
  extractPrecinctFromQr(dto: ScanCompareDto): string | null {
    for (const raw of [dto.qr_raw_1, dto.qr_raw_2, dto.qr_raw_3]) {
      if (!raw) continue;
      const lines = raw.trim().split('\n');
      // Metadata QR is typically the last one and has comma-separated values
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 2 && /^\d{8}$/.test(parts[1].trim())) {
          return parts[1].trim();
        }
      }
    }
    return null;
  }

  private async queryPrecinctResults(precinctId: string): Promise<ContestResult[]> {
    try {
      // 1. Look up precinct geography from PostgreSQL ref_precincts
      const geoResult = await this.pool.query(
        `SELECT reg_name, prv_name, mun_name, brgy_name, pollplace
         FROM ref_precincts WHERE acm_id = $1`,
        [precinctId],
      );

      if (geoResult.rows.length === 0) {
        console.warn(`Precinct ${precinctId} not found in ref_precincts`);
        return [];
      }

      const { reg_name, prv_name, mun_name, brgy_name, pollplace } = geoResult.rows[0];

      // 2. Query DuckDB parquet using the geographic hierarchy
      // Pipe SQL via stdin instead of -c to avoid shell-interpolation vectors
      const glob = `${this.parquetBase}/precinct/**/*.parquet`;
      const sql = [
        `SELECT contest_code, candidate_name, party_code, SUM(total_votes) as votes`,
        `FROM read_parquet('${glob}')`,
        `WHERE reg_name = '${reg_name.replace(/'/g, "''")}'`,
        `  AND prv_name = '${prv_name.replace(/'/g, "''")}'`,
        `  AND mun_name = '${mun_name.replace(/'/g, "''")}'`,
        `  AND brgy_name = '${brgy_name.replace(/'/g, "''")}'`,
        `  AND pollplace = '${pollplace.replace(/'/g, "''")}'`,
        `GROUP BY contest_code, candidate_name, party_code`,
        `ORDER BY contest_code, candidate_name`,
      ].join('\n');

      const output = execFileSync('duckdb', ['-json'], {
        input: sql,
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
          contest_name: this.categoryFromCode(code),
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

  /**
   * For each parsed VCM result, look up ref_candidates ordered by
   * candidate_code and replace "Position X" with the actual candidate name.
   * Contests not in ref_candidates keep the "Position X" label as-is.
   */
  private async resolveQrPositions(qr: ContestResult[]): Promise<void> {
    for (const contest of qr) {
      const isPositionBased = contest.candidates.some(c =>
        c.candidate.startsWith('Position '),
      );
      if (!isPositionBased) continue;

      try {
        const result = await this.pool.query(
          `SELECT candidate_name FROM ref_candidates
           WHERE contest_code = $1
           ORDER BY candidate_code`,
          [contest.contest_code],
        );

        if (result.rows.length === 0) continue;

        // Replace "Position X" with the name at index (X-1), preserve position
        for (const c of contest.candidates) {
          const pos = parseInt(c.candidate.replace('Position ', ''), 10);
          if (!isNaN(pos) && pos >= 1 && pos <= result.rows.length) {
            c.candidate = result.rows[pos - 1].candidate_name;
            c.position = pos; // preserve for position-based fallback matching
          }
        }
      } catch {
        // Name resolution is best-effort
      }
    }
  }

  private findDiscrepancies(qr: ContestResult[], db: ContestResult[]): Discrepancy[] {
    const discrepancies: Discrepancy[] = [];

    /**
     * Find a DB candidate matching a QR candidate. Tries name match first,
     * then falls back to position-based matching when the QR candidate has
     * a stored position number.
     */
    const matchDbCandidate = (
      dbList: CandidateVote[],
      qrCandidate: CandidateVote,
    ): CandidateVote | undefined => {
      // 1. Exact name match
      const byName = dbList.find(c => c.candidate === qrCandidate.candidate);
      if (byName) return byName;

      // 2. Position-based fallback (QR position X → DB index X-1)
      if (qrCandidate.position !== undefined) {
        const idx = qrCandidate.position - 1;
        const byPosition = dbList[idx];
        if (byPosition && byPosition.votes === qrCandidate.votes) {
          // Same position + same vote count → same candidate, different name
          return byPosition;
        }
      }

      return undefined;
    };

    /**
     * Find a QR candidate matching a DB candidate. Same strategy.
     */
    const matchQrCandidate = (
      qrList: CandidateVote[],
      dbCandidate: CandidateVote,
      index: number, // position in the DB list (used for fallback)
    ): CandidateVote | undefined => {
      // 1. Exact name match
      const byName = qrList.find(c => c.candidate === dbCandidate.candidate);
      if (byName) return byName;

      // 2. Position-based fallback (DB index X → QR position X+1)
      const byPosition = qrList.find(c => c.position === index + 1);
      if (byPosition && byPosition.votes === dbCandidate.votes) {
        return byPosition;
      }

      return undefined;
    };

    // Check QR → DB: flag QR candidates missing or mismatched in DB
    for (const qrContest of qr) {
      const dbContest = db.find(c => c.contest_code === qrContest.contest_code);
      if (!dbContest) {
        // QR contest not found in DB at all → flag every candidate
        for (const qrCandidate of qrContest.candidates) {
          if (qrCandidate.candidate === 'Unparsed QR Data') continue;
          discrepancies.push({
            contest_code: qrContest.contest_code,
            contest_name: qrContest.contest_name,
            candidate: qrCandidate.candidate,
            qr_votes: qrCandidate.votes,
            db_votes: 0,
          });
        }
        continue;
      }

      for (const qrCandidate of qrContest.candidates) {
        if (qrCandidate.candidate === 'Unparsed QR Data') continue;
        const dbCandidate = matchDbCandidate(dbContest.candidates, qrCandidate);
        if (!dbCandidate) {
          // QR candidate missing from DB → flag with db_votes: 0
          discrepancies.push({
            contest_code: qrContest.contest_code,
            contest_name: qrContest.contest_name,
            candidate: qrCandidate.candidate,
            qr_votes: qrCandidate.votes,
            db_votes: 0,
          });
        } else if (dbCandidate.votes !== qrCandidate.votes) {
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

    // Check DB → QR: flag DB candidates not found in QR
    for (const dbContest of db) {
      const qrContest = qr.find(c => c.contest_code === dbContest.contest_code);
      if (!qrContest) {
        // DB contest not found in QR → flag every candidate
        for (const dbCandidate of dbContest.candidates) {
          discrepancies.push({
            contest_code: dbContest.contest_code,
            contest_name: dbContest.contest_name,
            candidate: dbCandidate.candidate,
            qr_votes: 0,
            db_votes: dbCandidate.votes,
          });
        }
        continue;
      }

      for (let idx = 0; idx < dbContest.candidates.length; idx++) {
        const dbCandidate = dbContest.candidates[idx];
        if (dbCandidate.candidate === 'Unparsed QR Data') continue;
        const qrCandidate = matchQrCandidate(qrContest.candidates, dbCandidate, idx);
        if (!qrCandidate) {
          // DB candidate missing from QR → flag with qr_votes: 0
          discrepancies.push({
            contest_code: dbContest.contest_code,
            contest_name: dbContest.contest_name,
            candidate: dbCandidate.candidate,
            qr_votes: 0,
            db_votes: dbCandidate.votes,
          });
        }
      }
    }

    return discrepancies;
  }
}
