import { Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { ListAlertsQueryDto } from './dto/list-alerts-query.dto'
import type {
  AdminAlertDetail,
  AdminAlertListItem,
  AdminAlertsListResponse,
} from './alerts.types'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 200

interface AlertRow {
  id: string
  alertNo: string
  type: string
  severity: string
  status: string
  title: string
  message: string | null
  terminalId: string | null
  deviceName: string | null
  payloadJson: string | null
  handledBy: string | null
  handledAt: Date | null
  handleNote: string | null
  occurredAt: Date
  createdAt: Date
  updatedAt: Date
}

@Injectable()
export class AlertsService implements OnModuleInit {
  private readonly logger = new Logger(AlertsService.name)

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // ⚠️ 边界说明（务必区分清楚，勿误读为「告警生产逻辑已完成」）：
    //   - 这里只在**非生产环境**种入 6 条 dev/demo 演示告警，目的是让 /admin/alerts 有真实
    //     表数据可展示与联调；**生产环境绝不自动种子**（NODE_ENV==='production' 直接跳过）。
    //   - 本轮（Task 3）完成的是「Alert 数据模型 + Admin 告警运营后台（列表/详情/处理状态）」，
    //     **不是「设备/系统自动产生告警」**。自动告警生产逻辑尚未实现，后续需接入：
    //       终端心跳离线检测 / 打印机缺纸·卡纸·碳粉低 / 数据同步失败 / AI 服务调用失败 / 打印任务异常。
    //   - 管理员的「处理 / 忽略」只是运营状态记录与责任留痕，**不直接远程控制设备**。
    //   - upsert 的 update 为空：已存在则保留（含管理员处理后的状态），重启不覆盖。
    if (process.env['NODE_ENV'] !== 'production') {
      await this.seedDevAlerts()
    }
  }

  /** 告警列表（keyword/severity/status/type/terminalId 筛选 + page/pageSize 分页）。 */
  async list(query: ListAlertsQueryDto): Promise<AdminAlertsListResponse> {
    const page = Math.max(Number(query.page ?? 1), 1)
    const pageSize = Math.min(Math.max(Number(query.pageSize ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE)

    const where: Record<string, unknown> = {}
    if (query.severity) where['severity'] = query.severity
    if (query.status) where['status'] = query.status
    if (query.type) where['type'] = query.type
    if (query.terminalId) where['terminalId'] = query.terminalId
    if (query.keyword && query.keyword.trim()) {
      const kw = query.keyword.trim()
      where['OR'] = [
        { title: { contains: kw } },
        { message: { contains: kw } },
        { alertNo: { contains: kw } },
      ]
    }

    const [rows, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      this.prisma.alert.count({ where }),
    ])

    const handlerNames = await this.lookupHandlerNames(rows as AlertRow[])
    const items = (rows as AlertRow[]).map((r) => this.toListItem(r, handlerNames))
    return { items, total, page, pageSize }
  }

  /** 告警详情。 */
  async getById(id: string): Promise<AdminAlertDetail> {
    const alert = (await this.prisma.alert.findUnique({ where: { id } })) as AlertRow | null
    if (!alert) {
      throw new NotFoundException({ error: { code: 'ALERT_NOT_FOUND', message: `告警 ${id} 不存在` } })
    }
    const handlerNames = await this.lookupHandlerNames([alert])
    return this.toDetail(alert, handlerNames)
  }

  /**
   * 处理告警：status → processing/resolved/ignored，记录处理人/时间/备注。
   * **仅运营状态记录，不远程控制设备。** 返回前一状态供审计。
   */
  async updateStatus(
    id: string,
    status: 'processing' | 'resolved' | 'ignored',
    note: string | undefined,
    actorUserId: string,
  ): Promise<{ previous: { status: string }; detail: AdminAlertDetail }> {
    const alert = (await this.prisma.alert.findUnique({ where: { id } })) as AlertRow | null
    if (!alert) {
      throw new NotFoundException({ error: { code: 'ALERT_NOT_FOUND', message: `告警 ${id} 不存在` } })
    }
    const previous = { status: alert.status }
    await this.prisma.alert.update({
      where: { id },
      data: {
        status,
        handledBy: actorUserId,
        handledAt: new Date(),
        handleNote: note ?? null,
      },
    })
    return { previous, detail: await this.getById(id) }
  }

  // ── 内部 ──────────────────────────────────────────────────────────────────────

  /** 处理人 User.id → name 映射。 */
  private async lookupHandlerNames(rows: AlertRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.handledBy).filter((v): v is string => !!v))]
    const map = new Map<string, string>()
    if (ids.length > 0) {
      const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      for (const u of users) map.set(u.id, u.name)
    }
    return map
  }

  private toListItem(r: AlertRow, handlerNames: Map<string, string>): AdminAlertListItem {
    return {
      id: r.id,
      alertNo: r.alertNo,
      type: r.type,
      severity: r.severity,
      status: r.status,
      title: r.title,
      terminalId: r.terminalId,
      deviceName: r.deviceName,
      handledBy: r.handledBy,
      handlerName: r.handledBy ? handlerNames.get(r.handledBy) ?? null : null,
      handledAt: r.handledAt ? r.handledAt.toISOString() : null,
      occurredAt: r.occurredAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }
  }

  private toDetail(r: AlertRow, handlerNames: Map<string, string>): AdminAlertDetail {
    return {
      ...this.toListItem(r, handlerNames),
      message: r.message,
      payloadJson: r.payloadJson,
      handleNote: r.handleNote,
      createdAt: r.createdAt.toISOString(),
    }
  }

  // ── dev 种子 ────────────────────────────────────────────────────────────────
  private async seedDevAlerts(): Promise<void> {
    const seeds: Array<Omit<AlertRow, 'createdAt' | 'updatedAt'>> = [
      { id: 'alert_seed_1', alertNo: 'ALT-20260609-000001', type: 'printer-fault', severity: 'critical', status: 'new', title: '打印机卡纸故障', message: '卡纸故障，打印任务队列阻塞，需人工处理', terminalId: 'KSK-008', deviceName: 'Pantum-CM2820-008', payloadJson: '{"errorCode":"PAPER_JAM","queueBlocked":true}', handledBy: null, handledAt: null, handleNote: null, occurredAt: new Date('2026-06-09T01:45:00.000Z') },
      { id: 'alert_seed_2', alertNo: 'ALT-20260609-000002', type: 'device-offline', severity: 'critical', status: 'new', title: '终端心跳超时离线', message: '终端心跳超时，已离线超过 2 小时，影响正常服务', terminalId: 'KSK-007', deviceName: 'KSK-007 主机', payloadJson: null, handledBy: null, handledAt: null, handleNote: null, occurredAt: new Date('2026-06-08T23:30:00.000Z') },
      { id: 'alert_seed_3', alertNo: 'ALT-20260609-000003', type: 'toner-low', severity: 'warning', status: 'processing', title: '碳粉余量低', message: '碳粉余量低于 10%（当前 8%），建议尽快更换', terminalId: 'KSK-003', deviceName: 'Pantum-CM2820-003', payloadJson: '{"tonerPercent":8}', handledBy: null, handledAt: null, handleNote: null, occurredAt: new Date('2026-06-09T00:12:00.000Z') },
      { id: 'alert_seed_4', alertNo: 'ALT-20260609-000004', type: 'paper-empty', severity: 'warning', status: 'new', title: '纸盒已空', message: '纸盒已空，无法执行打印任务', terminalId: 'KSK-005', deviceName: 'Pantum-CM2820-005', payloadJson: null, handledBy: null, handledAt: null, handleNote: null, occurredAt: new Date('2026-06-09T00:05:00.000Z') },
      { id: 'alert_seed_5', alertNo: 'ALT-20260608-000031', type: 'sync-fail', severity: 'info', status: 'resolved', title: '岗位数据同步失败', message: '市人才网岗位数据同步失败，接口返回 503，已重试 3 次后成功', terminalId: null, deviceName: '数据同步服务', payloadJson: '{"httpStatus":503,"retries":3}', handledBy: null, handledAt: new Date('2026-06-08T06:10:00.000Z'), handleNote: '系统自动重试后恢复', occurredAt: new Date('2026-06-08T06:00:00.000Z') },
      { id: 'alert_seed_6', alertNo: 'ALT-20260608-000028', type: 'ai-call-fail', severity: 'warning', status: 'ignored', title: 'AI 简历解析超时', message: 'AI 简历解析接口响应超时（>30s），任务已进入重试队列', terminalId: 'KSK-004', deviceName: 'AI服务', payloadJson: null, handledBy: null, handledAt: new Date('2026-06-08T08:05:00.000Z'), handleNote: '偶发超时，已忽略', occurredAt: new Date('2026-06-08T07:58:00.000Z') },
    ]
    let created = 0
    for (const s of seeds) {
      const res = await this.prisma.alert.upsert({ where: { id: s.id }, update: {}, create: s })
      if (res.createdAt.getTime() === res.updatedAt.getTime()) created++
    }
    if (created > 0) this.logger.log(`seedDevAlerts: ensured ${seeds.length} demo alerts (${created} newly created)`)
  }
}
