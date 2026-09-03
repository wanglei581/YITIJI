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
import { PrintParamSuggestionService } from './print-param-suggestion.service'

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    JwtVerifierModule,
    // 复用 OcrService 做真实内容扫描（文件体检真实化）；
    // S3-1 另复用 LlmConfigService 读打印参数预填功能位开关（不发起模型调用）。
    AiModule,
    // 隐私遮挡派生件走 FilesService.upload（血缘 sourceFileId + assetCategory:'derived'），
    // 与 print-sign / print-conversion 同一落库模式。
    FilesModule,
  ],
  controllers: [MaterialsController],
  providers: [MaterialsService, PiiRedactionService, MaterialsCleanupTask, PrintParamSuggestionService],
  exports: [MaterialsService],
})
export class MaterialsModule {}
