import { Module } from '@nestjs/common';
import { PackageOrdersController } from './package-orders.controller';
import { PackageOrdersService } from './package-orders.service';
import { PrismaModule } from '../prisma/prisma.module';
import { FilesModule } from '../files/files.module';
import { PrintJobsModule } from '../print-jobs/print-jobs.module';

@Module({
  imports: [PrismaModule, FilesModule, PrintJobsModule],
  controllers: [PackageOrdersController],
  providers: [PackageOrdersService],
  exports: [PackageOrdersService],
})
export class PackageOrdersModule {}
