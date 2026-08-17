/**
 * verify 脚本共用的**真实可解析** PDF 夹具构造器。
 *
 * 为什么需要它（2026-08-17，批次 REAL-FILE-PRINT）：
 * 多个 verify 脚本此前用 `%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF` 这类裸片段
 * 当 PDF 夹具 —— 没有 catalog、没有页树、没有 xref，任何 PDF 阅读器都打不开。它们能跑通，
 * 只是因为页数识别当时是「按字节数 `/Type /Page` 出现次数」。
 *
 * 页数识别改成 pdf.js 解析页树为准之后（见 src/files/file-page-count.util.ts —— Word /
 * Chrome / LaTeX 产出的压缩对象流 PDF 字节扫描一个都看不见，必须真解析），这类假夹具会
 * 正确地被判为「无法识别」。断言意图没变，变的是夹具必须是真 PDF。
 *
 * 本构造器产出的 PDF：pdfjs 报告的 numPages 等于入参 pageCount（不是声明值，是真实解析
 * 结果）—— /Pages 的 /Kids 重复引用同一个真实 Page 对象 pageCount 次，且 /Count 与
 * Kids.length 一致（若两者不一致，pdfjs 的 checkLastPage 会把 numPages 纠正回实际遍历数）。
 */

/** 构造一份 pdfjs 会诚实报告 numPages=pageCount 的最小真实 PDF。 */
export function buildRealPdf(pageCount: number): Buffer {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error(`buildRealPdf: pageCount must be a positive integer, got ${pageCount}`)
  }
  const header = '%PDF-1.4\n'
  const kidsRefs = Array.from({ length: pageCount }, () => '3 0 R').join(' ')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kidsRefs}] /Count ${pageCount} >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ]
  let body = header
  const offsets: number[] = []
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(body, 'utf8'))
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefStart = Buffer.byteLength(body, 'utf8')
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return Buffer.from(body + xref + trailer, 'utf8')
}
