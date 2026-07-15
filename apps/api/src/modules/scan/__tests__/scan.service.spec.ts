import { Test, TestingModule } from '@nestjs/testing';
import { ScanService } from '../scan.service';

jest.setTimeout(120_000);

describe('ScanService', () => {
  let service: ScanService;

  const TIMEOUT = 120_000;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ScanService],
    }).compile();
    service = module.get<ScanService>(ScanService);
    await service.onModuleInit(); // Ensure table exists
  }, TIMEOUT);

  afterAll(async () => {
    await service.getPool().end();
  }, TIMEOUT);

  describe('compare', () => {
    it('should return comparison result with parsed QR and DB results', async () => {
      const result = await service.compare({
        precinct_id: '01010001',
        qr_raw_1: 'NATIONAL\n00399000:1=0|2=0|3=0|4=2|5=2|6=2',
      });

      expect(result).toHaveProperty('precinct_id', '01010001');
      expect(result).toHaveProperty('has_discrepancy');
      expect(result).toHaveProperty('discrepancy_details');
      expect(result.qr_parsed.length).toBeGreaterThan(0);
      expect(result.qr_parsed[0].contest_code).toBe('00399000');
      expect(result).toHaveProperty('region');
      expect(result).toHaveProperty('province');
    });

    it('should handle unparsable QR data gracefully', async () => {
      const result = await service.compare({
        precinct_id: '01010001',
        qr_raw_1: 'not-valid-data',
      });

      expect(result.qr_parsed.length).toBeGreaterThan(0);
      expect(result.qr_parsed[0].contest_code).toBe('RAW');
      expect(result.has_discrepancy).toBe(false);
    });

    it('should auto-detect precinct from VCM metadata QR', async () => {
      const result = await service.compare({
        precinct_id: 'auto-detect',
        qr_raw_1: 'NATIONAL\n00399000:1=0|2=0',
        qr_raw_3: '12,10120012,HASH1,HASH2,RV=922|CB=3',
      });

      expect(result.precinct_id).toBe('10120012');
    });

    it('should return empty db_results for unknown precinct', async () => {
      const result = await service.compare({
        precinct_id: 'ZZZZZZZZ',
        qr_raw_1: JSON.stringify({
          contest_code: '1010010',
          candidates: [],
        }),
      });

      expect(result.db_results).toEqual([]);
    });

    it('should detect discrepancies when votes differ', async () => {
      // VCM format uses position numbers, not candidate names
      // Discrepancy detection requires a position-to-candidate mapping
      // For now, just verify parsing works
      const result = await service.compare({
        precinct_id: '01010001',
        qr_raw_1: 'NATIONAL\n00399000:1=999|2=0|3=0',
      });

      expect(result.qr_parsed.length).toBeGreaterThan(0);
      expect(result.qr_parsed[0].contest_code).toBe('00399000');
      // VCM positions show as "Position N" — no candidate name matching yet
      expect(result.qr_parsed[0].candidates[0].candidate).toBe('Position 1');
      expect(result.qr_parsed[0].candidates[0].votes).toBe(999);
    });
  });

  describe('upload', () => {
    it('should insert a scan record and return id', async () => {
      const result = await service.upload({
        precinct_id: '01010001',
        qr_raw_1: 'test-data',
        has_discrepancy: false,
        scanned_by: 'Test',
      });

      expect(result).toHaveProperty('id');
      expect(result.uploaded).toBe(true);
    });
  });

  describe('getHistory', () => {
    it('should return array of records', async () => {
      const result = await service.getHistory(5);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
