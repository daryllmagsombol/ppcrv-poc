import { Module } from '@nestjs/common';
import { ResultsModule } from './modules/results/results.module';
import { ScanModule } from './modules/scan/scan.module';

@Module({
  imports: [ResultsModule, ScanModule],
})
export class AppModule {}
