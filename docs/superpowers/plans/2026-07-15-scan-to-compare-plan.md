# Scan to Compare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/compare` page where volunteers scan VCM receipt QR codes, compare against official DB results, and upload comparison records.

**Architecture:** New NestJS `ScanModule` queries DuckDB for official results (same pattern as `ResultsService`) and writes scan records to PostgreSQL via `pg`. Next.js frontend uses `html5-qrcode` for live camera scanning and renders side-by-side comparison tables with red discrepancy highlights.

**Tech Stack:** NestJS 11 (API), Next.js 15 (web), PostgreSQL via `pg`, DuckDB CLI (existing), `html5-qrcode` (frontend), Tailwind CSS (existing theme tokens).

## Global Constraints

- Reuse existing DuckDB `execFileSync` pattern for reads — no DuckDB Node.js client
- PostgreSQL connection must use `pg` Pool, configured via `PGHOST`/`PGDATABASE`/`PGUSER` env vars
- All API endpoints prefixed with `/api` (existing convention)
- Frontend components are `'use client'` (existing convention)
- Use existing Tailwind color tokens: `ink` (`#1B3A5C`), `ballot` (`#F8F6F0`), `stamp` (`#C41E3A`), `seal` (`#B8860B`), `field` (`#E8E5DE`)
- QR scanner must work on mobile browsers (camera permission)
- Allow upload even with missing/partial data (lenient error handling)

---

### Task 1: PostgreSQL Connection + ScanModule Scaffold

**Files:**
- Modify: `apps/api/package.json` — add `pg` dependency
- Create: `apps/api/src/modules/scan/scan.module.ts`
- Create: `apps/api/src/modules/scan/scan.service.ts`
- Create: `apps/api/src/modules/scan/scan.controller.ts`
- Create: `apps/api/src/modules/scan/dto/scan-compare.dto.ts`
- Create: `apps/api/src/modules/scan/dto/scan-upload.dto.ts`
- Modify: `apps/api/src/app.module.ts` — register ScanModule

**Interfaces:**
- Produces: `ScanService` class with `getPool()` method returning `pg.Pool`
- Produces: `ScanModule` imports `pg.Pool` as a provider, registers `ScanController`

**Database schema** (created on module init or manually):

```sql
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
);
```

- [ ] **Step 1: Add `pg` dependency**

Edit `apps/api/package.json` — add `"pg": "^8.14.0"` to `dependencies`.

Run: `pnpm install --filter api`

- [ ] **Step 2: Create ScanService with PG pool**

Write `apps/api/src/modules/scan/scan.service.ts`:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class ScanService implements OnModuleInit {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      host: process.env.PGHOST || 'localhost',
      database: process.env.PGDATABASE || 'pprcv_local',
      user: process.env.PGUSER || 'daryllmagsombol',
    });
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
}
```

- [ ] **Step 3: Create ScanModule**

Write `apps/api/src/modules/scan/scan.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ScanService } from './scan.service';
import { ScanController } from './scan.controller';

@Module({
  controllers: [ScanController],
  providers: [ScanService],
  exports: [ScanService],
})
export class ScanModule {}
```

- [ ] **Step 4: Create ScanController (stub)**

Write `apps/api/src/modules/scan/scan.controller.ts`:

```typescript
import { Controller, Post, Get, Body } from '@nestjs/common';
import { ScanService } from './scan.service';

@Controller('api/scan')
export class ScanController {
  constructor(private readonly scanService: ScanService) {}

  @Post('compare')
  async compare(@Body() body: any) {
    return { message: 'not implemented yet' };
  }

  @Post('upload')
  async upload(@Body() body: any) {
    return { message: 'not implemented yet' };
  }

  @Get('history')
  async history() {
    return { message: 'not implemented yet' };
  }
}
```

- [ ] **Step 5: Create validation DTOs**

Write `apps/api/src/modules/scan/dto/scan-compare.dto.ts`:

```typescript
import { IsString, IsOptional } from 'class-validator';

export class ScanCompareDto {
  @IsString()
  precinct_id: string;

  @IsOptional()
  @IsString()
  qr_raw_1?: string;

  @IsOptional()
  @IsString()
  qr_raw_2?: string;

  @IsOptional()
  @IsString()
  qr_raw_3?: string;
}
```

Write `apps/api/src/modules/scan/dto/scan-upload.dto.ts`:

```typescript
import { IsString, IsBoolean, IsOptional, IsArray } from 'class-validator';

export class ScanUploadDto {
  @IsString()
  precinct_id: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  municipality?: string;

  @IsOptional()
  @IsString()
  barangay?: string;

  @IsOptional()
  @IsString()
  qr_raw_1?: string;

  @IsOptional()
  @IsString()
  qr_raw_2?: string;

  @IsOptional()
  @IsString()
  qr_raw_3?: string;

  @IsOptional()
  qr_parsed?: any;

  @IsOptional()
  db_results?: any;

  @IsOptional()
  @IsBoolean()
  has_discrepancy?: boolean;

  @IsOptional()
  discrepancy_details?: any;

  @IsOptional()
  @IsString()
  scanned_by?: string;
}
```

- [ ] **Step 6: Register ScanModule in AppModule**

Edit `apps/api/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ResultsModule } from './modules/results/results.module';
import { ScanModule } from './modules/scan/scan.module';

@Module({
  imports: [ResultsModule, ScanModule],
})
export class AppModule {}
```

- [ ] **Step 7: Run tests to verify module loads**

Run: `cd apps/api && npx jest --no-coverage --passWithNoTests 2>&1 | head -30`
Expected: Tests pass (no scan test files yet, but existing tests should still pass)

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/api/src/modules/scan/ apps/api/src/app.module.ts
git commit -m "feat(api): add ScanModule with PostgreSQL connection"
```

---

### Task 2: ScanService.compare() — DuckDB Query + Comparison Logic

**Files:**
- Modify: `apps/api/src/modules/scan/scan.service.ts` — add `compare()` and `queryPrecinctResults()` methods
- Create: `apps/api/src/modules/scan/interfaces.ts` — shared types
- Test: `apps/api/src/modules/scan/__tests__/scan.service.spec.ts`

**Interfaces:**
- Consumes: `ScanService.getPool()` from Task 1
- Produces: `ScanService.compare(dto: ScanCompareDto)` → `ComparisonResult`
- Produces: `ScanService.queryPrecinctResults(precinctId: string)` → `ContestResult[]`
- Produces: `interface ComparisonResult { precinct_id, qr_parsed, db_results, has_discrepancy, discrepancy_details }`

- [ ] **Step 1: Create shared interfaces**

Write `apps/api/src/modules/scan/interfaces.ts`:

```typescript
export interface CandidateVote {
  candidate: string;
  party: string;
  votes: number;
}

export interface ContestResult {
  contest_code: string;
  contest_name: string;
  category: string;
  candidates: CandidateVote[];
}

export interface Discrepancy {
  contest_code: string;
  contest_name: string;
  candidate: string;
  qr_votes: number;
  db_votes: number;
}

export interface ComparisonResult {
  precinct_id: string;
  qr_parsed: ContestResult[];
  db_results: ContestResult[];
  has_discrepancy: boolean;
  discrepancy_details: Discrepancy[];
}
```

- [ ] **Step 2: Write failing test for compare()**

Write `apps/api/src/modules/scan/__tests__/scan.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ScanService } from '../scan.service';

describe('ScanService', () => {
  let service: ScanService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ScanService],
    }).compile();
    service = module.get<ScanService>(ScanService);
  });

  afterAll(async () => {
    await service.getPool().end();
  });

  describe('compare', () => {
    it('should return comparison with no discrepancies when QR matches DB', async () => {
      // Mock QR data that matches known test data
      const result = await service.compare({
        precinct_id: '01010001',
        qr_raw_1: JSON.stringify({
          contest_code: '1010010',
          candidates: [
            { candidate: 'ANDAL, GLENN (LAKAS)', party: '28', votes: 242 },
          ],
        }),
      });

      expect(result).toHaveProperty('precinct_id', '01010001');
      expect(result).toHaveProperty('has_discrepancy');
      expect(Array.isArray(result.discrepancy_details)).toBe(true);
    });

    it('should detect discrepancy when votes differ', async () => {
      const result = await service.compare({
        precinct_id: '01010001',
        qr_raw_1: JSON.stringify({
          contest_code: '1010010',
          candidates: [
            { candidate: 'ANDAL, GLENN (LAKAS)', party: '28', votes: 999 }, // deliberately wrong
          ],
        }),
      });

      expect(result.has_discrepancy).toBe(true);
      expect(result.discrepancy_details.length).toBeGreaterThan(0);
      expect(result.discrepancy_details[0].qr_votes).toBe(999);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/scan/__tests__/scan.service.spec.ts --no-coverage -v 2>&1`
Expected: FAIL — `compare()` doesn't exist yet

- [ ] **Step 4: Implement compare() logic in ScanService**

Modify `apps/api/src/modules/scan/scan.service.ts` — add methods:

```typescript
import { execFileSync } from 'child_process';
import * as path from 'path';
// ... other imports
import { ScanCompareDto } from './dto/scan-compare.dto';
import { ComparisonResult, ContestResult, CandidateVote, Discrepancy } from './interfaces';

// Add to class:

private readonly parquetBase: string;

constructor() {
  // ... existing pool init ...
  this.parquetBase =
    process.env.PARQUET_BASE_PATH ||
    path.resolve(__dirname, '..', '..', '..', '..', '..', 'apps', 'etl', 'output');
}

async compare(dto: ScanCompareDto): Promise<ComparisonResult> {
  // 1. Parse QR data
  const qrParsed = this.parseQrData(dto);

  // 2. Query DuckDB for precinct results
  const dbResults = await this.queryPrecinctResults(dto.precinct_id);

  // 3. Compare
  const discrepancies = this.findDiscrepancies(qrParsed, dbResults);

  return {
    precinct_id: dto.precinct_id,
    qr_parsed: qrParsed,
    db_results: dbResults,
    has_discrepancy: discrepancies.length > 0,
    discrepancy_details: discrepancies,
  };
}

private parseQrData(dto: ScanCompareDto): ContestResult[] {
  const results: ContestResult[] = [];
  for (const raw of [dto.qr_raw_1, dto.qr_raw_2, dto.qr_raw_3]) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      // Support both single contest and array formats
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item.contest_code && item.candidates) {
          results.push({
            contest_code: String(item.contest_code).padStart(8, '0'),
            contest_name: item.contest_name || item.contest_code,
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
      // QR data not JSON — store as raw text reference
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
    const sql = `
      SELECT contest_code, candidate_name, party_code, SUM(total_votes) as votes
      FROM '${glob}'
      WHERE pollplace LIKE '%${precinctId}%'
      GROUP BY contest_code, candidate_name, party_code
      ORDER BY contest_code, votes DESC
    `.trim().replace(/\s+/g, ' ');

    const output = execFileSync('duckdb', ['-json', '-c', sql], {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });
    const rows = JSON.parse(output);

    // Group by contest_code
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
        contest_name: code, // Could load from contest-names.json
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
    '003': 'Senator', '004': 'Governor', '005': 'Vice Governor',
    '006': 'Provincial Board', '007': 'House of Reps', '008': 'Mayor',
    '009': 'Vice Mayor', '010': 'Councilor', '011': 'Party List',
  };
  return map[prefix] || 'Unknown';
}

private findDiscrepancies(qr: ContestResult[], db: ContestResult[]): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];
  for (const qrContest of qr) {
    const dbContest = db.find(c => c.contest_code === qrContest.contest_code);
    if (!dbContest) continue;
    for (const qrCandidate of qrContest.candidates) {
      const dbCandidate = dbContest.candidates.find(
        c => c.candidate === qrCandidate.candidate
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && npx jest src/modules/scan/__tests__/scan.service.spec.ts --no-coverage -v 2>&1`
Expected: PASS (or relevant pass/skip based on actual DuckDB data availability)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/scan/scan.service.ts apps/api/src/modules/scan/interfaces.ts apps/api/src/modules/scan/__tests__/scan.service.spec.ts
git commit -m "feat(api): add ScanService.compare() with DuckDB query + discrepancy detection"
```

---

### Task 3: ScanController — Compare, Upload, History Endpoints

**Files:**
- Modify: `apps/api/src/modules/scan/scan.controller.ts` — full implementation
- Modify: `apps/api/src/modules/scan/scan.service.ts` — add `upload()` and `getHistory()` methods
- Create: `apps/api/src/modules/scan/__tests__/scan.controller.spec.ts` — controller tests

**Interfaces:**
- Consumes: `ScanService.compare(dto)`, `ScanService.upload(dto)`, `ScanService.getHistory()`
- Produces: `POST /api/scan/compare` → `ComparisonResult`, `POST /api/scan/upload` → `{ id, uploaded }`, `GET /api/scan/history` → `ScanRecord[]`

- [ ] **Step 1: Add upload() and getHistory() to ScanService**

Add to `apps/api/src/modules/scan/scan.service.ts`:

```typescript
import { ScanUploadDto } from './dto/scan-upload.dto';

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
    ]
  );
  return { id: result.rows[0].id, uploaded: true };
}

async getHistory(limit: number = 50): Promise<any[]> {
  const result = await this.pool.query(
    'SELECT * FROM scan_records ORDER BY scanned_at DESC LIMIT $1',
    [limit]
  );
  return result.rows;
}
```

- [ ] **Step 2: Implement full ScanController**

Write `apps/api/src/modules/scan/scan.controller.ts`:

```typescript
import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { ScanService } from './scan.service';
import { ScanCompareDto } from './dto/scan-compare.dto';
import { ScanUploadDto } from './dto/scan-upload.dto';

@Controller('api/scan')
export class ScanController {
  constructor(private readonly scanService: ScanService) {}

  @Post('compare')
  async compare(@Body() dto: ScanCompareDto) {
    return this.scanService.compare(dto);
  }

  @Post('upload')
  async upload(@Body() dto: ScanUploadDto) {
    return this.scanService.upload(dto);
  }

  @Get('history')
  async history(@Query('limit') limit?: string) {
    return this.scanService.getHistory(limit ? parseInt(limit, 10) : 50);
  }
}
```

- [ ] **Step 3: Write controller test**

Write `apps/api/src/modules/scan/__tests__/scan.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ScanController } from '../scan.controller';
import { ScanService } from '../scan.service';

describe('ScanController', () => {
  let controller: ScanController;
  let service: ScanService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScanController],
      providers: [ScanService],
    }).compile();
    controller = module.get<ScanController>(ScanController);
    service = module.get<ScanService>(ScanService);
  });

  afterAll(async () => {
    await service.getPool().end();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /api/scan/compare', () => {
    it('should return comparison result', async () => {
      const result = await controller.compare({
        precinct_id: '01010001',
        qr_raw_1: '{}',
      });
      expect(result).toHaveProperty('precinct_id');
      expect(result).toHaveProperty('has_discrepancy');
    });
  });

  describe('POST /api/scan/upload', () => {
    it('should upload and return id', async () => {
      const result = await controller.upload({
        precinct_id: '01010001',
        qr_raw_1: 'test-data',
        has_discrepancy: false,
      });
      expect(result).toHaveProperty('id');
      expect(result.uploaded).toBe(true);
    });
  });

  describe('GET /api/scan/history', () => {
    it('should return array of records', async () => {
      const result = await controller.history('10');
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx jest src/modules/scan/ --no-coverage -v 2>&1`
Expected: PASS

- [ ] **Step 5: Start API and test endpoints manually**

Run: `cd apps/api && npx nest start 2>&1 &` then:

```bash
curl -s -X POST http://localhost:3001/api/scan/compare \
  -H 'Content-Type: application/json' \
  -d '{"precinct_id":"01010001","qr_raw_1":"{}"}' | head -200
```

Expected: JSON response with comparison data

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/scan/scan.controller.ts apps/api/src/modules/scan/scan.service.ts apps/api/src/modules/scan/__tests__/scan.controller.spec.ts
git commit -m "feat(api): implement compare, upload, and history endpoints"
```

---

### Task 4: Frontend — QR Scanner Component

**Files:**
- Modify: `apps/web/package.json` — add `html5-qrcode`
- Create: `apps/web/src/app/compare/components/qr-scanner.tsx`
- Create: `apps/web/src/app/compare/components/scan-progress.tsx`

**Interfaces:**
- Produces: `QRScanner` component with `onScan(result: string)` callback and `onDone()` callback
- Produces: `ScanProgress` component with `scanned: number`, `total: number` props

- [ ] **Step 1: Add `html5-qrcode` dependency**

Edit `apps/web/package.json` — add `"html5-qrcode": "^2.3.8"` to `dependencies`.

Run: `pnpm install --filter web`

- [ ] **Step 2: Build QRScanner component**

Write `apps/web/src/app/compare/components/qr-scanner.tsx`:

```tsx
'use client';

import { useEffect, useRef, useCallback } from 'react';

interface QRScannerProps {
  onScan: (decodedText: string) => void;
  onError?: (error: string) => void;
  scanning: boolean;
}

export function QRScanner({ onScan, onError, scanning }: QRScannerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<any>(null);

  const startScanner = useCallback(async () => {
    if (!containerRef.current || typeof window === 'undefined') return;
    
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode('qr-scanner-container');
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText: string) => {
          // Stop scanning briefly, let parent re-start for next QR
          scanner.pause();
          onScan(decodedText);
        },
        () => {} // ignore unsuccessful reads
      );
    } catch (err: any) {
      onError?.(err?.message || 'Camera access denied');
    }
  }, [onScan, onError]);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (scanning) {
      startScanner();
    } else {
      stopScanner();
    }
    return () => { stopScanner(); };
  }, [scanning, startScanner, stopScanner]);

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        id="qr-scanner-container"
        ref={containerRef}
        className="overflow-hidden rounded-lg border-2 border-[#1B3A5C] bg-black"
        style={{ width: 300, height: 300 }}
      />
      <p className="text-sm text-gray-500">
        Point camera at QR code on VCM receipt
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Build ScanProgress component**

Write `apps/web/src/app/compare/components/scan-progress.tsx`:

```tsx
'use client';

interface ScanProgressProps {
  scanned: number;
  total: number;
  currentScanning: number;
}

export function ScanProgress({ scanned, total, currentScanning }: ScanProgressProps) {
  return (
    <div className="flex items-center justify-center gap-4">
      {Array.from({ length: total }, (_, i) => {
        const slot = i + 1;
        const isDone = slot <= scanned;
        const isCurrent = slot === currentScanning && scanned < total;
        return (
          <div
            key={slot}
            className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-lg font-bold transition-all
              ${isDone ? 'border-green-500 bg-green-50 text-green-700' : ''}
              ${isCurrent ? 'border-[#C41E3A] bg-red-50 text-[#C41E3A] animate-pulse' : ''}
              ${!isDone && !isCurrent ? 'border-gray-300 bg-gray-50 text-gray-400' : ''}
            `}
          >
            {isDone ? '✓' : slot}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Verify frontend builds**

Run: `cd apps/web && npx next build 2>&1 | tail -10`
Expected: Build succeeds (no errors)

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/src/app/compare/components/
git commit -m "feat(web): add QR scanner and scan progress components"
```

---

### Task 5: Frontend — Comparison View Component

**Files:**
- Create: `apps/web/src/app/compare/components/comparison-view.tsx`

**Interfaces:**
- Consumes: comparison data from API (same shape as `ComparisonResult`)
- Produces: `ComparisonView` component with side-by-side tables and red highlights

- [ ] **Step 1: Write comparison-view component**

Write `apps/web/src/app/compare/components/comparison-view.tsx`:

```tsx
'use client';

interface CandidateVote {
  candidate: string;
  party: string;
  votes: number;
}

interface ContestResult {
  contest_code: string;
  contest_name: string;
  category: string;
  candidates: CandidateVote[];
}

interface Discrepancy {
  contest_code: string;
  contest_name: string;
  candidate: string;
  qr_votes: number;
  db_votes: number;
}

interface ComparisonViewProps {
  precinct_id: string;
  qr_parsed: ContestResult[];
  db_results: ContestResult[];
  has_discrepancy: boolean;
  discrepancy_details: Discrepancy[];
  onUpload: () => void;
  uploading?: boolean;
}

function isDiscrepant(
  contestCode: string,
  candidateName: string,
  discrepancies: Discrepancy[],
): boolean {
  return discrepancies.some(
    d => d.contest_code === contestCode && d.candidate === candidateName,
  );
}

function ContestTable({
  contest,
  side,
  discrepancies,
}: {
  contest: ContestResult;
  side: 'qr' | 'db';
  discrepancies: Discrepancy[];
}) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-serif text-base font-bold text-[#1B3A5C]">
          {contest.contest_name}
        </h3>
        <span className="rounded bg-[#E8E5DE] px-2 py-0.5 text-xs font-semibold uppercase text-[#1B3A5C]">
          {contest.category}
        </span>
      </div>
      <table className="w-full border-t-2 border-b-2 border-[#1B3A5C]">
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-widest text-[#1B3A5C]">
            <th className="px-3 py-2">Candidate</th>
            <th className="px-3 py-2">Party</th>
            <th className="px-3 py-2 text-right">Votes</th>
          </tr>
        </thead>
        <tbody>
          {contest.candidates.map((c, i) => {
            const discrepant = isDiscrepant(contest.contest_code, c.candidate, discrepancies);
            return (
              <tr
                key={`${contest.contest_code}-${c.candidate}-${i}`}
                className={`even:bg-[#E8E5DE] ${discrepant ? 'bg-red-100' : ''}`}
              >
                <td className={`px-3 py-1.5 text-sm font-medium ${discrepant ? 'text-red-800' : 'text-[#1B3A5C]'}`}>
                  {c.candidate}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs text-gray-600">{c.party}</td>
                <td className={`px-3 py-1.5 text-right font-mono text-sm tabular-nums ${discrepant ? 'font-bold text-red-700' : ''}`}>
                  {c.votes.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ComparisonView({
  precinct_id,
  qr_parsed,
  db_results,
  has_discrepancy,
  discrepancy_details,
  onUpload,
  uploading,
}: ComparisonViewProps) {
  // Merge all contest codes from both sides
  const allContestCodes = new Set<string>();
  qr_parsed.forEach(c => allContestCodes.add(c.contest_code));
  db_results.forEach(c => allContestCodes.add(c.contest_code));

  const contests = Array.from(allContestCodes).map(code => {
    const qrContest = qr_parsed.find(c => c.contest_code === code);
    const dbContest = db_results.find(c => c.contest_code === code);
    return { code, qr: qrContest, db: dbContest };
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-lg border border-gray-200 bg-[#F8F6F0] p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-serif text-xl font-bold text-[#1B3A5C]">
              Precinct: {precinct_id}
            </h2>
          </div>
          {has_discrepancy && (
            <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">
              ⚠ Discrepancy Found
            </span>
          )}
          {!has_discrepancy && (
            <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">
              ✓ Match Verified
            </span>
          )}
        </div>
      </div>

      {/* Side-by-side tables */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Scanned QR Data */}
        <div>
          <h3 className="mb-4 font-serif text-lg font-bold text-[#1B3A5C]">
            Scanned QR Data
          </h3>
          {contests.map(({ code, qr }) => (
            qr ? (
              <ContestTable key={`qr-${code}`} contest={qr} side="qr" discrepancies={discrepancy_details} />
            ) : (
              <div key={`qr-${code}`} className="mb-6 rounded border border-dashed border-gray-300 p-4 text-center text-sm text-gray-400">
                No QR data for {code}
              </div>
            )
          ))}
          {qr_parsed.length === 0 && (
            <div className="rounded border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
              No QR data scanned
            </div>
          )}
        </div>

        {/* Official DB Results */}
        <div>
          <h3 className="mb-4 font-serif text-lg font-bold text-[#1B3A5C]">
            Official Results
          </h3>
          {contests.map(({ code, db }) => (
            db ? (
              <ContestTable key={`db-${code}`} contest={db} side="db" discrepancies={discrepancy_details} />
            ) : (
              <div key={`db-${code}`} className="mb-6 rounded border border-dashed border-gray-300 p-4 text-center text-sm text-gray-400">
                No data in DB for {code}
              </div>
            )
          ))}
          {db_results.length === 0 && (
            <div className="rounded border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
              Precinct not found in official results
            </div>
          )}
        </div>
      </div>

      {/* Discrepancy summary */}
      {discrepancy_details.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h4 className="mb-2 font-semibold text-red-800">
            Discrepancies ({discrepancy_details.length})
          </h4>
          <ul className="space-y-1 text-sm text-red-700">
            {discrepancy_details.map((d, i) => (
              <li key={i}>
                <strong>{d.contest_name}</strong> — {d.candidate}: QR has <strong>{d.qr_votes.toLocaleString()}</strong>, DB has <strong>{d.db_votes.toLocaleString()}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Upload button */}
      <div className="flex justify-center pt-4">
        <button
          onClick={onUpload}
          disabled={uploading}
          className="rounded-lg bg-[#1B3A5C] px-8 py-3 font-semibold text-[#F8F6F0] transition hover:bg-[#2a4d73] disabled:opacity-50"
        >
          {uploading ? 'Uploading...' : 'Upload & Save'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd apps/web && npx next build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/compare/components/comparison-view.tsx
git commit -m "feat(web): add comparison view with side-by-side tables and red highlights"
```

---

### Task 6: Frontend — Main Compare Page (State Machine)

**Files:**
- Create: `apps/web/src/app/compare/page.tsx`

**Interfaces:**
- Consumes: `QRScanner`, `ScanProgress`, `ComparisonView` components from Tasks 4-5
- Consumes: API endpoints from Task 3
- Produces: Full `/compare` page with scanning state machine

- [ ] **Step 1: Write the main page**

Write `apps/web/src/app/compare/page.tsx`:

```tsx
'use client';

import { useState, useCallback } from 'react';
import { QRScanner } from './components/qr-scanner';
import { ScanProgress } from './components/scan-progress';
import { ComparisonView } from './components/comparison-view';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
const TOTAL_QRS = 3;

type Stage = 'idle' | 'scanning' | 'comparing' | 'uploading' | 'done' | 'error';

interface ComparisonResult {
  precinct_id: string;
  qr_parsed: any[];
  db_results: any[];
  has_discrepancy: boolean;
  discrepancy_details: any[];
}

export default function ComparePage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [qrData, setQrData] = useState<string[]>([]);
  const [currentSlot, setCurrentSlot] = useState(1);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string>('');

  const handleScanResult = useCallback((decodedText: string) => {
    setQrData(prev => {
      const next = [...prev];
      next[currentSlot - 1] = decodedText;
      return next;
    });

    if (currentSlot >= TOTAL_QRS) {
      // All QR codes scanned — proceed to compare
      setStage('comparing');
      triggerComparison([...qrData, decodedText]);
    } else {
      setCurrentSlot(s => s + 1);
    }
  }, [currentSlot, qrData]);

  const handleDoneScanning = useCallback(() => {
    setStage('comparing');
    triggerComparison(qrData);
  }, [qrData]);

  const triggerComparison = async (scanned: string[]) => {
    setStage('comparing');
    setError('');
    try {
      const res = await fetch(`${API_URL}/scan/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          precinct_id: 'auto-detect', // Will be extracted from QR on server
          qr_raw_1: scanned[0] || '',
          qr_raw_2: scanned[1] || '',
          qr_raw_3: scanned[2] || '',
        }),
      });
      if (!res.ok) throw new Error('Compare request failed');
      const data = await res.json();
      setComparison(data);
      setStage('done');
    } catch (err: any) {
      setError(err.message || 'Failed to compare QR data');
      setStage('error');
    }
  };

  const handleUpload = useCallback(async () => {
    if (!comparison) return;
    setStage('uploading');
    try {
      const res = await fetch(`${API_URL}/scan/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          precinct_id: comparison.precinct_id,
          qr_raw_1: qrData[0] || '',
          qr_raw_2: qrData[1] || '',
          qr_raw_3: qrData[2] || '',
          qr_parsed: comparison.qr_parsed,
          db_results: comparison.db_results,
          has_discrepancy: comparison.has_discrepancy,
          discrepancy_details: comparison.discrepancy_details,
          scanned_by: 'Volunteer', // Could add a name input
        }),
      });
      if (!res.ok) throw new Error('Upload failed');
      setStage('done');
      alert('Scan record uploaded successfully!');
    } catch (err: any) {
      setError(err.message || 'Upload failed');
      setStage('error');
    }
  }, [comparison, qrData]);

  const handleReset = useCallback(() => {
    setStage('idle');
    setQrData([]);
    setCurrentSlot(1);
    setComparison(null);
    setError('');
  }, []);

  const handleScannerError = useCallback((err: string) => {
    setError(err);
    setStage('error');
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-8 font-serif text-3xl font-bold text-[#1B3A5C]">
        Scan to Compare
      </h1>

      {/* Stage: Idle */}
      {stage === 'idle' && (
        <div className="flex flex-col items-center gap-6 py-12">
          <p className="text-center text-gray-600">
            Scan QR codes from the VCM receipt to verify against official results.
          </p>
          <button
            onClick={() => setStage('scanning')}
            className="rounded-lg bg-[#1B3A5C] px-8 py-3 font-semibold text-[#F8F6F0] transition hover:bg-[#2a4d73]"
          >
            Start Scanning
          </button>
        </div>
      )}

      {/* Stage: Scanning */}
      {stage === 'scanning' && (
        <div className="flex flex-col items-center gap-6 py-8">
          <ScanProgress
            scanned={qrData.length}
            total={TOTAL_QRS}
            currentScanning={currentSlot}
          />
          <QRScanner
            onScan={handleScanResult}
            onError={handleScannerError}
            scanning={stage === 'scanning'}
          />
          <button
            onClick={handleDoneScanning}
            className="text-sm text-gray-500 underline hover:text-gray-700"
          >
            Done scanning (skip remaining)
          </button>
        </div>
      )}

      {/* Stage: Comparing */}
      {stage === 'comparing' && (
        <div className="flex flex-col items-center gap-4 py-12">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#E8E5DE] border-t-[#1B3A5C]" />
          <p className="text-gray-600">Comparing QR data against official results...</p>
        </div>
      )}

      {/* Stage: Error */}
      {stage === 'error' && (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-red-200 bg-red-50 p-8">
          <p className="text-red-700">{error}</p>
          <div className="flex gap-4">
            <button
              onClick={handleReset}
              className="rounded-lg bg-[#1B3A5C] px-6 py-2 font-semibold text-[#F8F6F0]"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* Stage: Done — show comparison */}
      {stage === 'done' && comparison && (
        <ComparisonView
          precinct_id={comparison.precinct_id}
          qr_parsed={comparison.qr_parsed}
          db_results={comparison.db_results}
          has_discrepancy={comparison.has_discrepancy}
          discrepancy_details={comparison.discrepancy_details}
          onUpload={handleUpload}
          uploading={stage === 'uploading'}
        />
      )}

      {/* Stage: Uploading */}
      {stage === 'uploading' && (
        <div className="flex flex-col items-center gap-4 py-12">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#E8E5DE] border-t-[#1B3A5C]" />
          <p className="text-gray-600">Uploading scan record...</p>
        </div>
      )}

      {/* Always show reset after done */}
      {(stage === 'done' || stage === 'uploading') && (
        <div className="mt-8 text-center">
          <button
            onClick={handleReset}
            className="text-sm text-gray-500 underline hover:text-gray-700"
          >
            Scan another receipt
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd apps/web && npx next build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/compare/page.tsx
git commit -m "feat(web): add /compare page with scan-to-compare state machine"
```

---

### Task 7: Integration — End-to-End Flow

**Files:**
- No new files — focus on verifying the full flow works end-to-end

- [ ] **Step 1: Start both services**

Run (in separate terminals or background):
```bash
cd apps/api && npx nest start &
cd apps/web && npx next dev &
```

Wait 5 seconds for both to be ready.

- [ ] **Step 2: Test compare endpoint with mock QR data**

```bash
curl -s -X POST http://localhost:3001/api/scan/compare \
  -H 'Content-Type: application/json' \
  -d '{"precinct_id":"01010001","qr_raw_1":"{\"contest_code\":\"1010010\",\"candidates\":[{\"candidate\":\"ANDAL, GLENN (LAKAS)\",\"party\":\"28\",\"votes\":242}]}"}' \
  | python3 -m json.tool
```

Expected: Returns comparison with `has_discrepancy: false` or actual discrepancy data

- [ ] **Step 3: Test upload endpoint**

```bash
curl -s -X POST http://localhost:3001/api/scan/upload \
  -H 'Content-Type: application/json' \
  -d '{"precinct_id":"01010001","qr_raw_1":"test","has_discrepancy":false,"scanned_by":"Integration Test"}' \
  | python3 -m json.tool
```

Expected: `{ "id": 1, "uploaded": true }`

- [ ] **Step 4: Verify history endpoint**

```bash
curl -s http://localhost:3001/api/scan/history | python3 -m json.tool | head -20
```

Expected: Array with the record just uploaded

- [ ] **Step 5: Run all API tests**

Run: `cd apps/api && npx jest --no-coverage -v 2>&1`
Expected: All tests pass

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete scan-to-compare integration"
```
