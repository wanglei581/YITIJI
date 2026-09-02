import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  matchesView,
  resolveHandlingState,
  type AlertHandlingState,
  type AlertListView,
} from './derived-alert-identity'
import { collectDerivedAlerts } from './derived-alerts'

// ============================================================
// AdminOpsService — 阶段1E:Admin 运营视图(打印任务流水 + 派生告警)
//
// 合规/诚实约束:
//   - 打印任务只回安全元数据:绝不返回 fileUrl / fileMd5 / paramsJson 原文 /
//     errorMessage(可能含内部细节);归属只回 member/anonymous,不回 endUserId。
//   - 告警仍是实时派生(终端离线 / 打印机异常 / 近 24h 打印失败)。
//     处理态落 AlertDisposition，确认不等于故障消失。
// ============================================================

export interface AdminPrintTaskItem {
  id: string
  status: string
  terminalCode: string | null
  ownerType: 'member' | 'anonymous'
  fileName: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  paperSize: string | null
  errorCode: string | null
  createdAt: string
  claimedAt: string | null
  completedAt: string | null
}

export interface AdminAlertItem {
  /** 稳定身份 = `${type}:${subjectId}`，也是确认挂载点。 */
  id: string
  subjectKey: string
  episodeToken: string
  type: 'terminal_offline' | 'printer_issue' | 'print_failed'
  severity: 'error' | 'warning'
  title: string
  detail: string
  terminalCode: string | null
  occurredAt: string
  /** 列表只含当前仍在发生的告警；已恢复的不会出现。 */
  conditionState: 'firing'
  handlingState: AlertHandlingState
  acknowledgedAt: string | null
  silencedUntil: string | null
  note: string | null
}

export interface AdminAlertsResult {
  data: AdminAlertItem[]
  derivedAt: string
  firingCount: number
  openCount: number
  acknowledgedCount: number
  suppressedCount: number
}

type ParsedParams = {
  fileName: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  paperSize: string | null
}

/** 与 member-print-orders 同口径的安全白名单提取(读时按不可信处理)。 */
function parseSafeParams(paramsJson: string): ParsedParams {
  const empty: ParsedParams = { fileName: null, copies: null, colorMode: null, paperSize: null }
  let raw: unknown
  try {
    raw = JSON.parse(paramsJson)
  } catch {
    return empty
  }
  if (typeof raw !== 'object' || raw === null) return empty
  const p = raw as Record<string, unknown>
  return {
    fileName: typeof p['fileName'] === 'string' && p['fileName'].length > 0 ? p['fileName'] : null,
    copies:
      typeof p['copies'] === 'number' && Number.isInteger(p['copies']) && p['copies'] >= 1 && p['copies'] <= 99
        ? p['copies']
        : null,
    colorMode: p['colorMode'] === 'black_white' || p['colorMode'] === 'color' ? p['colorMode'] : null,
    paperSize: typeof p['paperSize'] === 'string' && p['paperSize'].length > 0 ? p['paperSize'] : null,
  }
}

@Injectable()
export class AdminOpsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── 打印任务流水(订单管理页数据源)──────────────────────────────────────

  async listPrintTasks(params: {
    status?: string
    page: number
    pageSize: number
  }): Promise<{ data: AdminPrintTaskItem[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const where = params.status ? { status: params.status } : {}
    const [rows, total] = await Promise.all([
      // select 显式收口:fileUrl / fileMd5 / errorMessage / endUser 关系不读出
      this.prisma.printTask.findMany({
        where,
        select: {
          id: true,
          status: true,
          paramsJson: true,
          endUserId: true,
          errorCode: true,
          createdAt: true,
          claimedAt: true,
          completedAt: true,
          terminal: { select: { terminalCode: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.printTask.count({ where }),
    ])
    return {
      data: rows.map((r) => {
        const safe = parseSafeParams(r.paramsJson)
        return {
          id: r.id,
          status: r.status,
          terminalCode: r.terminal?.terminalCode ?? null,
          // 只回归属类别,不回 endUserId(防后台越权关联个人)
          ownerType: r.endUserId ? ('member' as const) : ('anonymous' as const),
          fileName: safe.fileName,
          copies: safe.copies,
          colorMode: safe.colorMode,
          paperSize: safe.paperSize,
          errorCode: r.errorCode,
          createdAt: r.createdAt.toISOString(),
          claimedAt: r.claimedAt ? r.claimedAt.toISOString() : null,
          completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        }
      }),
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
      },
    }
  }

  // ── 派生告警(告警中心页数据源)───────────────────────────────────────────

  async listDerivedAlerts(view: AlertListView = 'open'): Promise<AdminAlertsResult> {
    const now = new Date()
    const derived = await collectDerivedAlerts(this.prisma, now)
    const firingKeys = new Set(derived.map((alert) => alert.subjectKey))

    const openRows = await this.prisma.alertDisposition.findMany({
      where: { recoveredAt: null },
    })
    const staleIds = openRows.filter((row) => !firingKeys.has(row.subjectKey)).map((row) => row.id)
    if (staleIds.length > 0) {
      await this.prisma.alertDisposition.updateMany({
        where: { id: { in: staleIds }, recoveredAt: null },
        data: { recoveredAt: now },
      })
    }

    const byKey = new Map(openRows.filter((row) => firingKeys.has(row.subjectKey)).map((row) => [row.subjectKey, row]))
    const items: AdminAlertItem[] = derived.map((alert) => {
      const row = byKey.get(alert.subjectKey) ?? null
      const handlingState = resolveHandlingState(row, alert.episodeToken, now)
      const activeRow = handlingState === 'open' ? null : row
      return {
        id: alert.id,
        subjectKey: alert.subjectKey,
        episodeToken: alert.episodeToken,
        type: alert.type,
        severity: alert.severity,
        title: alert.title,
        detail: alert.detail,
        terminalCode: alert.terminalCode,
        occurredAt: alert.occurredAt,
        conditionState: 'firing',
        handlingState,
        acknowledgedAt: activeRow && handlingState !== 'open' ? activeRow.updatedAt.toISOString() : null,
        silencedUntil: handlingState === 'silenced' && activeRow?.silencedUntil
          ? activeRow.silencedUntil.toISOString()
          : null,
        note: activeRow?.note ?? null,
      }
    })

    let openCount = 0
    let acknowledgedCount = 0
    let suppressedCount = 0
    for (const item of items) {
      if (item.handlingState === 'open') openCount += 1
      else if (item.handlingState === 'acknowledged') acknowledgedCount += 1
      else suppressedCount += 1
    }

    return {
      data: items.filter((item) => matchesView(item.handlingState, view)),
      derivedAt: now.toISOString(),
      firingCount: items.length,
      openCount,
      acknowledgedCount,
      suppressedCount,
    }
  }
}
