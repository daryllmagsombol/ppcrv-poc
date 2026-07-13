import { Controller, Get, Param, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ResultsService } from './results.service';
import { ResultQueryDto } from './dto/result-query.dto';
import { ResultsResponse } from './dto/results-response.dto';
import { ContestInfo } from './dto/contest-info.dto';

@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
@Controller('api')
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Get('results')
  getResults(@Query() query: ResultQueryDto): ResultsResponse {
    return this.resultsService.queryResults(query);
  }

  @Get('regions')
  getRegions(): string[] {
    return this.resultsService.getDistinctValues('region', 'reg_name');
  }

  @Get('regions/:reg/provinces')
  getProvinces(@Param('reg') reg: string): string[] {
    return this.resultsService.getDistinctValues('province', 'prv_name', { reg_name: reg });
  }

  @Get('regions/:reg/provinces/:prv/municipalities')
  getMunicipalities(@Param('reg') reg: string, @Param('prv') prv: string): string[] {
    return this.resultsService.getDistinctValues('municipality', 'mun_name', {
      reg_name: reg,
      prv_name: prv,
    });
  }

  @Get('regions/:reg/provinces/:prv/municipalities/:mun/barangays')
  getBarangays(
    @Param('reg') reg: string,
    @Param('prv') prv: string,
    @Param('mun') mun: string,
  ): string[] {
    return this.resultsService.getDistinctValues('barangay', 'brgy_name', {
      reg_name: reg,
      prv_name: prv,
      mun_name: mun,
    });
  }

  @Get('barangays/:brgy/voting-centers')
  getVotingCenters(
    @Param('brgy') brgy: string,
    @Query('reg') reg?: string,
    @Query('prv') prv?: string,
    @Query('mun') mun?: string,
  ): string[] {
    const parents: Record<string, string> = { brgy_name: brgy };
    if (reg) parents.reg_name = reg;
    if (prv) parents.prv_name = prv;
    if (mun) parents.mun_name = mun;
    return this.resultsService.getDistinctValues('precinct', 'pollplace', parents);
  }

  @Get('contests')
  getContests(
    @Query('reg') reg?: string,
    @Query('prv') prv?: string,
    @Query('mun') mun?: string,
    @Query('brgy') brgy?: string,
  ): ContestInfo[] {
    return this.resultsService.getContestsByGeography({ reg, prv, mun, brgy });
  }
}
