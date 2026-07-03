// ============================================================
// AI 服务记录 — /me/ai-records（本人，仅元数据）。
// 不展示简历原文 / payload / 诊断正文；删除本人记录走既有硬删与审计链路。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card } from '@ai-job-print/ui'
import type { JobAiSessionListItem, MemberAiRecordItem, MemberAiRecordKind } from '@ai-job-print/shared'
import { BrainCircuitIcon, FileSearchIcon, SparklesIcon, Trash2Icon, type LucideIcon } from 'lucide-react'
import { deleteMyAiRecord, getMyAiRecords } from '../../../services/api/memberAssets'
import { deleteMyJobAiSession, listMyJobAiSessions } from '../../../services/api/jobAi'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'
import { JobAiSessionRecords } from './JobAiSessionRecords'

const KIND_META: Record<MemberAiRecordKind, { label: string; hint: string; icon: LucideIcon; bg: string; color: string }> = {
  parse: { label: '简历诊断', hint: '上传简历后的诊断记录', icon: FileSearchIcon, bg: 'bg-primary-50', color: 'text-primary-600' },
  optimize: { label: '简历优化', hint: '基于诊断生成的优化建议', icon: SparklesIcon, bg: 'bg-violet-50', color: 'text-violet-600' },
  generate: { label: 'AI 简历生成', hint: 'AI 引导生成的简历记录', icon: SparklesIcon, bg: 'bg-blue-50', color: 'text-blue-600' },
  job_fit: { label: '岗位匹配参考', hint: '仅供求职准备参考', icon: FileSearchIcon, bg: 'bg-sky-50', color: 'text-sky-600' },
  career_plan: { label: '职业规划建议', hint: '阶段性行动建议记录', icon: FileSearchIcon, bg: 'bg-emerald-50', color: 'text-emerald-600' },
  fair_visit_plan: { label: '招聘会准备单', hint: '基于招聘会公开信息生成', icon: SparklesIcon, bg: 'bg-amber-50', color: 'text-amber-600' },
  job_master: { label: '岗位决策分析', hint: '岗位大师决策参考报告', icon: BrainCircuitIcon, bg: 'bg-indigo-50', color: 'text-indigo-600' },
}

const UNKNOWN_KIND_META = {
  label: 'AI 服务记录',
  hint: '本人 AI 服务元数据',
  icon: SparklesIcon,
  bg: 'bg-gray-50',
  color: 'text-gray-500',
}

const STATUS_META: Record<MemberAiRecordItem['status'], { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'bg-amber-50 text-amber-600' },
  processing: { label: '处理中', cls: 'bg-blue-50 text-blue-600' },
  completed: { label: '已完成', cls: 'bg-emerald-50 text-emerald-600' },
  failed: { label: '失败', cls: 'bg-red-50 text-red-600' },
}

function shortTaskId(taskId: string): string {
  return taskId.length > 10 ? `${taskId.slice(0, 6)}...${taskId.slice(-4)}` : taskId
}

function metaLine(item: MemberAiRecordItem): string {
  const expires = item.expiresAt ? ` · 留存至 ${formatTime(item.expiresAt)}` : ''
  return `${item.provider} · 任务 ${shortTaskId(item.taskId)} · ${formatTime(item.createdAt)}${expires}`
}

export function MyAiRecordsPage() {
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberAiRecordItem[]>([])
  const [jobAiSessions, setJobAiSessions] = useState<JobAiSessionListItem[]>([])
  const [state, setState] = useState<MeListState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmJobAiSessionId, setConfirmJobAiSessionId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyJobAiSessionId, setBusyJobAiSessionId] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const mountedRef = useRef(false)
  const loadSeqRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadSeqRef.current += 1
    }
  }, [])

  const load = useCallback(() => {
    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq

    if (!isLoggedIn) {
      setItems([])
      setJobAiSessions([])
      setState('ready')
      return
    }
    setState('loading')
    const token = getToken()
    Promise.all([
      getMyAiRecords(token, { pageSize: 50 }),
      listMyJobAiSessions(token, { pageSize: 50 }),
    ])
      .then(([recordsPage, sessionsPage]) => {
        if (!mountedRef.current || loadSeqRef.current !== seq) return
        setItems(recordsPage.items)
        setJobAiSessions(sessionsPage.items)
        setState('ready')
      })
      .catch(() => {
        if (!mountedRef.current || loadSeqRef.current !== seq) return
        setState('error')
      })
  }, [getToken, isLoggedIn])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 3000)
    return () => clearTimeout(t)
  }, [hint])

  useEffect(() => {
    if (!confirmId) return
    const t = setTimeout(() => setConfirmId(null), 3500)
    return () => clearTimeout(t)
  }, [confirmId])

  useEffect(() => {
    if (!confirmJobAiSessionId) return
    const t = setTimeout(() => setConfirmJobAiSessionId(null), 3500)
    return () => clearTimeout(t)
  }, [confirmJobAiSessionId])

  const remove = async (recordId: string) => {
    if (confirmId !== recordId) {
      setConfirmId(recordId)
      return
    }
    const token = getToken()
    if (!token) return
    setBusyId(recordId)
    try {
      const result = await deleteMyAiRecord(token, recordId)
      setItems((prev) => prev.filter((item) => item.id !== recordId))
      setConfirmId(null)
      setHint(result.deletedCount > 1 ? '记录及关联优化结果已删除' : '记录已删除')
    } catch {
      setHint('删除失败，记录可能已到期或被清理')
    } finally {
      setBusyId(null)
    }
  }

  const removeJobAiSession = async (sessionId: string) => {
    if (confirmJobAiSessionId !== sessionId) {
      setConfirmJobAiSessionId(sessionId)
      return
    }
    const token = getToken()
    if (!token) return
    setBusyJobAiSessionId(sessionId)
    try {
      await deleteMyJobAiSession(token, sessionId)
      setJobAiSessions((prev) => prev.filter((item) => item.session.id !== sessionId))
      setConfirmJobAiSessionId(null)
      setHint('岗位 AI 参考记录已删除')
    } catch {
      setHint('删除失败，记录可能已到期或被清理')
    } finally {
      setBusyJobAiSessionId(null)
    }
  }

  return (
    <>
      {hint && (
        <div role="status" className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-neutral-900/90 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          {hint}
        </div>
      )}

      <MeListShell
        title="AI服务记录"
        subtitle="本人 AI 简历、岗位匹配、职业规划与参会准备服务记录（仅元数据）"
        loginFrom="/me/ai-records"
        isLoggedIn={isLoggedIn}
        state={state}
        onRetry={() => setReloadKey((k) => k + 1)}
        isEmpty={items.length === 0 && jobAiSessions.length === 0}
        emptyIcon={SparklesIcon}
        emptyTitle="还没有 AI 服务记录"
        emptyDescription="完成简历诊断、优化、岗位 AI 参考、职业规划或参会准备后，这里会显示记录"
      >
        <JobAiSessionRecords
          items={jobAiSessions}
          confirmId={confirmJobAiSessionId}
          busyId={busyJobAiSessionId}
          onDelete={(sessionId) => void removeJobAiSession(sessionId)}
        />

        {items.length > 0 && (
          <div className="pt-1">
            <h2 className="text-sm font-semibold text-gray-900">简历与规划 AI 记录</h2>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">仅展示本人 AI 服务元数据，不展示简历原文、诊断正文或文件内容。</p>
          </div>
        )}

        {items.map((item) => {
          const kind = KIND_META[item.kind] ?? UNKNOWN_KIND_META
          const status = STATUS_META[item.status]
          const Icon = kind.icon
          const confirming = confirmId === item.id
          return (
            <Card key={item.id} className="flex items-center gap-4 p-4">
              <div className={['flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', kind.bg].join(' ')}>
                <Icon className={['h-6 w-6', kind.color].join(' ')} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-gray-900">{kind.label}</p>
                  <span className={['shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', status.cls].join(' ')}>
                    {status.label}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-400">{kind.hint}</p>
                <p className="mt-0.5 truncate text-xs text-gray-400">{metaLine(item)}</p>
              </div>
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => void remove(item.id)}
                title={confirming ? '再次点击确认删除' : '删除'}
                aria-label={confirming ? '再次点击确认删除 AI 服务记录' : '删除 AI 服务记录'}
                className={[
                  'flex h-12 shrink-0 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors',
                  confirming
                    ? 'border-red-300 bg-red-50 text-red-600'
                    : 'border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-500',
                ].join(' ')}
              >
                <Trash2Icon className="h-4 w-4" aria-hidden="true" />
                {confirming && <span className="ml-1">确认删除</span>}
              </button>
            </Card>
          )
        })}
        <p className="mt-1 text-center text-xs text-gray-400">仅展示本人 AI 服务元数据，不展示简历原文、诊断正文或文件内容</p>
      </MeListShell>
    </>
  )
}
