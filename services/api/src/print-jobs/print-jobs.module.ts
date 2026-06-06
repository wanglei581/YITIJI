import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PrintJobsController } from './print-jobs.controller'
import { PrintJobsService } from './print-jobs.service'

@Module({
  imports: [
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'dev-only-secret',
    }),
  ],
  controllers: [PrintJobsController],
  providers:   [PrintJobsService],
})
export class PrintJobsModule {}
