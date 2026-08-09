import { Module } from '@nestjs/common'
import { AiModule } from '../ai/ai.module'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { FilesModule } from '../files/files.module'
import { PrismaModule } from '../prisma/prisma.module'
import { StorageModule } from '../storage/storage.module'
import { MaterialsController } from './materials.controller'
import { MaterialsCleanupTask } from './materials.cleanup.task'
import { MaterialsService } from './materials.service'
import { PiiRedactionService } from './pii-redaction.service'

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    JwtVerifierModule,
    // 只为了复用 OcrService 做真实内容扫描（文件体检真实化），不需要 AiModule 的其它能力。
    AiModule,
    // 隐私遮挡派生件走 FilesService.upload（血缘 sourceFileId + assetCategory:'derived'），
    // 与 print-sign / print-conversion 同一落库模式。
    FilesModule,
  ],
  controllers: [MaterialsController],
  providers: [MaterialsService, PiiRedactionService, MaterialsCleanupTask],
  exports: [MaterialsService],
})
export class MaterialsModule {}
