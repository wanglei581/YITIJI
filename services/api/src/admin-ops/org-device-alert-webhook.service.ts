/**
 * 机构设备告警通知地址的读取、保存和测试。
 * 明文只在校验、加密和发送时出现，不进审计、不进接口响应。
 */

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { resolveClientIp } from '../common/client-ip'
import { decryptSecret, encryptSecret } from '../common/crypto/secret-cipher'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { PrismaService } from '../prisma/prisma.service'
import {
  assertDeviceAlertWebhookUrl,
  DeviceAlertWebhookError,
  maskWebhookUrl,
  postGroupRobot,
} from './device-alert-webhook'
import { DEVICE_ALERT_TEST_MESSAGE } from './org-device-alert-push'

export interface DeviceAlertNotifyView {
  configured: boolean
  maskedUrl: string | null
}

interface RequestMeta {
  headers?: Record<string, string | string[] | undefined>
  ip?: string
  requestId?: string
}

@Injectable()
export class OrgDeviceAlertWebhookService {
  private fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 用例替换发送函数，避免打到真实群。 */
  useFetchForTest(fetchImpl: typeof fetch): void {
    this.fetchImpl = fetchImpl
  }

  async viewForPartner(user: AuthedUser): Promise<DeviceAlertNotifyView> {
    return this.present(this.orgIdOf(user))
  }

  async saveForPartner(user: AuthedUser, rawUrl: string, req: RequestMeta): Promise<DeviceAlertNotifyView> {
    return this.save(user, this.orgIdOf(user), rawUrl, req)
  }

  async testForPartner(user: AuthedUser, req: RequestMeta): Promise<{ sent: true }> {
    return this.test(user, this.orgIdOf(user), req)
  }

  viewForAdmin(orgId: string): Promise<DeviceAlertNotifyView> {
    return this.present(orgId)
  }

  saveForAdmin(user: AuthedUser, orgId: string, rawUrl: string, req: RequestMeta): Promise<DeviceAlertNotifyView> {
    return this.save(user, orgId, rawUrl, req)
  }

  testForAdmin(user: AuthedUser, orgId: string, req: RequestMeta): Promise<{ sent: true }> {
    return this.test(user, orgId, req)
  }

  private orgIdOf(user: AuthedUser): string {
    if (!user.orgId) {
      throw new ForbiddenException({ error: { code: 'PARTNER_ORG_REQUIRED', message: '当前账号未绑定机构' } })
    }
    return user.orgId
  }

  private async present(orgId: string): Promise<DeviceAlertNotifyView> {
    const org = await this.requireOrg(orgId)
    if (!org.deviceAlertWebhookEnc) return { configured: false, maskedUrl: null }
    try {
      return { configured: true, maskedUrl: maskWebhookUrl(decryptSecret(org.deviceAlertWebhookEnc)) }
    } catch {
      return { configured: true, maskedUrl: null }
    }
  }

  private async save(user: AuthedUser, orgId: string, rawUrl: string, req: RequestMeta): Promise<DeviceAlertNotifyView> {
    await this.requireOrg(orgId)
    const trimmed = rawUrl.trim()
    if (!trimmed) {
      await this.prisma.organization.update({ where: { id: orgId }, data: { deviceAlertWebhookEnc: null } })
      await this.writeAudit(user, orgId, { configured: false, host: null }, req)
      return { configured: false, maskedUrl: null }
    }
    let url: string
    try {
      url = assertDeviceAlertWebhookUrl(trimmed)
    } catch (error) {
      throw new BadRequestException({
        error: {
          code: 'DEVICE_ALERT_WEBHOOK_INVALID',
          message: error instanceof DeviceAlertWebhookError ? error.message : '通知地址只接受企业微信、钉钉或飞书的群机器人',
        },
      })
    }
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { deviceAlertWebhookEnc: encryptSecret(url) },
    })
    await this.writeAudit(user, orgId, { configured: true, host: new URL(url).hostname }, req)
    return { configured: true, maskedUrl: maskWebhookUrl(url) }
  }

  private async test(user: AuthedUser, orgId: string, req: RequestMeta): Promise<{ sent: true }> {
    const org = await this.requireOrg(orgId)
    if (!org.deviceAlertWebhookEnc) {
      throw new BadRequestException({
        error: { code: 'DEVICE_ALERT_WEBHOOK_UNSET', message: '请先保存通知地址，再发送测试消息' },
      })
    }
    let url: string
    try {
      url = assertDeviceAlertWebhookUrl(decryptSecret(org.deviceAlertWebhookEnc))
    } catch {
      throw new BadRequestException({
        error: { code: 'DEVICE_ALERT_WEBHOOK_DELIVERY_FAILED', message: '测试消息没有发出去，请核对地址后重试' },
      })
    }
    try {
      await postGroupRobot(url, DEVICE_ALERT_TEST_MESSAGE, this.fetchImpl)
    } catch {
      throw new BadRequestException({
        error: { code: 'DEVICE_ALERT_WEBHOOK_DELIVERY_FAILED', message: '测试消息没有发出去，请核对地址后重试' },
      })
    }
    await this.writeAudit(user, orgId, { event: 'test', host: new URL(url).hostname }, req)
    return { sent: true }
  }

  private async requireOrg(orgId: string): Promise<{ id: string; deviceAlertWebhookEnc: string | null }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, deviceAlertWebhookEnc: true },
    })
    if (!org) throw new NotFoundException({ error: { code: 'ORG_NOT_FOUND', message: '机构不存在' } })
    return org
  }

  private writeAudit(user: AuthedUser, orgId: string, payload: Record<string, unknown>, req: RequestMeta): Promise<string | null> {
    const userAgent = req.headers?.['user-agent']
    return this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'organization.device_alert_webhook',
      targetType: 'organization',
      targetId: orgId,
      payload,
      ipAddress: resolveClientIp(req),
      userAgent: typeof userAgent === 'string' ? userAgent : null,
      requestId: typeof req.requestId === 'string' ? req.requestId : null,
    })
  }
}
