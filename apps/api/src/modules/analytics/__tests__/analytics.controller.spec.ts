import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from '../analytics.controller';
import { AnalyticsService, RegionStatus } from '../analytics.service';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let service: AnalyticsService;

  const mockService = {
    getGeographyStatus: jest.fn(),
    getProvinceStatus: jest.fn(),
    getCityStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [{ provide: AnalyticsService, useValue: mockService }],
    }).compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('GET /api/analytics/geography-status should return region statuses', () => {
    const mock: RegionStatus[] = [
      { name: 'NCR', totalPrecincts: 100, reportedPrecincts: 80, completionRate: 80 },
    ];
    mockService.getGeographyStatus.mockReturnValue(mock);
    expect(controller.getGeographyStatus()).toEqual(mock);
    expect(mockService.getGeographyStatus).toHaveBeenCalled();
  });

  it('GET /api/analytics/geography-status/regions/:reg should return province statuses', () => {
    const mock = [{ name: 'METRO MANILA', totalPrecincts: 50, reportedPrecincts: 40, completionRate: 80 }];
    mockService.getProvinceStatus.mockReturnValue(mock);
    expect(controller.getProvinceStatus('NCR')).toEqual(mock);
    expect(mockService.getProvinceStatus).toHaveBeenCalledWith('NCR');
  });

  it('GET /api/analytics/geography-status/regions/:reg/provinces/:prv should return city statuses', () => {
    const mock = [{ name: 'MANILA', totalPrecincts: 20, reportedPrecincts: 15, completionRate: 75 }];
    mockService.getCityStatus.mockReturnValue(mock);
    expect(controller.getCityStatus('NCR', 'METRO MANILA')).toEqual(mock);
    expect(mockService.getCityStatus).toHaveBeenCalledWith('NCR', 'METRO MANILA');
  });
});
