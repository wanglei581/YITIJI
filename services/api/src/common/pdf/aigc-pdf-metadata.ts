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
// ⚠️ 边界（本批次刻意不做）：
// 只加**隐式元数据**，不加任何可见水印 / 页眉 / 页脚。
// 简历 PDF 是用户要拿去投递的材料，往上面印可见 AI 标识会直接影响求职结果，
// 属于产品裁决范围，不由工程侧单方面决定。可见标识另案处理。
//
// 隐私：metadata 只写标识与时间，不写简历正文、诊断结论、姓名、fileId。
// contentId 只允许传服务端任务 id（不可反查用户身份的随机串），可不传。
// ============================================================

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
  /** 可选的服务端任务 id，用于事后定位同一份产物；不得传用户身份信息 */
  readonly contentId?: string | null
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
  if (input.contentId) info['ContentId'] = input.contentId
}
