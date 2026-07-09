import { Module } from '@nestjs/common';
import { ResultsModule } from './modules/results/results.module';

@Module({
  imports: [ResultsModule],
})
export class AppModule {}
