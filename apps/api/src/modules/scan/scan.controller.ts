import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { ScanService } from './scan.service';
import { ScanCompareDto } from './dto/scan-compare.dto';
import { ScanUploadDto } from './dto/scan-upload.dto';

@Controller('api/scan')
export class ScanController {
  constructor(private readonly scanService: ScanService) {}

  @Post('compare')
  async compare(@Body() dto: ScanCompareDto) {
    return this.scanService.compare(dto);
  }

  @Post('upload')
  async upload(@Body() dto: ScanUploadDto) {
    return this.scanService.upload(dto);
  }

  @Get('history')
  async history(@Query('limit') limit?: string) {
    return this.scanService.getHistory(limit ? parseInt(limit, 10) : 50);
  }
}
