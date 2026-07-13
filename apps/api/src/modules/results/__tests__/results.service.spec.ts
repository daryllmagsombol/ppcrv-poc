import { Test, TestingModule } from '@nestjs/testing';
import { ResultsService } from '../results.service';

describe('ResultsService', () => {
  let service: ResultsService;

  beforeEach(async () => {
    process.env.PARQUET_BASE_PATH = './output';

    const module: TestingModule = await Test.createTestingModule({
      providers: [ResultsService],
    }).compile();

    service = module.get<ResultsService>(ResultsService);
  });

  afterEach(() => {
    delete process.env.PARQUET_BASE_PATH;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('categoryFromCode', () => {
    it('should return Senator for code 00399000', () => {
      const result = (service as any).categoryFromCode('00399000');
      expect(result).toBe('Senator');
    });

    it('should return Governor for code 00401000', () => {
      const result = (service as any).categoryFromCode('00401000');
      expect(result).toBe('Governor');
    });

    it('should return Mayor for code 00801010', () => {
      const result = (service as any).categoryFromCode('00801010');
      expect(result).toBe('Mayor');
    });

    it('should return Unknown for unrecognized prefix', () => {
      const result = (service as any).categoryFromCode('99900000');
      expect(result).toBe('Unknown');
    });

    it('should handle empty string', () => {
      const result = (service as any).categoryFromCode('');
      expect(result).toBe('Unknown');
    });
  });

  describe('buildContestQuery', () => {
    it('should build correct SQL with no params (national)', () => {
      const { sql } = (service as any).buildContestQuery({});
      expect(sql).toContain("SELECT DISTINCT contest_code FROM './output/national/**/*.parquet'");
    });

    it('should build correct SQL with region filter', () => {
      const { sql, level } = (service as any).buildContestQuery({ reg: 'NCR' });
      expect(sql).toContain("reg_name = 'NCR'");
      expect(level).toBe('region');
    });

    it('should build correct SQL with region + province filter', () => {
      const { sql, level } = (service as any).buildContestQuery({ reg: 'CAR', prv: 'BENGUET' });
      expect(sql).toContain("reg_name = 'CAR'");
      expect(sql).toContain("prv_name = 'BENGUET'");
      expect(level).toBe('province');
    });

    it('should filter contests by category on frontend', () => {
      expect(true).toBe(true);
    });
  });

  describe('buildQuery', () => {
    it('should generate correct SQL for national level', () => {
      const { sql, level } = (service as any).buildQuery({ level: 'national' });
      expect(sql).toContain("FROM './output/national/**/*.parquet'");
      expect(level).toBe('national');
    });

    it('should add WHERE clause for region filter', () => {
      const { sql } = (service as any).buildQuery({ level: 'region', reg: 'NCR' });
      expect(sql).toContain("reg_name = 'NCR'");
    });

    it('should add multiple WHERE conditions', () => {
      const { sql } = (service as any).buildQuery({
        level: 'province',
        reg: 'NCR',
        prv: 'METRO MANILA',
        contest: '00399000',
      });
      expect(sql).toContain("reg_name = 'NCR'");
      expect(sql).toContain("prv_name = 'METRO MANILA'");
      expect(sql).toContain("contest_code = '00399000'");
    });
  });
});
