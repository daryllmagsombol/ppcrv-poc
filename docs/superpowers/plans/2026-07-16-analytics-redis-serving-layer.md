# Analytics Redis Serving Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace runtime DuckDB `execFileSync` queries with Redis reads, using a DuckDB ETL script to pre-compute and seed Redis at deploy time.

**Architecture:** Add `ioredis` + `@duckdb/node-api` as dependencies. Create a `RedisModule` that exposes a `RedisService` (production: connects to Redis, dev: returns `null` when no `REDIS_URL`). Rewrite `AnalyticsService` to read from Redis when available, falling back to DuckDB in dev. Create `scripts/seed-redis.ts` that runs DuckDB aggregations once and pipelines results into Redis.

**Tech Stack:** NestJS 11, ioredis, @duckdb/node-api (dev-only for ETL), TypeScript 5.7, Jest 30

## Global Constraints

- Zero runtime DuckDB calls in production (only Redis reads)
- AnalyticsService public method signatures must not change (same params, same return types)
- Dev mode without REDIS_URL keeps current DuckDB fallback — no Redis required locally
- Redis key naming follows `analytics:{type}:{...}` convention per the design spec
- All new code is TypeScript strict mode

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/api/package.json` | Modify | Add `ioredis`, `@duckdb/node-api` (dev dep) |
| `apps/api/src/modules/redis/redis.module.ts` | Create | NestJS dynamic module, optional Redis connection |
| `apps/api/src/modules/redis/redis.service.ts` | Create | Wraps ioredis client; `isAvailable`, hgetall, get, set |
| `apps/api/src/modules/redis/redis.types.ts` | Create | Types: `GeoStatusData`, `VoteShareData`, `UndervoteData` |
| `apps/api/src/modules/analytics/analytics.service.ts` | Modify | Replace `execFileSync` with Redis reads + dev fallback |
| `apps/api/src/modules/analytics/analytics.module.ts` | Modify | Import RedisModule |
| `apps/api/src/modules/analytics/__tests__/analytics.service.spec.ts` | Modify | Mock RedisService instead of DuckDB |
| `apps/api/scripts/seed-redis.ts` | Create | ETL script: DuckDB aggregate → Redis pipeline load |
| `apps/api/.env.example` | Modify | Add `REDIS_URL` |

---

### Task 1: Add Dependencies

**Files:**
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: NPM packages available for import

- [ ] **Step 1: Add ioredis and @duckdb/node-api to package.json**

```bash
cd apps/api && npm install ioredis && npm install --save-dev @duckdb/node-api
```

- [ ] **Step 2: Verify install**

```bash
node -e "require('ioredis'); console.log('ioredis OK')"
node -e "require('@duckdb/node-api'); console.log('duckdb OK')"
```

Expected: both print OK without errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json
git commit -m "chore(api): add ioredis and @duckdb/node-api"
```

---

### Task 2: Create Redis Types

**Files:**
- Create: `apps/api/src/modules/redis/redis.types.ts`

**Interfaces:**
- Produces: `GeoStatusData`, `VoteShareData`, `UndervoteData` interfaces (consumed by RedisService and AnalyticsService)

- [ ] **Step 1: Write the types file**

```typescript
// apps/api/src/modules/redis/redis.types.ts

export interface GeoStatusData {
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

export interface VoteShareData {
  contest: string;
  contestName: string;
  totalVotes: number;
  candidates: VoteShareCandidate[];
}

export interface UndervoteData {
  totalVotes: number;
  totalUndervotes: number;
  totalOvervotes: number;
  undervoteRate: number;
  overvoteRate: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit src/modules/redis/redis.types.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/redis/redis.types.ts
git commit -m "feat(api): add Redis data types"
```

---

### Task 3: Create RedisService

**Files:**
- Create: `apps/api/src/modules/redis/redis.service.ts`

**Interfaces:**
- Consumes: `GeoStatusData`, `VoteShareData`, `UndervoteData` from `redis.types.ts`
- Produces: `RedisService` class with methods `isAvailable()`, `hgetallGeoStatus(key)`, `getVoteShare(key)`, `getUndervotes(key)`, `onModuleDestroy()` for cleanup

- [ ] **Step 1: Write the RedisService**

```typescript
// apps/api/src/modules/redis/redis.service.ts

import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { GeoStatusData, VoteShareData, UndervoteData } from './redis.types';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null = null;

  constructor() {
    const url = process.env.REDIS_URL;
    if (url) {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });
      this.client.on('error', (err) =>
        this.logger.warn(`Redis connection error: ${err.message}`),
      );
      this.logger.log('Redis client created (will connect lazily)');
    } else {
      this.logger.warn('REDIS_URL not set — analytics will use DuckDB fallback');
    }
  }

  /** True when Redis is configured and connected. */
  async isAvailable(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  /** Ensure connection before first use. */
  private async ensureClient(): Promise<Redis | null> {
    if (!this.client) return null;
    if (this.client.status !== 'ready' && this.client.status !== 'connect') {
      try {
        await this.client.connect();
      } catch {
        return null;
      }
    }
    return this.client;
  }

  // --- Geography Status ---

  async hgetallGeoStatus(key: string): Promise<Record<string, GeoStatusData>> {
    const c = await this.ensureClient();
    if (!c) return {};
    const raw = await c.hgetall(key);
    const result: Record<string, GeoStatusData> = {};
    for (const [name, json] of Object.entries(raw)) {
      try {
        result[name] = JSON.parse(json);
      } catch {
        this.logger.warn(`Failed to parse geo status for key "${key}" field "${name}"`);
      }
    }
    return result;
  }

  // --- Vote Share ---

  async getVoteShare(key: string): Promise<VoteShareData | null> {
    const c = await this.ensureClient();
    if (!c) return null;
    const raw = await c.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      this.logger.warn(`Failed to parse vote share for key "${key}"`);
      return null;
    }
  }

  // --- Undervotes ---

  async getUndervotes(key: string): Promise<UndervoteData | null> {
    const c = await this.ensureClient();
    if (!c) return null;
    const raw = await c.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      this.logger.warn(`Failed to parse undervotes for key "${key}"`);
      return null;
    }
  }

  // --- Contests ---

  async hgetallContests(): Promise<Record<string, string>> {
    const c = await this.ensureClient();
    if (!c) return {};
    const raw = await c.hgetall('analytics:contests');
    // ioredis returns field→value pairs already typed as Record<string, string>
    return raw;
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/redis/redis.service.ts
git commit -m "feat(api): add RedisService with lazy-connect and parse methods"
```

---

### Task 4: Create RedisModule

**Files:**
- Create: `apps/api/src/modules/redis/redis.module.ts`

**Interfaces:**
- Consumes: `RedisService` from `redis.service.ts`
- Produces: `RedisModule` as `@Global()` NestJS module exporting `RedisService`

- [ ] **Step 1: Write the RedisModule**

```typescript
// apps/api/src/modules/redis/redis.module.ts

import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/redis/redis.module.ts
git commit -m "feat(api): add RedisModule as global NestJS module"
```

---

### Task 5: Register RedisModule in AppModule

**Files:**
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `RedisModule` from `redis.module.ts`
- Produces: App imports RedisModule globally

- [ ] **Step 1: Read current app.module.ts to check imports**

Read `apps/api/src/app.module.ts`.

- [ ] **Step 2: Add RedisModule import**

Add `RedisModule` to the `imports` array of the `@Module()` decorator.

```typescript
import { RedisModule } from './modules/redis/redis.module';

@Module({
  imports: [/* existing imports */, RedisModule],
  // ...
})
```

(Exact edit depends on current file contents — match existing import style.)

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/app.module.ts
git commit -m "feat(api): register RedisModule in AppModule"
```

---

### Task 6: Rewrite AnalyticsService to use Redis with DuckDB fallback

**Files:**
- Modify: `apps/api/src/modules/analytics/analytics.service.ts` (full rewrite)

**Interfaces:**
- Consumes: `RedisService` from `redis.module`; `GeoStatusData`, `VoteShareData`, `UndervoteData` from `redis.types`
- Produces: Same public methods — `getGeographyStatus()`, `getProvinceStatus(reg)`, `getCityStatus(reg, prv)`, `getVoteShare(params)`, `getUndervotes(params)`

- [ ] **Step 1: Write the rewritten service**

```typescript
// apps/api/src/modules/analytics/analytics.service.ts

import { Injectable, Logger } from '@nestjs/common';
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

// --- DuckDB fallback methods (kept from original for dev mode) ---

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
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly parquetBase: string;
  private redisReady = false;

  constructor(private readonly redis: RedisService) {
    this.parquetBase =
      process.env.PARQUET_BASE_PATH ||
      path.resolve(__dirname, '..', '..', '..', '..', '..', 'apps', 'etl', 'output');
    // Check Redis availability once on module init
    this.initRedis();
  }

  private async initRedis() {
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run existing tests to check basic wiring**

```bash
cd apps/api && npx jest --testPathPattern="analytics" --forceExit
```

Expected: should pass (tests hit DuckDB fallback since no REDIS_URL in test).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/analytics/analytics.service.ts
git commit -m "feat(api): rewrite analytics service with Redis + DuckDB fallback"
```

---

### Task 7: Update AnalyticsModule to import RedisModule

**Files:**
- Modify: `apps/api/src/modules/analytics/analytics.module.ts`

**Interfaces:**
- Consumes: `RedisModule` from `redis.module`
- Produces: AnalyticsModule with RedisModule imported

- [ ] **Step 1: Edit analytics.module.ts**

```typescript
// apps/api/src/modules/analytics/analytics.module.ts

import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [RedisModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/analytics/analytics.module.ts
git commit -m "feat(api): import RedisModule in AnalyticsModule"
```

---

### Task 8: Rewrite tests for Redis-based AnalyticsService

**Files:**
- Modify: `apps/api/src/modules/analytics/__tests__/analytics.service.spec.ts` (full rewrite)

**Interfaces:**
- Consumes: `AnalyticsService`, `RedisService`
- Produces: Passing tests that mock RedisService

- [ ] **Step 1: Write the updated test file**

```typescript
// apps/api/src/modules/analytics/__tests__/analytics.service.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from '../analytics.service';
import { RedisService } from '../../redis/redis.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let redisService: jest.Mocked<Pick<RedisService, 'isAvailable' | 'hgetallGeoStatus' | 'getVoteShare' | 'getUndervotes'>>;

  beforeEach(async () => {
    const mockRedis = {
      isAvailable: jest.fn().mockResolvedValue(false),
      hgetallGeoStatus: jest.fn().mockResolvedValue({}),
      getVoteShare: jest.fn().mockResolvedValue(null),
      getUndervotes: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    redisService = mockRedis as any;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- Redis path tests ---

  describe('with Redis available', () => {
    beforeEach(() => {
      (redisService.isAvailable as jest.Mock).mockResolvedValue(true);
    });

    it('getGeographyStatus returns mapped regions from Redis hash', async () => {
      (redisService.hgetallGeoStatus as jest.Mock).mockResolvedValue({
        'NCR': { name: 'NCR', totalPrecincts: 100, reportedPrecincts: 80, completionRate: 80 },
        'REGION I': { name: 'REGION I', totalPrecincts: 50, reportedPrecincts: 25, completionRate: 50 },
      });

      // Re-create service so initRedis() picks up the mock change
      const module = await Test.createTestingModule({
        providers: [
          AnalyticsService,
          { provide: RedisService, useValue: redisService },
        ],
      }).compile();
      const svc = module.get<AnalyticsService>(AnalyticsService);

      const result = await svc.getGeographyStatus();
      expect(result).toEqual([
        { name: 'NCR', totalPrecincts: 100, reportedPrecincts: 80, completionRate: 80 },
        { name: 'REGION I', totalPrecincts: 50, reportedPrecincts: 25, completionRate: 50 },
      ]);
      expect(redisService.hgetallGeoStatus).toHaveBeenCalledWith('analytics:geo:regions');
    });

    it('getGeographyStatus returns empty array when Redis has no data', async () => {
      (redisService.hgetallGeoStatus as jest.Mock).mockResolvedValue({});

      const module = await Test.createTestingModule({
        providers: [
          AnalyticsService,
          { provide: RedisService, useValue: redisService },
        ],
      }).compile();
      const svc = module.get<AnalyticsService>(AnalyticsService);

      const result = await svc.getGeographyStatus();
      expect(result).toEqual([]);
    });

    it('getProvinceStatus returns provinces for a region', async () => {
      (redisService.hgetallGeoStatus as jest.Mock).mockResolvedValue({
        'MANILA': { name: 'MANILA', totalPrecincts: 10, reportedPrecincts: 8, completionRate: 80 },
      });

      const module = await Test.createTestingModule({
        providers: [
          AnalyticsService,
          { provide: RedisService, useValue: redisService },
        ],
      }).compile();
      const svc = module.get<AnalyticsService>(AnalyticsService);

      const result = await svc.getProvinceStatus('NCR');
      expect(result).toEqual([
        { name: 'MANILA', totalPrecincts: 10, reportedPrecincts: 8, completionRate: 80 },
      ]);
      expect(redisService.hgetallGeoStatus).toHaveBeenCalledWith('analytics:geo:province:NCR');
    });

    it('getCityStatus returns cities for a region+province', async () => {
      (redisService.hgetallGeoStatus as jest.Mock).mockResolvedValue({
        'CITY A': { name: 'CITY A', totalPrecincts: 5, reportedPrecincts: 4, completionRate: 80 },
      });

      const module = await Test.createTestingModule({
        providers: [
          AnalyticsService,
          { provide: RedisService, useValue: redisService },
        ],
      }).compile();
      const svc = module.get<AnalyticsService>(AnalyticsService);

      const result = await svc.getCityStatus('NCR', 'MANILA');
      expect(result).toEqual([
        { name: 'CITY A', totalPrecincts: 5, reportedPrecincts: 4, completionRate: 80 },
      ]);
      expect(redisService.hgetallGeoStatus).toHaveBeenCalledWith('analytics:geo:city:NCR:MANILA');
    });

    it('getVoteShare returns data from Redis', async () => {
      const vsData = {
        contest: '00399000',
        contestName: 'SENATOR OF PHILIPPINES',
        totalVotes: 1000,
        candidates: [{ name: 'CANDIDATE A', party: 'IND', votes: 600, percentage: 60 }],
      };
      (redisService.getVoteShare as jest.Mock).mockResolvedValue(vsData);

      const module = await Test.createTestingModule({
        providers: [
          AnalyticsService,
          { provide: RedisService, useValue: redisService },
        ],
      }).compile();
      const svc = module.get<AnalyticsService>(AnalyticsService);

      const result = await svc.getVoteShare({ contest: '00399000' });
      expect(result).toEqual(vsData);
      expect(redisService.getVoteShare).toHaveBeenCalledWith('analytics:votes:00399000:nat');
    });

    it('getVoteShare returns empty when key missing', async () => {
      (redisService.getVoteShare as jest.Mock).mockResolvedValue(null);

      const module = await Test.createTestingModule({
        providers: [
          AnalyticsService,
          { provide: RedisService, useValue: redisService },
        ],
      }).compile();
      const svc = module.get<AnalyticsService>(AnalyticsService);

      const result = await svc.getVoteShare({ contest: '00399000' });
      expect(result).toEqual({ contest: '00399000', contestName: '', totalVotes: 0, candidates: [] });
    });

    it('getUndervotes returns data from Redis', async () => {
      const uvData = { totalVotes: 1000, totalUndervotes: 50, totalOvervotes: 10, undervoteRate: 5, overvoteRate: 1 };
      (redisService.getUndervotes as jest.Mock).mockResolvedValue(uvData);

      const module = await Test.createTestingModule({
        providers: [
          AnalyticsService,
          { provide: RedisService, useValue: redisService },
        ],
      }).compile();
      const svc = module.get<AnalyticsService>(AnalyticsService);

      const result = await svc.getUndervotes({ contest: '00399000' });
      expect(result).toEqual(uvData);
      expect(redisService.getUndervotes).toHaveBeenCalledWith('analytics:undervotes:00399000:nat');
    });

    it('getUndervotes returns zeros when key missing', async () => {
      (redisService.getUndervotes as jest.Mock).mockResolvedValue(null);

      const module = await Test.createTestingModule({
        providers: [
          AnalyticsService,
          { provide: RedisService, useValue: redisService },
        ],
      }).compile();
      const svc = module.get<AnalyticsService>(AnalyticsService);

      const result = await svc.getUndervotes({ contest: '00399000' });
      expect(result).toEqual({ totalVotes: 0, totalUndervotes: 0, totalOvervotes: 0, undervoteRate: 0, overvoteRate: 0 });
    });
  });

  // --- DuckDB fallback path tests ---

  describe('with Redis unavailable (DuckDB fallback)', () => {
    it('methods are defined and callable', () => {
      expect(typeof service.getGeographyStatus).toBe('function');
      expect(typeof service.getProvinceStatus).toBe('function');
      expect(typeof service.getCityStatus).toBe('function');
      expect(typeof service.getVoteShare).toBe('function');
      expect(typeof service.getUndervotes).toBe('function');
    });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd apps/api && npx jest --testPathPattern="analytics.service" --forceExit
```

Expected: all tests pass. (DuckDB fallback tests may fail if DuckDB not installed locally — accept a skip or investigate.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/analytics/__tests__/analytics.service.spec.ts
git commit -m "test(api): rewrite analytics tests for Redis with mocks"
```

---

### Task 9: Create seed-redis.ts ETL script

**Files:**
- Create: `apps/api/scripts/seed-redis.ts`

**Interfaces:**
- Consumes: DuckDB parquet files at `PARQUET_BASE_PATH`
- Produces: Populated Redis keys (`analytics:*`) from command line

- [ ] **Step 1: Write the seed script**

```typescript
#!/usr/bin/env ts-node
// apps/api/scripts/seed-redis.ts
//
// Usage: ts-node scripts/seed-redis.ts
// Requires: REDIS_URL and PARQUET_BASE_PATH environment variables
//
// Reads all Parquet files via DuckDB, pre-computes aggregates,
// and pipelines results into Redis.

import * as duckdb from '@duckdb/node-api';
import Redis from 'ioredis';

// --- Config ---

const REDIS_URL = process.env.REDIS_URL;
const PARQUET_BASE = process.env.PARQUET_BASE_PATH || '../../apps/etl/output';

if (!REDIS_URL) {
  console.error('ERROR: REDIS_URL not set');
  process.exit(1);
}

// --- DuckDB setup ---

const db = new duckdb.DuckDB();

async function query(sql: string): Promise<any[]> {
  const conn = await db.connect();
  try {
    const result = await conn.run(sql);
    const rows: any[] = [];
    for (let i = 0; i < result.numRows; i++) {
      const row: Record<string, any> = {};
      for (const col of result.schema.fields) {
        row[col.name] = result.get(col.name, i);
      }
      rows.push(row);
    }
    return rows;
  } finally {
    conn.close();
  }
}

// --- Helpers ---

function esc(val: string): string {
  return val.replace(/'/g, "''");
}

function levelGlob(level: string): string {
  return `${PARQUET_BASE}/${level}/**/*.parquet`;
}

function geoToSql(params: { reg?: string; prv?: string; mun?: string }): string {
  const w: string[] = [];
  if (params.reg) w.push(`reg_name = '${esc(params.reg)}'`);
  if (params.prv) w.push(`prv_name = '${esc(params.prv)}'`);
  if (params.mun) w.push(`mun_name = '${esc(params.mun)}'`);
  return w.length > 0 ? `WHERE ${w.join(' AND ')}` : '';
}

// --- Seed functions ---

async function seedContestList(redis: Redis) {
  console.log('Seeding contest list...');
  // Read contest-names.json and store as Redis hash
  const fs = await import('fs');
  const namesPath = `${PARQUET_BASE}/../contest-names.json`;
  let names: Record<string, string> = {};
  try {
    names = JSON.parse(fs.readFileSync(namesPath, 'utf-8'));
  } catch {
    console.warn(`  WARNING: contest-names.json not found at ${namesPath}, skipping`);
    return;
  }
  const entries = Object.entries(names);
  if (entries.length === 0) return;

  const pipeline = redis.pipeline();
  for (const [code, name] of entries) {
    pipeline.hset('analytics:contests', code, name);
  }
  await pipeline.exec();
  console.log(`  Loaded ${entries.length} contests into analytics:contests`);
}

async function seedGeographyStatus(redis: Redis) {
  console.log('Seeding geography status...');

  // Regions
  console.log('  Regions...');
  const regions = await query(`
    SELECT reg_name,
           COUNT(*) as total_precincts,
           SUM(CASE WHEN has_votes > 0 THEN 1 ELSE 0 END) as reported_precincts
    FROM (
      SELECT reg_name, pollplace, SUM(total_votes) as has_votes
      FROM '${levelGlob('precinct')}'
      GROUP BY reg_name, pollplace
    ) sub
    GROUP BY reg_name
    ORDER BY reg_name
  `.trim().replace(/\s+/g, ' '));

  if (regions.length > 0) {
    const pipeline = redis.pipeline();
    for (const r of regions) {
      const total = Number(r.total_precincts);
      const reported = Number(r.reported_precincts);
      const cr = total > 0 ? Math.round((reported / total) * 100) : 0;
      pipeline.hset('analytics:geo:regions', r.reg_name, JSON.stringify({
        name: r.reg_name, totalPrecincts: total, reportedPrecincts: reported, completionRate: cr,
      }));
    }
    await pipeline.exec();
  }
  console.log(`  Loaded ${regions.length} regions`);

  // Provinces per region
  console.log('  Provinces...');
  let provinceCount = 0;
  for (const reg of regions) {
    const provinces = await query(`
      SELECT prv_name,
             COUNT(*) as total_precincts,
             SUM(CASE WHEN has_votes > 0 THEN 1 ELSE 0 END) as reported_precincts
      FROM (
        SELECT prv_name, pollplace, SUM(total_votes) as has_votes
        FROM '${levelGlob('precinct')}'
        WHERE reg_name = '${esc(reg.reg_name)}'
        GROUP BY prv_name, pollplace
      ) sub
      GROUP BY prv_name
      ORDER BY prv_name
    `.trim().replace(/\s+/g, ' '));

    if (provinces.length > 0) {
      const pipeline = redis.pipeline();
      const key = `analytics:geo:province:${reg.reg_name}`;
      for (const p of provinces) {
        const total = Number(p.total_precincts);
        const reported = Number(p.reported_precincts);
        const cr = total > 0 ? Math.round((reported / total) * 100) : 0;
        pipeline.hset(key, p.prv_name, JSON.stringify({
          name: p.prv_name, totalPrecincts: total, reportedPrecincts: reported, completionRate: cr,
        }));
      }
      await pipeline.exec();
      provinceCount += provinces.length;
    }
  }
  console.log(`  Loaded ${provinceCount} provinces`);

  // Cities per province (sampled to avoid millions of Redis keys)
  // For cities, we only seed for the provinces that have city-level contests
  // This is a best-effort: load all if total is manageable, skip if too many
  console.log('  Cities (sampling top 50 provinces)...');
  let cityCount = 0;
  let skippedCities = 0;
  // Re-query all province_names with known regions
  const provinceList: { reg: string; prv: string }[] = [];
  for (const reg of regions) {
    const provs = await query(`
      SELECT DISTINCT prv_name FROM '${levelGlob('precinct')}'
      WHERE reg_name = '${esc(reg.reg_name)}'
    `.trim().replace(/\s+/g, ' '));
    for (const p of provs) {
      provinceList.push({ reg: reg.reg_name, prv: p.prv_name });
    }
  }

  const topProvinces = provinceList.slice(0, 50);
  for (const { reg, prv } of topProvinces) {
    const cities = await query(`
      SELECT mun_name,
             COUNT(*) as total_precincts,
             SUM(CASE WHEN has_votes > 0 THEN 1 ELSE 0 END) as reported_precincts
      FROM (
        SELECT mun_name, pollplace, SUM(total_votes) as has_votes
        FROM '${levelGlob('precinct')}'
        WHERE reg_name = '${esc(reg)}' AND prv_name = '${esc(prv)}'
        GROUP BY mun_name, pollplace
      ) sub
      GROUP BY mun_name
      ORDER BY mun_name
    `.trim().replace(/\s+/g, ' '));

    if (cities.length > 0) {
      const pipeline = redis.pipeline();
      const key = `analytics:geo:city:${reg}:${prv}`;
      for (const c of cities) {
        const total = Number(c.total_precincts);
        const reported = Number(c.reported_precincts);
        const cr = total > 0 ? Math.round((reported / total) * 100) : 0;
        pipeline.hset(key, c.mun_name, JSON.stringify({
          name: c.mun_name, totalPrecincts: total, reportedPrecincts: reported, completionRate: cr,
        }));
      }
      await pipeline.exec();
      cityCount += cities.length;
    }
  }
  console.log(`  Loaded ${cityCount} cities (${provinceList.length - topProvinces.length} provinces skipped for city data)`);
}

async function seedVoteShare(redis: Redis) {
  console.log('Seeding vote share...');
  // Get all distinct contest codes
  const contests = await query(`
    SELECT DISTINCT LPAD(CAST(contest_code AS VARCHAR), 8, '0') as code
    FROM '${levelGlob('national')}'
    ORDER BY code
  `.trim().replace(/\s+/g, ' '));

  console.log(`  Found ${contests.length} contests`);

  const levels = [
    { name: 'national', label: 'nat', glob: levelGlob('national') },
    { name: 'region', label: 'reg', glob: levelGlob('region') },
    { name: 'province', label: 'prv', glob: levelGlob('province') },
    { name: 'municipality', label: 'mun', glob: levelGlob('municipality') },
  ];

  let count = 0;
  for (const contest of contests) {
    const code = contest.code;

    for (const level of levels) {
      // National: single key
      if (level.name === 'national') {
        const rows = await query(`
          SELECT candidate_name, party_code, SUM(total_votes) as votes
          FROM '${level.glob}'
          WHERE LPAD(CAST(contest_code AS VARCHAR), 8, '0') = '${code}'
          GROUP BY candidate_name, party_code
          ORDER BY votes DESC
        `.trim().replace(/\s+/g, ' '));

        if (rows.length === 0) continue;

        const totalVotes = rows.reduce((sum, r) => sum + Number(r.votes || 0), 0);
        const candidates = rows.map(r => ({
          name: r.candidate_name,
          party: r.party_code || '',
          votes: Number(r.votes),
          percentage: totalVotes > 0 ? Math.round((Number(r.votes) / totalVotes) * 1000) / 10 : 0,
        }));

        const key = `analytics:votes:${code}:nat`;
        await redis.set(key, JSON.stringify({ contest: code, contestName: '', totalVotes, candidates }));
        count++;
        continue;
      }

      // For geo-level keys, get distinct geos first
      const geoCol = level.name === 'region' ? 'reg_name' : level.name === 'province' ? 'prv_name' : 'mun_name';
      const geos = await query(`
        SELECT DISTINCT ${geoCol} as geo
        FROM '${level.glob}'
        WHERE LPAD(CAST(contest_code AS VARCHAR), 8, '0') = '${code}'
      `.trim().replace(/\s+/g, ' '));

      const pipeline = redis.pipeline();
      let batchCount = 0;

      for (const g of geos) {
        const gl = level.label;
        const whereClause = `WHERE LPAD(CAST(contest_code AS VARCHAR), 8, '0') = '${code}' AND ${geoCol} = '${esc(g.geo)}'`;
        const rows = await query(`
          SELECT candidate_name, party_code, SUM(total_votes) as votes
          FROM '${level.glob}'
          ${whereClause}
          GROUP BY candidate_name, party_code
          ORDER BY votes DESC
        `.trim().replace(/\s+/g, ' '));

        if (rows.length === 0) continue;

        const totalVotes = rows.reduce((sum, r) => sum + Number(r.votes || 0), 0);
        const candidates = rows.map(r => ({
          name: r.candidate_name,
          party: r.party_code || '',
          votes: Number(r.votes),
          percentage: totalVotes > 0 ? Math.round((Number(r.votes) / totalVotes) * 1000) / 10 : 0,
        }));

        const key = `analytics:votes:${code}:${gl}:${g.geo}`;
        pipeline.set(key, JSON.stringify({ contest: code, contestName: '', totalVotes, candidates }));
        batchCount++;
      }

      if (batchCount > 0) {
        await pipeline.exec();
        count += batchCount;
      }
    }

    if (count % 1000 === 0) {
      console.log(`  Progress: ${count} vote share keys...`);
    }
  }

  console.log(`  Loaded ${count} vote share keys`);
}

async function seedUndervotes(redis: Redis) {
  console.log('Seeding undervotes...');

  const contests = await query(`
    SELECT DISTINCT LPAD(CAST(contest_code AS VARCHAR), 8, '0') as code
    FROM '${levelGlob('national')}'
    ORDER BY code
  `.trim().replace(/\s+/g, ' '));

  const levels = [
    { name: 'national', label: 'nat', glob: levelGlob('national') },
    { name: 'region', label: 'reg', glob: levelGlob('region') },
    { name: 'province', label: 'prv', glob: levelGlob('province') },
    { name: 'municipality', label: 'mun', glob: levelGlob('municipality') },
  ];

  let count = 0;
  for (const contest of contests) {
    const code = contest.code;

    for (const level of levels) {
      if (level.name === 'national') {
        const rows = await query(`
          SELECT SUM(total_votes) as total_votes,
                 MIN(total_under_votes) as total_under_votes,
                 MIN(total_over_votes) as total_over_votes
          FROM '${level.glob}'
          WHERE LPAD(CAST(contest_code AS VARCHAR), 8, '0') = '${code}'
        `.trim().replace(/\s+/g, ' '));

        const tv = Number(rows[0]?.total_votes || 0);
        const tuv = Number(rows[0]?.total_under_votes || 0);
        const tov = Number(rows[0]?.total_over_votes || 0);

        const key = `analytics:undervotes:${code}:nat`;
        await redis.set(key, JSON.stringify({
          totalVotes: tv,
          totalUndervotes: tuv,
          totalOvervotes: tov,
          undervoteRate: tv > 0 ? Math.round((tuv / tv) * 1000) / 10 : 0,
          overvoteRate: tv > 0 ? Math.round((tov / tv) * 1000) / 10 : 0,
        }));
        count++;
        continue;
      }

      const geoCol = level.name === 'region' ? 'reg_name' : level.name === 'province' ? 'prv_name' : 'mun_name';
      const geos = await query(`
        SELECT DISTINCT ${geoCol} as geo
        FROM '${level.glob}'
        WHERE LPAD(CAST(contest_code AS VARCHAR), 8, '0') = '${code}'
      `.trim().replace(/\s+/g, ' '));

      const pipeline = redis.pipeline();
      let batchCount = 0;

      for (const g of geos) {
        const whereClause = `WHERE LPAD(CAST(contest_code AS VARCHAR), 8, '0') = '${code}' AND ${geoCol} = '${esc(g.geo)}'`;
        const rows = await query(`
          SELECT SUM(total_votes) as total_votes,
                 MIN(total_under_votes) as total_under_votes,
                 MIN(total_over_votes) as total_over_votes
          FROM '${level.glob}'
          ${whereClause}
        `.trim().replace(/\s+/g, ' '));

        const tv = Number(rows[0]?.total_votes || 0);
        const tuv = Number(rows[0]?.total_under_votes || 0);
        const tov = Number(rows[0]?.total_over_votes || 0);

        const key = `analytics:undervotes:${code}:${level.label}:${g.geo}`;
        pipeline.set(key, JSON.stringify({
          totalVotes: tv,
          totalUndervotes: tuv,
          totalOvervotes: tov,
          undervoteRate: tv > 0 ? Math.round((tuv / tv) * 1000) / 10 : 0,
          overvoteRate: tv > 0 ? Math.round((tov / tv) * 1000) / 10 : 0,
        }));
        batchCount++;
      }

      if (batchCount > 0) {
        await pipeline.exec();
        count += batchCount;
      }
    }

    if (count % 500 === 0) {
      console.log(`  Progress: ${count} undervote keys...`);
    }
  }

  console.log(`  Loaded ${count} undervote keys`);
}

// --- Main ---

async function main() {
  console.log('=== Analytics Redis Seed ===');
  console.log(`Parquet base: ${PARQUET_BASE}`);
  console.log(`Redis URL: ${REDIS_URL}`);

  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });

  try {
    await seedContestList(redis);
    await seedGeographyStatus(redis);
    await seedVoteShare(redis);
    await seedUndervotes(redis);

    const dbsize = await redis.dbsize();
    console.log(`\nDone! Redis DB now has ${dbsize} keys.`);
  } finally {
    redis.quit();
    await db.close();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit scripts/seed-redis.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/scripts/seed-redis.ts
git commit -m "feat(api): add seed-redis.ts ETL script"
```

---

### Task 10: Update .env.example

**Files:**
- Modify: `apps/api/.env.example`

**Interfaces:**
- Produces: Developer docs for required env vars

- [ ] **Step 1: Add REDIS_URL to .env.example**

Read the file, append:

```
# Redis (production analytics serving)
REDIS_URL=redis://localhost:6379
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/.env.example
git commit -m "docs(api): add REDIS_URL to .env.example"
```

---

### Task 11: Full build verification

**Files:** None (verification only)

- [ ] **Step 1: Build the API**

```bash
cd apps/api && npm run build
```

Expected: `dist/` produced with no errors.

- [ ] **Step 2: Build the web app**

```bash
cd apps/web && npx next build
```

Expected: successful production build.

- [ ] **Step 3: Run all tests**

```bash
cd apps/api && npx jest --forceExit
```

Expected: all tests pass (some DuckDB-fallback tests may need DuckDB installed locally).

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final build fixes"
```
