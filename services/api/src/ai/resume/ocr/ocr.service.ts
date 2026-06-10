import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { DisabledOcrProvider } from './disabled-ocr.provider'
import { TencentOcrProvider } from './tencent-ocr.provider.stub'
import type { OcrInput, OcrProvider, OcrProviderName, OcrResult } from './ocr-provider.interface'

const KNOWN_OCR_PROVIDERS = ['disabled', 'tencent'] as const

/**
 * OCR provider 选择器。
 *
 * 按 OCR_PROVIDER env 选择 active provider（默认 disabled）：
 *   - disabled：图片 / 扫描件诚实返回 OCR_NOT_CONFIGURED，绝不假识别。
 *   - tencent：占位（二期接真实腾讯云 OCR API）。
 *
 * 非法 OCR_PROVIDER 值启动即抛 OCR_PROVIDER_INVALID，不静默回退
 * （对齐 AiService 对 AI_PROVIDER 的处理范式）。
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name)
  private readonly provider: OcrProvider

  constructor(
    private readonly disabledProvider: DisabledOcrProvider,
    private readonly tencentProvider: TencentOcrProvider,
  ) {
    const rawName = process.env['OCR_PROVIDER'] ?? 'disabled'
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
