/**
 * 把本机构终端的设备告警发到该机构自己的群。
 * 平台总地址仍走 deliverOpsAlert，这里不改那条正文。
 * 去重键带上密文摘要：换地址后，同一场故障会再通知一次。
 */

import { createHash } from 'crypto'
import { Logger } from '@nestjs/common'
import { formatBeijingMinute } from '../common/beijing-display-time'
import { decryptSecret } from '../common/crypto/secret-cipher'
import type { PrismaService } from '../prisma/prisma.service'
import type { DerivedAlert } from './derived-alerts'
import { SCAN_DEVICE_ISSUE } from './derived-scan-device-alerts'
import { assertDeviceAlertWebhookUrl, postGroupRobot } from './device-alert-webhook'

const DEVICE_ALERT_TYPES = new Set(['terminal_offline', 'printer_issue', SCAN_DEVICE_ISSUE])

const ADVICE = [
  '建议：',
  '补纸：请打开纸盒，放入 A4 纸。',
  '清卡纸：请打开打印机盖板，取出卡住的纸张后关好。',
  '检查电源和网络：请确认电源已插好，网线或网络已经连通。',
].join('\n')

export const DEVICE_ALERT_TEST_MESSAGE = '【设备告警】这是一条测试消息。以后这台机构名下的设备出问题或恢复时，会发到这个群。消息里只有终端名称、位置和设备问题，不含使用者个人信息。'

type NotifyAlert = Pick<DerivedAlert, 'subjectKey' | 'episodeToken' | 'type' | 'title' | 'terminalCode'> & {
  occurredAt?: string
}

type TerminalNotifyRow = {
  id: string
  orgId: string | null
  displayName: string | null
  locationLabel: string | null
  terminalCode: string
  org: { deviceAlertWebhookEnc: string | null } | null
}

type NotifyDb = {
  organization?: {
    count?: (args: { where: { deviceAlertWebhookEnc: { not: null } } }) => Promise<number>
  }
  terminal?: {
    findMany?: (args: unknown) => Promise<TerminalNotifyRow[]>
  }
}

type RedisLike = {
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>
  del(key: string): Promise<number>
}

export function deviceAlertProblem(title: string, terminalCode: string | null): string {
  const prefix = terminalCode ? `终端 ${terminalCode} ` : ''
  if (prefix && title.startsWith(prefix)) return title.slice(prefix.length)
  return title
}

export function composeOrgDeviceAlertMessage(input: {
  displayName: string | null
  locationLabel: string | null
  terminalCode: string
  problem: string
  occurredAt: string | null
  state: 'firing' | 'recovered'
}): string {
  const name = input.displayName?.trim() || input.terminalCode
  const place = input.locationLabel?.trim() || '位置未填写'
  let started = '时间未记录'
  if (input.occurredAt) {
    const date = new Date(input.occurredAt)
    if (!Number.isNaN(date.getTime())) started = formatBeijingMinute(date)
  }
  const lines = [
    `【设备告警】${name}（${place}）`,
    `问题：${input.problem}`,
    `开始：${started}`,
  ]
  lines.push(input.state === 'recovered' ? '已恢复' : ADVICE)
  return lines.join('\n')
}

function subjectIdOf(alert: { type: string; subjectKey: string }): string {
  const prefix = `${alert.type}:`
  return alert.subjectKey.startsWith(prefix) ? alert.subjectKey.slice(prefix.length) : ''
}

function cipherHash(enc: string): string {
  return createHash('sha256').update(enc).digest('hex').slice(0, 12)
}

function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/https?:\/\/\S+/gi, '[url]').slice(0, 180)
}

export async function anyOrgDeviceAlertWebhook(prisma: PrismaService | null): Promise<boolean> {
  const count = (prisma as unknown as NotifyDb | null)?.organization?.count
  if (typeof count !== 'function') return false
  try {
    const n = await count({ where: { deviceAlertWebhookEnc: { not: null } } })
    return n > 0
  } catch {
    return false
  }
}

async function loadTerminals(prisma: PrismaService | null, ids: string[]): Promise<Map<string, TerminalNotifyRow>> {
  const findMany = (prisma as unknown as NotifyDb | null)?.terminal?.findMany
  if (typeof findMany !== 'function' || ids.length === 0) return new Map()
  const rows = await findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      orgId: true,
      displayName: true,
      locationLabel: true,
      terminalCode: true,
      org: { select: { deviceAlertWebhookEnc: true } },
    },
  })
  return new Map(rows.map((row) => [row.id, row]))
}

export async function pushOrgDeviceAlerts(input: {
  prisma: PrismaService | null
  redis: RedisLike
  fetchImpl: typeof fetch
  current: DerivedAlert[]
  previous: NotifyAlert[]
  inScope: Set<string> | null
  logger: Pick<Logger, 'warn'>
  dedupeTtlSeconds: number
}): Promise<void> {
  try {
    await deliver(input)
  } catch (error) {
    input.logger.warn(`ORG_ALERT_PUSH_FAILED phase=fanout error=${safeError(error)}`)
  }
}

async function deliver(input: {
  prisma: PrismaService | null
  redis: RedisLike
  fetchImpl: typeof fetch
  current: DerivedAlert[]
  previous: NotifyAlert[]
  inScope: Set<string> | null
  logger: Pick<Logger, 'warn'>
  dedupeTtlSeconds: number
}): Promise<void> {
  const currentByKey = new Set(input.current.map((alert) => alert.subjectKey))
  const jobs: Array<{ alert: NotifyAlert; state: 'firing' | 'recovered' }> = []
  const clearIds: NotifyAlert[] = []
  for (const alert of input.current) {
    if (DEVICE_ALERT_TYPES.has(alert.type)) jobs.push({ alert, state: 'firing' })
  }
  for (const alert of input.previous) {
    if (!DEVICE_ALERT_TYPES.has(alert.type) || currentByKey.has(alert.subjectKey)) continue
    const outOfScope = input.inScope ? !input.inScope.has(alert.subjectKey) : alert.type === SCAN_DEVICE_ISSUE
    if (outOfScope) {
      if (alert.type === SCAN_DEVICE_ISSUE) clearIds.push(alert)
      continue
    }
    jobs.push({ alert, state: 'recovered' })
  }
  if (jobs.length === 0 && clearIds.length === 0) return
  const ids = [...new Set([
    ...jobs.map((job) => subjectIdOf(job.alert)),
    ...clearIds.map((alert) => subjectIdOf(alert)),
  ].filter(Boolean))]
  let terminals: Map<string, TerminalNotifyRow>
  try {
    terminals = await loadTerminals(input.prisma, ids)
  } catch (error) {
    input.logger.warn(`ORG_ALERT_PUSH_FAILED phase=lookup error=${safeError(error)}`)
    return
  }
  for (const alert of clearIds) {
    const row = terminals.get(subjectIdOf(alert))
    const enc = row?.org?.deviceAlertWebhookEnc
    if (!row?.orgId || !enc) continue
    await input.redis.del(dedupeKey(row.orgId, enc, alert, 'firing')).catch(() => undefined)
  }
  const urls = new Map<string, string | null>()
  for (const job of jobs) {
    const row = terminals.get(subjectIdOf(job.alert))
    const enc = row?.org?.deviceAlertWebhookEnc
    if (!row?.orgId || !enc) continue
    let url = urls.get(row.orgId)
    if (url === undefined) {
      try {
        url = decryptSecret(enc)
      } catch {
        url = null
        input.logger.warn('ORG_ALERT_PUSH_FAILED phase=decrypt error=CIPHER_FAILED')
      }
      urls.set(row.orgId, url)
    }
    if (!url) continue
    const key = dedupeKey(row.orgId, enc, job.alert, job.state)
    if (!(await input.redis.setIfAbsent(key, '1', input.dedupeTtlSeconds))) continue
    const text = composeOrgDeviceAlertMessage({
      displayName: row.displayName,
      locationLabel: row.locationLabel,
      terminalCode: row.terminalCode || job.alert.terminalCode || row.id,
      problem: deviceAlertProblem(job.alert.title, job.alert.terminalCode),
      occurredAt: job.alert.occurredAt ?? null,
      state: job.state,
    })
    try {
      assertDeviceAlertWebhookUrl(url)
      await postGroupRobot(url, text, input.fetchImpl)
    } catch (error) {
      await input.redis.del(key).catch(() => undefined)
      input.logger.warn(`ORG_ALERT_PUSH_FAILED phase=send type=${job.alert.type} state=${job.state} error=${safeError(error)}`)
    }
  }
}

function dedupeKey(orgId: string, enc: string, alert: NotifyAlert, state: 'firing' | 'recovered'): string {
  return `admin-alert-push:org:${orgId}:${cipherHash(enc)}:${alert.subjectKey}:${alert.episodeToken}:${state}`
}
