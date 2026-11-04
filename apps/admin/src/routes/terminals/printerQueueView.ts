/** 把心跳里的打印队列原值译成后台能看的句子。纯函数，不读时钟、不发请求。 */

export interface PrinterQueueReport {
  printerQueueName: string | null
  printerQueuePortKind: string | null
  printerQueuePortName: string | null
  printerQueueRawStatus: string | null
  printerQueueSpooler: string | null
}

export interface PrinterQueuePresentation {
  current: boolean
  statusLabel: string | null
  historyLabel: string | null
  missing: string | null
  queueName: string | null
  portText: string | null
  spoolerLabel: string | null
  spoolerBadge: 'success' | 'warning' | 'error' | 'default' | null
  spoolerDetail: string | null
  rawText: string | null
  rawTitle: string | null
}

const PRINTER_STATUS: Record<number, string> = {
  1: '其他', 2: '未知', 3: '空闲', 4: '打印中', 5: '预热', 6: '停止打印', 7: '脱机',
}

const DETECTED_ERROR: Record<number, string> = {
  0: '驱动没给', 1: '其他', 2: '无错误', 3: '纸少', 4: '缺纸', 5: '粉少', 6: '缺粉',
  7: '开盖', 8: '卡纸', 9: '脱机', 10: '需维修', 11: '出纸盒满',
}

const EXTENDED_STATUS: Record<number, string> = {
  1: '其他', 2: '未知', 3: '空闲', 4: '打印中', 5: '预热', 6: '停止打印', 7: '脱机',
  8: '暂停', 9: '错误', 10: '忙', 11: '不可用', 12: '等待', 13: '处理中', 14: '初始化',
  15: '省电', 16: '正在删除', 17: '输入输出中', 18: '手动进纸',
}

const STATE_BITS: Array<[number, string]> = [
  [0x1, '暂停'],
  [0x2, '错误'],
  [0x8, '卡纸'],
  [0x10, '缺纸'],
  [0x40, '纸张问题'],
  [0x80, '脱机'],
  [0x20000, '粉少'],
  [0x40000, '缺粉'],
  [0x100000, '需人工处理'],
  [0x400000, '开盖'],
]

const BLANK: PrinterQueuePresentation = {
  current: false,
  statusLabel: null,
  historyLabel: null,
  missing: null,
  queueName: null,
  portText: null,
  spoolerLabel: null,
  spoolerBadge: null,
  spoolerDetail: null,
  rawText: null,
  rawTitle: null,
}

function namedNumber(label: string, raw: string, table: Record<number, string>): string {
  if (raw === '') return `${label} 空`
  if (!/^\d+$/.test(raw)) return `${label} ${raw}`
  const meaning = table[Number(raw)]
  return meaning === undefined ? `${label} ${raw}` : `${label} ${raw}（${meaning}）`
}

function hasBit(value: number, bit: number): boolean {
  return Math.floor(value / bit) % 2 === 1
}

function printerStateText(raw: string): string {
  if (raw === '') return '队列状态 空'
  if (!/^\d+$/.test(raw)) return `队列状态 ${raw}`
  const value = Number(raw)
  if (value === 0) return '队列状态 0'
  let rest = value
  const names: string[] = []
  for (const [bit, name] of STATE_BITS) {
    if (!hasBit(rest, bit)) continue
    names.push(name)
    rest -= bit
  }
  if (rest !== 0 || names.length === 0) return `队列状态 ${raw}`
  return `队列状态 ${raw}（${names.join('、')}）`
}

function offlineText(raw: string): string {
  if (raw === '') return '脱机 空'
  if (raw === 'True') return '脱机 是'
  if (raw === 'False') return '脱机 否'
  return `脱机 ${raw}`
}

function rawView(raw: string | null): { text: string; title: string } {
  if (raw === null || raw === '') return { text: '空', title: '' }
  if (raw === 'not_found') {
    return { text: 'Windows 里找不到这个打印队列（队列名可能被改过，或驱动没装好）', title: raw }
  }
  if (raw === 'query_failed') {
    return { text: '查询打印机失败（Windows 打印服务可能没在运行）', title: raw }
  }
  const parts = raw.split(',')
  if (parts.length !== 5) return { text: raw, title: raw }
  const [status, error, offline, state, extended] = parts as [string, string, string, string, string]
  return {
    text: [
      namedNumber('打印机状态', status, PRINTER_STATUS),
      namedNumber('检测到的错误', error, DETECTED_ERROR),
      offlineText(offline),
      printerStateText(state),
      namedNumber('扩展状态', extended, EXTENDED_STATUS),
    ].join(' · '),
    title: `PrinterStatus=${status}, DetectedErrorState=${error}, WorkOffline=${offline}, PrinterState=${state}, ExtendedPrinterStatus=${extended}`,
  }
}

function portText(kind: string | null, name: string | null): string {
  if (kind === 'usb') return name ? `${name}（USB 直连）` : 'USB 直连'
  if (kind === 'network') return '网络端口（不显示地址）'
  if (kind === 'wsd') return '网络自动发现端口（WSD）'
  if (kind === 'other') return '其他端口'
  if (kind === 'unknown') return '读不到'
  return '未上报'
}

function spoolerView(value: string | null): { label: string; badge: 'success' | 'warning' | 'error' | 'default'; detail: string | null } {
  if (value === 'running') return { label: '正在运行', badge: 'success', detail: null }
  if (value === 'stopped') {
    return {
      label: '已停止',
      badge: 'error',
      detail: '打印会全部卡住。后台不能远程启动，要到现场重启主机或启动打印服务。',
    }
  }
  if (value === 'other') return { label: '正在启动或停止', badge: 'warning', detail: null }
  if (value === 'unknown') return { label: '读不到', badge: 'default', detail: null }
  if (value === null || value === '') return { label: '未上报', badge: 'default', detail: null }
  return { label: value, badge: 'default', detail: null }
}

function historyOf(queue: PrinterQueueReport | null): string | null {
  if (!queue) return null
  if (queue.printerQueueSpooler === 'running' || queue.printerQueueSpooler === 'stopped' || queue.printerQueueSpooler === 'other' || queue.printerQueueSpooler === 'unknown') {
    return spoolerView(queue.printerQueueSpooler).label
  }
  return queue.printerQueueName || null
}

export function describePrinterQueue(online: boolean, queue: PrinterQueueReport | null): PrinterQueuePresentation {
  if (!online) {
    return { ...BLANK, current: false, statusLabel: '终端离线', historyLabel: historyOf(queue) }
  }
  if (!queue) {
    return { ...BLANK, current: true, missing: '未上报（终端程序升级到新版本后才上报）' }
  }
  const spooler = spoolerView(queue.printerQueueSpooler)
  const raw = rawView(queue.printerQueueRawStatus)
  return {
    current: true,
    statusLabel: null,
    historyLabel: null,
    missing: null,
    queueName: queue.printerQueueName ? queue.printerQueueName : '未上报',
    portText: portText(queue.printerQueuePortKind, queue.printerQueuePortName),
    spoolerLabel: spooler.label,
    spoolerBadge: spooler.badge,
    spoolerDetail: spooler.detail,
    rawText: raw.text,
    rawTitle: raw.title,
  }
}
