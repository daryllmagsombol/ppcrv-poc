import { Controller, Get, Param, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { AnalyticsService, RegionStatus, ProvinceStatus, CityStatus, VoteShareResponse, UndervoteResponse } from './analytics.service';
import { VoteShareQueryDto } from './dto/vote-share-query.dto';
import { UndervotesQueryDto } from './dto/undervotes-query.dto';

@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
@Controller('api/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('geography-status')
  getGeographyStatus(): Promise<RegionStatus[]> {
    return this.analyticsService.getGeographyStatus();
  }

  @Get('geography-status/regions/:reg')
  getProvinceStatus(@Param('reg') reg: string): Promise<ProvinceStatus[]> {
    return this.analyticsService.getProvinceStatus(reg);
  }

  @Get('geography-status/regions/:reg/provinces/:prv')
  getCityStatus(@Param('reg') reg: string, @Param('prv') prv: string): Promise<CityStatus[]> {
    return this.analyticsService.getCityStatus(reg, prv);
  }

  @Get('vote-share')
  getVoteShare(@Query() query: VoteShareQueryDto): Promise<VoteShareResponse> {
    return this.analyticsService.getVoteShare(query);
  }

  @Get('undervotes')
  getUndervotes(@Query() query: UndervotesQueryDto): Promise<UndervoteResponse> {
    return this.analyticsService.getUndervotes(query);
  }
}
