import { Controller, Get, Param, UsePipes, ValidationPipe } from '@nestjs/common';
import { AnalyticsService, RegionStatus } from './analytics.service';

@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
@Controller('api/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('geography-status')
  getGeographyStatus(): RegionStatus[] {
    return this.analyticsService.getGeographyStatus();
  }

  @Get('geography-status/regions/:reg')
  getProvinceStatus(@Param('reg') reg: string) {
    return this.analyticsService.getProvinceStatus(reg);
  }

  @Get('geography-status/regions/:reg/provinces/:prv')
  getCityStatus(@Param('reg') reg: string, @Param('prv') prv: string) {
    return this.analyticsService.getCityStatus(reg, prv);
  }
}
