import { Module } from '@nestjs/common'
import { AiModule } from '../ai/ai.module'
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
    // 只为了复用 OcrService 做真实内容扫描（文件体检真实化），不需要 AiModule 的其它能力。
    AiModule,
  ],
  controllers: [MaterialsController],
  providers: [MaterialsService, MaterialsCleanupTask],
  exports: [MaterialsService],
})
export class MaterialsModule {}
