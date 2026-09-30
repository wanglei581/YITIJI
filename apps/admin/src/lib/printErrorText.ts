// 复用一体机已有纯展示 helper，不修改打印状态和接口；仅补齐它尚未登记的两个码。
import { errorCodeToMessage } from '../../../kiosk/src/pages/print/printProgressModel'

export function printErrorText(code: string | null | undefined): string {
  if (!code) return '—'
  if (code === 'printer_jam') return '打印机卡纸，请联系工作人员处理'
  if (code === 'PARTIAL_OUTPUT') return '打印输出不完整，请核查现场出纸情况'
  return errorCodeToMessage(code) ?? '打印失败（未归类）'
}
