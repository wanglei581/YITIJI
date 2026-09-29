import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { DisabledOcrProvider } from './disabled-ocr.provider'
import { TencentOcrProvider } from './tencent-ocr.provider.stub'
import { BaiduOcrProvider } from './baidu-ocr.provider'
import type { OcrInput, OcrProvider, OcrProviderName, OcrResult } from './ocr-provider.interface'
import { resolveOcrProviderName } from '../../../config/ai-platform-config'

const KNOWN_OCR_PROVIDERS = ['disabled', 'tencent', 'baidu'] as const

/**
 * OCR provider 选择器。
 *
 * 按 OCR_PROVIDER env 选择 active provider（默认 disabled）：
 *   - disabled：图片 / 扫描件诚实返回 OCR_NOT_CONFIGURED，绝不假识别。
 *   - baidu：真实百度智能云通用文字识别（高精度版 accurate_basic，Stage 3）。
 *   - tencent：占位（保留扩展位，未接真实 API）。
 *
 * 非法 OCR_PROVIDER 值启动即抛 OCR_PROVIDER_INVALID，不静默回退
 * （对齐 AiService 对 AI_PROVIDER 的处理范式）。
 * 例外（F-11）：生产环境按去空白 + 小写取值，认不出的落到 disabled（如实 OCR_NOT_CONFIGURED），
 * 不让一个填错的 OCR 取值在依赖注入阶段拖垮整站；缺项由 /health 的 ai-platform 降级如实报出。
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name)
  private readonly provider: OcrProvider

  constructor(
    private readonly disabledProvider: DisabledOcrProvider,
    private readonly tencentProvider: TencentOcrProvider,
    private readonly baiduProvider: BaiduOcrProvider,
  ) {
    const rawName = resolveOcrProviderName()
    if (!(KNOWN_OCR_PROVIDERS as readonly string[]).includes(rawName)) {
      throw new InternalServerErrorException({
        error: {
          code: 'OCR_PROVIDER_INVALID',
          message: `Unknown OCR_PROVIDER "${rawName}". Must be one of: ${KNOWN_OCR_PROVIDERS.join(', ')}`,
        },
      })
    }
    const name = rawName as OcrProviderName
    const map: Record<OcrProviderName, OcrProvider> = {
      disabled: this.disabledProvider,
      tencent: this.tencentProvider,
      baidu: this.baiduProvider,
    }
    this.provider = map[name]
    this.logger.log(`OCR provider = ${this.provider.name}`)
  }

  get activeProviderName(): OcrProviderName {
    return this.provider.name
  }

  recognize(input: OcrInput): Promise<OcrResult> {
    return this.provider.recognize(input)
  }
}
