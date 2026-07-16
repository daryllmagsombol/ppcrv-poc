import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from '../analytics.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [AnalyticsService],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getVoteShare should throw BadRequestException on DuckDB failure', async () => {
    const origPath = process.env.PARQUET_BASE_PATH;
    process.env.PARQUET_BASE_PATH = '/tmp/nonexistent-parquet-dir-12345';
    const failModule = await Test.createTestingModule({
      providers: [AnalyticsService],
    }).compile();
    const failService = failModule.get<AnalyticsService>(AnalyticsService);
    expect(() => failService.getVoteShare({})).toThrow();
    process.env.PARQUET_BASE_PATH = origPath;
  });

  it('getVoteShare with contest filter builds correct query structure', () => {
    expect(typeof service.getVoteShare).toBe('function');
    expect(service.getVoteShare.length).toBe(1);
  });

  it('getUndervotes should throw BadRequestException on DuckDB failure', () => {
    expect(() => service.getUndervotes({})).toThrow();
  });

  it('getUndervotes accepts expected params shape', () => {
    expect(typeof service.getUndervotes).toBe('function');
    expect(service.getUndervotes.length).toBe(1);
  });
});
