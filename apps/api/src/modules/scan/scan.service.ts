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
