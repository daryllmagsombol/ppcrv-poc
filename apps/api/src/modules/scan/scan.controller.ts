import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { ScanService } from './scan.service';
import { ScanCompareDto } from './dto/scan-compare.dto';
import { ScanUploadDto } from './dto/scan-upload.dto';

@Controller('api/scan')
export class ScanController {
  constructor(private readonly scanService: ScanService) {}

  @Post('compare')
  async compare(@Body() dto: ScanCompareDto) {
    return { message: 'not implemented yet' };
  }

  @Post('upload')
  async upload(@Body() dto: ScanUploadDto) {
    return { message: 'not implemented yet' };
  }

  @Get('history')
  async history(@Query('limit') limit?: string) {
    return { message: 'not implemented yet' };
  }
}
