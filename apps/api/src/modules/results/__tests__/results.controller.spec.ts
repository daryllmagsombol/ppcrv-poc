import { Test, TestingModule } from '@nestjs/testing';
import { ResultsController } from '../results.controller';
import { ResultsService } from '../results.service';

describe('ResultsController', () => {
  let controller: ResultsController;
  let service: ResultsService;

  const mockService = {
    queryResults: jest.fn(),
    getDistinctValues: jest.fn(),
    getContestsByGeography: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResultsController],
      providers: [{ provide: ResultsService, useValue: mockService }],
    }).compile();

    controller = module.get<ResultsController>(ResultsController);
    service = module.get<ResultsService>(ResultsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('GET /api/results should call service.queryResults', () => {
    const dto = { level: 'national' };
    controller.getResults(dto as any);
    expect(mockService.queryResults).toHaveBeenCalledWith(dto);
  });

  it('GET /api/regions should return distinct regions', () => {
    mockService.getDistinctValues.mockReturnValue(['NCR', 'CAR']);
    const result = controller.getRegions();
    expect(result).toEqual(['NCR', 'CAR']);
    expect(mockService.getDistinctValues).toHaveBeenCalledWith('region', 'reg_name');
  });

  it('GET /api/contests should call service.getContestsByGeography with query params', () => {
    mockService.getContestsByGeography = jest.fn().mockReturnValue([
      { code: '00399000', name: 'SENATOR OF PHILIPPINES', category: 'Senator' },
    ]);
    const result = controller.getContests('NCR', 'METRO MANILA', undefined, undefined);
    expect(mockService.getContestsByGeography).toHaveBeenCalledWith({
      reg: 'NCR',
      prv: 'METRO MANILA',
    });
    expect(result).toEqual([
      { code: '00399000', name: 'SENATOR OF PHILIPPINES', category: 'Senator' },
    ]);
  });

  it('GET /api/contests should work with no params', () => {
    mockService.getContestsByGeography = jest.fn().mockReturnValue([]);
    const result = controller.getContests();
    expect(mockService.getContestsByGeography).toHaveBeenCalledWith({});
  });
});
