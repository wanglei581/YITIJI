import { Injectable } from '@nestjs/common'
import type { OcrInput, OcrProvider, OcrProviderName, OcrResult } from './ocr-provider.interface'

/**
 * 默认 OCR provider（OCR_PROVIDER=disabled）。
 *
 * 不做任何识别，诚实返回 OCR_NOT_CONFIGURED。Phase 1A 默认即此实现：
 * 图片 / 扫描件简历不假装识别，引导用户上传带文字层的 PDF 或 DOCX。
 */
@Injectable()
export class DisabledOcrProvider implements OcrProvider {
  readonly name: OcrProviderName = 'disabled'

  recognize(_input: OcrInput): Promise<OcrResult> {
    return Promise.resolve({
      ok: false,
      errorCode: 'OCR_NOT_CONFIGURED',
      errorMessage: '图片 / 扫描件简历的文字识别（OCR）尚未配置，请上传带文字层的 PDF 或 DOCX',
    })
  }
}
