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
  FileTextIcon,
} from 'lucide-react'
import { getMyResumes } from '../../../services/api/memberAssets'
import { useAuth } from '../../../auth/useAuth'
import { KIcon, type KioskIconName } from '../../../components/kiosk-icon'
import { useInkRipple } from '../../../hooks/useInkRipple'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'
import './me-detail-inkpaper.css'

const STATUS_META: Record<MemberResumeItem['status'], { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'is-warning' },
  processing: { label: '处理中', cls: 'is-muted' },
  completed: { label: '已完成', cls: 'is-active' },
  failed: { label: '失败', cls: 'is-danger' },
}

const KIND_META: Record<MemberResumeItem['kind'], { label: string; hint: string; icon: KioskIconName; tone: string }> = {
  parse: {
    label: '上传诊断简历',
    hint: '上传简历后生成的诊断记录',
    icon: 'doc-check',
    tone: 'teal',
  },
  generate: {
    label: 'AI 生成简历',
    hint: 'AI 引导生成的简历版本',
    icon: 'sparkle',
    tone: 'wheat',
  },
}

const UNKNOWN_STATUS = { label: '未知状态', cls: 'is-muted' }
const UNKNOWN_KIND = {
  label: '简历记录',
  hint: '本人简历服务记录',
  icon: 'resume' satisfies KioskIconName,
  tone: 'slate',
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
  useInkRipple('.me-inkdetail .me-ripple')

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

  const completedCount = items.filter((item) => item.status === 'completed').length
  const parseCount = items.filter((item) => item.kind === 'parse').length
  const generateCount = items.filter((item) => item.kind === 'generate').length

  return (
    <div className="me-inkdetail me-inkdetail-resumes h-full">
      <MeListShell
        title="我的简历"
        subtitle="本人上传诊断与 AI 生成的简历记录（仅元数据）"
        loginFrom="/me/resumes"
        isLoggedIn={isLoggedIn}
        state={state}
        onRetry={() => setReloadKey((k) => k + 1)}
        headerActions={
          <Button className="me-ripple" size="sm" variant="secondary" onClick={() => navigate('/resume/source')}>
            <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">
              <KIcon name="upload" />
            </span>
            去上传简历
          </Button>
        }
      >
        <section className="me-detail-summary" aria-label="简历记录概览">
          <span className="me-summary-icon me-tone-teal" aria-hidden="true">
            <KIcon name="resume" />
          </span>
          <div className="min-w-0 flex-1">
            <p>简历档案</p>
            <strong>{total}</strong>
            <span>仅展示本人简历服务元数据，不展示原文或诊断正文</span>
          </div>
          <div className="me-summary-mini" aria-label="简历记录数量">
            <span>诊断 {parseCount}</span>
            <span>生成 {generateCount}</span>
            <span>完成 {completedCount}</span>
          </div>
        </section>

        {items.length === 0 ? (
          <Card className="me-empty-card">
            <EmptyState
              icon={FileTextIcon}
              title="还没有登录后保存的简历"
              description="公共一体机上的游客上传不会自动绑定到账号；登录后上传、诊断或生成的简历会显示在这里"
              className="py-10"
            />
            <div className="mt-2 flex justify-center">
              <Button size="lg" className="me-ripple h-14 rounded-full px-8" onClick={() => navigate('/resume/source')}>
                <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">
                  <KIcon name="upload" />
                </span>
                去上传简历
              </Button>
            </div>
          </Card>
        ) : (
          items.map((item) => {
            const kind = KIND_META[item.kind] ?? UNKNOWN_KIND
            const status = STATUS_META[item.status] ?? UNKNOWN_STATUS
            const actionable = isActionable(item)
            const disabledReason = item.status === 'failed' ? '任务已失败，不可继续操作' : '任务完成后可用'
            const taskLabel = shortTaskId(item.taskId)
            return (
              <Card key={item.id} className="me-benefit-card">
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <span className={['me-row-icon', `me-tone-${kind.tone}`].join(' ')} aria-hidden="true">
                    <KIcon name={kind.icon} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="me-row-title">{kind.label}</span>
                      <span className={['me-status', status.cls].join(' ')}>{status.label}</span>
                      {item.kind === 'parse' && (
                        <span className="me-chip">{item.optimized ? '已生成优化版' : '未优化'}</span>
                      )}
                    </div>
                    <p className="me-row-meta">{kind.hint}</p>
                    <p className="mt-1 truncate text-xs text-[color:var(--muted)]">{metaLine(item)}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 md:justify-start">
                    {item.kind === 'parse' ? (
                      <>
                        <ActionButton
                          disabled={!actionable}
                          disabledReason={disabledReason}
                          icon="doc-check"
                          label="查看报告"
                          ariaLabel={`查看简历任务 ${taskLabel} 的诊断报告`}
                          onClick={() => openReport(item.taskId)}
                        />
                        <ActionButton
                          disabled={!actionable}
                          disabledReason={disabledReason}
                          icon="sparkle"
                          label={item.optimized ? '查看优化版' : '继续优化'}
                          ariaLabel={`${item.optimized ? '查看' : '继续生成'}简历任务 ${taskLabel} 的优化版`}
                          onClick={() => openOptimize(item.taskId)}
                        />
                        <ActionButton
                          disabled={!actionable}
                          disabledReason={disabledReason}
                          icon="briefcase"
                          label="岗位匹配"
                          ariaLabel={`为简历任务 ${taskLabel} 查看岗位匹配参考`}
                          onClick={() => openJobFit(item.taskId)}
                        />
                      </>
                    ) : (
                      <ActionButton
                        disabled={!actionable}
                        disabledReason={disabledReason}
                        icon="printer"
                        label="查看并打印"
                        ariaLabel={`查看并打印 AI 生成简历任务 ${taskLabel}`}
                        onClick={() => openGenerate(item.taskId)}
                      />
                    )}
                  </div>
                </div>
              </Card>
            )
          })
        )}
        {items.length > 0 && (
          <p className="me-legal-note">
            仅展示本人简历元数据；原始简历短留存，到期后无法恢复，不向企业提供或投递
            {total > items.length ? `；当前显示最近 ${items.length} / ${total} 条` : ''}
          </p>
        )}
      </MeListShell>
    </div>
  )
}

function ActionButton({
  disabled,
  disabledReason,
  icon,
  label,
  ariaLabel,
  onClick,
}: {
  disabled: boolean
  disabledReason: string
  icon: KioskIconName
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
        'me-ripple me-resume-action inline-flex items-center gap-1.5 overflow-hidden rounded-full border px-3 text-xs font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-primary-100',
        disabled
          ? 'cursor-not-allowed border-[rgba(16,48,43,0.08)] bg-[rgba(16,48,43,0.04)] text-[color:var(--muted)] opacity-55'
          : 'border-[rgba(16,48,43,0.12)] bg-[rgba(255,253,248,0.78)] text-[color:var(--ink-2)] hover:bg-[rgba(16,48,43,0.08)] hover:text-[color:var(--ink)]',
      ].join(' ')}
    >
      <span className="inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
        <KIcon name={icon} />
      </span>
      {label}
      {!disabled && (
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center" aria-hidden="true">
          <KIcon name="arrow" />
        </span>
      )}
    </button>
  )
}
