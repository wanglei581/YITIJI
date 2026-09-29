// ============================================================
// AI 生成内容（AIGC）PDF 元数据标识（S0-4 / 风险 R4）
//
// 背景：`docs/design/kiosk-ai-os-v3-2026-08/interface-handoff.md` §3 要求
// 「所有 AI 生成内容（含打印件）必须带可见标识与文件元数据标识」。
// 实测只有合同审查报告做到了（Subject + 页眉 + 每页页脚 + 自定义 metadata），
// 其余 5 个 AI 产物 PDF 只有首页一行免责声明、**PDF metadata 里没有任何 AIGC 字段**，
// 简历 PDF 更是连免责声明都没有，只有一个 Title。
//
// 本文件把合同审查那套 metadata 写法抽成公共实现，让所有 AI 产物 PDF 一致。
//
// 本函数只写元数据。可见页眉由允许印标识的 PDF 服务调用 stampAigcPageHeader。
// 简历 PDF 仍不加可见标识，是否印在投递件上待产品负责人拍板。
//
// 隐私：metadata 只写标识与时间，不写简历正文、诊断结论、姓名、fileId。
// contentId 只允许传服务端任务号、会话号或产物号，必须能回到生成记录。空串拒绝写入。
// ============================================================

import { buildAigcLabelJson, requireAigcProduceId } from './aigc-label'

/** 本终端的 AIGC 服务方标识前缀。与合同审查的 `zyd-contract-v1` 同一命名族。 */
const SERVICE_PROVIDER_PREFIX = 'zyd'

export interface AigcPdfMetadataInput {
  /** PDF 标题（会写进 info.Title） */
  readonly title: string
  /** 一句话说明产物性质与「仅供参考」口径（写进 info.Subject） */
  readonly subject: string
  /**
   * 产物类型标识，拼成 ServiceProviderCode = `zyd-<kind>-v1`。
   * 取值须与能力一一对应，便于事后按产物类型检索。
   */
  readonly kind: string
  /** 生成时间；不传取当前时间 */
  readonly generatedAt?: Date
  /** 服务端任务号、会话号或产物号。AI 生成的 PDF 必填，不得传用户身份，也不得用随机号代替。 */
  readonly contentId: string
}

/**
 * 给 PDFDocument 写入 AIGC 标识元数据。
 *
 * 必须在 `new PDFDocument()` 之后、`doc.end()` 之前调用。
 * 只写元数据，不改任何版面内容，因此对已有页数 / 排版没有影响。
 */
export function applyAigcPdfMetadata(
  doc: { info: PDFKit.DocumentInfo },
  input: AigcPdfMetadataInput,
): void {
  const contentId = requireAigcProduceId(input.contentId ?? '')
  const generatedAt = input.generatedAt ?? new Date()
  const info = doc.info as unknown as Record<string, string | Date>
  info['Title'] = input.title
  info['Author'] = '青序 AI 求职服务'
  info['Subject'] = input.subject
  info['CreationDate'] = generatedAt
  // 以下为 AIGC 标识字段，与 contract-review-report-pdf.service.ts 保持同一组键名
  info['AIGenerated'] = 'true'
  info['ServiceProviderCode'] = `${SERVICE_PROVIDER_PREFIX}-${input.kind}-v1`
  info['GeneratedAt'] = generatedAt.toISOString()
  info['ContentId'] = contentId
  // 首次写入时传播方与生产方相同。AIGenerated=false 的文件不走本函数，因此不写 AIGC。
  info['AIGC'] = buildAigcLabelJson(contentId)
}
