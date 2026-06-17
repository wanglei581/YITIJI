import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { PrismaModule } from '../prisma/prisma.module'
import { StorageModule } from '../storage/storage.module'
import { MaterialsController } from './materials.controller'
import { MaterialsCleanupTask } from './materials.cleanup.task'
import { MaterialsService } from './materials.service'

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    JwtVerifierModule,
  ],
  controllers: [MaterialsController],
  providers: [MaterialsService, MaterialsCleanupTask],
  exports: [MaterialsService],
})
export class MaterialsModule {}
