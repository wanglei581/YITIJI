import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ResumeOptimizeModule } from '@ai-job-print/shared'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useAuth } from '../../auth/useAuth'
import { aiErrorMessageOf, isAiOutage } from '../../ai'
import { getResumeOptimize } from '../../services/api'
import { readAiResumeSession } from './aiResumeSession'
import { ResumeCompareCard } from './components/resume-compare/ResumeCompareCard'
import { ResumeCompareState } from './components/resume-compare/ResumeCompareState'
import {
  buildCompareItems,
  moduleKeyOf,
  initialDecisionsFrom,
  type ResumeCompareDecisions,
} from './components/resume-compare/resumeCompareModel'
import './resume-optimize-compare.css'

const OPTIMIZE_ROUTE = '/resume/optimize'
const UNSAVED_NOTICE =
  '裁决草稿只在本次页面流转，未保存、未生成文件；返回优化页后仍需在编辑区核对内容。'

export function ResumeOptimizeComparePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = location.state as Record<string, unknown> | null
  const session = useMemo(() => readAiResumeSession(), [])
  const queryTaskId = useMemo(
    () => new URLSearchParams(location.search).get('taskId') ?? undefined,
    [location.search],
  )
  const stateTaskId = typeof state?.taskId === 'string' ? state.taskId : undefined
  const taskId = stateTaskId ?? queryTaskId ?? session?.taskId
  const usingSessionTask = !stateTaskId && !queryTaskId && Boolean(session?.taskId)
  const accessToken =
    (typeof state?.accessToken === 'string' ? state.accessToken : undefined)
    ?? (usingSessionTask ? session?.accessToken : undefined)

  const [modules, setModules] = useState<ResumeOptimizeModule[]>([])
  const [loadedTaskId, setLoadedTaskId] = useState<string | null>(null)
  const [providerName, setProviderName] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(taskId))
  const [outage, setOutage] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [decisions, setDecisions] = useState<ResumeCompareDecisions>(() => initialDecisionsFrom(state))
  const [confirmedByModule, setConfirmedByModule] = useState<Record<string, string[]>>({})

  useEffect(() => {
    if (!taskId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setModules([])
    setLoadedTaskId(null)
    setProviderName(null)
    setOutage(null)
    setFailure(null)
    setCurrentIndex(0)
    setDecisions({})
    setConfirmedByModule({})
    getResumeOptimize(taskId, { token: getToken(), accessToken })
      .then((response) => {
        if (cancelled) return
        setProviderName(response.providerName ?? null)
        if (response.status !== 'completed') {
          setFailure(response.failReason || '这次没有生成逐条改写候选。')
          return
        }
        const nextModules = response.modules ?? []
        setModules(nextModules)
        setLoadedTaskId(taskId)
        setCurrentIndex((index) => Math.min(index, Math.max(0, nextModules.length - 1)))
        if (nextModules.length === 0) setFailure('这次没有生成逐条改写候选。')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (isAiOutage(error)) {
          setOutage(aiErrorMessageOf(error, 'AI 服务当前不可用'))
        } else {
          setFailure(aiErrorMessageOf(error, '优化结果读取失败'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [taskId, accessToken, getToken, retryNonce])

  const items = useMemo(
    () => loadedTaskId === taskId ? buildCompareItems(modules) : [],
    [loadedTaskId, modules, taskId],
  )
  const current = items[currentIndex]
  const keyAt = (index: number) => moduleKeyOf(items[index], index)
  const isDemoResult = providerName === 'mock'

  const backToOptimize = () => navigate(OPTIMIZE_ROUTE, {
    state: taskId ? { taskId, accessToken, decisions } : undefined,
  })
  const retry = () => {
    setLoadedTaskId(null)
    setRetryNonce((value) => value + 1)
  }

  const choose = (decision: 'original' | 'optimized') => {
    if (!current) return
    const key = keyAt(currentIndex)
    if (decision === 'optimized') {
      const confirmed = new Set(confirmedByModule[key] ?? [])
      if (current.additions.some((addition) => !confirmed.has(addition))) return
    }
    setDecisions((previous) => ({ ...previous, [key]: decision }))
  }

  const next = () => {
    if (!current || !decisions[keyAt(currentIndex)]) return
    if (currentIndex < items.length - 1) setCurrentIndex((index) => index + 1)
    else backToOptimize()
  }

  const currentUnconfirmed = current?.additions.some(
    (item) => !(confirmedByModule[keyAt(currentIndex)] ?? []).includes(item),
  ) ?? false
  const pageStatus = !taskId
    ? { tone: 'warn' as const, label: '缺少简历' }
    : loading
      ? { tone: 'unknown' as const, label: '读取中' }
      : outage || failure || !current
        ? { tone: 'warn' as const, label: '未取得候选' }
        : { tone: 'ok' as const, label: '待本人裁决' }
  const ctabar = current ? (
    <>
      <button type="button" className="qx-btn" data-variant="teal" aria-pressed={decisions[keyAt(currentIndex)] === 'optimized'} onClick={() => choose('optimized')} disabled={currentUnconfirmed} aria-disabled={currentUnconfirmed || undefined}>用改写</button>
      <button type="button" className="qx-btn" data-variant="ghost" aria-pressed={decisions[keyAt(currentIndex)] === 'original'} onClick={() => choose('original')}>保留原文</button>
      <button type="button" className="qx-btn" data-variant="primary" disabled={!decisions[keyAt(currentIndex)]} onClick={next}>下一条</button>
    </>
  ) : (
    <button type="button" className="qx-btn" data-variant="ghost" onClick={backToOptimize}>返回优化页</button>
  )

  return (
    <QxPageFrame
      title="逐条改写对照"
      subtitle={isDemoResult ? '演示内容不是你的简历原文。' : '左边原文，右边改写；一次只裁决一条。'}
      status={pageStatus}
      terminalLabel="就业服务大厅"
      ctabar={ctabar}
    >
      <section data-kiosk-domain="resume" data-kiosk-screen="resume-optimize-compare" data-route="/resume/optimize/compare" className="qx-scroll qx-resume-compare">
        {isDemoResult && <p className="qxc-notice" data-tone="warn">{COMPLIANCE_COPY.KIOSK_RESUME_DEMO_NOTICE}</p>}
        <p className="qxc-notice" role="note">{UNSAVED_NOTICE}</p>
        {!taskId ? (
          <ResumeCompareState title="还没有可对照的简历" description="请先完成简历上传与解析，再查看逐条改写。" actionLabel="去上传简历" onAction={() => navigate('/resume/source?intent=optimize')} />
        ) : loading ? (
          <ResumeCompareState title="正在读取逐条改写" description="读取尚未完成，现在不展示候选内容。" busy />
        ) : outage ? (
          <ResumeCompareState title="AI 改写当前不可用" description={`${outage}。原文和优化页的手动编辑不受影响，本页不用通用建议冒充结果。`} actionLabel="重新读取" onAction={retry} />
        ) : failure || !current ? (
          <ResumeCompareState title="本次没有可对照的改写" description={failure ?? '服务没有返回可裁决的逐条候选。'} actionLabel="重新读取" onAction={retry} />
        ) : (
          <ResumeCompareCard
            item={current}
            index={currentIndex}
            total={items.length}
            decision={decisions[keyAt(currentIndex)]}
            decisions={decisions}
            allItems={items}
            confirmed={confirmedByModule[keyAt(currentIndex)] ?? []}
            isDemoResult={isDemoResult}
            onExit={backToOptimize}
            onConfirm={(addition, checked) => setConfirmedByModule((previous) => {
              const key = keyAt(currentIndex)
              const nextConfirmed = new Set(previous[key] ?? [])
              if (checked) nextConfirmed.add(addition)
              else {
                nextConfirmed.delete(addition)
                setDecisions((currentDecisions) => {
                  if (currentDecisions[key] !== 'optimized') return currentDecisions
                  const nextDecisions = { ...currentDecisions }
                  delete nextDecisions[key]
                  return nextDecisions
                })
              }
              return { ...previous, [key]: [...nextConfirmed] }
            })}
            onPrevious={currentIndex > 0 ? () => setCurrentIndex((index) => index - 1) : undefined}
          />
        )}
      </section>
    </QxPageFrame>
  )
}
