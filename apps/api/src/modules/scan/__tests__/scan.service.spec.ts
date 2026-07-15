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
        qr_raw_1: JSON.stringify({
          contest_code: '399000',
          candidates: [
            { candidate: 'MARCOS, IMEE R. (NP)', party: 'NP', votes: 542 },
          ],
        }),
      });

      expect(result).toHaveProperty('precinct_id', '01010001');
      expect(result).toHaveProperty('has_discrepancy');
      expect(result).toHaveProperty('discrepancy_details');
      expect(result.qr_parsed.length).toBeGreaterThan(0);
      expect(result).toHaveProperty('region');
      expect(result).toHaveProperty('province');
    });

    it('should handle unparsable QR data gracefully', async () => {
      const result = await service.compare({
        precinct_id: '01010001',
        qr_raw_1: 'not-json-data',
      });

      expect(result.qr_parsed.length).toBeGreaterThan(0);
      expect(result.qr_parsed[0].contest_code).toBe('RAW');
      expect(result.has_discrepancy).toBe(false);
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
      const result = await service.compare({
        precinct_id: '01010001',
        qr_raw_1: JSON.stringify({
          contest_code: '399000',
          candidates: [
            { candidate: 'MARCOS, IMEE R. (NP)', party: 'NP', votes: 999 },
          ],
        }),
      });

      // Only verify discrepancy detection if the precinct was found in DB
      if (result.db_results.length > 0) {
        expect(result.has_discrepancy).toBe(true);
        expect(result.discrepancy_details.length).toBeGreaterThan(0);
        expect(result.discrepancy_details[0].qr_votes).toBe(999);
      } else {
        console.warn('Skipping discrepancy check — precinct not found in DuckDB');
      }
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
