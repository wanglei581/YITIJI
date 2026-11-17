export interface TerminalBatchRowInput {
  terminalCode: string
  displayName?: string
  locationLabel?: string
  orgId?: string
}

export interface CreateTerminalBatchInput {
  range?: {
    prefix: string
    start: number
    end: number
    locationLabel?: string
    orgId?: string
  }
  rows?: TerminalBatchRowInput[]
}

export interface TerminalBatchCreatedRow {
  terminalId: string
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  orgId: string | null
  orgName: string | null
}

export interface TerminalBatchCreated {
  batchId: string
  count: number
  terminals: TerminalBatchCreatedRow[]
}

export interface TerminalBatchSelectionInput {
  terminalIds?: string[]
  batchId?: string
  ttlMinutes?: number
}

export interface TerminalBatchIssuedCode {
  terminalId: string
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  bindCode: string
  expiresAt: string
}

export interface TerminalBatchSkipped {
  terminalId: string | null
  terminalCode: string
  reason: string
}

export interface TerminalBatchBindCodeResult {
  issued: TerminalBatchIssuedCode[]
  skipped: TerminalBatchSkipped[]
}

export interface TerminalBatchRevokeResult {
  revokedCount: number
  terminalCount: number
}

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const NAME_LIMIT = 120
const LOCATION_LIMIT = 200

export function parseTerminalBatchPaste(
  text: string,
  organizations: Array<{ id: string; name: string }>,
): { rows: TerminalBatchRowInput[]; errors: string[] } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)
  const rows: TerminalBatchRowInput[] = []
  const errors: string[] = []
  lines.forEach((line, index) => {
    const lineNo = index + 1
    const columns = line.split(/[,，\t]/).map((column) => column.trim())
    const name = columns[0] ?? ''
    const location = columns[1] ?? ''
    const orgText = columns[2] ?? ''
    const lineErrors: string[] = []
    if (!name) lineErrors.push(`第 ${lineNo} 行：终端名称不能为空`)
    else if (name.length > NAME_LIMIT) lineErrors.push(`第 ${lineNo} 行：名称超过上限 ${NAME_LIMIT} 个字`)
    if (location.length > LOCATION_LIMIT) lineErrors.push(`第 ${lineNo} 行：点位超过上限 ${LOCATION_LIMIT} 个字`)
    let orgId: string | undefined
    if (orgText) {
      const org = organizations.find((item) => item.id === orgText || item.name === orgText)
      if (!org) lineErrors.push(`第 ${lineNo} 行：找不到机构`)
      else orgId = org.id
    }
    if (lineErrors.length > 0) {
      errors.push(...lineErrors)
      return
    }
    const usableAsCode = name.length <= 64 && CODE_RE.test(name)
    const terminalCode = usableAsCode ? name : `P${cryptoRandom()}`
    rows.push({
      terminalCode,
      displayName: name,
      ...(location ? { locationLabel: location } : {}),
      ...(orgId ? { orgId } : {}),
    })
  })
  return { rows, errors }
}

function cryptoRandom(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function formatBindCodeCsv(rows: TerminalBatchIssuedCode[]): string {
  const header = ['终端号', '名称', '点位', '绑定码', '到期时间']
  const lines = [
    header,
    ...rows.map((row) => [row.terminalCode, row.displayName ?? '', row.locationLabel ?? '', row.bindCode, row.expiresAt]),
  ]
  return `\uFEFF${lines.map((columns) => columns.map(escapeCsv).join(',')).join('\r\n')}`
}

export function downloadBindCodeCsv(rows: TerminalBatchIssuedCode[]): void {
  const csv = formatBindCodeCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = '终端绑定码.csv'
  link.click()
  URL.revokeObjectURL(url)
}

/** 表格软件会把 = + - @ 以及制表符、回车开头的单元格当成公式。先加单引号，再按 CSV 规则转义。 */
function neutralizeSpreadsheetFormula(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`
  return value
}

function escapeCsv(value: string): string {
  const safe = neutralizeSpreadsheetFormula(value)
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`
  return safe
}
