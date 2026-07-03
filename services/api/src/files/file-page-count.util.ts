// 文件页数识别纯函数（从 materials.service 抽取，供 materials + print-jobs 复用）。
// 行为与原 materials 私有实现逐字一致；无副作用、无新依赖。

/**
 * PDF 轻量页数识别：统计 `/Type /Page`（叶子页；`\b` 排除页树根 `/Type /Pages`）。
 * 识别不到返回 null（由调用方决定 fail-closed）。
 */
export function countPdfPages(buffer: Buffer): number | null {
  const text = buffer.toString('latin1')
  const matches = text.match(/\/Type\s*\/Page\b/g)
  if (!matches?.length) return null
  return matches.length
}

/** 单页图片 MIME 白名单（png/jpeg/webp）；用于"图片按 1 页"计。 */
export function isSinglePageImage(mimeType: string): boolean {
  return mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp'
}
