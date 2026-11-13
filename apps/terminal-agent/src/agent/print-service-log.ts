/**
 * 打印完成判据：Windows 事件日志 Microsoft-Windows-PrintService/Operational。
 * 这个日志默认是关的。关着的时候，打成功也等不到 307 事件，会被记成结果未确认。
 */
import { spawnSync } from 'node:child_process'
import { err as logError, log } from '../logger'

export const PRINT_SERVICE_OPERATIONAL_LOG = 'Microsoft-Windows-PrintService/Operational'
export type PrintCompletionEvidence = 'available' | 'unavailable'

const ENABLED_LINE = /^\s*enabled:\s*(true|false)\s*$/im

let current: PrintCompletionEvidence | null = null

export function parsePrintServiceLogEnabled(output: string): boolean | null {
  const match = output.match(ENABLED_LINE)
  if (!match?.[1]) return null
  return match[1].toLowerCase() === 'true'
}

/** 自检前不带这个字段。自检后只报 available 或 unavailable。 */
export function printCompletionHeartbeatField(): { printCompletionEvidence?: PrintCompletionEvidence } {
  if (current == null) return {}
  return { printCompletionEvidence: current }
}

export function resetPrintCompletionEvidenceForTests(): void {
  current = null
}

export interface PrintServiceLogCommandResult {
  ok: boolean
  output: string
  error?: string
}

export interface PrintCompletionProbe {
  platform: NodeJS.Platform
  query: () => PrintServiceLogCommandResult
  enable: () => PrintServiceLogCommandResult
  log: (message: string) => void
  err: (message: string) => void
}

function commandFailure(result: PrintServiceLogCommandResult, label: string): string {
  const detail = (result.error ?? result.output).trim()
  return detail ? `${label}：${detail}` : label
}

/**
 * 先看日志开了没有。没开就试着开。仍不行就记明原因，心跳报不可用。
 * 非 Windows 不抛错，直接报不可用。
 */
export function resolvePrintCompletionEvidence(probe: PrintCompletionProbe): PrintCompletionEvidence {
  if (probe.platform !== 'win32') {
    current = 'unavailable'
    probe.log('打印完成判据不可用：本机不是 Windows，读不到打印完成事件日志。')
    return current
  }

  const queried = probe.query()
  if (queried.ok && parsePrintServiceLogEnabled(queried.output) === true) {
    current = 'available'
    probe.log('打印完成判据可用：Microsoft-Windows-PrintService/Operational 已启用。')
    return current
  }

  const enabled = probe.enable()
  const after = probe.query()
  if (enabled.ok && after.ok && parsePrintServiceLogEnabled(after.output) === true) {
    current = 'available'
    probe.log('打印完成判据可用：已启用 Microsoft-Windows-PrintService/Operational。')
    return current
  }

  current = 'unavailable'
  const reason = [
    queried.ok
      ? `查询结果未显示已启用：${queried.output.trim() || '空输出'}`
      : commandFailure(queried, '查询失败'),
    enabled.ok ? '启用命令已执行，但复查仍未启用' : commandFailure(enabled, '启用失败'),
    after.ok
      ? `复查结果：${after.output.trim() || '空输出'}`
      : commandFailure(after, '复查失败'),
  ].join('；')
  probe.err(`打印完成判据不可用。${reason}`)
  return current
}

function runWevtutil(args: string[]): PrintServiceLogCommandResult {
  const result = spawnSync('wevtutil', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (result.error) return { ok: false, output, error: result.error.message }
  if (result.status !== 0) return { ok: false, output, error: `wevtutil exit ${result.status ?? 'null'}` }
  return { ok: true, output }
}

/** 启动时调用。服务以系统身份运行时，启用日志不需要再提权。失败不抛错。 */
export function checkPrintCompletionEvidenceAtStartup(): PrintCompletionEvidence {
  return resolvePrintCompletionEvidence({
    platform: process.platform,
    query: () => runWevtutil(['gl', PRINT_SERVICE_OPERATIONAL_LOG]),
    enable: () => runWevtutil(['sl', PRINT_SERVICE_OPERATIONAL_LOG, '/e:true']),
    log,
    err: logError,
  })
}
