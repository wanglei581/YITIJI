



export type Assert = (label: string, condition: boolean, detail?: string) => void

export const MIN = 60_000

export const OUTPUT_KEYS = ['printed', 'settled', 'successRate', 'unconfirmed']

export const TOTAL_FAULT_KEYS = [
  'offlineCount', 'offlineMinutes', 'printerFaultCount', 'printerFaultMinutes',
  'recoveredCount', 'avgRecoveryMinutes', 'longestMinutes',
]

export const ROW_FAULT_KEYS = [...TOTAL_FAULT_KEYS, 'unrecovered', 'reportedInWindow']

export const TERMINAL_OPS_KEY_PATHS = new Set<string>([
  'period', 'timezone', 'window', 'window.from', 'window.to', 'generatedAt', 'minSample',
  'terminals',
  ...['terminalCode', 'displayName', 'locationLabel', 'online', 'lastHeartbeatAt', 'visitCount', 'serviceCount', 'output', 'faults']
    .map((key) => `terminals[].${key}`),
  ...OUTPUT_KEYS.map((key) => `terminals[].output.${key}`),
  ...ROW_FAULT_KEYS.map((key) => `terminals[].faults.${key}`),
  'totals',
  ...['terminalCount', 'onlineTerminals', 'unrecoveredTerminals', 'silentTerminals', 'visitCount', 'serviceCount', 'output', 'faults']
    .map((key) => `totals.${key}`),
  ...OUTPUT_KEYS.map((key) => `totals.output.${key}`),
  ...TOTAL_FAULT_KEYS.map((key) => `totals.faults.${key}`),
  'visitCount', 'visitCount.available', 'visitCount.recordingStarted',
  'aiAvailability', 'aiAvailability.available', 'aiAvailability.reason',
])


export function carryContext<A extends object, B extends object>(before: A, next: B): A & B {
  return Object.defineProperties({ ...before, ...next }, { ...Object.getOwnPropertyDescriptors(before), ...Object.getOwnPropertyDescriptors(next) })
}
