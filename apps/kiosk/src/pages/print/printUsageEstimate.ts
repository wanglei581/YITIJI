/**
 * 打印用量预估（纯函数，供预览页「用量预估」卡片使用）。
 *
 * 唯一硬规则：**页数未识别时不估**。
 *
 * 2026-08-17 真实文件走查发现：预览页对 `file.pages` 用 `?? 1` 兜底，于是一份 30 页
 * 但页数没识别出来的 PDF，在同一张卡片上「文件页数」诚实写着「待识别，以实际打印为准」，
 * 紧接着两行却写「总打印面 1 面 / 预计用纸 1 张」——自相矛盾，且是编出来的数字，
 * 违反 CLAUDE.md §9「没有真实结果不得展示结论」。
 *
 * 注：本函数只算**用纸量**，不算钱。应付金额一律由服务端在确认页按识别页数计算
 * （见 PrintPreviewPage「费用说明」与 PrintPageCountService）。
 */
export interface PrintUsageEstimate {
  /** 总打印面；页数未识别时为 null。 */
  totalFaces: number | null
  /** 预计用纸张数；页数未识别时为 null。 */
  sheetsUsed: number | null
  /** 相对单面节省的张数；无法估算时为 0。 */
  paperSaved: number
}

export interface PrintUsageEstimateInput {
  /** 已识别的文档页数；null 表示尚未识别出来。 */
  pages: number | null
  copies: number
  pagesPerSheet: number
  /** 'simplex' 单面；其余取值均视为双面。 */
  duplex: string
}

export function computePrintUsageEstimate({
  pages,
  copies,
  pagesPerSheet,
  duplex,
}: PrintUsageEstimateInput): PrintUsageEstimate {
  const unknown: PrintUsageEstimate = { totalFaces: null, sheetsUsed: null, paperSaved: 0 }
  if (pages === null || !Number.isFinite(pages) || pages <= 0) return unknown
  if (!Number.isFinite(copies) || copies <= 0) return unknown
  if (!Number.isFinite(pagesPerSheet) || pagesPerSheet <= 0) return unknown

  const facesPerCopy = Math.ceil(pages / pagesPerSheet)
  const totalFaces = facesPerCopy * copies
  const sheetsUsed = duplex === 'simplex' ? totalFaces : Math.ceil(totalFaces / 2)
  return { totalFaces, sheetsUsed, paperSaved: totalFaces - sheetsUsed }
}
