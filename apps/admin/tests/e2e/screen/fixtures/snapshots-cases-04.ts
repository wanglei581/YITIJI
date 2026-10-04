import type { ScreenSnapshotLimits, ScreenSnapshotWindow, ScreenUsageRange } from '@ai-job-print/shared'



export const PRINTED_PAGES_SOURCE =
  'PrintTask(completed|printOutcome=printed) × copies; OrderItem/Order.billablePages'

export const PRINTED_PAGES_TREND_SOURCE =
  'PrintTask.completedAt(completed|printOutcome=printed) × copies; OrderItem/Order.billablePages'

export const WINDOW: ScreenSnapshotWindow = {
  timezone: 'Asia/Shanghai',
  onlineWindowSeconds: 180,
  realtimeTtlSeconds: 15,
  countsTtlSeconds: 60,
  cumulativeTtlSeconds: 300,
}

export const LIMITS: ScreenSnapshotLimits = {
  minAggregateSample: 5,
  displayToken: 'not_issued',
  displayTokenReason: 'display_token_not_issued',
  access: 'authenticated_console',
  recruitmentHosting: 'enabled',
}

export const DISTRICT_PLAN: ReadonlyArray<[string, string, string[]]> = [
  ['海珠区', 'HZ', ['off:离线 34 分钟:7', 'pr', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']],
  ['天河区', 'TH', ['off:离线 12 分钟:2', 'pr:5', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']],
  ['白云区', 'BY', ['wa:打印机缺纸:11', 'pr', 'ok', 'ok', 'ok', 'ok']],
  ['越秀区', 'YX', ['wa:打印机故障:4', 'pr', 'ok', 'ok', 'ok', 'ok', 'ok']],
  ['荔湾区', 'LW', ['off:离线 2 小时', 'ok', 'ok', 'ok']],
  ['番禺区', 'PY', ['wa:打印机卡纸', 'un', 'ok', 'ok', 'ok']],
  ['黄埔区', 'HP', ['wa:打印机墨粉不足', 'un', 'ok']],
]

export const DISTRICTS: ReadonlyArray<{ area: string; count: number }> = DISTRICT_PLAN.map(([area, , list]) => ({ area, count: list.length }))

export const TASK_FLOW = {
  printByStatus: { completed: 418, printing: 4, pending: 2, cancelled: 11, failed: 3 },
  scanByStatus: { completed: 92, failed: 1 },
}

export const SAFE_RANGES: readonly ScreenUsageRange[] = ['today', '7d', '30d']

export const SERVICE_LABELS = ['岗位信息', '招聘会', '政策服务', '企业展示', 'AI 简历', 'AI 顾问', '模拟面试', '职业规划', '岗位 AI', '打印', '扫描']

export const SERVICE_LABELS_HOSTING_OFF = ['政策服务', 'AI 简历', 'AI 顾问', '模拟面试', '职业规划', '简历对照', '打印', '扫描']
