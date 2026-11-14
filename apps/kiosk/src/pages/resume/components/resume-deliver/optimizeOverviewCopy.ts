/** 只能手改的那一行：摘录去掉末尾句号后再补回一个，避免连着两个句号。 */
export function optimizeManualOriginalLine(before: string, factNote = ''): string {
  const snippet = before.replace(/\s+/g, ' ').trim().replace(/。+$/u, '')
  return `${snippet ? `原文：${snippet}。` : '原文：这一条没有留下原句。'}这一条只能在编辑区里改。${factNote}`
}
