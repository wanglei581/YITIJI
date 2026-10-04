// 打印失败错误码 → 后台给运营看的中文原因。
// 口径与服务端告警标题同一份（services/api/src/admin-ops/derived-alerts.ts 的 PRINT_FAILED_ALERT_REASONS），
// 门禁 verify-console-plain-copy 会逐个核对：服务端登记过的码这里必须都有。
// 不引用一体机的 errorCodeToMessage：那是给现场用户看的句子，而且会把一体机打印页的模块拖进后台。
const PRINT_ERROR_REASONS: Record<string, string> = {
  DOWNLOAD_HASH_MISMATCH: '文件校验未通过',
  PRINTER_NOT_FOUND: '找不到打印机',
  PRINTER_OFFLINE: '打印机离线',
  PAPER_EMPTY: '缺纸',
  PRINTER_ERROR: '打印机故障或卡纸',
  PRINT_JOB_UNCONFIRMED: '出纸未确认',
  PARTIAL_OUTPUT: '只打出了一部分',
  PRINT_TIMEOUT: '打印超时',
  PRINT_COMMAND_FAILED: '打印命令执行失败',
  UNSUPPORTED_FILE_TYPE: '文件格式不支持',
  FILE_NOT_FOUND: '打印文件已失效',
  printer_jam: '打印机卡纸',
}

export function printErrorText(code: string | null | undefined, orderType?: string): string {
  if (!code) return '—'
  return Object.prototype.hasOwnProperty.call(PRINT_ERROR_REASONS, code)
    ? PRINT_ERROR_REASONS[code]
    : orderType === 'scan' ? '扫描失败（未归类）' : '打印失败（未归类）'
}
