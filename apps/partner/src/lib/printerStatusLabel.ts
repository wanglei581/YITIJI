/**
 * 终端程序上报的打印机状态 → 页面上的说法。
 * 和机构项目详情里原来的表对齐，并补上程序实际会报的「纸张或墨粉不足」「缺纸」等值。
 */

const LABELS: Record<string, string> = {
  ready: '就绪',
  ok: '就绪',
  idle: '空闲',
  online: '已连接',
  printing: '打印中',
  busy: '忙碌',
  offline: '离线',
  paper_out: '缺纸',
  paper_empty: '缺纸',
  paper_jam: '卡纸',
  low_paper: '纸张或墨粉不足',
  error: '故障',
  not_found: '未检测到打印机',
  unknown: '暂不能确认',
  queue_cleanup_failed: '开机清理失败，已暂停接单',
  queue_pause_failed: '暂停队列失败，已暂停接单',
}

export function printerStatusLabel(status: string | null | undefined): string {
  if (!status) return '尚未上报'
  return LABELS[status] ?? '暂不能识别，请现场核对'
}

export function printerStatusSummary(status: string | null | undefined, openAlertCount: number): string {
  const count = Number.isFinite(openAlertCount) ? openAlertCount : 0
  return `${printerStatusLabel(status)}，未恢复 ${count} 条`
}
