jest.setTimeout(120_000);

import { Test, TestingModule } from '@nestjs/testing';
import { ScanController } from '../scan.controller';
import { ScanService } from '../scan.service';
import { Pool } from 'pg';

async function isDbReachable(): Promise<boolean> {
  try {
    const pool = new Pool({
      host: process.env.PGHOST || 'localhost',
      database: process.env.PGDATABASE || 'pprcv_local',
      user: process.env.PGUSER || 'daryllmagsombol',
      connectionTimeoutMillis: 3000,
    });
    await pool.query('SELECT 1');
    await pool.end();
    return true;
  } catch {
    return false;
  }
}

describe('ScanController', () => {
  let controller: ScanController;
  let service: ScanService;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDbReachable();
    if (!dbAvailable) return;
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScanController],
      providers: [ScanService],
    }).compile();
    controller = module.get<ScanController>(ScanController);
    service = module.get<ScanService>(ScanService);
    await service.onModuleInit(); // Ensure table exists
  });

  afterAll(async () => {
    if (!dbAvailable || !service) return;
    await service.getPool().end();
  });

  beforeEach(() => {
    if (!dbAvailable) pending('PostgreSQL not available — skipping integration tests');
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
      expect(result).toHaveProperty('precinct_id', '01010001');
      expect(result).toHaveProperty('has_discrepancy');
    });
  });

  describe('POST /api/scan/upload', () => {
    it('should upload and return id', async () => {
      const result = await controller.upload({
        precinct_id: '01010001',
        qr_raw_1: 'test-data',
        has_discrepancy: false,
        scanned_by: 'Test Controller',
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
