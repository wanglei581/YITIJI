// ============================================================
// 简历文件文字提取层契约（Phase 1A）
//
// 目标：把上传的简历文件真实提取为统一 extractedText，作为后续
//       LLM 简历诊断（Phase 1B）的唯一文本输入口。
//
// 合规约束：
// - 失败时绝不返回 mock / 假文本，只返回明确 errorCode + errorMessage
// - 提取文本只在内存中流转给下游分析，不落任何表
// - 原文 / buffer 不写日志、不写审计，只记元数据（charCount/source/耗时）
// ============================================================

/** 文本来源：标识提取走的是哪条路径（pdf_ocr=扫描版 PDF 渲染后 OCR）。 */
export type ResumeTextSource = 'docx' | 'pdf_text' | 'image_ocr' | 'pdf_ocr'

/** 提取置信度。docx/pdf_text 文本层为 high；image_ocr 由 OCR provider 给出。 */
export type ResumeExtractionConfidence = 'high' | 'medium' | 'low'

/**
 * 失败码。
 *
 * 说明：在调用方建议清单基础上新增 FILE_NOT_FOUND / FILE_PURPOSE_REJECTED 两项，
 * 用于覆盖「fileId 已清理 / 读取失败」与「fileId 非简历用途」两类入口失败。
 */
export type ResumeExtractionErrorCode =
  | 'FILE_NOT_FOUND' // fileId 不存在 / 已清理 / 读取失败
  | 'FILE_PURPOSE_REJECTED' // fileId 存在但不是简历文件（purpose 不在白名单）
  | 'FILE_EMPTY' // 空文件
  | 'FILE_TOO_LARGE' // 超过大小上限
  | 'UNSUPPORTED_FILE_TYPE' // 旧版 .doc / 其它不支持格式
  | 'PDF_TEXT_EMPTY' // PDF 无文字层（扫描件）
  | 'TEXT_TOO_SHORT' // 提取到的有效文字过少
  | 'OCR_NOT_CONFIGURED' // 图片但 OCR_PROVIDER=disabled（或腾讯凭证缺失）
  | 'OCR_FAILED' // OCR 已配置但识别失败 / 占位未接入

export interface ResumeExtractionInput {
  fileId: string
  /**
   * 归属会员 id。提取层按该值读取文件：
   * - string: 只能读取本人会员文件。
   * - null / undefined: 只能读取匿名文件。
   */
  endUserId?: string | null
}

export interface ResumeExtractionResult {
  ok: boolean
  fileId: string
  /** 仅 ok=true：提取出的简历文本（可能已按上限截断，截断只影响下游分析）。 */
  text?: string
  textSource?: ResumeTextSource
  confidence?: ResumeExtractionConfidence
  /** PDF 页数（可得时）。 */
  pageCount?: number
  charCount?: number
  /** 非阻塞提示（如文本被截断、清晰度偏低）。 */
  warnings?: string[]
  /** 仅 ok=false。 */
  errorCode?: ResumeExtractionErrorCode
  errorMessage?: string
}
