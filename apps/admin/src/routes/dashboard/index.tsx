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
  type AdminAlertsResult,
  type AdminPrintTaskItem,
  type AdminPrintTaskPage,
} from '../../services/api/adminOps'

// ─── Types ────────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string
  value: string
  unit?: string
  sub: string
  icon: ElementType
  /** 数值转警示配色（陶色）。 */
  warn?: boolean
  /** 该指标的某个数据源加载失败：整卡转错误态并给「重试」，不再显示猜测值。 */
  failed?: boolean
  onRetry: () => void
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

/**
 * 工作台分区降级模型（OPS-05）：
 * 九个接口各自独立成败，任一块失败只让那一块进错误态并提供重试，
 * 不再用 Promise.all 把整页拖进「工作台数据加载失败」。
 */
type BlockKey =
  | 'terminals'
  | 'printers'
  | 'jobSources'
  | 'fairSources'
  | 'files'
  | 'aiUsage'
  | 'auditLogs'
  | 'printTasks'
  | 'alerts'

const ALL_BLOCKS: BlockKey[] = [
  'terminals',
  'printers',
  'jobSources',
  'fairSources',
  'files',
  'aiUsage',
  'auditLogs',
  'printTasks',
  'alerts',
]

interface BlockEntry<V = unknown> {
  value: V | null
  error: string | null
  loading: boolean
}

function initialBlock<V>(loading = true): BlockEntry<V> {
  return { value: null, error: null, loading }
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
  cancelled: { label: '已取消', status: 'default' },
  abandoned: { label: '已废弃', status: 'default' },
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

/** 非空平均值；全为空返回 null（诚实：无上报不显示均值）。 */
function avgLevel(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (nums.length === 0) return null
  return Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length)
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

function printTypeLabel(task: AdminPrintTaskItem): string {
  const color = task.colorMode === 'color' ? '彩色' : task.colorMode === 'black_white' ? '黑白' : '—'
  const copies = task.copies != null ? ` · ${task.copies} 份` : ''
  return `${color}${copies}`
}

// ─── Section building blocks ──────────────────────────────────────────────────

function SectionLink({ href, children }: { href: string; children: ReactNode }) {
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

/** KPI 卡片；数据源失败时卡内给错误 + 重试，不让整页因单块失败而崩溃。 */
function KpiCard({ label, value, unit, sub, icon: Icon, warn, failed, onRetry }: KpiCardProps) {
  return (
    <div
      className={
        'rounded-lg border bg-surface px-5 py-[18px] shadow-sm ' +
        (warn && !failed
          ? 'border-warning/30'
          : failed
            ? 'border-error/30'
            : 'border-neutral-900/[0.06]')
      }
    >
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-neutral-500">
        <Icon className="h-[14px] w-[14px] shrink-0" aria-hidden="true" />
        {label}
      </div>
      {failed ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[13px] text-error-fg">数据源加载失败</span>
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
          >
            重试
          </button>
        </div>
      ) : (
        <>
          <div
            className={
              'mt-2 text-[1.9rem] font-extrabold tabular-nums leading-none ' +
              (warn ? 'text-warning' : 'text-neutral-900')
            }
          >
            {value}
            {unit && <span className="ml-1 text-sm font-bold opacity-50">{unit}</span>}
          </div>
          <p className="mt-2 text-[11.5px] text-neutral-500">{sub}</p>
        </>
      )}
    </div>
  )
}

/** 区块级错误：只影响所在卡片/区块，配独立重试。 */
function BlockError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2.5 py-8 text-center">
      <p className="text-sm text-error-fg">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-neutral-200 bg-surface px-4 py-1.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
      >
        重试
      </button>
    </div>
  )
}

function BlockLoading() {
  return <p className="py-8 text-center text-sm text-neutral-400">加载中…</p>
}

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

function RecentPrintTasks({ tasks, total }: { tasks: AdminPrintTaskItem[]; total: number }) {
  return (
    <SectionCard
      title="最近打印任务"
      action={<SectionLink href="/orders">进入订单管理</SectionLink>}
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

function RecentActivity({ logs }: { logs: AuditLogRecord[] }) {
  return (
    <SectionCard title="最近操作" action={<SectionLink href="/audit">日志审计</SectionLink>}>
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

// ─── Data mapping（只对已加载成功的数据求值，失败块不进统计）──────────────

interface LoadedSources {
  jobSources: AdminJobSourceRecord[]
  fairSources: AdminFairSourceRecord[]
  files: AdminFileRecord[]
}

function pendingJobCount(jobSources: AdminJobSourceRecord[]): number {
  return jobSources.filter((source) => isPending(source.reviewStatus)).length
}

function pendingFairCount(fairSources: AdminFairSourceRecord[]): number {
  return fairSources.filter((source) => isPending(source.reviewStatus)).length
}

function fileAttention(files: AdminFileRecord[]): { expired: number; sensitive: number } {
  const now = Date.now()
  const activeFiles = files.filter((file) => file.deletedAt === null)
  return {
    expired: activeFiles.filter((file) => file.expiresAt !== null && Date.parse(file.expiresAt) <= now).length,
    sensitive: activeFiles.filter((file) => file.sensitiveLevel === 'highly_sensitive').length,
  }
}

function buildTodoRows(loaded: LoadedSources): TodoRow[] {
  const rows: TodoRow[] = []
  const pendingJobs = pendingJobCount(loaded.jobSources)
  const pendingFairs = pendingFairCount(loaded.fairSources)
  const fileStats = fileAttention(loaded.files)

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

/**
 * 每个 key 对应一次独立请求；loadBlocks 用 Promise.allSettled 聚合结果，
 * 失败只落该 key 的 error，成功块照常渲染。
 */
const LOADERS: Record<BlockKey, () => Promise<unknown>> = {
  terminals: () => getTerminals().then((res) => res.terminals),
  printers: () => getPrinters().then((res) => res.printers),
  jobSources: () => getJobSources(),
  fairSources: () => getFairSources(),
  files: () => listFiles({ limit: 100 }).then((res) => res.items),
  aiUsage: () => getAiUsage(),
  auditLogs: () => getAuditLogs({ limit: 6, offset: 0 }).then((res) => res.items),
  printTasks: () => adminOpsService.listPrintTasks({ page: 1, pageSize: 5 }),
  alerts: () => adminOpsService.listAlerts(),
}

export default function DashboardPage() {
  const [blocks, setBlocks] = useState<Partial<Record<BlockKey, BlockEntry>>>({})
  const [initialLoading, setInitialLoading] = useState(true)

  const patchBlock = useCallback(<V,>(key: BlockKey, patch: Partial<BlockEntry<V>>) => {
    setBlocks((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? initialBlock<V>()), ...patch },
    }))
  }, [])

  const loadBlocks = useCallback(
    async (keys: BlockKey[]) => {
      keys.forEach((key) => patchBlock(key, { loading: true, error: null }))
      const results = await Promise.allSettled(keys.map((key) => LOADERS[key]()))
      results.forEach((result, index) => {
        const key = keys[index]
        if (result.status === 'fulfilled') {
          patchBlock(key, { value: result.value as never, error: null, loading: false })
        } else {
          const message = result.reason instanceof Error ? result.reason.message : '加载失败'
          patchBlock(key, { value: null, error: message, loading: false })
        }
      })
    },
    [patchBlock],
  )

  const loadAll = useCallback(() => {
    void loadBlocks(ALL_BLOCKS)
  }, [loadBlocks])

  useEffect(() => {
    void loadBlocks(ALL_BLOCKS).finally(() => setInitialLoading(false))
  }, [loadBlocks])

  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  const entry = <K extends BlockKey>(key: K): BlockEntry =>
    blocks[key] ?? { value: null, error: null, loading: true }
  const hasValue = <K extends BlockKey,>(key: K): boolean => entry(key).value !== null && entry(key).error === null
  const failedKeys = (keys: BlockKey[]): BlockKey[] => keys.filter((key) => entry(key).error !== null)
  const anyLoading = ALL_BLOCKS.some((key) => entry(key).loading)

  const terminals = hasValue('terminals') ? (entry('terminals').value as AdminTerminalRecord[]) : null
  const printers = hasValue('printers') ? (entry('printers').value as AdminPrinterRecord[]) : null
  const jobSources = hasValue('jobSources') ? (entry('jobSources').value as AdminJobSourceRecord[]) : null
  const fairSources = hasValue('fairSources') ? (entry('fairSources').value as AdminFairSourceRecord[]) : null
  const files = hasValue('files') ? (entry('files').value as AdminFileRecord[]) : null
  const aiUsage = hasValue('aiUsage') ? (entry('aiUsage').value as AdminAiUsage) : null
  const auditLogs = hasValue('auditLogs') ? (entry('auditLogs').value as AuditLogRecord[]) : null
  const printTaskPage = hasValue('printTasks') ? (entry('printTasks').value as AdminPrintTaskPage) : null
  const alerts = hasValue('alerts') ? (entry('alerts').value as AdminAlertsResult) : null

  const loadedAny = ALL_BLOCKS.some((key) => hasValue(key))
  const totalTerminals = terminals?.length ?? 0
  const onlineTerminals = terminals?.filter((terminal) => terminal.online).length ?? 0
  const offlineTerminals = totalTerminals - onlineTerminals
  const printerTotal = printers?.length ?? 0
  const readyPrinters = printers?.filter((printer) => printer.status === 'online').length ?? 0
  const toner = printers ? avgLevel(printers.map((printer) => printer.tonerLevel)) : null
  const paper = printers ? avgLevel(printers.map((printer) => printer.paperTrayLevel)) : null
  const fileStats = files ? fileAttention(files) : { expired: 0, sensitive: 0 }

  const retry = (keys: BlockKey[]) => () => void loadBlocks(keys)
  const alertCount = alerts?.firingCount ?? 0

  if (initialLoading) {
    return (
      <Page title="工作台" subtitle={`${today} · 运营概览，仅展示已有真实数据来源的指标`}>
        <LoadingState text="正在加载工作台数据…" className="py-24" />
      </Page>
    )
  }

  if (!loadedAny) {
    return (
      <Page
        title="工作台"
        subtitle={`${today} · 运营概览，仅展示已有真实数据来源的指标`}
        actions={
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={loadAll}
              disabled={anyLoading}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-4 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
            >
              <RefreshCwIcon className={'h-3.5 w-3.5' + (anyLoading ? ' animate-spin' : '')} aria-hidden="true" />
              刷新
            </button>
          </div>
        }
      >
        <ErrorState
          title="工作台数据加载失败"
          message="各数据源均未返回数据，请检查服务状态后重试；已加载成功的板块会正常显示。"
          onRetry={loadAll}
          className="py-24"
        />
      </Page>
    )
  }

  return (
    <Page
      title="工作台"
      subtitle={`${today} · 运营概览，仅展示已有真实数据来源的指标`}
      actions={
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={loadAll}
            disabled={anyLoading}
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-4 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
          >
            <RefreshCwIcon className={'h-3.5 w-3.5' + (anyLoading ? ' animate-spin' : '')} aria-hidden="true" />
            刷新
          </button>
          {alerts && alertCount > 0 && (
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
      <div className="flex flex-col gap-4">
        <section aria-label="核心指标" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard
            label="在线终端"
            icon={MonitorIcon}
            value={String(onlineTerminals)}
            unit={`/ ${totalTerminals} 台`}
            sub={terminals !== null ? (offlineTerminals > 0 ? `${offlineTerminals} 台离线 · 点击设备管理查看` : '全部在线') : ''}
            warn={terminals !== null && offlineTerminals > 0}
            failed={terminals === null}
            onRetry={retry(['terminals'])}
          />
          <KpiCard
            label="待审核数据"
            icon={BriefcaseIcon}
            value={String(
              (jobSources !== null ? pendingJobCount(jobSources) : 0) +
                (fairSources !== null ? pendingFairCount(fairSources) : 0),
            )}
            unit="条"
            sub={(() => {
              const parts: string[] = []
              if (jobSources !== null) parts.push(`岗位 ${pendingJobCount(jobSources)}`)
              if (fairSources !== null) parts.push(`招聘会 ${pendingFairCount(fairSources)}`)
              return parts.join(' · ')
            })()}
            warn={jobSources !== null || fairSources !== null
              ? pendingJobCount(jobSources ?? []) + pendingFairCount(fairSources ?? []) > 0
              : false}
            failed={jobSources === null || fairSources === null}
            onRetry={retry(failedKeys(['jobSources', 'fairSources']))}
          />
          <KpiCard
            label="待清理文件"
            icon={FolderIcon}
            value={String(fileStats.expired)}
            unit="个"
            sub={files !== null ? `近 100 条内 · 高敏 ${fileStats.sensitive}` : ''}
            warn={files !== null && fileStats.expired > 0}
            failed={files === null}
            onRetry={retry(['files'])}
          />
          <KpiCard
            label="AI 调用"
            icon={BotIcon}
            value={aiUsage !== null ? String(aiUsage.totalCalls) : '0'}
            unit="次"
            sub={aiUsage !== null ? `成功率 ${aiUsage.successRate}%` : ''}
            warn={aiUsage !== null && aiUsage.failCount > 0}
            failed={aiUsage === null}
            onRetry={retry(['aiUsage'])}
          />
        </section>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.7fr_1fr]">
          {/* 左列 */}
          <div className="flex flex-col gap-4">
            {printTaskPage ? (
              <RecentPrintTasks tasks={printTaskPage.data} total={printTaskPage.pagination.total} />
            ) : entry('printTasks').error ? (
              <SectionCard title="最近打印任务">
                <BlockError message="打印任务加载失败" onRetry={retry(['printTasks'])} />
              </SectionCard>
            ) : (
              <SectionCard title="最近打印任务">
                <BlockLoading />
              </SectionCard>
            )}

            {auditLogs ? (
              <RecentActivity logs={auditLogs} />
            ) : entry('auditLogs').error ? (
              <SectionCard title="最近操作">
                <BlockError message="审计日志加载失败" onRetry={retry(['auditLogs'])} />
              </SectionCard>
            ) : (
              <SectionCard title="最近操作">
                <BlockLoading />
              </SectionCard>
            )}
          </div>

          {/* 右列 */}
          <div className="flex flex-col gap-4">
            <SectionCard title="待办审核" action={<SectionLink href="/job-sources">全部</SectionLink>}>
              {(() => {
                const failed = failedKeys(['jobSources', 'fairSources', 'files'])
                if (jobSources === null && fairSources === null && files === null) {
                  if (failed.length > 0) {
                    return <BlockError message="待办数据加载失败" onRetry={retry(failed)} />
                  }
                  return <BlockLoading />
                }
                const rows = buildTodoRows({
                  jobSources: jobSources ?? [],
                  fairSources: fairSources ?? [],
                  files: files ?? [],
                })
                return (
                  <div>
                    {failed.length > 0 && (
                      <p className="border-b border-dashed border-neutral-200 py-2 text-xs text-warning-fg">
                        部分来源加载失败（{failed.join(' / ')}），其待办未统计。
                        <button type="button" onClick={retry(failed)} className="ml-2 font-bold text-primary-700 hover:underline">
                          重试
                        </button>
                      </p>
                    )}
                    {rows.length === 0 ? (
                      <p className="py-6 text-center text-sm text-neutral-400">暂无待办事项</p>
                    ) : (
                      rows.map((row, index) => (
                        <TodoItemRow key={row.key} row={row} isFirst={index === 0 && failed.length === 0} />
                      ))
                    )}
                  </div>
                )
              })()}
            </SectionCard>

            <SectionCard title="设备状态" action={<SectionLink href="/devices">设备管理</SectionLink>}>
              {terminals === null && printers === null ? (
                entry('terminals').error || entry('printers').error ? (
                  <BlockError
                    message="设备状态加载失败"
                    onRetry={retry(failedKeys(['terminals', 'printers']))}
                  />
                ) : (
                  <BlockLoading />
                )
              ) : (
                <div className="flex flex-col gap-2.5">
                  {(() => {
                    if (terminals === null) {
                      return (
                        <p className="text-xs text-warning-fg">
                          终端列表加载失败，终端在线率暂缺。
                          <button type="button" onClick={retry(['terminals'])} className="ml-2 font-bold text-primary-700 hover:underline">
                            重试
                          </button>
                        </p>
                      )
                    }
                    if (terminals.length === 0) {
                      return <p className="py-6 text-center text-sm text-neutral-400">暂无已注册终端</p>
                    }
                    const online = terminals.filter((terminal) => terminal.online).length
                    return (
                      <>
                        <Meter
                          label="终端在线率"
                          percent={(online / terminals.length) * 100}
                          valueText={`${online}/${terminals.length}`}
                          low={online < terminals.length}
                        />
                        {printers !== null && printerTotal > 0 && (
                          <Meter
                            label="打印机就绪"
                            percent={(readyPrinters / printerTotal) * 100}
                            valueText={`${readyPrinters}/${printerTotal}`}
                            low={readyPrinters < printerTotal}
                          />
                        )}
                      </>
                    )
                  })()}
                  {printers !== null ? (
                    <>
                      {toner !== null && (
                        <Meter label="碳粉均值" percent={toner} valueText={`${toner}%`} low={toner < 40} />
                      )}
                      {/* paperTrayLevel 后端当前恒 null（未上报），口径与工作台百分比一致；
                          不上报时整行不渲染（avgLevel 返回 null），绝不显示「张」等猜测单位。 */}
                      {paper !== null && (
                        <Meter label="纸量均值" percent={paper} valueText={`${paper}%`} low={paper < 40} />
                      )}
                      {printerTotal === 0 && terminals !== null && terminals.length > 0 && (
                        <p className="text-xs text-neutral-400">打印机尚无心跳上报</p>
                      )}
                    </>
                  ) : (
                    entry('printers').error && (
                      <p className="text-xs text-warning-fg">
                        打印机数据加载失败，打印机状态暂缺。
                        <button type="button" onClick={retry(['printers'])} className="ml-2 font-bold text-primary-700 hover:underline">
                          重试
                        </button>
                      </p>
                    )
                  )}
                </div>
              )}
            </SectionCard>

            <SectionCard title="实时告警" action={<SectionLink href="/alerts">告警中心</SectionLink>}>
              {alerts === null ? (
                entry('alerts').error ? (
                  <BlockError message="实时告警加载失败" onRetry={retry(['alerts'])} />
                ) : (
                  <BlockLoading />
                )
              ) : (
                <div>
                  {alerts.data.length === 0 ? (
                    <p className="py-6 text-center text-sm text-neutral-400">暂无实时告警</p>
                  ) : (
                    buildAlertRows(alerts.data).map((row, index) => (
                      <TodoItemRow key={row.key} row={row} isFirst={index === 0} />
                    ))
                  )}
                  {alertCount > alerts.data.length && (
                    <p className="border-t border-neutral-900/[0.06] pt-2.5 text-[11.5px] text-neutral-500">
                      当前共 {alertCount} 条告警仍在发生（含已确认/静默与截断部分），以上仅列最近 {alerts.data.length} 条，完整清单见告警中心。
                    </p>
                  )}
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      </div>
    </Page>
  )
}

// 工作台只展示已有真实后端来源的数据：
// 打印任务/告警来自 adminOps（实时派生），设备量条来自 Terminal Agent 心跳，
// 无真实数据的区块显示诚实空态；金额/收入等待支付域 C-5 落地后再接入。
