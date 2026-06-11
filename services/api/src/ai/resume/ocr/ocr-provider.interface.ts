// ============================================================
// OCR Provider 接口（Phase 1A —— 简历图片/扫描件文字识别底座）
//
// 合规约束（所有实现必须遵守）：
// - OCR 密钥只在服务端 env，严禁出现在任何前端代码
// - 公共一体机上「读不出就如实报错」，绝不返回任何假识别文本
// - 不把简历图片 URL / 识别原文写入日志或审计
// ============================================================

export type OcrProviderName = 'disabled' | 'tencent' | 'baidu'

/** OCR 失败码（上层映射为 ResumeExtractionErrorCode 的 OCR_* 子集）。 */
export type OcrErrorCode = 'OCR_NOT_CONFIGURED' | 'OCR_FAILED'

export interface OcrInput {
  /** 服务端读出的图片 buffer，不经前端、不落第三方 URL。 */
  buffer: Buffer
  mimeType: string
}

export interface OcrResult {
  ok: boolean
  /** ok=true 时的识别文本；失败时不返回。 */
  text?: string
  /** 识别置信度（OCR 出错率高，通常 medium/low）。 */
  confidence?: 'high' | 'medium' | 'low'
  /** ok=false 时给出，供上层映射失败原因。 */
  errorCode?: OcrErrorCode
  errorMessage?: string
}

export interface OcrProvider {
  /** provider 标识，用于启动日志与元数据（不记原文）。 */
  readonly name: OcrProviderName
  recognize(input: OcrInput): Promise<OcrResult>
}
