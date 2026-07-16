#!/usr/bin/env ts-node
// apps/api/scripts/seed-redis.ts
//
// ETL script: reads Parquet files via DuckDB, pre-computes analytics aggregates,
// and loads them into Redis for production serving.
//
// Usage:
//   REDIS_URL=redis://... PARQUET_BASE_PATH=... npx ts-node scripts/seed-redis.ts
//
// Requires: REDIS_URL environment variable

import { DuckDBInstance } from '@duckdb/node-api';
import Redis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';

// ── Config ──────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL;
const PARQUET_BASE = process.env.PARQUET_BASE_PATH || path.resolve(__dirname, '..', '..', '..', 'apps', 'etl', 'output');
const CONTEST_NAMES_PATH = process.env.CONTEST_NAMES_PATH || path.resolve(PARQUET_BASE, '..', '..', '..', 'data', 'contest-names.json');

if (!REDIS_URL) {
  console.error('ERROR: REDIS_URL environment variable is required');
  process.exit(1);
}

// ── DuckDB helpers ──────────────────────────────────────────────────

let db: DuckDBInstance | null = null;

async function query(sql: string): Promise<Record<string, any>[]> {
  if (!db) {
    db = await DuckDBInstance.create();
  }
  const conn = await db.connect();
  try {
    const reader = await conn.runAndReadAll(sql);
    return reader.getRowObjectsJson();
  } finally {
    conn.closeSync();
  }
}

function esc(val: string): string {
  return val.replace(/'/g, "''");
}

// ── Seed functions ──────────────────────────────────────────────────

async function seedContestList(redis: Redis): Promise<number> {
  console.log('Seeding contest list...');

  let names: Record<string, string> = {};
  try {
    names = JSON.parse(fs.readFileSync(CONTEST_NAMES_PATH, 'utf-8'));
    console.log(`  Loaded ${Object.keys(names).length} contest names from JSON`);
  } catch {
    console.warn(`  WARNING: contest-names.json not found at ${CONTEST_NAMES_PATH}, skipping`);
    return 0;
  }

  const entries = Object.entries(names);
  if (entries.length === 0) return 0;

  const pipeline = redis.pipeline();
  for (const [code, name] of entries) {
    pipeline.hset('analytics:contests', code, name);
  }
  await pipeline.exec();
  console.log(`  Loaded ${entries.length} contests into analytics:contests`);
  return entries.length;
}

async function seedGeographyStatus(redis: Redis): Promise<number> {
  console.log('Seeding geography status...');
  let totalKeys = 0;

  // ── Regions ──
  console.log('  Regions...');
  const regions = await query(`
    SELECT reg_name,
           COUNT(*) as total_precincts,
           SUM(CASE WHEN has_votes > 0 THEN 1 ELSE 0 END) as reported_precincts
    FROM (
      SELECT reg_name, pollplace, SUM(total_votes) as has_votes
      FROM read_parquet('${esc(levelGlob('precinct'))}', union_by_name=true)
      GROUP BY reg_name, pollplace
    ) sub
    GROUP BY reg_name
    ORDER BY reg_name
  `.trim().replace(/\s+/g, ' '));

  if (regions.length > 0) {
    const pipeline = redis.pipeline();
    for (const r of regions) {
      const total = Number(r.total_precincts || 0);
      const reported = Number(r.reported_precincts || 0);
      const cr = total > 0 ? Math.round((reported / total) * 100) : 0;
      pipeline.hset('analytics:geo:regions', String(r.reg_name), JSON.stringify({
        name: r.reg_name, totalPrecincts: total, reportedPrecincts: reported, completionRate: cr,
      }));
    }
    await pipeline.exec();
  }
  totalKeys += regions.length;
  console.log(`  Loaded ${regions.length} regions`);

  // ── Provinces per region ──
  console.log('  Provinces...');
  let provinceCount = 0;
  for (const reg of regions) {
    const provinces = await query(`
      SELECT prv_name,
             COUNT(*) as total_precincts,
             SUM(CASE WHEN has_votes > 0 THEN 1 ELSE 0 END) as reported_precincts
      FROM (
        SELECT prv_name, pollplace, SUM(total_votes) as has_votes
        FROM read_parquet('${esc(levelGlob('precinct'))}', union_by_name=true)
        WHERE reg_name = '${esc(String(reg.reg_name))}'
        GROUP BY prv_name, pollplace
      ) sub
      GROUP BY prv_name
      ORDER BY prv_name
    `.trim().replace(/\s+/g, ' '));

    if (provinces.length > 0) {
      const pipeline = redis.pipeline();
      const key = `analytics:geo:province:${reg.reg_name}`;
      for (const p of provinces) {
        const total = Number(p.total_precincts || 0);
        const reported = Number(p.reported_precincts || 0);
        const cr = total > 0 ? Math.round((reported / total) * 100) : 0;
        pipeline.hset(key, String(p.prv_name), JSON.stringify({
          name: p.prv_name, totalPrecincts: total, reportedPrecincts: reported, completionRate: cr,
        }));
      }
      await pipeline.exec();
      provinceCount += provinces.length;
    }
  }
  totalKeys += provinceCount;
  console.log(`  Loaded ${provinceCount} provinces`);

  // ── Cities (single batch query for all cities) ──
  console.log('  Cities (batch query)...');
  let cityCount = 0;

  const allCities = await query(`
    SELECT reg_name, prv_name, mun_name,
           COUNT(*) as total_precincts,
           SUM(CASE WHEN has_votes > 0 THEN 1 ELSE 0 END) as reported_precincts
    FROM (
      SELECT reg_name, prv_name, mun_name, pollplace, SUM(total_votes) as has_votes
      FROM read_parquet('${esc(levelGlob('precinct'))}', union_by_name=true)
      GROUP BY reg_name, prv_name, mun_name, pollplace
    ) sub
    GROUP BY reg_name, prv_name, mun_name
    ORDER BY reg_name, prv_name, mun_name
  `.trim().replace(/\s+/g, ' '));

  // Group cities by region:province and load into Redis
  const cityGroups: Map<string, { name: string; totalPrecincts: number; reportedPrecincts: number; completionRate: number }[]> = new Map();
  for (const c of allCities) {
    const reg = String(c.reg_name);
    const prv = String(c.prv_name);
    const groupKey = `${reg}:${prv}`;
    const total = Number(c.total_precincts || 0);
    const reported = Number(c.reported_precincts || 0);
    const cr = total > 0 ? Math.round((reported / total) * 100) : 0;
    if (!cityGroups.has(groupKey)) cityGroups.set(groupKey, []);
    cityGroups.get(groupKey)!.push({ name: String(c.mun_name), totalPrecincts: total, reportedPrecincts: reported, completionRate: cr });
  }

  const pipeline = redis.pipeline();
  for (const [groupKey, cities] of cityGroups) {
    const key = `analytics:geo:city:${groupKey}`;
    for (const c of cities) {
      pipeline.hset(key, c.name, JSON.stringify(c));
      cityCount++;
    }
  }
  if (cityCount > 0) await pipeline.exec();
  totalKeys += cityCount;
  console.log(`  Loaded ${cityCount} cities across ${cityGroups.size} province groups`);

  return totalKeys;
}

async function seedVoteShare(redis: Redis): Promise<number> {
  console.log('Seeding vote share (batch mode)...');

  // National: single query for ALL contests
  console.log('  National level...');
  const natRows = await query(`
    SELECT LPAD(CAST(contest_code AS VARCHAR), 8, '0') as contest,
           candidate_name, party_code, SUM(total_votes) as votes
    FROM read_parquet('${esc(levelGlob('national'))}', union_by_name=true)
    GROUP BY contest, candidate_name, party_code
    ORDER BY contest, votes DESC
  `.trim().replace(/\s+/g, ' '));

  let totalKeys = await groupAndLoadVoteShare(redis, natRows, 'nat', null);
  console.log(`  National: ${totalKeys} keys`);

  // Geo levels: single query per level, grouped by contest + geo
  const geoLevels = [
    { name: 'region', label: 'reg', col: 'reg_name' },
    { name: 'province', label: 'prv', col: 'prv_name' },
    { name: 'municipality', label: 'mun', col: 'mun_name' },
  ];

  for (const level of geoLevels) {
    console.log(`  ${level.name} level...`);
    const rows = await query(`
      SELECT LPAD(CAST(contest_code AS VARCHAR), 8, '0') as contest,
             ${level.col} as geo,
             candidate_name, party_code, SUM(total_votes) as votes
      FROM read_parquet('${esc(levelGlob(level.name))}', union_by_name=true)
      GROUP BY contest, ${level.col}, candidate_name, party_code
      ORDER BY contest, ${level.col}, votes DESC
    `.trim().replace(/\s+/g, ' '));

    const count = await groupAndLoadVoteShare(redis, rows, level.label, level.col);
    totalKeys += count;
    console.log(`  ${level.name}: ${count} keys`);
  }

  console.log(`  Loaded ${totalKeys} total vote share keys`);
  return totalKeys;
}

/** Group raw vote share rows by contest+geo and load into Redis. */
async function groupAndLoadVoteShare(
  redis: Redis,
  rows: Record<string, any>[],
  levelLabel: string,
  geoCol: string | null,
): Promise<number> {
  // Group rows by redis key
  const groups: Map<string, { name: string; party: string; votes: number; percentage: number }[]> = new Map();

  for (const r of rows) {
    const contest = String(r.contest);
    const geo = geoCol ? String(r[geoCol]) : null;
    const key = geo
      ? `analytics:votes:${contest}:${levelLabel}:${geo}`
      : `analytics:votes:${contest}:${levelLabel}`;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({
      name: String(r.candidate_name),
      party: String(r.party_code || ''),
      votes: Number(r.votes),
      percentage: 0, // calculated below
    });
  }

  // Calculate percentages and load into Redis
  const pipeline = redis.pipeline();
  for (const [key, candidates] of groups) {
    const totalVotes = candidates.reduce((sum, c) => sum + c.votes, 0);
    for (const c of candidates) {
      c.percentage = totalVotes > 0 ? Math.round((c.votes / totalVotes) * 1000) / 10 : 0;
    }
    const contest = key.split(':')[2]; // analytics:votes:{contest}:...
    pipeline.set(key, JSON.stringify({ contest, contestName: '', totalVotes, candidates }));
  }
  if (groups.size > 0) await pipeline.exec();
  return groups.size;
}

async function seedUndervotes(redis: Redis): Promise<number> {
  console.log('Seeding undervotes (batch mode)...');

  const levels: { name: string; label: string; col: string | null }[] = [
    { name: 'national', label: 'nat', col: null },
    { name: 'region', label: 'reg', col: 'reg_name' },
    { name: 'province', label: 'prv', col: 'prv_name' },
    { name: 'municipality', label: 'mun', col: 'mun_name' },
  ];

  let totalKeys = 0;

  for (const level of levels) {
    console.log(`  ${level.name} level...`);

    const geoSelect = level.col ? `, ${level.col} as geo` : '';
    const geoGroup = level.col ? `, ${level.col}` : '';

    const rows = await query(`
      SELECT LPAD(CAST(contest_code AS VARCHAR), 8, '0') as contest${geoSelect},
             SUM(total_votes) as total_votes,
             MIN(total_under_votes) as total_under_votes,
             MIN(total_over_votes) as total_over_votes
      FROM read_parquet('${esc(levelGlob(level.name))}', union_by_name=true)
      GROUP BY LPAD(CAST(contest_code AS VARCHAR), 8, '0')${geoGroup}
    `.trim().replace(/\s+/g, ' '));

    const pipeline = redis.pipeline();
    let batchCount = 0;

    for (const r of rows) {
      const contest = String(r.contest);
      const geo = level.col ? String(r.geo) : null;
      const key = geo
        ? `analytics:undervotes:${contest}:${level.label}:${geo}`
        : `analytics:undervotes:${contest}:${level.label}`;

      const tv = Number(r.total_votes || 0);
      const tuv = Number(r.total_under_votes || 0);
      const tov = Number(r.total_over_votes || 0);

      pipeline.set(key, JSON.stringify({
        totalVotes: tv, totalUndervotes: tuv, totalOvervotes: tov,
        undervoteRate: tv > 0 ? Math.round((tuv / tv) * 1000) / 10 : 0,
        overvoteRate: tv > 0 ? Math.round((tov / tv) * 1000) / 10 : 0,
      }));
      batchCount++;
    }

    if (batchCount > 0) await pipeline.exec();
    totalKeys += batchCount;
    console.log(`  ${level.name}: ${batchCount} keys`);
  }

  console.log(`  Loaded ${totalKeys} total undervote keys`);
  return totalKeys;
}

// ── Helpers ─────────────────────────────────────────────────────────

function levelGlob(level: string): string {
  return `${PARQUET_BASE}/${level}/**/*.parquet`;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Analytics Redis Seed ===');
  console.log(`Parquet base: ${PARQUET_BASE}`);
  console.log(`Redis URL: ${REDIS_URL}`);

  const redis = new Redis(REDIS_URL!, { maxRetriesPerRequest: 3 });

  try {
    const start = Date.now();

    await seedContestList(redis);
    await seedGeographyStatus(redis);
    await seedVoteShare(redis);
    await seedUndervotes(redis);

    const dbsize = await redis.dbsize();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nDone in ${elapsed}s! Redis DB has ${dbsize} keys.`);
  } finally {
    await redis.quit();
    if (db) {
      db.closeSync();
    }
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
