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
const CONTEST_NAMES_PATH = path.resolve(PARQUET_BASE, '..', 'contest-names.json');

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

  // ── Cities (top 50 provinces only to manage Redis key count) ──
  console.log('  Cities (top 50 provinces)...');
  let cityCount = 0;

  // Get all province/region pairs
  const provinceList: { reg: string; prv: string }[] = [];
  for (const reg of regions) {
    const provs = await query(`
      SELECT DISTINCT prv_name
      FROM read_parquet('${esc(levelGlob('precinct'))}', union_by_name=true)
      WHERE reg_name = '${esc(String(reg.reg_name))}'
    `.trim().replace(/\s+/g, ' '));
    for (const p of provs) {
      provinceList.push({ reg: String(reg.reg_name), prv: String(p.prv_name) });
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
        FROM read_parquet('${esc(levelGlob('precinct'))}', union_by_name=true)
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
        const total = Number(c.total_precincts || 0);
        const reported = Number(c.reported_precincts || 0);
        const cr = total > 0 ? Math.round((reported / total) * 100) : 0;
        pipeline.hset(key, String(c.mun_name), JSON.stringify({
          name: c.mun_name, totalPrecincts: total, reportedPrecincts: reported, completionRate: cr,
        }));
      }
      await pipeline.exec();
      cityCount += cities.length;
    }
  }
  totalKeys += cityCount;
  console.log(`  Loaded ${cityCount} cities (${provinceList.length - topProvinces.length} provinces skipped)`);

  return totalKeys;
}

async function seedVoteShare(redis: Redis): Promise<number> {
  console.log('Seeding vote share...');

  // Get all distinct contest codes from national-level data
  const contests = await query(`
    SELECT DISTINCT LPAD(CAST(contest_code AS VARCHAR), 8, '0') as code
    FROM read_parquet('${esc(levelGlob('national'))}', union_by_name=true)
    ORDER BY code
  `.trim().replace(/\s+/g, ' '));

  console.log(`  Found ${contests.length} contests`);

  const levels: { name: string; label: string }[] = [
    { name: 'national', label: 'nat' },
    { name: 'region', label: 'reg' },
    { name: 'province', label: 'prv' },
    { name: 'municipality', label: 'mun' },
  ];

  let totalKeys = 0;

  for (let ci = 0; ci < contests.length; ci++) {
    const code = String(contests[ci].code);

    for (const level of levels) {
      if (level.name === 'national') {
        // National level — single key
        const rows = await query(`
          SELECT candidate_name, party_code, SUM(total_votes) as votes
          FROM read_parquet('${esc(levelGlob(level.name))}', union_by_name=true)
          WHERE LPAD(CAST(contest_code AS VARCHAR), 8, '0') = '${esc(code)}'
          GROUP BY candidate_name, party_code
          ORDER BY votes DESC
        `.trim().replace(/\s+/g, ' '));

        if (rows.length === 0) continue;

        const totalVotes = rows.reduce((sum, r) => sum + Number(r.votes || 0), 0);
        const candidates = rows.map(r => ({
          name: r.candidate_name,
          party: String(r.party_code || ''),
          votes: Number(r.votes),
          percentage: totalVotes > 0 ? Math.round((Number(r.votes) / totalVotes) * 1000) / 10 : 0,
        }));

        const key = `analytics:votes:${code}:nat`;
        await redis.set(key, JSON.stringify({ contest: code, contestName: '', totalVotes, candidates }));
        totalKeys++;
        continue;
      }

      // Geo-level: get distinct geographies for this contest
      const geoCol = level.name === 'region' ? 'reg_name'
        : level.name === 'province' ? 'prv_name'
        : 'mun_name';

      const geos = await query(`
        SELECT DISTINCT ${geoCol} as geo
        FROM read_parquet('${esc(levelGlob(level.name))}', union_by_name=true)
        WHERE LPAD(CAST(contest_code AS VARCHAR), 8, '0') = '${esc(code)}'
      `.trim().replace(/\s+/g, ' '));

      const pipeline = redis.pipeline();
      let batchCount = 0;

      for (const g of geos) {
        const geoKey = String(g.geo);
        const whereClause = `WHERE LPAD(CAST(contest_code AS VARCHAR), 8, '0') = '${esc(code)}' AND ${geoCol} = '${esc(geoKey)}'`;
        const rows = await query(`
          SELECT candidate_name, party_code, SUM(total_votes) as votes
          FROM read_parquet('${esc(levelGlob(level.name))}', union_by_name=true)
          ${whereClause}
          GROUP BY candidate_name, party_code
          ORDER BY votes DESC
        `.trim().replace(/\s+/g, ' '));

        if (rows.length === 0) continue;

        const totalVotes = rows.reduce((sum, r) => sum + Number(r.votes || 0), 0);
        const candidates = rows.map(r => ({
          name: r.candidate_name,
          party: String(r.party_code || ''),
          votes: Number(r.votes),
          percentage: totalVotes > 0 ? Math.round((Number(r.votes) / totalVotes) * 1000) / 10 : 0,
        }));

        pipeline.set(`analytics:votes:${code}:${level.label}:${geoKey}`, JSON.stringify({
          contest: code, contestName: '', totalVotes, candidates,
        }));
        batchCount++;
      }

      if (batchCount > 0) {
        await pipeline.exec();
        totalKeys += batchCount;
      }
    }

    if ((ci + 1) % 100 === 0) {
      console.log(`  Progress: ${ci + 1}/${contests.length} contests processed (${totalKeys} vote share keys)...`);
    }
  }

  console.log(`  Loaded ${totalKeys} vote share keys`);
  return totalKeys;
}

async function seedUndervotes(redis: Redis): Promise<number> {
  console.log('Seeding undervotes...');

  const contests = await query(`
    SELECT DISTINCT LPAD(CAST(contest_code AS VARCHAR), 8, '0') as code
    FROM read_parquet('${esc(levelGlob('national'))}', union_by_name=true)
    ORDER BY code
  `.trim().replace(/\s+/g, ' '));

  const levels: { name: string; label: string }[] = [
    { name: 'national', label: 'nat' },
    { name: 'region', label: 'reg' },
    { name: 'province', label: 'prv' },
    { name: 'municipality', label: 'mun' },
  ];

  let totalKeys = 0;

  for (let ci = 0; ci < contests.length; ci++) {
    const code = String(contests[ci].code);

    for (const level of levels) {
      if (level.name === 'national') {
        const rows = await query(`
          SELECT SUM(total_votes) as total_votes,
                 MIN(total_under_votes) as total_under_votes,
                 MIN(total_over_votes) as total_over_votes
          FROM read_parquet('${esc(levelGlob(level.name))}', union_by_name=true)
          WHERE LPAD(CAST(contest_code AS VARCHAR), 8, '0') = '${esc(code)}'
        `.trim().replace(/\s+/g, ' '));

        const tv = Number(rows[0]?.total_votes || 0);
        const tuv = Number(rows[0]?.total_under_votes || 0);
        const tov = Number(rows[0]?.total_over_votes || 0);

        await redis.set(`analytics:undervotes:${code}:nat`, JSON.stringify({
          totalVotes: tv, totalUndervotes: tuv, totalOvervotes: tov,
          undervoteRate: tv > 0 ? Math.round((tuv / tv) * 1000) / 10 : 0,
          overvoteRate: tv > 0 ? Math.round((tov / tv) * 1000) / 10 : 0,
        }));
        totalKeys++;
        continue;
      }

      const geoCol = level.name === 'region' ? 'reg_name'
        : level.name === 'province' ? 'prv_name'
        : 'mun_name';

      const geos = await query(`
        SELECT DISTINCT ${geoCol} as geo
        FROM read_parquet('${esc(levelGlob(level.name))}', union_by_name=true)
        WHERE LPAD(CAST(contest_code AS VARCHAR), 8, '0') = '${esc(code)}'
      `.trim().replace(/\s+/g, ' '));

      const pipeline = redis.pipeline();
      let batchCount = 0;

      for (const g of geos) {
        const geoKey = String(g.geo);
        const whereClause = `WHERE LPAD(CAST(contest_code AS VARCHAR), 8, '0') = '${esc(code)}' AND ${geoCol} = '${esc(geoKey)}'`;
        const rows = await query(`
          SELECT SUM(total_votes) as total_votes,
                 MIN(total_under_votes) as total_under_votes,
                 MIN(total_over_votes) as total_over_votes
          FROM read_parquet('${esc(levelGlob(level.name))}', union_by_name=true)
          ${whereClause}
        `.trim().replace(/\s+/g, ' '));

        const tv = Number(rows[0]?.total_votes || 0);
        const tuv = Number(rows[0]?.total_under_votes || 0);
        const tov = Number(rows[0]?.total_over_votes || 0);

        pipeline.set(`analytics:undervotes:${code}:${level.label}:${geoKey}`, JSON.stringify({
          totalVotes: tv, totalUndervotes: tuv, totalOvervotes: tov,
          undervoteRate: tv > 0 ? Math.round((tuv / tv) * 1000) / 10 : 0,
          overvoteRate: tv > 0 ? Math.round((tov / tv) * 1000) / 10 : 0,
        }));
        batchCount++;
      }

      if (batchCount > 0) {
        await pipeline.exec();
        totalKeys += batchCount;
      }
    }

    if ((ci + 1) % 100 === 0) {
      console.log(`  Progress: ${ci + 1}/${contests.length} contests processed (${totalKeys} undervote keys)...`);
    }
  }

  console.log(`  Loaded ${totalKeys} undervote keys`);
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
