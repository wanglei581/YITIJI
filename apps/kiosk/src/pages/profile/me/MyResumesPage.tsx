// ============================================================
// 我的简历 — /me/resumes（本人，仅元数据）。
// 不展示简历原文 / payload / 诊断正文；报告、优化和生成结果由目标页
// 凭本人 token + taskId 再按需读取。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState } from '@ai-job-print/ui'
import type { MemberResumeItem } from '@ai-job-print/shared'
import {
  ArrowUpRightIcon,
  FileSearchIcon,
  FileTextIcon,
  PrinterIcon,
  SparklesIcon,
  TargetIcon,
  type LucideIcon,
} from 'lucide-react'
import { getMyResumes } from '../../../services/api/memberAssets'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'

const STATUS_META: Record<MemberResumeItem['status'], { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'bg-amber-50 text-amber-600' },
  processing: { label: '处理中', cls: 'bg-blue-50 text-blue-600' },
  completed: { label: '已完成', cls: 'bg-emerald-50 text-emerald-600' },
  failed: { label: '失败', cls: 'bg-red-50 text-red-600' },
}

const KIND_META: Record<MemberResumeItem['kind'], { label: string; hint: string; icon: LucideIcon; bg: string; color: string }> = {
  parse: {
    label: '上传诊断简历',
    hint: '上传简历后生成的诊断记录',
    icon: FileSearchIcon,
    bg: 'bg-primary-50',
    color: 'text-primary-600',
  },
  generate: {
    label: 'AI 生成简历',
    hint: 'AI 引导生成的简历版本',
    icon: SparklesIcon,
    bg: 'bg-violet-50',
    color: 'text-violet-600',
  },
}

const UNKNOWN_STATUS = { label: '未知状态', cls: 'bg-gray-50 text-gray-600' }
const UNKNOWN_KIND = {
  label: '简历记录',
  hint: '本人简历服务记录',
  icon: FileTextIcon,
  bg: 'bg-gray-50',
  color: 'text-gray-600',
}

function shortTaskId(taskId: string | null | undefined): string {
  if (!taskId) return '未知任务'
  return taskId.length > 10 ? `${taskId.slice(0, 6)}...${taskId.slice(-4)}` : taskId
}

function metaLine(item: MemberResumeItem): string {
  const expires = item.expiresAt ? ` · 留存至 ${formatTime(item.expiresAt)}` : ''
  return `${item.provider} · 任务 ${shortTaskId(item.taskId)} · ${formatTime(item.createdAt)}${expires}`
}

function isActionable(item: MemberResumeItem): boolean {
  return item.status === 'completed'
}

function taskPath(path: string, taskId: string): string {
  return `${path}?taskId=${encodeURIComponent(taskId)}`
}

export function MyResumesPage() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberResumeItem[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<MeListState>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setItems([])
      setTotal(0)
      setState('ready')
      return
    }
    setState('loading')
    getMyResumes(getToken(), { pageSize: 50 })
      .then((page) => {
        setItems(page.items)
        setTotal(page.total)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [getToken, isLoggedIn])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const openReport = (taskId: string) => navigate(taskPath('/resume/report', taskId), { state: { taskId } })
  const openOptimize = (taskId: string) => navigate(taskPath('/resume/optimize', taskId), { state: { taskId } })
  const openJobFit = (taskId: string) => navigate(taskPath('/resume/job-fit', taskId), { state: { taskId } })
  const openGenerate = (taskId: string) => navigate(taskPath('/resume/generate/preview', taskId), { state: { taskId } })

  return (
    <MeListShell
      title="我的简历"
      subtitle="本人上传诊断与 AI 生成的简历记录（仅元数据）"
      loginFrom="/me/resumes"
      isLoggedIn={isLoggedIn}
      state={state}
      onRetry={() => setReloadKey((k) => k + 1)}
    >
      {items.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            icon={FileTextIcon}
            title="还没有登录后保存的简历"
            description="公共一体机上的游客上传不会自动绑定到账号；登录后上传、诊断或生成的简历会显示在这里"
            className="py-10"
          />
          <div className="mt-2 flex justify-center">
            <Button size="lg" className="h-14 px-8" onClick={() => navigate('/resume/source')}>
              <FileTextIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />
              去上传简历
            </Button>
          </div>
        </Card>
      ) : (
        items.map((item) => {
          const kind = KIND_META[item.kind] ?? UNKNOWN_KIND
          const status = STATUS_META[item.status] ?? UNKNOWN_STATUS
          const Icon = kind.icon
          const actionable = isActionable(item)
          const disabledReason = item.status === 'failed' ? '任务已失败，不可继续操作' : '任务完成后可用'
          const taskLabel = shortTaskId(item.taskId)
          return (
            <Card
              key={item.id}
              className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-4 p-4 md:grid-cols-[3rem_minmax(0,1fr)_auto]"
            >
              <div className={['flex h-12 w-12 items-center justify-center rounded-xl', kind.bg].join(' ')}>
                <Icon className={['h-6 w-6', kind.color].join(' ')} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-gray-900">{kind.label}</p>
                  <span className={['shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', status.cls].join(' ')}>
                    {status.label}
                  </span>
                  {item.kind === 'parse' && (
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      {item.optimized ? '已生成优化版' : '未优化'}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-400">{kind.hint}</p>
                <p className="mt-0.5 truncate text-xs text-gray-400">{metaLine(item)}</p>
              </div>
              <div className="col-span-2 flex flex-wrap items-center justify-end gap-2 md:col-span-1 md:justify-start">
                {item.kind === 'parse' ? (
                  <>
                    <ActionButton
                      disabled={!actionable}
                      disabledReason={disabledReason}
                      icon={FileSearchIcon}
                      label="查看报告"
                      ariaLabel={`查看简历任务 ${taskLabel} 的诊断报告`}
                      onClick={() => openReport(item.taskId)}
                    />
                    <ActionButton
                      disabled={!actionable}
                      disabledReason={disabledReason}
                      icon={SparklesIcon}
                      label={item.optimized ? '查看优化版' : '继续优化'}
                      ariaLabel={`${item.optimized ? '查看' : '继续生成'}简历任务 ${taskLabel} 的优化版`}
                      onClick={() => openOptimize(item.taskId)}
                    />
                    <ActionButton
                      disabled={!actionable}
                      disabledReason={disabledReason}
                      icon={TargetIcon}
                      label="岗位匹配"
                      ariaLabel={`为简历任务 ${taskLabel} 查看岗位匹配参考`}
                      onClick={() => openJobFit(item.taskId)}
                    />
                  </>
                ) : (
                  <ActionButton
                    disabled={!actionable}
                    disabledReason={disabledReason}
                    icon={PrinterIcon}
                    label="查看并打印"
                    ariaLabel={`查看并打印 AI 生成简历任务 ${taskLabel}`}
                    onClick={() => openGenerate(item.taskId)}
                  />
                )}
              </div>
            </Card>
          )
        })
      )}
      {items.length > 0 && (
        <p className="mt-1 text-center text-xs text-gray-400">
          仅展示本人简历元数据；原始简历短留存，到期后无法恢复，不向企业提供或投递
          {total > items.length ? `；当前显示最近 ${items.length} / ${total} 条` : ''}
        </p>
      )}
    </MeListShell>
  )
}

function ActionButton({
  disabled,
  disabledReason,
  icon: Icon,
  label,
  ariaLabel,
  onClick,
}: {
  disabled: boolean
  disabledReason: string
  icon: LucideIcon
  label: string
  ariaLabel: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? disabledReason : label}
      aria-label={disabled ? `${ariaLabel}（${disabledReason}）` : ariaLabel}
      className={[
        'inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary-100',
        disabled
          ? 'cursor-not-allowed border-gray-100 bg-gray-50 text-gray-300'
          : 'border-gray-200 bg-white text-gray-600 hover:bg-primary-50 hover:text-primary-700',
      ].join(' ')}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
      {!disabled && <ArrowUpRightIcon className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  )
}
