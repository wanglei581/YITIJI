/**
 * 前端生成 CSV 的共用工具（Excel 打开不乱码、单元格不被当成公式）。
 *
 * - 每个单元格都用双引号包起来，内部双引号写成两个；
 * - 以 = + - @ 或制表符、回车开头的文本前面加一个单引号，防止 Excel 把它当公式执行；
 *   纯数字（含负数）原样保留；
 * - 文件开头写 UTF-8 BOM，Excel 才会按 UTF-8 读中文。
 */

const FORMULA_LEAD = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (FORMULA_LEAD.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`
  return `"${text.split('"').join('""')}"`
}

export function buildCsv(rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>): string {
  return `${rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')}\r\n`
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** 文件名里去掉 Windows / macOS 不允许的字符。 */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\r\n\t]+/g, '_').trim() || '导出'
}
