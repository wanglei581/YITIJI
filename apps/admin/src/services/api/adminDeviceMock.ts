import { ApiHttpError } from './client'
import { adminMockAdapter } from './adminMockAdapter'
import type { AdminTerminalRecord, AdminTerminalsResponse } from './types'
import type {
  CreateTerminalBatchInput,
  TerminalBatchBindCodeResult,
  TerminalBatchCreated,
  TerminalBatchCreatedRow,
  TerminalBatchIssuedCode,
  TerminalBatchRevokeResult,
  TerminalBatchRowInput,
  TerminalBatchSelectionInput,
  TerminalBatchSkipped,
} from './terminalBatch'

interface HeldTerminal {
  id: string
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  orgId: string | null
  orgName: string | null
  provisionBatchId: string
  enabled: boolean
  lifecycleStatus: 'planned'
  codeState: 'none' | 'unused' | 'revoked'
}

const held: HeldTerminal[] = []

function codeLabel(state: HeldTerminal['codeState']): { status: AdminTerminalRecord['activationStatus']; label: string } {
  if (state === 'unused') return { status: 'code_unused', label: '码未用' }
  return { status: 'no_code', label: '未生成码' }
}

function toRecord(terminal: HeldTerminal): AdminTerminalRecord {
  const activation = codeLabel(terminal.codeState)
  return {
    id: terminal.id,
    terminalCode: terminal.terminalCode,
    displayName: terminal.displayName,
    macAddress: null,
    locationLabel: terminal.locationLabel,
    enabled: terminal.enabled,
    lifecycleStatus: terminal.lifecycleStatus,
    lifecycleVersion: 0,
    credentialGeneration: 0,
    hasActiveCredential: false,
    orgId: terminal.orgId,
    orgName: terminal.orgName,
    registeredAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    online: false,
    lastHeartbeatAt: null,
    agentStatus: null,
    localTaskDatabaseAvailable: null,
    printerStatus: null,
    wiredNetworkStatus: null,
    printerNetworkStatus: null,
    agentVersion: null,
    ipAddress: null,
    diskFreeGb: null,
    releaseObservation: null,
    provisionBatchId: terminal.provisionBatchId,
    activationStatus: activation.status,
    activationStatusLabel: activation.label,
    firstActivatedAt: null,
  }
}

function decorate(response: AdminTerminalsResponse): AdminTerminalsResponse {
  const base = response.terminals.map((terminal) => ({
    ...terminal,
    provisionBatchId: terminal.provisionBatchId ?? null,
    activationStatus: terminal.activationStatus ?? (terminal.lifecycleStatus === 'planned' ? 'no_code' as const : 'activated' as const),
    activationStatusLabel: terminal.activationStatusLabel ?? (terminal.lifecycleStatus === 'planned' ? '未生成码' : '已激活'),
    firstActivatedAt: terminal.firstActivatedAt ?? null,
  }))
  return { terminals: [...held.map(toRecord), ...base] }
}

function expand(input: CreateTerminalBatchInput): TerminalBatchRowInput[] {
  if (input.range && input.rows && input.rows.length > 0) {
    throw new ApiHttpError('TERMINAL_BATCH_INPUT_CONFLICT', '一次只能用一种填法', 400)
  }
  if (input.range) {
    const { prefix, start, end, locationLabel, orgId } = input.range
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
      throw new ApiHttpError('TERMINAL_BATCH_ROW_INVALID', '第 1 行：起止编号不正确', 400)
    }
    const width = String(end).length
    const rows: TerminalBatchRowInput[] = []
    for (let number = start; number <= end; number += 1) {
      const terminalCode = `${prefix}${String(number).padStart(width, '0')}`
      rows.push({
        terminalCode,
        displayName: terminalCode,
        ...(locationLabel ? { locationLabel } : {}),
        ...(orgId ? { orgId } : {}),
      })
    }
    return rows
  }
  return input.rows ?? []
}

function knownCodes(): Set<string> {
  return new Set(held.map((terminal) => terminal.terminalCode))
}

export const adminDeviceMock = {
  ...adminMockAdapter,
  async getTerminals(): Promise<AdminTerminalsResponse> {
    return decorate(await adminMockAdapter.getTerminals())
  },
  async createTerminalBatch(input: CreateTerminalBatchInput): Promise<TerminalBatchCreated> {
    const rows = expand(input)
    if (rows.length > 200) throw new ApiHttpError('TERMINAL_BATCH_TOO_LARGE', '一次最多预建 200 台', 400)
    if (rows.length === 0) throw new ApiHttpError('TERMINAL_BATCH_EMPTY', '没有要预建的终端', 400)
    const taken = knownCodes()
    const errors: string[] = []
    rows.forEach((row, index) => {
      if (taken.has(row.terminalCode)) errors.push(`第 ${index + 1} 行：终端编号已存在`)
      taken.add(row.terminalCode)
    })
    if (errors.length > 0) throw new ApiHttpError('TERMINAL_BATCH_ROW_INVALID', errors.join('；'), 400)
    const batchId = `b_${cryptoRandom()}`
    const created = rows.map((row) => {
      const terminal: HeldTerminal = {
        id: `t_${cryptoRandom()}`,
        terminalCode: row.terminalCode,
        displayName: row.displayName ?? row.terminalCode,
        locationLabel: row.locationLabel ?? null,
        orgId: row.orgId ?? null,
        orgName: null,
        provisionBatchId: batchId,
        enabled: true,
        lifecycleStatus: 'planned',
        codeState: 'none',
      }
      held.unshift(terminal)
      return mockTerminalBatchCreatedRow(terminal)
    })
    return mockTerminalBatchCreated(batchId, created)
  },
  async issueTerminalBatchBindCodes(input: TerminalBatchSelectionInput): Promise<TerminalBatchBindCodeResult> {
    return issueHeld(input, false)
  },
  async revokeTerminalBatchBindCodes(input: TerminalBatchSelectionInput): Promise<TerminalBatchRevokeResult> {
    const targets = selectHeld(input)
    let revokedCount = 0
    for (const target of targets) {
      if (target && target.codeState === 'unused') {
        target.codeState = 'revoked'
        revokedCount += 1
      }
    }
    return mockTerminalBatchRevokeResult(revokedCount, targets.filter((target) => target !== null).length)
  },
  async reissueTerminalBatchBindCodes(input: TerminalBatchSelectionInput): Promise<TerminalBatchBindCodeResult> {
    const targets = selectHeld(input)
    for (const target of targets) {
      if (target?.codeState === 'unused') target.codeState = 'revoked'
    }
    return issueHeld(input, true)
  },
}

function selectHeld(input: TerminalBatchSelectionInput): Array<HeldTerminal | null> {
  const ids = uniqueInOrder(input.terminalIds?.map((id) => id.trim()).filter((id) => id.length > 0) ?? [])
  if (ids.length > 200) throw new ApiHttpError('TERMINAL_BATCH_TOO_LARGE', '一次最多处理 200 台', 400)
  if (ids.length > 0) return ids.map((id) => held.find((terminal) => terminal.id === id) ?? null)
  const batchId = input.batchId?.trim()
  if (!batchId) throw new ApiHttpError('TERMINAL_BATCH_SELECTION_EMPTY', '先选择终端，或指定批次号', 400)
  return held.filter((terminal) => terminal.provisionBatchId === batchId)
}

function issueHeld(input: TerminalBatchSelectionInput, alreadyRevoked: boolean): TerminalBatchBindCodeResult {
  const targets = selectHeld(input)
  const issued: TerminalBatchIssuedCode[] = []
  const skipped: TerminalBatchBindCodeResult['skipped'] = []
  for (const target of targets) {
    if (!target) {
      skipped.push(mockTerminalBatchSkipped(null, '', '终端不存在'))
      continue
    }
    if (!target.enabled) {
      skipped.push(mockTerminalBatchSkipped(target.id, target.terminalCode, '已停用'))
      continue
    }
    if (target.lifecycleStatus !== 'planned') {
      skipped.push(mockTerminalBatchSkipped(target.id, target.terminalCode, '已激活'))
      continue
    }
    if (!alreadyRevoked && target.codeState === 'unused') target.codeState = 'revoked'
    target.codeState = 'unused'
    issued.push(mockTerminalBatchIssuedCode(target, mockCode(), new Date(Date.now() + 10 * 60_000).toISOString()))
  }
  return mockTerminalBatchBindCodeResult(issued, skipped)
}

function mockTerminalBatchCreatedRow(terminal: HeldTerminal): TerminalBatchCreatedRow {
  return {
    terminalId: terminal.id,
    terminalCode: terminal.terminalCode,
    displayName: terminal.displayName,
    locationLabel: terminal.locationLabel,
    orgId: terminal.orgId,
    orgName: terminal.orgName,
  }
}

function mockTerminalBatchCreated(batchId: string, rows: TerminalBatchCreatedRow[]): TerminalBatchCreated {
  return { batchId, count: rows.length, terminals: rows }
}

function mockTerminalBatchIssuedCode(terminal: HeldTerminal, bindCode: string, expiresAt: string): TerminalBatchIssuedCode {
  return {
    terminalId: terminal.id,
    terminalCode: terminal.terminalCode,
    displayName: terminal.displayName,
    locationLabel: terminal.locationLabel,
    bindCode,
    expiresAt,
  }
}

function mockTerminalBatchSkipped(terminalId: string | null, terminalCode: string, reason: string): TerminalBatchSkipped {
  return { terminalId, terminalCode, reason }
}

function mockTerminalBatchBindCodeResult(
  issued: TerminalBatchIssuedCode[],
  skipped: TerminalBatchSkipped[],
): TerminalBatchBindCodeResult {
  return { issued, skipped }
}

function mockTerminalBatchRevokeResult(revokedCount: number, terminalCount: number): TerminalBatchRevokeResult {
  return { revokedCount, terminalCount }
}

function uniqueInOrder(ids: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }
  return unique
}

function mockCode(): string {
  const pool = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  let out = ''
  for (let index = 0; index < 20; index += 1) out += pool.charAt(Math.floor(Math.random() * pool.length))
  return out
}

function cryptoRandom(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
