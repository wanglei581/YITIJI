// ============================================================
// 面试报告 — 历史练习记录入口（2C）。
//
// 登录会员：真实列表（/me/mock-interviews，游标分页）+ 查看 / 删除（两步确认）。
// 游客：诚实空态 + 引导（匿名报告短期有效，不做跨会话列表）。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { MemberInterviewItem } from '@ai-job-print/shared'
import { EyeIcon, FileSearchIcon, LogInIcon, Trash2Icon } from 'lucide-react'
import { deleteMyInterview, getMyInterviews } from '../../services/api/interview'
import { useAuth } from '../../auth/useAuth'
import { InterviewTopbar } from './InterviewTopbar'
import './interview-service-desk.css'

function formatTime(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function InterviewReportsPage() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberInterviewItem[]>([])
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setState('ready')
      return
    }
    setState('loading')
    getMyInterviews(getToken())
      .then((r) => {
        setItems(r.items)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [isLoggedIn, getToken])

  useEffect(() => { load() }, [load, reloadKey])

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 3000)
    return () => clearTimeout(t)
  }, [hint])

  const handleDelete = async (sessionId: string) => {
    if (confirmId !== sessionId) {
      setConfirmId(sessionId)
      return
    }
    setConfirmId(null)
    const token = getToken()
    if (!token) return
    try {
      await deleteMyInterview(token, sessionId)
      setItems((prev) => prev.filter((x) => x.sessionId !== sessionId))
      setHint('练习记录已删除')
    } catch {
      setHint('删除失败，请稍后重试')
    }
  }

  return (
    <div className="interview-flow interview-reports" data-visual-theme="service-desk" data-ux-density="touch">
      <InterviewTopbar />
      <PageHeader
        className="interview-pagehead"
        title="面试报告"
        subtitle="模拟面试练习的历史报告，仅本人可见 · 模拟练习，仅供参考"
        actions={
          <div className="flex gap-2">
            {isLoggedIn && (
              <Button size="sm" variant="secondary" onClick={() => navigate('/profile')}>
                AI服务记录
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => navigate('/')}>返回</Button>
          </div>
        }
      />

      {hint && (
        <div role="status" className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-neutral-900/90 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          {hint}
        </div>
      )}

      <div className="interview-flow__scroll flex-1 overflow-y-auto pb-8">
        {!isLoggedIn ? (
          <Card className="interview-card interview-reports__guest flex flex-col items-center gap-4 p-10 text-center">
            <FileSearchIcon className="h-10 w-10 text-neutral-300" aria-hidden="true" />
            <div>
              <p className="text-base font-semibold text-neutral-900">登录后可保存练习报告</p>
              <p className="mt-1 text-sm text-neutral-500">
                游客模式的练习报告短期有效（约 2 小时）；登录后报告保存 7 天，可随时回看与打印
              </p>
            </div>
            <div className="flex gap-3">
              <Button size="lg" className="h-14 px-6" onClick={() => navigate('/login', { state: { from: '/interview/reports' } })}>
                <LogInIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />
                手机号登录
              </Button>
              <Button size="lg" variant="secondary" className="h-14 px-6" onClick={() => navigate('/interview/setup')}>
                开始模拟面试
              </Button>
            </div>
          </Card>
        ) : state === 'loading' ? (
          <LoadingState className="py-20" />
        ) : state === 'error' ? (
          <ErrorState className="py-20" onRetry={() => setReloadKey((k) => k + 1)} />
        ) : items.length === 0 ? (
          <Card className="interview-card p-4">
            <EmptyState
              icon={FileSearchIcon}
              title="还没有练习报告"
              description="完成一次模拟面试后，这里会展示你的练习报告"
              className="py-12"
              action={<Button size="lg" className="h-14 px-8" onClick={() => navigate('/interview/setup')}>开始模拟面试</Button>}
            />
          </Card>
        ) : (
          <div className="interview-reports__list flex flex-col gap-3">
            {items.map((it) => (
              <Card key={it.sessionId} className="interview-card interview-reports__row flex items-center gap-4 p-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-plum-soft">
                  <FileSearchIcon className="h-6 w-6 text-plum" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-neutral-900">{it.position} · {it.interviewerLabel}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {it.industry} · {it.durationMin} 分钟练习 · {formatTime(it.createdAt)}
                  </p>
                </div>
                {it.hasReport && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-12 shrink-0"
                    onClick={() => navigate('/interview/report', { state: { sessionId: it.sessionId } })}
                  >
                    <EyeIcon className="mr-1 h-4 w-4" aria-hidden="true" />
                    查看
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => void handleDelete(it.sessionId)}
                  title={confirmId === it.sessionId ? '再次点击确认删除' : '删除'}
                  aria-label="删除练习记录"
                  className={[
                    'flex h-12 shrink-0 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors',
                    confirmId === it.sessionId
                      ? 'border-error/40 bg-error-bg text-error-fg'
                      : 'border-neutral-200 text-neutral-400 hover:bg-error-bg hover:text-error-fg',
                  ].join(' ')}
                >
                  <Trash2Icon className="h-4 w-4" aria-hidden="true" />
                  {confirmId === it.sessionId && <span className="ml-1">确认删除</span>}
                </button>
              </Card>
            ))}
            <p className="mt-1 text-center text-xs text-neutral-400">报告保存 7 天后自动清理；删除为物理删除并留删除日志</p>
          </div>
        )}
      </div>
    </div>
  )
}
