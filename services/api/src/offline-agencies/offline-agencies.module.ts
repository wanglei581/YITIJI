import { Module } from '@nestjs/common'
import { OfflineAgenciesController } from './offline-agencies.controller'
import { OfflineAgenciesService } from './offline-agencies.service'

@Module({
  controllers: [OfflineAgenciesController],
  providers: [OfflineAgenciesService],
})
export class OfflineAgenciesModule {}
