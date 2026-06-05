import { useCallback, useEffect, useState, type ElementType } from 'react'
import { Card, ErrorState, LoadingState } from '@ai-job-print/ui'
import { Page } from '../Page'
import {
  ArrowRightIcon,
  BotIcon,
  BriefcaseIcon,
  FolderIcon,
  MonitorIcon,
} from 'lucide-react'
import {
  getAiUsage,
  getFairSources,
  getJobSources,
  listFiles,
  type AdminAiUsage,
  type AdminFairSourceRecord,
  type AdminFileRecord,
  type AdminJobSourceRecord,
} from '../../services/api'
import {
  getAuditLogs,
  type AuditLogRecord,
} from '../../services/api/audit'
import {
  getTerminals,
  type AdminTerminalRecord,
} from '../../services/api/devices'

// ─── Types ────────────────────────────────────────────────────────────────────

interface KpiCard {
  label: string
  value: string
  sub: string
  icon: ElementType
  /** Show a 2px left accent when value is in alert state. */
  alert?: boolean
}

interface ActionItem {
  label: string
  count: number
  hint: string
}

interface ActionPanel {
  title: string
  icon: ElementType
  items: ActionItem[]
  href: string
}

interface DashboardData {
  terminals: AdminTerminalRecord[]
  jobSources: AdminJobSourceRecord[]
  fairSources: AdminFairSourceRecord[]
  files: AdminFileRecord[]
  aiUsage: AdminAiUsage
  auditLogs: AuditLogRecord[]
}

interface FileStats {
  expired: number
  sensitive: number
}

const PENDING_STATUSES = new Set(['pending', 'reviewing'])

const ACTION_LABELS: Record<string, string> = {
  'ai_resume_result.cleanup_expired': '清理过期 AI 简历结果',
  'data_source.create': '创建数据源',
  'data_source.toggle': '启停数据源',
  'fair.import': '招聘会导入',
  'fair.publish': '招聘会发布',
  'fair.review': '招聘会审核',
  'file.cleanup_expired': '清理过期文件',
  'file.force_delete': '文件删除',
  'file.get_signed_url': '访问文件',
  'file.upload': '文件上传',
  'job.import': '岗位导入',
  'job.publish': '岗位发布',
  'job.review': '岗位审核',
  'job_source.create': '创建岗位源',
  'system.config_change': '配置变更',
  'system.login': '登录',
}

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  kiosk: '一体机',
  partner: '合作机构',
  system: '系统',
}

function relTime(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return iso

  const diff = Date.now() - time
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

function isPending(reviewStatus: string): boolean {
  return PENDING_STATUSES.has(reviewStatus)
}

function getFileStats(files: AdminFileRecord[]): FileStats {
  const now = Date.now()
  const activeFiles = files.filter((file) => file.deletedAt === null)
  return {
    expired: activeFiles.filter((file) => Date.parse(file.expiresAt) <= now).length,
    sensitive: activeFiles.filter((file) => file.sensitiveLevel === 'highly_sensitive').length,
  }
}

function getAuditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

function getActorLabel(log: AuditLogRecord): string {
  const role = ROLE_LABELS[log.actorRole] ?? log.actorRole
  return log.actorId ? `${role} · ${log.actorId}` : role
}

function getTargetLabel(log: AuditLogRecord): string {
  if (!log.targetType) return ''
  return log.targetId ? `${log.targetType}/${log.targetId}` : log.targetType
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiSection({ cards }: { cards: KpiCard[] }) {
  return (
    <section aria-label="核心指标">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
        核心指标
      </h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <div
              key={card.label}
              className="relative overflow-hidden rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
            >
              {card.alert && (
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[2px] bg-red-500" />
              )}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-500">{card.label}</p>
                  <p className="mt-1.5 text-2xl font-bold tabular-nums text-gray-900">
                    {card.value}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">{card.sub}</p>
                </div>
                <div className="shrink-0 rounded-lg bg-gray-50 p-2.5">
                  <Icon className="h-5 w-5 text-gray-500" aria-hidden="true" />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ActionPanelsSection({ panels }: { panels: ActionPanel[] }) {
  return (
    <section aria-label="待办事项">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
        待办事项
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {panels.map((panel) => {
          const Icon = panel.icon
          const total = panel.items.reduce((sum, it) => sum + it.count, 0)
          return (
            <Card key={panel.title} className="flex flex-col p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-50">
                    <Icon className="h-5 w-5 text-gray-500" aria-hidden="true" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-800">{panel.title}</h3>
                </div>
                <span className="text-xl font-bold tabular-nums text-gray-900">{total}</span>
              </div>
              <ul className="mt-4 space-y-2">
                {panel.items.map((it) => (
                  <li key={it.label} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{it.label}</span>
                    <span className="text-gray-400">
                      <span className="tabular-nums font-medium text-gray-700">{it.count}</span>
                      <span className="ml-1.5 text-xs">· {it.hint}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex-1" />
              <a
                href={panel.href}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                查看全部
                <ArrowRightIcon className="h-3 w-3" aria-hidden="true" />
              </a>
            </Card>
          )
        })}
      </div>
    </section>
  )
}

function RecentActivitySection({ logs }: { logs: AuditLogRecord[] }) {
  return (
    <section aria-label="最近操作">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          最近操作
        </h2>
        <a
          href="/audit"
          className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
        >
          查看全部
          <ArrowRightIcon className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>

      <Card className="overflow-hidden p-0">
        {logs.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">暂无审计记录</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {logs.map((log) => {
              const target = getTargetLabel(log)
              return (
                <div
                  key={log.id}
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-gray-50"
                >
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-primary-400" />

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800">
                      {getAuditActionLabel(log.action)}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-gray-400">
                      {getActorLabel(log)}
                      {target ? ` · ${target}` : ''}
                    </p>
                  </div>

                  <span className="shrink-0 text-xs tabular-nums text-gray-400">
                    {relTime(log.createdAt)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </section>
  )
}

// ─── Real data mapping ────────────────────────────────────────────────────────

function buildKpiCards(data: DashboardData): KpiCard[] {
  const totalTerminals = data.terminals.length
  const onlineTerminals = data.terminals.filter((terminal) => terminal.online).length
  const offlineTerminals = totalTerminals - onlineTerminals

  const pendingJobs = data.jobSources.filter((source) => isPending(source.reviewStatus)).length
  const pendingFairs = data.fairSources.filter((source) => isPending(source.reviewStatus)).length
  const pendingTotal = pendingJobs + pendingFairs

  const fileStats = getFileStats(data.files)

  return [
    {
      label: '在线终端',
      value: `${onlineTerminals} / ${totalTerminals}`,
      sub: offlineTerminals > 0 ? `离线 ${offlineTerminals} 台` : '全部在线',
      icon: MonitorIcon,
      alert: offlineTerminals > 0,
    },
    {
      label: '待审核数据',
      value: String(pendingTotal),
      sub: `岗位 ${pendingJobs} · 招聘会 ${pendingFairs}`,
      icon: BriefcaseIcon,
      alert: pendingTotal > 0,
    },
    {
      label: '待清理文件',
      value: String(fileStats.expired),
      sub: `近 100 条内 · 高敏 ${fileStats.sensitive}`,
      icon: FolderIcon,
      alert: fileStats.expired > 0,
    },
    {
      label: 'AI 调用',
      value: String(data.aiUsage.totalCalls),
      sub: `成功率 ${data.aiUsage.successRate}%`,
      icon: BotIcon,
      alert: data.aiUsage.failCount > 0,
    },
  ]
}

function buildActionPanels(data: DashboardData): ActionPanel[] {
  const pendingJobs = data.jobSources.filter((source) => isPending(source.reviewStatus)).length
  const pendingFairs = data.fairSources.filter((source) => isPending(source.reviewStatus)).length
  const fileStats = getFileStats(data.files)
  const offlineTerminals = data.terminals.filter((terminal) => !terminal.online).length
  const abnormalPrinters = data.terminals.filter((terminal) => {
    const status = terminal.printerStatus
    return Boolean(status && status !== 'ok')
  }).length

  return [
    {
      title: '待审核外部数据',
      icon: BriefcaseIcon,
      href: '/job-sources',
      items: [
        { label: '岗位信息源', count: pendingJobs, hint: '待审核' },
        { label: '招聘会信息源', count: pendingFairs, hint: '待审核' },
      ],
    },
    {
      title: '文件清理',
      icon: FolderIcon,
      href: '/files',
      items: [
        { label: '已过期在库文件', count: fileStats.expired, hint: '近 100 条内' },
        { label: '高敏文件', count: fileStats.sensitive, hint: '近 100 条内' },
      ],
    },
    {
      title: '终端状态',
      icon: MonitorIcon,
      href: '/devices?tab=terminals',
      items: [
        { label: '离线终端', count: offlineTerminals, hint: '心跳超时' },
        { label: '打印机异常', count: abnormalPrinters, hint: '最近上报' },
      ],
    },
  ]
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    Promise.all([
      getTerminals(),
      getJobSources(),
      getFairSources(),
      listFiles({ limit: 100 }),
      getAiUsage(),
      getAuditLogs({ limit: 8, offset: 0 }),
    ])
      .then(([terminalRes, jobSources, fairSources, files, aiUsage, auditRes]) => {
        setData({
          terminals: terminalRes.terminals,
          jobSources,
          fairSources,
          files,
          aiUsage,
          auditLogs: auditRes.items,
        })
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <Page title="工作台" subtitle="运营概览 · 仅展示已有真实数据来源的指标">
      {loading ? (
        <LoadingState text="正在加载工作台数据…" className="py-24" />
      ) : error || !data ? (
        <ErrorState
          title="工作台数据加载失败"
          message="当前无法获取真实后端数据，请检查服务状态后重试。"
          onRetry={load}
          className="py-24"
        />
      ) : (
        <div className="flex flex-col gap-7">
          <KpiSection cards={buildKpiCards(data)} />
          <ActionPanelsSection panels={buildActionPanels(data)} />
          <RecentActivitySection logs={data.auditLogs} />
        </div>
      )}
    </Page>
  )
}

// 工作台只展示已有真实后端来源的数据。
// 订单、收入、告警、打印任务统计暂无真实统计端点，待端点完成后再接入。
