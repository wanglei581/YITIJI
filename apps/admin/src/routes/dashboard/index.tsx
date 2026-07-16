import { useCallback, useEffect, useState, type ElementType, type ReactNode } from 'react'
import { ErrorState, LoadingState, Meter, SectionCard, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BotIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarIcon,
  FolderIcon,
  MonitorIcon,
  PrinterIcon,
  RefreshCwIcon,
  ScrollTextIcon,
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
  getPrinters,
  getTerminals,
  type AdminPrinterRecord,
  type AdminTerminalRecord,
} from '../../services/api/devices'
import {
  adminOpsService,
  type AdminAlertItem,
  type AdminPrintTaskItem,
} from '../../services/api/adminOps'

// ─── Types ────────────────────────────────────────────────────────────────────

interface KpiCard {
  label: string
  value: string
  unit?: string
  sub: string
  icon: ElementType
  /** 数值转警示配色（陶色）。 */
  warn?: boolean
}

interface TodoRow {
  key: string
  icon: ElementType
  title: string
  sub: string
  href: string
  actionLabel: string
  warn?: boolean
}

interface DashboardData {
  terminals: AdminTerminalRecord[]
  printers: AdminPrinterRecord[]
  jobSources: AdminJobSourceRecord[]
  fairSources: AdminFairSourceRecord[]
  files: AdminFileRecord[]
  aiUsage: AdminAiUsage
  auditLogs: AuditLogRecord[]
  printTasks: AdminPrintTaskItem[]
  printTaskTotal: number
  alerts: AdminAlertItem[]
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

const PRINT_STATUS_LABELS: Record<string, { label: string; status: 'success' | 'warning' | 'error' | 'info' | 'default' }> = {
  pending: { label: '排队中', status: 'info' },
  claimed: { label: '已领取', status: 'info' },
  printing: { label: '打印中', status: 'info' },
  completed: { label: '已完成', status: 'success' },
  failed: { label: '失败', status: 'error' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relTime(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return iso

  const diff = Date.now() - time
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

function clockTime(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return iso
  return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function isPending(reviewStatus: string): boolean {
  return PENDING_STATUSES.has(reviewStatus)
}

function getFileStats(files: AdminFileRecord[]) {
  const now = Date.now()
  const activeFiles = files.filter((file) => file.deletedAt === null)
  return {
    expired: activeFiles.filter((file) => file.expiresAt !== null && Date.parse(file.expiresAt) <= now).length,
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

/** 非空平均值；全为空返回 null（诚实：无上报不显示均值）。 */
function avgLevel(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (nums.length === 0) return null
  return Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length)
}

function printTypeLabel(task: AdminPrintTaskItem): string {
  const color = task.colorMode === 'color' ? '彩色' : task.colorMode === 'black_white' ? '黑白' : '—'
  const copies = task.copies != null ? ` · ${task.copies} 份` : ''
  return `${color}${copies}`
}

// ─── Section link ─────────────────────────────────────────────────────────────

function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-bold text-primary-700 hover:text-primary-600"
    >
      {children}
      <ArrowRightIcon className="h-3 w-3" aria-hidden="true" />
    </a>
  )
}

// ─── KPI ──────────────────────────────────────────────────────────────────────

function KpiSection({ cards }: { cards: KpiCard[] }) {
  return (
    <section aria-label="核心指标" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <div
            key={card.label}
            className="rounded-lg border border-neutral-900/[0.06] bg-surface px-5 py-[18px] shadow-sm"
          >
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-500">
              <Icon className="h-[15px] w-[15px]" aria-hidden="true" />
              {card.label}
            </div>
            <div
              className={
                'mt-2.5 text-3xl font-extrabold tabular-nums ' +
                (card.warn ? 'text-warning' : 'text-neutral-900')
              }
            >
              {card.value}
              {card.unit && <span className="ml-0.5 text-sm font-bold opacity-55">{card.unit}</span>}
            </div>
            <p className="mt-2 text-xs text-neutral-500">{card.sub}</p>
          </div>
        )
      })}
    </section>
  )
}

// ─── 最近打印任务 ─────────────────────────────────────────────────────────────

function RecentPrintTasks({ tasks, total }: { tasks: AdminPrintTaskItem[]; total: number }) {
  return (
    <SectionCard
      title="最近打印任务"
      action={<CardLink href="/orders">进入订单管理</CardLink>}
      flush={tasks.length > 0}
    >
      {tasks.length === 0 ? (
        <p className="py-6 text-center text-sm text-neutral-400">暂无打印任务</p>
      ) : (
        <>
          <div className="overflow-x-auto px-5">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {['任务', '终端', '参数', '状态', '时间'].map((th) => (
                    <th
                      key={th}
                      className="whitespace-nowrap border-b border-neutral-900/10 px-2.5 py-2 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500"
                    >
                      {th}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const st = PRINT_STATUS_LABELS[task.status] ?? { label: task.status, status: 'default' as const }
                  return (
                    <tr key={task.id} className="transition-colors hover:bg-neutral-50">
                      <td className="max-w-[180px] truncate whitespace-nowrap border-b border-neutral-900/[0.06] px-2.5 py-2.5 font-bold text-primary-700">
                        {task.fileName ?? task.id.slice(0, 8)}
                      </td>
                      <td className="whitespace-nowrap border-b border-neutral-900/[0.06] px-2.5 py-2.5 text-neutral-700">
                        {task.terminalCode ?? '—'}
                      </td>
                      <td className="whitespace-nowrap border-b border-neutral-900/[0.06] px-2.5 py-2.5 tabular-nums text-neutral-700">
                        {printTypeLabel(task)}
                      </td>
                      <td className="whitespace-nowrap border-b border-neutral-900/[0.06] px-2.5 py-2.5">
                        <StatusBadge dot status={st.status} label={st.label} />
                      </td>
                      <td className="whitespace-nowrap border-b border-neutral-900/[0.06] px-2.5 py-2.5 tabular-nums text-neutral-500">
                        {clockTime(task.createdAt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="px-5 pb-4 pt-3 text-xs text-neutral-500">共 {total} 条打印任务</p>
        </>
      )}
    </SectionCard>
  )
}

// ─── 待办条目（待办审核 / 实时告警共用行样式）──────────────────────────────────

function TodoItemRow({ row, isFirst }: { row: TodoRow; isFirst: boolean }) {
  const Icon = row.icon
  return (
    <div
      className={
        'flex items-center gap-3 py-[11px] text-[13px]' +
        (isFirst ? '' : ' border-t border-neutral-900/[0.06]')
      }
    >
      <span
        className={
          'grid h-8 w-8 shrink-0 place-items-center rounded-[9px] ' +
          (row.warn ? 'bg-warning-bg text-warning-fg' : 'bg-primary-100 text-primary-700')
        }
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-neutral-900">{row.title}</p>
        <p className="mt-0.5 truncate text-[11.5px] text-neutral-500">{row.sub}</p>
      </div>
      <a href={row.href} className="shrink-0 text-xs font-bold text-primary-700 hover:text-primary-600">
        {row.actionLabel}
      </a>
    </div>
  )
}

// ─── 最近操作 ─────────────────────────────────────────────────────────────────

function RecentActivity({ logs }: { logs: AuditLogRecord[] }) {
  return (
    <SectionCard title="最近操作" action={<CardLink href="/audit">日志审计</CardLink>}>
      {logs.length === 0 ? (
        <p className="py-6 text-center text-sm text-neutral-400">暂无审计记录</p>
      ) : (
        <div>
          {logs.map((log, index) => {
            const target = getTargetLabel(log)
            return (
              <div
                key={log.id}
                className={
                  'flex items-center gap-3 py-[11px] text-[13px]' +
                  (index === 0 ? '' : ' border-t border-neutral-900/[0.06]')
                }
              >
                <span
                  aria-hidden="true"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-primary-100 text-primary-700"
                >
                  <ScrollTextIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-neutral-900">
                    {getAuditActionLabel(log.action)}
                  </p>
                  <p className="mt-0.5 truncate text-[11.5px] text-neutral-500">
                    {getActorLabel(log)}
                    {target ? ` · ${target}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                  {relTime(log.createdAt)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </SectionCard>
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
      value: `${onlineTerminals}`,
      unit: `/ ${totalTerminals} 台`,
      sub: offlineTerminals > 0 ? `${offlineTerminals} 台离线 · 点击设备管理查看` : '全部在线',
      icon: MonitorIcon,
      warn: offlineTerminals > 0,
    },
    {
      label: '待审核数据',
      value: String(pendingTotal),
      unit: '条',
      sub: `岗位 ${pendingJobs} · 招聘会 ${pendingFairs}`,
      icon: BriefcaseIcon,
      warn: pendingTotal > 0,
    },
    {
      label: '待清理文件',
      value: String(fileStats.expired),
      unit: '个',
      sub: `近 100 条内 · 高敏 ${fileStats.sensitive}`,
      icon: FolderIcon,
      warn: fileStats.expired > 0,
    },
    {
      label: 'AI 调用',
      value: String(data.aiUsage.totalCalls),
      unit: '次',
      sub: `成功率 ${data.aiUsage.successRate}%`,
      icon: BotIcon,
      warn: data.aiUsage.failCount > 0,
    },
  ]
}

function buildTodoRows(data: DashboardData): TodoRow[] {
  const pendingJobs = data.jobSources.filter((source) => isPending(source.reviewStatus)).length
  const pendingFairs = data.fairSources.filter((source) => isPending(source.reviewStatus)).length
  const fileStats = getFileStats(data.files)

  const rows: TodoRow[] = []
  if (pendingJobs > 0) {
    rows.push({
      key: 'jobs',
      icon: BriefcaseIcon,
      title: `${pendingJobs} 条岗位信息待审核`,
      sub: '来自岗位信息源 · 审核通过后才会在终端展示',
      href: '/job-sources',
      actionLabel: '去审核',
    })
  }
  if (pendingFairs > 0) {
    rows.push({
      key: 'fairs',
      icon: CalendarIcon,
      title: `${pendingFairs} 条招聘会信息待审核`,
      sub: '来自招聘会信息源 · 审核通过后才会在终端展示',
      href: '/fair-sources',
      actionLabel: '去审核',
    })
  }
  if (fileStats.expired > 0) {
    rows.push({
      key: 'files',
      icon: FolderIcon,
      title: `${fileStats.expired} 个已过期在库文件`,
      sub: '近 100 条内 · 建议执行清理',
      href: '/files',
      actionLabel: '去清理',
      warn: true,
    })
  }
  if (fileStats.sensitive > 0) {
    rows.push({
      key: 'sensitive',
      icon: Building2Icon,
      title: `${fileStats.sensitive} 个高敏文件在库`,
      sub: '近 100 条内 · 关注保留时长与访问日志',
      href: '/files',
      actionLabel: '去查看',
      warn: true,
    })
  }
  return rows
}

function buildAlertRows(alerts: AdminAlertItem[]): TodoRow[] {
  return alerts.slice(0, 3).map((alert) => ({
    key: alert.id,
    icon: alert.type === 'terminal_offline' ? MonitorIcon : PrinterIcon,
    title: alert.title,
    sub: `${alert.terminalCode ?? '未知终端'} · ${relTime(alert.occurredAt)}`,
    href: '/alerts',
    actionLabel: '处理',
    warn: true,
  }))
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
      getPrinters(),
      getJobSources(),
      getFairSources(),
      listFiles({ limit: 100 }),
      getAiUsage(),
      getAuditLogs({ limit: 6, offset: 0 }),
      adminOpsService.listPrintTasks({ page: 1, pageSize: 5 }),
      adminOpsService.listAlerts(),
    ])
      .then(([terminalRes, printerRes, jobSources, fairSources, files, aiUsage, auditRes, printTaskPage, alertsRes]) => {
        setData({
          terminals: terminalRes.terminals,
          printers: printerRes.printers,
          jobSources,
          fairSources,
          files,
          aiUsage,
          auditLogs: auditRes.items,
          printTasks: printTaskPage.data,
          printTaskTotal: printTaskPage.pagination.total,
          alerts: alertsRes.data,
        })
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  const alertCount = data?.alerts.length ?? 0

  return (
    <Page
      title="工作台"
      subtitle={`${today} · 运营概览，仅展示已有真实数据来源的指标`}
      actions={
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-4 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
          >
            <RefreshCwIcon className={'h-3.5 w-3.5' + (loading ? ' animate-spin' : '')} aria-hidden="true" />
            刷新
          </button>
          {alertCount > 0 && (
            <a
              href="/alerts"
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-primary-600 px-4 text-[13px] font-bold text-white shadow-[0_8px_18px_rgba(16,48,43,0.18)] transition-transform hover:-translate-y-px hover:bg-primary-700 active:scale-[0.97]"
            >
              <AlertTriangleIcon className="h-3.5 w-3.5" aria-hidden="true" />
              处理告警 ({alertCount})
            </a>
          )}
        </div>
      }
    >
      {loading && !data ? (
        <LoadingState text="正在加载工作台数据…" className="py-24" />
      ) : error || !data ? (
        <ErrorState
          title="工作台数据加载失败"
          message="当前无法获取真实后端数据，请检查服务状态后重试。"
          onRetry={load}
          className="py-24"
        />
      ) : (
        <div className="flex flex-col gap-4">
          <KpiSection cards={buildKpiCards(data)} />

          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.7fr_1fr]">
            {/* 左列 */}
            <div className="flex flex-col gap-4">
              <RecentPrintTasks tasks={data.printTasks} total={data.printTaskTotal} />
              <RecentActivity logs={data.auditLogs} />
            </div>

            {/* 右列 */}
            <div className="flex flex-col gap-4">
              <SectionCard title="待办审核" action={<CardLink href="/job-sources">全部</CardLink>}>
                {(() => {
                  const rows = buildTodoRows(data)
                  return rows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-neutral-400">暂无待办事项</p>
                  ) : (
                    <div>
                      {rows.map((row, index) => (
                        <TodoItemRow key={row.key} row={row} isFirst={index === 0} />
                      ))}
                    </div>
                  )
                })()}
              </SectionCard>

              <SectionCard title="设备状态" action={<CardLink href="/devices">设备管理</CardLink>}>
                {data.terminals.length === 0 ? (
                  <p className="py-6 text-center text-sm text-neutral-400">暂无已注册终端</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {(() => {
                      const total = data.terminals.length
                      const online = data.terminals.filter((terminal) => terminal.online).length
                      const readyPrinters = data.printers.filter((printer) => printer.status === 'online').length
                      const printerTotal = data.printers.length
                      const toner = avgLevel(data.printers.map((printer) => printer.tonerLevel))
                      const paper = avgLevel(data.printers.map((printer) => printer.paperTrayLevel))
                      return (
                        <>
                          <Meter
                            label="终端在线率"
                            percent={(online / total) * 100}
                            valueText={`${online}/${total}`}
                            low={online < total}
                          />
                          {printerTotal > 0 && (
                            <Meter
                              label="打印机就绪"
                              percent={(readyPrinters / printerTotal) * 100}
                              valueText={`${readyPrinters}/${printerTotal}`}
                              low={readyPrinters < printerTotal}
                            />
                          )}
                          {toner !== null && (
                            <Meter label="碳粉均值" percent={toner} valueText={`${toner}%`} low={toner < 40} />
                          )}
                          {paper !== null && (
                            <Meter label="纸量均值" percent={paper} valueText={`${paper}%`} low={paper < 40} />
                          )}
                          {printerTotal === 0 && (
                            <p className="text-xs text-neutral-400">打印机尚无心跳上报</p>
                          )}
                        </>
                      )
                    })()}
                  </div>
                )}
              </SectionCard>

              <SectionCard title="实时告警" action={<CardLink href="/alerts">告警中心</CardLink>}>
                {data.alerts.length === 0 ? (
                  <p className="py-6 text-center text-sm text-neutral-400">暂无实时告警</p>
                ) : (
                  <div>
                    {buildAlertRows(data.alerts).map((row, index) => (
                      <TodoItemRow key={row.key} row={row} isFirst={index === 0} />
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}

// 工作台只展示已有真实后端来源的数据：
// 打印任务/告警来自 adminOps（实时派生），设备量条来自 Terminal Agent 心跳，
// 无真实数据的区块显示诚实空态；金额/收入等待支付域 C-5 落地后再接入。
