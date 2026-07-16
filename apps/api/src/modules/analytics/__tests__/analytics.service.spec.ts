import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from '../analytics.service';
import { RedisService } from '../../redis/redis.service';

type RedisMock = Pick<
  RedisService,
  'isAvailable' | 'hgetallGeoStatus' | 'getVoteShare' | 'getUndervotes'
>;

function createMockRedis(available: boolean): jest.Mocked<RedisMock> {
  return {
    isAvailable: jest.fn().mockResolvedValue(available),
    hgetallGeoStatus: jest.fn().mockResolvedValue({}),
    getVoteShare: jest.fn().mockResolvedValue(null),
    getUndervotes: jest.fn().mockResolvedValue(null),
  } as jest.Mocked<RedisMock>;
}

async function buildServiceWith(redis: RedisMock): Promise<{ module: TestingModule; service: AnalyticsService }> {
  const module = await Test.createTestingModule({
    providers: [
      AnalyticsService,
      { provide: RedisService, useValue: redis },
    ],
  }).compile();
  const service = module.get<AnalyticsService>(AnalyticsService);
  return { module, service };
}

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let redisService: jest.Mocked<RedisMock>;

  beforeEach(async () => {
    redisService = createMockRedis(false);
    const ctx = await buildServiceWith(redisService);
    service = ctx.service;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- Redis path tests ---

  describe('with Redis available', () => {
    let availableRedis: jest.Mocked<RedisMock>;

    beforeEach(() => {
      availableRedis = createMockRedis(true);
    });

    it('getGeographyStatus returns mapped regions from Redis hash', async () => {
      (availableRedis.hgetallGeoStatus as jest.Mock).mockResolvedValue({
        NCR: { name: 'NCR', totalPrecincts: 100, reportedPrecincts: 80, completionRate: 80 },
        'REGION I': { name: 'REGION I', totalPrecincts: 50, reportedPrecincts: 25, completionRate: 50 },
      });

      const { service: svc } = await buildServiceWith(availableRedis);
      const result = await svc.getGeographyStatus();

      expect(result).toEqual([
        { name: 'NCR', totalPrecincts: 100, reportedPrecincts: 80, completionRate: 80 },
        { name: 'REGION I', totalPrecincts: 50, reportedPrecincts: 25, completionRate: 50 },
      ]);
      expect(availableRedis.hgetallGeoStatus).toHaveBeenCalledWith('analytics:geo:regions');
    });

    it('getGeographyStatus returns empty array when Redis has no data', async () => {
      (availableRedis.hgetallGeoStatus as jest.Mock).mockResolvedValue({});

      const { service: svc } = await buildServiceWith(availableRedis);

      const result = await svc.getGeographyStatus();
      expect(result).toEqual([]);
    });

    it('getProvinceStatus returns provinces for a region', async () => {
      (availableRedis.hgetallGeoStatus as jest.Mock).mockResolvedValue({
        MANILA: { name: 'MANILA', totalPrecincts: 10, reportedPrecincts: 8, completionRate: 80 },
      });

      const { service: svc } = await buildServiceWith(availableRedis);

      const result = await svc.getProvinceStatus('NCR');
      expect(result).toEqual([
        { name: 'MANILA', totalPrecincts: 10, reportedPrecincts: 8, completionRate: 80 },
      ]);
      expect(availableRedis.hgetallGeoStatus).toHaveBeenCalledWith('analytics:geo:province:NCR');
    });

    it('getCityStatus returns cities for a region+province', async () => {
      (availableRedis.hgetallGeoStatus as jest.Mock).mockResolvedValue({
        'CITY A': { name: 'CITY A', totalPrecincts: 5, reportedPrecincts: 4, completionRate: 80 },
      });

      const { service: svc } = await buildServiceWith(availableRedis);

      const result = await svc.getCityStatus('NCR', 'MANILA');
      expect(result).toEqual([
        { name: 'CITY A', totalPrecincts: 5, reportedPrecincts: 4, completionRate: 80 },
      ]);
      expect(availableRedis.hgetallGeoStatus).toHaveBeenCalledWith('analytics:geo:city:NCR:MANILA');
    });

    it('getVoteShare returns data from Redis', async () => {
      const vsData = {
        contest: '00399000',
        contestName: 'SENATOR OF PHILIPPINES',
        totalVotes: 1000,
        candidates: [{ name: 'CANDIDATE A', party: 'IND', votes: 600, percentage: 60 }],
      };
      (availableRedis.getVoteShare as jest.Mock).mockResolvedValue(vsData);

      const { service: svc } = await buildServiceWith(availableRedis);

      const result = await svc.getVoteShare({ contest: '00399000' });
      expect(result).toEqual(vsData);
      expect(availableRedis.getVoteShare).toHaveBeenCalledWith('analytics:votes:00399000:nat');
    });

    it('getVoteShare returns empty when key missing', async () => {
      (availableRedis.getVoteShare as jest.Mock).mockResolvedValue(null);

      const { service: svc } = await buildServiceWith(availableRedis);

      const result = await svc.getVoteShare({ contest: '00399000' });
      expect(result).toEqual({
        contest: '00399000',
        contestName: '',
        totalVotes: 0,
        candidates: [],
      });
    });

    it('getUndervotes returns data from Redis', async () => {
      const uvData = { totalVotes: 1000, totalUndervotes: 50, totalOvervotes: 10, undervoteRate: 5, overvoteRate: 1 };
      (availableRedis.getUndervotes as jest.Mock).mockResolvedValue(uvData);

      const { service: svc } = await buildServiceWith(availableRedis);

      const result = await svc.getUndervotes({ contest: '00399000' });
      expect(result).toEqual(uvData);
      expect(availableRedis.getUndervotes).toHaveBeenCalledWith('analytics:undervotes:00399000:nat');
    });

    it('getUndervotes returns zeros when key missing', async () => {
      (availableRedis.getUndervotes as jest.Mock).mockResolvedValue(null);

      const { service: svc } = await buildServiceWith(availableRedis);

      const result = await svc.getUndervotes({ contest: '00399000' });
      expect(result).toEqual({
        totalVotes: 0,
        totalUndervotes: 0,
        totalOvervotes: 0,
        undervoteRate: 0,
        overvoteRate: 0,
      });
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