import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

// ============================================================
// AdminOpsService — 阶段1E:Admin 运营视图(打印任务流水 + 派生告警)
//
// 合规/诚实约束:
//   - 打印任务只回安全元数据:绝不返回 fileUrl / fileMd5 / paramsJson 原文 /
//     errorMessage(可能含内部细节);归属只回 member/anonymous,不回 endUserId。
//   - 无支付域(Order/PaymentAttempt 属 Phase C-5 未建),不编造金额/支付状态。
//   - 告警为**实时派生**(终端离线 / 打印机异常 / 近 24h 打印失败),
//     无独立 Alert 模型 → 不支持确认/处理流转,前端如实说明。
// ============================================================

/** 与 terminals.service 同口径:lastSeen 距今 < 3 分钟 = 在线。 */
const ONLINE_WINDOW_MS = 3 * 60 * 1000
/** 打印失败告警回看窗口。 */
const FAILED_LOOKBACK_MS = 24 * 60 * 60 * 1000

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
  /** 派生告警的合成 id(类型 + 目标),仅用于前端 key。 */
  id: string
  type: 'terminal_offline' | 'printer_issue' | 'print_failed'
  severity: 'error' | 'warning'
  title: string
  detail: string
  terminalCode: string | null
  occurredAt: string
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

const PRINTER_STATUS_LABELS: Record<string, string> = {
  offline: '打印机离线',
  paper_empty: '打印机缺纸',
  error: '打印机故障',
  not_found: '打印机未找到',
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

  async listDerivedAlerts(): Promise<{ data: AdminAlertItem[]; derivedAt: string }> {
    const now = Date.now()
    const alerts: AdminAlertItem[] = []

    // 1) 终端离线 + 打印机异常(取每台终端最近一次心跳)
    const terminals = await this.prisma.terminal.findMany({
      select: {
        id: true,
        terminalCode: true,
        registeredAt: true,
        heartbeats: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true, printerStatus: true },
        },
      },
    })
    for (const t of terminals) {
      const lastHeartbeat = t.heartbeats[0]
      const lastSeen = lastHeartbeat?.createdAt ?? t.registeredAt
      const offlineMs = now - lastSeen.getTime()
      if (offlineMs >= ONLINE_WINDOW_MS) {
        const minutes = Math.floor(offlineMs / 60000)
        alerts.push({
          id: `terminal_offline:${t.id}`,
          type: 'terminal_offline',
          // 离线超 30 分钟视为 error,短时离线 warning
          severity: offlineMs >= 30 * 60 * 1000 ? 'error' : 'warning',
          title: `终端 ${t.terminalCode} 离线`,
          detail: `最近一次心跳在 ${minutes} 分钟前(${lastSeen.toISOString().slice(0, 16).replace('T', ' ')})`,
          terminalCode: t.terminalCode,
          occurredAt: lastSeen.toISOString(),
        })
      } else if (lastHeartbeat?.printerStatus && lastHeartbeat.printerStatus !== 'ok') {
        const label = PRINTER_STATUS_LABELS[lastHeartbeat.printerStatus] ?? `打印机状态异常(${lastHeartbeat.printerStatus})`
        alerts.push({
          id: `printer_issue:${t.id}`,
          type: 'printer_issue',
          severity: lastHeartbeat.printerStatus === 'paper_empty' ? 'warning' : 'error',
          title: `终端 ${t.terminalCode} ${label}`,
          detail: `终端在线,但最近心跳上报打印机状态为 ${lastHeartbeat.printerStatus}`,
          terminalCode: t.terminalCode,
          occurredAt: lastHeartbeat.createdAt.toISOString(),
        })
      }
    }

    // 2) 近 24h 打印失败任务
    const failedTasks = await this.prisma.printTask.findMany({
      where: { status: 'failed', updatedAt: { gte: new Date(now - FAILED_LOOKBACK_MS) } },
      select: {
        id: true,
        errorCode: true,
        updatedAt: true,
        terminal: { select: { terminalCode: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })
    for (const task of failedTasks) {
      alerts.push({
        id: `print_failed:${task.id}`,
        type: 'print_failed',
        severity: 'warning',
        title: `打印任务失败${task.errorCode ? `(${task.errorCode})` : ''}`,
        detail: `任务 ${task.id}${task.terminal?.terminalCode ? ` · 终端 ${task.terminal.terminalCode}` : ''},失败于 ${task.updatedAt.toISOString().slice(0, 16).replace('T', ' ')}`,
        terminalCode: task.terminal?.terminalCode ?? null,
        occurredAt: task.updatedAt.toISOString(),
      })
    }

    alerts.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
    return { data: alerts, derivedAt: new Date(now).toISOString() }
  }
}
