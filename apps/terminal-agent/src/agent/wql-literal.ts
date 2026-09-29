/**
 * Win32_Printer 的 WQL 过滤串。
 *
 * 名字从 stdin 进 PowerShell，在 PowerShell 里用 Escape-WqlLiteral 组装过滤串，
 * 不在 Node 里把名字拼进脚本。转义顺序固定：先把 `\` 换成 `\\`，再把 `'` 换成 `\'`。
 * 反着来会把刚加上的反斜杠再转一次，过滤串对不上。
 * 查到之后仍用 Name -eq 对原名再核对一次，过滤串命中多行时不会拿错打印机。
 */

/** 与 Escape-WqlLiteral 同一套规则，给门禁用，用来核对过滤串。 */
export function escapeWqlLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export function win32PrinterNameFilter(printerName: string): string {
  return `Name='${escapeWqlLiteral(printerName)}'`
}

/** wmi.ts 与 print-queue-hold.ts 嵌进脚本的是这一份，不各写一遍。 */
export const ESCAPE_WQL_LITERAL_FUNCTION = `
function Escape-WqlLiteral([string]$value) {
  if ($null -eq $value) { return '' }
  $escaped = $value.Replace('\\', '\\\\')
  return $escaped.Replace("'", "\\'")
}
`.trim()
