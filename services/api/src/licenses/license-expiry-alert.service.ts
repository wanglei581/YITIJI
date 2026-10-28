import { Injectable, Logger, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { deliverOpsAlert, type OpsAlertPayload } from '../admin-ops/admin-alert-push.service'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { licenseNow } from './license-clock'
import { toLicenseWindow } from './license-gate'
import { beijingDateOf, inclusiveDayText, lastDayOf } from './license-time'
import { DAY_MS, graceEndsAt, resolveOrgLicense, type LicenseWindow } from './license-state'
import { LICENSE_WARN_DAYS } from './license.types'

/** 结束宽限后的「已停用」通知，只在刚结束的 30 天内发（免得久远的历史数据在换库、清缓存后被重复翻出来）。 */
const EXPIRED_NOTICE_WINDOW_MS = 30 * DAY_MS

export interface AlertOrgInput {
  id: string
  name: string
  licenses: LicenseWindow[]
}

/**
 * 计划要推的授权告警（纯函数，只看机构、授权与时钟）。只管 licenseMode = required 的机构：
 *   到期前 30 / 7 / 1 天各推一次（按「连续覆盖到哪一刻」算——已经录了首尾相接的续期就不推）；
 *   宽限期内每天推一次；结束宽限的那一刻起推一次「已停用」。
 * 暂停 / 没有授权是管理员明确的动作或状态，不在这里重复推。
 * 告警正文只写机构名与日期，不含合同编号、信用代码；日期一律写成「2027-10-31（北京时间，含当天）」，
 * 与后台期限显示（periodText）同一口径：到期日那一整天都还在期内。
 */
export function planLicenseAlerts(orgs: AlertOrgInput[], now: Date): OpsAlertPayload[] {
  const alerts: OpsAlertPayload[] = []
  const stages = [...LICENSE_WARN_DAYS].sort((a, b) => a - b)
  for (const org of orgs) {
    const resolution = resolveOrgLicense({ mode: 'required', licenses: org.licenses, now })
    const subjectKey = `license_expiry:${org.id}`
    if (resolution.state === 'ok' && resolution.coveredUntil) {
      const msLeft = resolution.coveredUntil.getTime() - now.getTime()
      const stage = stages.find((days) => msLeft <= days * DAY_MS)
      if (stage === undefined) continue
      const daysLeft = Math.max(1, Math.ceil(msLeft / DAY_MS))
      alerts.push({
        subjectKey,
        episodeToken: `${resolution.coveredUntil.toISOString()}:t${stage}`,
        type: 'license_expiry',
        severity: stage === 1 ? 'error' : 'warning',
        title: `机构「${org.name}」的软件使用授权还有 ${daysLeft} 天到期（有效期至 ${inclusiveDayText(lastDayOf(resolution.coveredUntil))}），请尽快续期`,
        terminalCode: null,
      })
    } else if (resolution.state === 'grace' && resolution.current) {
      const graceEnd = graceEndsAt(resolution.current)
      alerts.push({
        subjectKey,
        episodeToken: `${resolution.current.endsAt.toISOString()}:grace:${beijingDateOf(now)}`,
        type: 'license_expiry',
        severity: 'error',
        title: `机构「${org.name}」的软件使用授权已过到期日，宽限期到 ${inclusiveDayText(lastDayOf(graceEnd))}，之后其终端将不能开始新会话`,
        terminalCode: null,
      })
    } else if (resolution.state === 'expired' && resolution.current) {
      const graceEnd = graceEndsAt(resolution.current)
      if (now.getTime() - graceEnd.getTime() > EXPIRED_NOTICE_WINDOW_MS) continue
      alerts.push({
        subjectKey,
        episodeToken: `${resolution.current.endsAt.toISOString()}:expired`,
        type: 'license_expiry',
        severity: 'error',
        title: `机构「${org.name}」的软件使用授权已过期且宽限已结束，其终端已不能开始新会话`,
        terminalCode: null,
      })
    }
  }
  return alerts
}

/**
 * 授权到期告警推送，复用管理员告警通道（企业微信群机器人，见 admin-alert-push.service.ts 的 deliverOpsAlert）：
 * 同一主题、同一回合并同一状态只推一次，没配 ALERT_WEBHOOK_URL 时直接不推。
 * 每天北京时间 9 点跑一次；多实例同时跑也不会重复推（去重在 Redis）。checkNow 可直接调用，便于门禁注入时钟验证。
 */
@Injectable()
export class LicenseExpiryAlertService {
  private readonly logger = new Logger(LicenseExpiryAlertService.name)
  private readonly webhook = process.env['ALERT_WEBHOOK_URL']?.trim() || null
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Optional() fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  @Cron('0 9 * * *', { name: 'license-expiry-alert', timeZone: 'Asia/Shanghai' })
  async runDaily(): Promise<void> {
    if (!this.webhook) return
    try {
      await this.checkNow(licenseNow())
    } catch (error) {
      this.logger.warn(`LICENSE_ALERT_FAILED error=${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 查一遍并推送；返回本次计划推送的告警（含已去重而没真正发出的）。 */
  async checkNow(now: Date): Promise<OpsAlertPayload[]> {
    const orgs = await this.prisma.organization.findMany({
      where: { licenseMode: 'required' },
      select: { id: true, name: true, licenses: { select: { id: true, status: true, startsAt: true, endsAt: true, graceDays: true, terminalQuota: true, createdAt: true } } },
    })
    const planned = planLicenseAlerts(
      orgs.map((org) => ({ id: org.id, name: org.name, licenses: org.licenses.map(toLicenseWindow) })),
      now,
    )
    for (const alert of planned) {
      await deliverOpsAlert({
        redis: this.redis,
        webhook: this.webhook,
        fetchImpl: this.fetchImpl,
        alert,
        state: 'firing',
        logger: this.logger,
      })
    }
    return planned
  }
}
