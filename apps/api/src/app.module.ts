import { Module } from '@nestjs/common';
import { ResultsModule } from './modules/results/results.module';
import { ScanModule } from './modules/scan/scan.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { RedisModule } from './modules/redis/redis.module';

@Module({
  imports: [ResultsModule, ScanModule, AnalyticsModule, RedisModule],
})
export class AppModule {}
