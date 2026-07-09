import { Test, TestingModule } from '@nestjs/testing';
import { ResultsService } from '../results.service';

describe('ResultsService', () => {
  let service: ResultsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultsService,
        {
          provide: 'PARQUET_BASE_PATH',
          useValue: process.env.PARQUET_BASE_PATH || './output',
        },
      ],
    }).compile();

    service = module.get<ResultsService>(ResultsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildQuery', () => {
    it('should generate correct SQL for national level', () => {
      const { sql, level } = (service as any).buildQuery({ level: 'national' });
      expect(sql).toContain("FROM './output/national/*.parquet'");
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
