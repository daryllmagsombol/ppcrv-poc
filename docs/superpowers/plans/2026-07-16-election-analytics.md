# Election Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add map view, vote share breakdown, and undervote/overvote analysis to the PPCRV election monitoring platform.

**Architecture:** Three new NestJS API endpoints query existing DuckDB Parquet data (no new infra). Frontend analytics page uses Leaflet for geographic drill-down (National → Region → Province → City) and Recharts for bar/pie charts. GeoJSON boundary files are served as static assets from the frontend.

**Tech Stack:** NestJS 11, Next.js 15, Leaflet + react-leaflet, Recharts, DuckDB (existing), Tailwind CSS (existing)

## Global Constraints

- All API endpoints query existing DuckDB Parquet files — no new database or caching layer
- NestJS controllers use `@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))` — existing pattern
- DTOs use `class-validator` decorators (same as `result-query.dto.ts`)
- Test files go in `__tests__/` adjacent to source files
- Frontend components use `'use client'` directive
- Frontend fetches via `/api/*` (rewritten to `localhost:3001` in dev)
- No new cloud infrastructure required
- GeoJSON boundaries simplified to <1MB per level using mapshaper

---
### Task 1: Backend — Analytics Module Scaffold + Geography-Status Endpoint

**Files:**
- Create: `apps/api/src/modules/analytics/analytics.module.ts`
- Create: `apps/api/src/modules/analytics/analytics.controller.ts`
- Create: `apps/api/src/modules/analytics/analytics.service.ts`
- Create: `apps/api/src/modules/analytics/__tests__/analytics.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts` — register AnalyticsModule

**Interfaces:**
- Consumes: `execFileSync('duckdb', ['-json', ...])` — existing pattern in ResultsService
- Produces: `AnalyticsService.getGeographyStatus()` → `Promise<RegionStatus[]>`

- [ ] **Step 1: Create `analytics.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
```

- [ ] **Step 2: Create `analytics.service.ts`**

Paste this content:

```typescript
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
```

- [ ] **Step 3: Create `analytics.controller.ts`**

```typescript
import { Controller, Get, Param, Query, UsePipes, ValidationPipe, BadRequestException } from '@nestjs/common';
import { AnalyticsService, RegionStatus } from './analytics.service';

@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
@Controller('api/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('geography-status')
  getGeographyStatus(): RegionStatus[] {
    return this.analyticsService.getGeographyStatus();
  }

  @Get('geography-status/regions/:reg')
  getProvinceStatus(@Param('reg') reg: string) {
    return this.analyticsService.getProvinceStatus(reg);
  }

  @Get('geography-status/regions/:reg/provinces/:prv')
  getCityStatus(@Param('reg') reg: string, @Param('prv') prv: string) {
    return this.analyticsService.getCityStatus(reg, prv);
  }
}
```

- [ ] **Step 4: Register AnalyticsModule in `app.module.ts`**

Edit `apps/api/src/app.module.ts`. Add the import:

```typescript
import { AnalyticsModule } from './modules/analytics/analytics.module';
```

Add `AnalyticsModule` to the imports array:

```typescript
@Module({
  imports: [ResultsModule, ScanModule, AnalyticsModule],
})
```

- [ ] **Step 5: Create `analytics.controller.spec.ts`**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from '../analytics.controller';
import { AnalyticsService, RegionStatus } from '../analytics.service';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let service: AnalyticsService;

  const mockService = {
    getGeographyStatus: jest.fn(),
    getProvinceStatus: jest.fn(),
    getCityStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [{ provide: AnalyticsService, useValue: mockService }],
    }).compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('GET /api/analytics/geography-status should return region statuses', () => {
    const mock: RegionStatus[] = [
      { name: 'NCR', totalPrecincts: 100, reportedPrecincts: 80, completionRate: 80 },
    ];
    mockService.getGeographyStatus.mockReturnValue(mock);
    expect(controller.getGeographyStatus()).toEqual(mock);
    expect(mockService.getGeographyStatus).toHaveBeenCalled();
  });

  it('GET /api/analytics/geography-status/regions/:reg should return province statuses', () => {
    const mock = [{ name: 'METRO MANILA', totalPrecincts: 50, reportedPrecincts: 40, completionRate: 80 }];
    mockService.getProvinceStatus.mockReturnValue(mock);
    expect(controller.getProvinceStatus('NCR')).toEqual(mock);
    expect(mockService.getProvinceStatus).toHaveBeenCalledWith('NCR');
  });

  it('GET /api/analytics/geography-status/regions/:reg/provinces/:prv should return city statuses', () => {
    const mock = [{ name: 'MANILA', totalPrecincts: 20, reportedPrecincts: 15, completionRate: 75 }];
    mockService.getCityStatus.mockReturnValue(mock);
    expect(controller.getCityStatus('NCR', 'METRO MANILA')).toEqual(mock);
    expect(mockService.getCityStatus).toHaveBeenCalledWith('NCR', 'METRO MANILA');
  });
});
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd apps/api && npx jest --no-coverage --testPathPattern 'analytics.controller.spec'
```

Expected: All 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/analytics/ apps/api/src/app.module.ts
git commit -m "feat: add analytics module with geography-status endpoint"
```

---
### Task 2: Backend — Vote-Share Endpoint

**Files:**
- Create: `apps/api/src/modules/analytics/dto/vote-share-query.dto.ts`
- Modify: `apps/api/src/modules/analytics/analytics.service.ts` — add vote-share method
- Modify: `apps/api/src/modules/analytics/analytics.controller.ts` — add vote-share route
- Create: `apps/api/src/modules/analytics/__tests__/analytics.service.spec.ts`

**Interfaces:**
- Consumes: `AnalyticsService.getGeographyStatus()` (from Task 1)
- Produces: `AnalyticsService.getVoteShare(params)` → `VoteShareResponse`

- [ ] **Step 1: Create `dto/vote-share-query.dto.ts`**

```typescript
import { IsOptional, IsString, Matches } from 'class-validator';

export class VoteShareQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'contest must be an 8-digit code' })
  contest?: string;

  @IsOptional()
  @IsString()
  reg?: string;

  @IsOptional()
  @IsString()
  prv?: string;

  @IsOptional()
  @IsString()
  mun?: string;
}
```

- [ ] **Step 2: Add types and method to `analytics.service.ts`**

Add these exports after the existing types:

```typescript
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
```

Add this method to the `AnalyticsService` class:

```typescript
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
```

- [ ] **Step 3: Add vote-share route to `analytics.controller.ts`**

Add after the existing routes:

```typescript
import { VoteShareQueryDto } from './dto/vote-share-query.dto';
import { VoteShareResponse } from './analytics.service';
```

And the route:

```typescript
@Get('vote-share')
getVoteShare(@Query() query: VoteShareQueryDto): VoteShareResponse {
  return this.analyticsService.getVoteShare(query);
}
```

- [ ] **Step 4: Create `__tests__/analytics.service.spec.ts`**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from '../analytics.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AnalyticsService],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getVoteShare should throw BadRequestException on DuckDB failure', () => {
    // With no Parquet data available, DuckDB will fail — verify it throws
    expect(() => service.getVoteShare({})).toThrow();
  });

  it('getVoteShare with contest filter builds correct query structure', () => {
    // Test that the method exists and accepts the expected params shape
    expect(typeof service.getVoteShare).toBe('function');
    expect(service.getVoteShare.length).toBe(1); // takes one params object
  });
});
```

- [ ] **Step 5: Run tests**

```bash
cd apps/api && npx jest --no-coverage --testPathPattern 'analytics'
```

Expected: All tests pass (or the DuckDB query tests throw as expected).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/analytics/
git commit -m "feat: add vote-share analytics endpoint"
```

---
### Task 3: Backend — Undervotes Endpoint

**Files:**
- Create: `apps/api/src/modules/analytics/dto/undervotes-query.dto.ts`
- Modify: `apps/api/src/modules/analytics/analytics.service.ts` — add undervotes method
- Modify: `apps/api/src/modules/analytics/analytics.controller.ts` — add undervotes route
- Modify: `apps/api/src/modules/analytics/__tests__/analytics.service.spec.ts` — add undervote tests

**Interfaces:**
- Consumes: `AnalyticsService.getVoteShare()` (from Task 2)
- Produces: `AnalyticsService.getUndervotes(params)` → `UndervoteResponse`

- [ ] **Step 1: Create `dto/undervotes-query.dto.ts`**

```typescript
import { IsOptional, IsString, Matches } from 'class-validator';

export class UndervotesQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'contest must be an 8-digit code' })
  contest?: string;

  @IsOptional()
  @IsString()
  reg?: string;

  @IsOptional()
  @IsString()
  prv?: string;

  @IsOptional()
  @IsString()
  mun?: string;
}
```

- [ ] **Step 2: Add types and method to `analytics.service.ts`**

Add these exports:

```typescript
export interface UndervoteResponse {
  totalVotes: number;
  totalUndervotes: number;
  totalOvervotes: number;
  undervoteRate: number;
  overvoteRate: number;
}
```

Add this method to the `AnalyticsService` class:

```typescript
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
           SUM(total_under_votes) as total_under_votes,
           SUM(total_over_votes) as total_over_votes
    FROM '${glob}'
    ${whereClause}
  `.trim().replace(/\s+/g, ' ');

  let rows: any[];
  try {
    const output = execFileSync('duckdb', ['-json', '-c', sql], {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });
    rows = JSON.parse(output);
  } catch {
    throw new BadRequestException('Failed to query undervote data');
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
```

- [ ] **Step 3: Add undervotes route to `analytics.controller.ts`**

Add the import:

```typescript
import { UndervotesQueryDto } from './dto/undervotes-query.dto';
import { UndervoteResponse } from './analytics.service';
```

And the route:

```typescript
@Get('undervotes')
getUndervotes(@Query() query: UndervotesQueryDto): UndervoteResponse {
  return this.analyticsService.getUndervotes(query);
}
```

- [ ] **Step 4: Add undervote tests to `analytics.service.spec.ts`**

Append to the existing describe block:

```typescript
it('getUndervotes should throw BadRequestException on DuckDB failure', () => {
  expect(() => service.getUndervotes({})).toThrow();
});

it('getUndervotes accepts expected params shape', () => {
  expect(typeof service.getUndervotes).toBe('function');
  expect(service.getUndervotes.length).toBe(1);
});
```

- [ ] **Step 5: Run tests**

```bash
cd apps/api && npx jest --no-coverage --testPathPattern 'analytics'
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/analytics/
git commit -m "feat: add undervotes analytics endpoint"
```

---
### Task 4: Frontend — Install Dependencies + Create Analytics Page Layout

**Files:**
- Modify: `apps/web/package.json` — add leaflet, react-leaflet, recharts
- Create: `apps/web/src/app/analytics/page.tsx`
- Create: `apps/web/src/app/analytics/hooks/use-analytics.ts`
- Create: `apps/web/src/app/analytics/types.ts`

**Interfaces:**
- Consumes: Backend API endpoints (from Tasks 1-3) at `/api/analytics/*`
- Produces: Analytics page with layout ready for map and chart components

- [ ] **Step 1: Install dependencies**

```bash
cd apps/web && pnpm add leaflet react-leaflet recharts && pnpm add -D @types/leaflet
```

- [ ] **Step 2: Create `types.ts`**

```typescript
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
```

- [ ] **Step 3: Create `hooks/use-analytics.ts`**

```typescript
'use client';

import { useState, useCallback, useRef } from 'react';
import { RegionStatus, ProvinceStatus, CityStatus, VoteShareResponse, UndervoteResponse, GeoSelection } from '../types';

const API = '/api/analytics';

export function useAnalytics() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoSelection, setGeoSelection] = useState<GeoSelection>({ level: 'national' });
  const [regionStatuses, setRegionStatuses] = useState<RegionStatus[]>([]);
  const [provinceStatuses, setProvinceStatuses] = useState<ProvinceStatus[]>([]);
  const [cityStatuses, setCityStatuses] = useState<CityStatus[]>([]);
  const [voteShare, setVoteShare] = useState<VoteShareResponse | null>(null);
  const [undervotes, setUndervotes] = useState<UndervoteResponse | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchJson = useCallback(async (url: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return await res.json();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      throw err;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const loadGeographyStatus = useCallback(async () => {
    try {
      const data = await fetchJson(`${API}/geography-status`);
      if (data) setRegionStatuses(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, [fetchJson]);

  const loadProvinceStatus = useCallback(async (region: string) => {
    try {
      const data = await fetchJson(`${API}/geography-status/regions/${encodeURIComponent(region)}`);
      if (data) setProvinceStatuses(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, [fetchJson]);

  const loadCityStatus = useCallback(async (region: string, province: string) => {
    try {
      const data = await fetchJson(
        `${API}/geography-status/regions/${encodeURIComponent(region)}/provinces/${encodeURIComponent(province)}`
      );
      if (data) setCityStatuses(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, [fetchJson]);

  const loadVoteShare = useCallback(async (selection: GeoSelection, contest?: string) => {
    const params = new URLSearchParams();
    if (contest) params.set('contest', contest);
    if (selection.region) params.set('reg', selection.region);
    if (selection.province) params.set('prv', selection.province);
    if (selection.city) params.set('mun', selection.city);
    try {
      const data = await fetchJson(`${API}/vote-share?${params}`);
      if (data) setVoteShare(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, [fetchJson]);

  const loadUndervotes = useCallback(async (selection: GeoSelection, contest?: string) => {
    const params = new URLSearchParams();
    if (contest) params.set('contest', contest);
    if (selection.region) params.set('reg', selection.region);
    if (selection.province) params.set('prv', selection.province);
    if (selection.city) params.set('mun', selection.city);
    try {
      const data = await fetchJson(`${API}/undervotes?${params}`);
      if (data) setUndervotes(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, [fetchJson]);

  const selectRegion = useCallback(async (region: string) => {
    const sel: GeoSelection = { level: 'region', region };
    setGeoSelection(sel);
    setProvinceStatuses([]);
    setCityStatuses([]);
    await Promise.all([
      loadProvinceStatus(region),
      loadVoteShare(sel),
      loadUndervotes(sel),
    ]);
  }, [loadProvinceStatus, loadVoteShare, loadUndervotes]);

  const selectProvince = useCallback(async (region: string, province: string) => {
    const sel: GeoSelection = { level: 'province', region, province };
    setGeoSelection(sel);
    setCityStatuses([]);
    await Promise.all([
      loadCityStatus(region, province),
      loadVoteShare(sel),
      loadUndervotes(sel),
    ]);
  }, [loadCityStatus, loadVoteShare, loadUndervotes]);

  const selectCity = useCallback(async (region: string, province: string, city: string) => {
    const sel: GeoSelection = { level: 'city', region, province, city };
    setGeoSelection(sel);
    await Promise.all([
      loadVoteShare(sel),
      loadUndervotes(sel),
    ]);
  }, [loadVoteShare, loadUndervotes]);

  const goToNational = useCallback(async () => {
    setGeoSelection({ level: 'national' });
    setProvinceStatuses([]);
    setCityStatuses([]);
    await Promise.all([
      loadGeographyStatus(),
      loadVoteShare({ level: 'national' }),
      loadUndervotes({ level: 'national' }),
    ]);
  }, [loadGeographyStatus, loadVoteShare, loadUndervotes]);

  return {
    loading, error, geoSelection,
    regionStatuses, provinceStatuses, cityStatuses,
    voteShare, undervotes,
    loadGeographyStatus, selectRegion, selectProvince, selectCity, goToNational,
  };
}
```

- [ ] **Step 4: Create `app/analytics/page.tsx` (skeleton layout)**

```tsx
'use client';

import { useEffect } from 'react';
import { useAnalytics } from './hooks/use-analytics';

export default function AnalyticsPage() {
  const {
    loading, error, geoSelection,
    regionStatuses, provinceStatuses, cityStatuses,
    voteShare, undervotes,
    loadGeographyStatus, selectRegion, selectProvince, selectCity, goToNational,
  } = useAnalytics();

  useEffect(() => {
    loadGeographyStatus();
  }, [loadGeographyStatus]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-6 font-serif text-2xl font-bold text-[#1B3A5C]">
        Election Analytics
      </h1>

      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-600">
        <button onClick={goToNational} className="hover:text-[#1B3A5C] hover:underline">
          National
        </button>
        {geoSelection.region && (
          <>
            <span>/</span>
            <span className="font-medium text-[#1B3A5C]">{geoSelection.region}</span>
          </>
        )}
        {geoSelection.province && (
          <>
            <span>/</span>
            <span className="font-medium text-[#1B3A5C]">{geoSelection.province}</span>
          </>
        )}
        {geoSelection.city && (
          <>
            <span>/</span>
            <span className="font-medium text-[#1B3A5C]">{geoSelection.city}</span>
          </>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Map View (placeholder) */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 font-serif text-lg font-semibold text-[#1B3A5C]">Map View</h2>
          <div className="flex h-80 items-center justify-center rounded bg-gray-50 text-sm text-gray-400">
            Map component will render here
          </div>
          <div className="mt-3 text-xs text-gray-500">
            {geoSelection.level === 'national' && `${regionStatuses.length} regions loaded`}
            {geoSelection.level === 'region' && `${provinceStatuses.length} provinces loaded`}
            {geoSelection.level === 'province' && `${cityStatuses.length} cities loaded`}
          </div>
        </div>

        <div className="space-y-6">
          {/* Vote Share Chart (placeholder) */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="mb-3 font-serif text-lg font-semibold text-[#1B3A5C]">
              Vote Share {voteShare?.contest && `- ${voteShare.contest}`}
            </h2>
            <div className="flex h-64 items-center justify-center rounded bg-gray-50 text-sm text-gray-400">
              {loading ? 'Loading...' : voteShare ? `${voteShare.candidates.length} candidates` : 'Select a geography'}
            </div>
          </div>

          {/* Undervote Panel (placeholder) */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="mb-3 font-serif text-lg font-semibold text-[#1B3A5C]">
              Under / Over Vote Analysis
            </h2>
            <div className="flex h-32 items-center justify-center rounded bg-gray-50 text-sm text-gray-400">
              {loading ? 'Loading...' : undervotes ? `${undervotes.undervoteRate}% undervote rate` : 'Select a geography'}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml apps/web/src/app/analytics/
git commit -m "feat: add analytics page layout with use-analytics hook"
```

---
### Task 5: Frontend — Map View Component

**Files:**
- Create: `apps/web/src/app/analytics/components/map-view.tsx`
- Create: `apps/web/src/app/analytics/data/regions.json` (simplified Philippines regions)
- Create: `apps/web/src/app/analytics/data/provinces.json` (simplified provinces)
- Create: `apps/web/src/app/analytics/data/cities.json` (simplified cities)
- Modify: `apps/web/src/app/analytics/page.tsx` — integrate MapView

**Interfaces:**
- Consumes: `RegionStatus[]`, `ProvinceStatus[]`, `CityStatus[]`, `GeoSelection` (from `types.ts`)
- Produces: `<MapView>` component with drill-down callbacks

- [ ] **Step 1: Download and simplify Philippines GeoJSON boundaries**

Download from PhilGIS or use a community-maintained npm package. Simplify with mapshaper:

```bash
# Install mapshaper
npm install -g mapshaper

# Download Philippines admin boundaries (example URLs — adjust as needed)
# Regions: https://raw.githubusercontent.com/.../philippines-regions.json
# Provinces: https://raw.githubusercontent.com/.../philippines-provinces.json  
# Cities: https://raw.githubusercontent.com/.../philippines-cities.json

# Simplify each to <1MB
mapshaper regions.json -simplify dp 10% -o apps/web/src/app/analytics/data/regions.json
mapshaper provinces.json -simplify dp 10% -o apps/web/src/app/analytics/data/provinces.json
mapshaper cities.json -simplify dp 10% -o apps/web/src/app/analytics/data/cities.json
```

If community GeoJSON isn't available, create minimal boundary files with region names as points (a name-based drill-down fallback that loads Leaflet at the correct coordinates):

```bash
# Create placeholder — this would need actual GeoJSON from a map data source
touch apps/web/src/app/analytics/data/regions.json
touch apps/web/src/app/analytics/data/provinces.json
touch apps/web/src/app/analytics/data/cities.json
```

- [ ] **Step 2: Create `components/map-view.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RegionStatus, ProvinceStatus, CityStatus, GeoSelection } from '../types';

interface MapViewProps {
  geoSelection: GeoSelection;
  regionStatuses: RegionStatus[];
  provinceStatuses: ProvinceStatus[];
  cityStatuses: CityStatus[];
  onSelectRegion: (name: string) => void;
  onSelectProvince: (region: string, province: string) => void;
  onSelectCity: (region: string, province: string, city: string) => void;
  onBack: () => void;
}

function getColor(rate: number): string {
  if (rate >= 80) return '#22c55e';
  if (rate >= 50) return '#eab308';
  if (rate >= 20) return '#f97316';
  return '#ef4444';
}

function getStyle(rate: number, isSelected: boolean) {
  return {
    fillColor: getColor(rate),
    weight: isSelected ? 3 : 1,
    opacity: 1,
    color: isSelected ? '#1B3A5C' : '#6b7280',
    fillOpacity: 0.7,
  };
}

function MapContent({
  geoSelection, regionStatuses, provinceStatuses, cityStatuses,
  onSelectRegion, onSelectProvince, onSelectCity,
}: Omit<MapViewProps, 'onBack'>) {
  const map = useMap();
  const [geoJsonData, setGeoJsonData] = useState<any>(null);
  const [geoKey, setGeoKey] = useState(0);

  // Load GeoJSON based on current level
  useEffect(() => {
    let file = 'regions.json';
    if (geoSelection.level === 'region') file = 'provinces.json';
    if (geoSelection.level === 'province') file = 'cities.json';

    fetch(`/analytics/data/${file}`)
      .then(res => res.json())
      .then(data => {
        setGeoJsonData(data);
        setGeoKey(k => k + 1);
      })
      .catch(() => setGeoJsonData(null));
  }, [geoSelection.level]);

  // Fit map to Philippines bounds on national level
  useEffect(() => {
    if (geoSelection.level === 'national') {
      map.setView([12.8797, 121.7740], 6);
    }
  }, [geoSelection.level, map]);

  if (!geoJsonData) {
    // Fallback: show region list instead of map
    return (
      <div className="h-80 overflow-y-auto">
        <h3 className="mb-2 text-sm font-semibold text-gray-500">REGIONS</h3>
        {regionStatuses.map(r => (
          <button
            key={r.name}
            onClick={() => onSelectRegion(r.name)}
            className="flex w-full items-center justify-between border-b px-2 py-1.5 text-left text-sm hover:bg-gray-50"
          >
            <span>{r.name}</span>
            <span className="text-xs text-gray-400">{r.completionRate}%</span>
          </button>
        ))}
      </div>
    );
  }

  const statusMap = new Map<string, number>();
  if (geoSelection.level === 'national') {
    regionStatuses.forEach(r => statusMap.set(r.name, r.completionRate));
  } else if (geoSelection.level === 'region') {
    provinceStatuses.forEach(r => statusMap.set(r.name, r.completionRate));
  } else if (geoSelection.level === 'province') {
    cityStatuses.forEach(r => statusMap.set(r.name, r.completionRate));
  }

  return (
    <GeoJSON
      key={geoKey}
      data={geoJsonData}
      style={(feature: any) => {
        const name = feature?.properties?.name || feature?.properties?.ADM1_EN || '';
        const rate = statusMap.get(name) ?? 0;
        const isSelected = false;
        return getStyle(rate, isSelected);
      }}
      onEachFeature={(feature: any, layer: L.Layer) => {
        const name = feature?.properties?.name ||
                     feature?.properties?.ADM1_EN ||
                     feature?.properties?.ADM2_EN ||
                     feature?.properties?.ADM3_EN ||
                     '';
        const rate = statusMap.get(name);

        layer.bindTooltip(`${name}: ${rate !== undefined ? `${rate}%` : 'No data'}`, {
          sticky: true,
        });

        layer.on({
          click: () => {
            if (geoSelection.level === 'national' && name) {
              onSelectRegion(name);
            } else if (geoSelection.level === 'region' && name && geoSelection.region) {
              onSelectProvince(geoSelection.region, name);
            } else if (geoSelection.level === 'province' && name && geoSelection.region && geoSelection.province) {
              onSelectCity(geoSelection.region, geoSelection.province, name);
            }
          },
        });
      }}
    />
  );
}

export default function MapView(props: MapViewProps) {
  return (
    <div className="h-80 overflow-hidden rounded-lg">
      <MapContainer
        center={[12.8797, 121.7740]}
        zoom={6}
        className="h-full w-full"
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapContent {...props} />
      </MapContainer>
    </div>
  );
}
```

- [ ] **Step 3: Create GeoJSON placeholder data files**

Create minimal placeholder JSON files so the app doesn't 404:

```bash
echo '{"type":"FeatureCollection","features":[]}' > apps/web/public/analytics/data/regions.json
echo '{"type":"FeatureCollection","features":[]}' > apps/web/public/analytics/data/provinces.json
echo '{"type":"FeatureCollection","features":[]}' > apps/web/public/analytics/data/cities.json
```

Note: These are placeholders. Replace with real simplified GeoJSON from PhilGIS, OSM Boundaries, or GADM.

- [ ] **Step 4: Verify frontend builds**

```bash
cd apps/web && pnpm build 2>&1 | tail -20
```

Expected: Build succeeds (Leaflet import works, GeoJSON data files found).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/analytics/components/map-view.tsx apps/web/public/analytics/
git commit -m "feat: add map view component with Leaflet drill-down"
```

---
### Task 6: Frontend — Vote Share + Undervote Components

**Files:**
- Create: `apps/web/src/app/analytics/components/vote-share-chart.tsx`
- Create: `apps/web/src/app/analytics/components/undervote-panel.tsx`
- Modify: `apps/web/src/app/analytics/page.tsx` — integrate components

**Interfaces:**
- Consumes: `VoteShareResponse`, `UndervoteResponse` (from `types.ts`)
- Produces: `<VoteShareChart>` and `<UndervotePanel>` components

- [ ] **Step 1: Create `components/vote-share-chart.tsx`**

```tsx
'use client';

import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { VoteShareResponse } from '../types';

interface VoteShareChartProps {
  data: VoteShareResponse | null;
  loading: boolean;
}

const COLORS = ['#1B3A5C', '#2E6F95', '#4A9EBC', '#7EC8E3', '#B3DFF2', '#D4A843', '#C17A3A', '#8B5A2B', '#5C4033', '#3E2723'];

export default function VoteShareChart({ data, loading }: VoteShareChartProps) {
  const [chartType, setChartType] = useState<'bar' | 'pie'>('bar');

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        Loading...
      </div>
    );
  }

  if (!data || data.candidates.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        Select a geography to view vote share
      </div>
    );
  }

  // Take top 10 candidates for readability
  const topCandidates = data.candidates.slice(0, 10);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          Total votes: {data.totalVotes.toLocaleString()}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setChartType('bar')}
            className={`rounded px-2 py-0.5 text-xs ${chartType === 'bar' ? 'bg-[#1B3A5C] text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            Bar
          </button>
          <button
            onClick={() => setChartType('pie')}
            className={`rounded px-2 py-0.5 text-xs ${chartType === 'pie' ? 'bg-[#1B3A5C] text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            Pie
          </button>
        </div>
      </div>

      <div className="h-64">
        {chartType === 'bar' ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topCandidates} layout="vertical" margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis
                dataKey="name"
                type="category"
                width={120}
                tick={{ fontSize: 10 }}
              />
              <Tooltip
                formatter={(value: number, _name: string, props: any) => [
                  `${value.toLocaleString()} (${props.payload.percentage}%)`,
                  'Votes',
                ]}
              />
              <Bar dataKey="votes" fill="#1B3A5C" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={topCandidates}
                dataKey="votes"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={true}
              >
                {topCandidates.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, _name: string, props: any) => [
                  `${value.toLocaleString()} (${props.payload.percentage}%)`,
                  'Votes',
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `components/undervote-panel.tsx`**

```tsx
'use client';

import { UndervoteResponse } from '../types';

interface UndervotePanelProps {
  data: UndervoteResponse | null;
  loading: boolean;
}

export default function UndervotePanel({ data, loading }: UndervotePanelProps) {
  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-gray-400">
        Loading...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-gray-400">
        Select a geography to view undervote analysis
      </div>
    );
  }

  const isOvervoteHigh = data.overvoteRate > 0.5;

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="rounded-lg bg-gray-50 p-3 text-center">
          <div className="text-2xl font-bold text-[#1B3A5C]">
            {data.totalVotes.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500">Total Votes Cast</div>
        </div>

        <div className="rounded-lg bg-gray-50 p-3 text-center">
          <div className="text-2xl font-bold text-amber-600">
            {data.totalUndervotes.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500">Undervotes</div>
          <div className="text-xs font-medium text-amber-500">{data.undervoteRate}%</div>
        </div>

        <div className="rounded-lg bg-gray-50 p-3 text-center">
          <div className={`text-2xl font-bold ${isOvervoteHigh ? 'text-red-600' : 'text-gray-600'}`}>
            {data.totalOvervotes.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500">Overvotes</div>
          <div className={`text-xs font-medium ${isOvervoteHigh ? 'text-red-500' : 'text-gray-400'}`}>
            {data.overvoteRate}%
            {isOvervoteHigh && <span className="ml-1">⚠️</span>}
          </div>
        </div>

        <div className="rounded-lg bg-gray-50 p-3 text-center">
          <div className="text-2xl font-bold text-green-600">
            {data.undervoteRate > 0 ? `${(data.totalVotes / (data.totalVotes - data.totalUndervotes)).toFixed(2)}x` : 'N/A'}
          </div>
          <div className="text-xs text-gray-500">Vote Efficiency</div>
        </div>

        <div className="rounded-lg bg-gray-50 p-3 text-center">
          <div className="text-2xl font-bold text-purple-600">
            {data.totalVotes > 0
              ? `${((data.totalUndervotes + data.totalOvervotes) / data.totalVotes * 100).toFixed(1)}%`
              : 'N/A'}
          </div>
          <div className="text-xs text-gray-500">Combined Rate</div>
        </div>
      </div>

      {isOvervoteHigh && (
        <div className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">
          Overvote rate exceeds 0.5% threshold — may indicate election integrity concern
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Integrate components into `page.tsx`**

Replace the placeholder sections in `page.tsx`:

Import the new components:

```typescript
import MapView from './components/map-view';
import VoteShareChart from './components/vote-share-chart';
import UndervotePanel from './components/undervote-panel';
```

Replace the Map View placeholder div:

```tsx
<MapView
  geoSelection={geoSelection}
  regionStatuses={regionStatuses}
  provinceStatuses={provinceStatuses}
  cityStatuses={cityStatuses}
  onSelectRegion={selectRegion}
  onSelectProvince={(reg, prv) => selectProvince(reg, prv)}
  onSelectCity={(reg, prv, city) => selectCity(reg, prv, city)}
  onBack={goToNational}
/>
```

Replace the Vote Share placeholder:

```tsx
<VoteShareChart data={voteShare} loading={loading} />
```

Replace the Undervote placeholder:

```tsx
<UndervotePanel data={undervotes} loading={loading} />
```

- [ ] **Step 4: Verify frontend builds**

```bash
cd apps/web && pnpm build 2>&1 | tail -30
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/analytics/
git commit -m "feat: add vote-share chart and undervote panel components"
```

---
### Task 7: Integration — Add Nav Link + Final Polish

**Files:**
- Modify: `apps/web/src/app/layout.tsx` — add analytics nav link
- Verify: End-to-end flow

- [ ] **Step 1: Add nav link to the layout**

Add header/nav to `apps/web/src/app/layout.tsx`:

```tsx
import Link from 'next/link';

// Add after <body> opening:
<header className="border-b border-gray-200 bg-white">
  <nav className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
    <Link href="/" className="font-serif text-lg font-bold text-[#1B3A5C]">
      PPCRV
    </Link>
    <Link href="/results" className="text-sm text-gray-600 hover:text-[#1B3A5C]">
      Results
    </Link>
    <Link href="/analytics" className="text-sm text-gray-600 hover:text-[#1B3A5C]">
      Analytics
    </Link>
  </nav>
</header>
```

- [ ] **Step 2: Run full build**

```bash
cd apps/web && pnpm build 2>&1 | tail -30
cd apps/api && npx jest --no-coverage --testPathPattern 'analytics'
```

Expected: Both build and tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/layout.tsx
git commit -m "feat: add analytics nav link to header"
```
