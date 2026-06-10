import { Injectable } from '@nestjs/common'
import type { OcrInput, OcrProvider, OcrProviderName, OcrResult } from './ocr-provider.interface'

/**
 * 腾讯云 OCR provider —— 占位实现（Phase 1A 预留，二期接真实 API）。
 *
 * 接入步骤（二期）：
 *   1. 服务端 env 配置 TENCENT_OCR_SECRET_ID / TENCENT_OCR_SECRET_KEY / TENCENT_OCR_REGION
 *      ★ SecretId / SecretKey 仅服务端持有，严禁写入前端 / 提交真实值到仓库 ★
 *   2. 后端读出图片 buffer 后，服务端完成 TC3-HMAC-SHA256 v3 签名，调用腾讯云
 *      OCR（如 GeneralAccurateOCR / GeneralBasicOCR）；不把图片上传给前端、不把
 *      识别原文 / 图片内容写入日志或审计。
 *   3. 把识别结果映射为 OcrResult（text + confidence）。
 *
 * 当前为占位：即使 OCR_PROVIDER=tencent，也绝不返回任何假文本。
 *   - 凭证未配置 → OCR_NOT_CONFIGURED
 *   - 凭证已配置但真实接口未接入 → OCR_FAILED（诚实失败，引导上传 PDF/DOCX）
 */
@Injectable()
export class TencentOcrProvider implements OcrProvider {
  readonly name: OcrProviderName = 'tencent'

  recognize(_input: OcrInput): Promise<OcrResult> {
    const configured =
      !!process.env['TENCENT_OCR_SECRET_ID'] && !!process.env['TENCENT_OCR_SECRET_KEY']
    if (!configured) {
      return Promise.resolve({
        ok: false,
        errorCode: 'OCR_NOT_CONFIGURED',
        errorMessage:
          '腾讯云 OCR 凭证未配置（需 TENCENT_OCR_SECRET_ID / TENCENT_OCR_SECRET_KEY），请上传带文字层的 PDF 或 DOCX',
      })
    }
    return Promise.resolve({
      ok: false,
      errorCode: 'OCR_FAILED',
      errorMessage:
        '腾讯云 OCR 为占位实现，真实识别接口待二期接入；当前请上传带文字层的 PDF 或 DOCX',
    })
  }
}
