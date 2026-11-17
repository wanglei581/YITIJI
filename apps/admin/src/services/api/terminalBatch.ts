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

export interface TerminalBatchCreated {
  batchId: string
  count: number
  terminals: Array<{
    terminalId: string
    terminalCode: string
    displayName: string | null
    locationLabel: string | null
    orgId: string | null
    orgName: string | null
  }>
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
    if (!name) {
      errors.push(`第 ${lineNo} 行：终端名称不能为空`)
      return
    }
    let orgId: string | undefined
    if (orgText) {
      const org = organizations.find((item) => item.id === orgText || item.name === orgText)
      if (!org) {
        errors.push(`第 ${lineNo} 行：找不到机构`)
        return
      }
      orgId = org.id
    }
    const usableAsCode = name.length <= 64 && CODE_RE.test(name)
    const terminalCode = usableAsCode ? name : `P${cryptoRandom()}`
    rows.push({
      terminalCode,
      displayName: name.slice(0, 120),
      ...(location ? { locationLabel: location.slice(0, 200) } : {}),
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

export function downloadBindCodeCsv(rows: TerminalBatchIssuedCode[]): void {
  const header = ['终端号', '名称', '点位', '绑定码', '到期时间']
  const lines = [
    header,
    ...rows.map((row) => [row.terminalCode, row.displayName ?? '', row.locationLabel ?? '', row.bindCode, row.expiresAt]),
  ]
  const csv = `\uFEFF${lines.map((columns) => columns.map(escapeCsv).join(',')).join('\r\n')}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = '终端绑定码.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}
