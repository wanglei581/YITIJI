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
//   - GET 只读：告警列表端点不写数据库。恢复与否只能正向查证，
//     不能用「本次查询没看见」推断（见 listDerivedAlerts 注释）。
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
  /** 当前仍在发生的告警总数(精确计数,不受列表上限影响)。 */
  firingCount: number
  /** 本次实际派生出的条数;小于 firingCount 即说明被截断。 */
  listedCount: number
  /**
   * 截断说明。非 null 时界面必须如实提示「列表不是全部」,
   * 并且必须说明下面三个处理态计数只覆盖已列出的部分(CLAUDE.md §9)。
   */
  truncation: { type: 'print_failed'; omitted: number; cap: number } | null
  /** 以下计数只统计本次已列出的告警。 */
  openCount: number
  acknowledgedCount: number
  suppressedCount: number
}

/** SQLite 的绑定变量上限保守取值;subjectKey in (...) 按此分批,避免长列表炸参数。 */
const DISPOSITION_LOOKUP_CHUNK = 300

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

  /**
   * 派生告警列表。这是 GET 端点,只读——不写 AlertDisposition。
   *
   * 为什么删掉原来的「不在本次派生结果里就写 recoveredAt」:
   *   缺席不是恢复的证据。一条告警没出现在本次结果里,可能是真恢复,也可能是被
   *   列表上限截断,还可能是这一跳查询本身没覆盖到。用缺席反推恢复,会把仍在
   *   firing 的告警标成已恢复,并且在它重新进入列表时把操作员的确认 / 关闭
   *   无声撤销(resolveHandlingState 看到 recoveredAt != null 就回 open)。
   *
   *   删掉之后「恢复后再发作」仍然是对的:那由 episodeToken 负责——离线用 lastSeen、
   *   打印机异常用 printerStatus+lastHealthyAt、打印失败用 PrintTask.id,
   *   任何一次真实恢复都会让下一轮故障拿到新 token,旧处置自然失效。
   *   也就是说恢复判定是从正面数据算出来的,不是从「没看见」推断出来的。
   */
  async listDerivedAlerts(view: AlertListView = 'open'): Promise<AdminAlertsResult> {
    const now = new Date()
    const collected = await collectDerivedAlerts(this.prisma, now)
    const derived = collected.alerts

    // 只按本次确实派生出来的 subjectKey 取处置行,读取范围随列表有界。
    const rows = await this.findDispositions(derived.map((alert) => alert.subjectKey))
    const byKey = new Map(rows.map((row) => [row.subjectKey, row]))
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
      // 精确总数,不是「本次列出了几条」。截断时二者不等,由 truncation 如实说明。
      firingCount: collected.firingTotal,
      listedCount: items.length,
      truncation: collected.omitted > 0
        ? { type: 'print_failed' as const, omitted: collected.omitted, cap: collected.cap }
        : null,
      openCount,
      acknowledgedCount,
      suppressedCount,
    }
  }

  /** 分批按 subjectKey 取处置行,避免超长 in (...) 触碰 SQLite 绑定变量上限。 */
  private async findDispositions(subjectKeys: string[]) {
    const out: Array<{
      subjectKey: string
      action: string
      episodeToken: string
      recoveredAt: Date | null
      silencedUntil: Date | null
      note: string | null
      updatedAt: Date
    }> = []
    for (let i = 0; i < subjectKeys.length; i += DISPOSITION_LOOKUP_CHUNK) {
      const chunk = subjectKeys.slice(i, i + DISPOSITION_LOOKUP_CHUNK)
      const rows = await this.prisma.alertDisposition.findMany({
        where: { subjectKey: { in: chunk } },
        select: {
          subjectKey: true,
          action: true,
          episodeToken: true,
          recoveredAt: true,
          silencedUntil: true,
          note: true,
          updatedAt: true,
        },
      })
      out.push(...rows)
    }
    return out
  }
}
