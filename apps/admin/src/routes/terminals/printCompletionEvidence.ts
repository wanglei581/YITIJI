/** 终端详情里的一行。没上报不能说成可用。 */
export function printCompletionEvidenceLabel(value: string | null | undefined): string {
  if (value === 'available') return '打印完成判据可用'
  if (value === 'unavailable') return '打印完成判据不可用'
  return '打印完成判据未上报'
}
