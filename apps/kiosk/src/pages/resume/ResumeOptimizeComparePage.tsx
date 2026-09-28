import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ResumeOptimizeModule } from '@ai-job-print/shared'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import { QxAiHelp, QxStepActions } from '../../components/qingxu/QxAiHelp'
import { ResumeOptimizeNavbar } from './components/resume-deliver/ResumeOptimizeNavbar'
import { resumeUserReason } from './resumeUserCopy'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useAuth } from '../../auth/useAuth'
import { aiErrorMessageOf, isAiOutage } from '../../ai'
import { getResumeOptimize } from '../../services/api'
import { readAiResumeSession } from './aiResumeSession'
import { ResumeCompareBatchBar } from './components/resume-compare/ResumeCompareBatchBar'
import { ResumeCompareCard } from './components/resume-compare/ResumeCompareCard'
import { ResumeCompareDraft } from './components/resume-compare/ResumeCompareDraft'
import { ResumeCompareState } from './components/resume-compare/ResumeCompareState'
import {
  adoptEligible,
  decisionStats,
  buildCompareItems,
  keepUndecided,
  moduleKeyOf,
  initialDecisionsFrom,
  type ResumeCompareDecision,
  type ResumeCompareDecisions,
} from './components/resume-compare/resumeCompareModel'
import './resume-optimize-compare.css'
import './resume-r1-qx2.css'

const OPTIMIZE_ROUTE = '/resume/optimize'
const UNSAVED_NOTICE =
  '选择是阅读决策，未保存、未生成文件；返回优化页时可以选择是否应用到编辑区。只有编辑区的内容会进入导出。'

export function ResumeOptimizeComparePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = location.state as Record<string, unknown> | null
  const existingOnly = new URLSearchParams(location.search).get('saved') === '1' || new URLSearchParams(location.search).get('existingOnly') === '1' || state?.existingOnly === true
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
  // 从总览点某一条进来时，直接停在那一条（state.focusIndex）；没带或越界就从第 1 条开始。
  const [currentIndex, setCurrentIndex] = useState(() => {
    const focus = typeof state?.focusIndex === 'number' ? Math.floor(state.focusIndex) : 0
    return focus > 0 ? focus : 0
  })
  const [decisions, setDecisions] = useState<ResumeCompareDecisions>(() => initialDecisionsFrom(state))
  const [confirmedByModule, setConfirmedByModule] = useState<Record<string, string[]>>({})
  const [customByModule, setCustomByModule] = useState<Record<string, string>>({})
  const [batchNote, setBatchNote] = useState<string | null>(null)

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
    setCustomByModule({})
    setBatchNote(null)
    getResumeOptimize(taskId, { token: getToken(), accessToken }, existingOnly)
      .then((response) => {
        if (cancelled) return
        setProviderName(response.providerName ?? null)
        if (response.status !== 'completed') {
          setFailure(resumeUserReason(response.failReason, '这次没有生成逐条改写候选。'))
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
  }, [taskId, accessToken, getToken, retryNonce, existingOnly])

  const items = useMemo(
    () => loadedTaskId === taskId ? buildCompareItems(modules) : [],
    [loadedTaskId, modules, taskId],
  )
  const stats = decisionStats(items, decisions)
  useEffect(() => {
    if (items.length > 0 && currentIndex >= items.length) setCurrentIndex(0)
  }, [items.length, currentIndex])
  const current = items[currentIndex]
  const keyAt = (index: number) => moduleKeyOf(items[index], index)
  const isDemoResult = providerName === 'mock'

  const backToOptimize = () => navigate(OPTIMIZE_ROUTE, {
    state: taskId ? { taskId, accessToken, decisions, ...(existingOnly ? { existingOnly: true } : {}) } : undefined,
  })
  const retry = () => {
    setLoadedTaskId(null)
    setRetryNonce((value) => value + 1)
  }

  const choose = (decision: ResumeCompareDecision) => {
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
        : { tone: 'ok' as const, label: '待本人选择' }
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
      title="逐条选择改法"
      subtitle={isDemoResult ? '演示内容不是你的简历原文。' : '左边原文，右边改写；选择是阅读决策，回优化页时再选择是否应用。'}
      status={pageStatus}
      terminalLabel="就业服务大厅"
      back={{ label: '返回简历优化工作台', onBack: backToOptimize }}
      navbar={<ResumeOptimizeNavbar />}
      ctabar={<>{ctabar}<QxStepActions onPrev={backToOptimize}><QxAiHelp label="问小青：这句还能怎么改 →" draft="我想把简历中的一句经历换个改法。请先让我提供原句，只整理真实内容，不添加数字或成果。" /></QxStepActions></>}
    >
      <section data-kiosk-domain="resume" data-kiosk-screen="resume-optimize-compare" data-route="/resume/optimize/compare" className="qx-scroll qx-resume-compare" data-takeaway="逐条选择改法，再编辑导出新简历">
        {isDemoResult && <p className="qxc-notice" data-tone="warn">{COMPLIANCE_COPY.KIOSK_RESUME_DEMO_NOTICE}</p>}
        <p className="qxc-notice" role="note">{UNSAVED_NOTICE}</p>
        {!taskId ? (
          <ResumeCompareState title="还没有可对照的简历" description="请先完成简历上传与解析，再查看逐条改写。" actionLabel="去上传简历" onAction={() => navigate('/resume/source?intent=optimize')} />
        ) : loading ? (
          <ResumeCompareState title="正在读取逐条改写" description="读取尚未完成，现在不展示候选内容。" busy />
        ) : outage ? (
          <ResumeCompareState title="AI 改写当前不可用" description={`${outage}。原文和优化页的手动编辑不受影响，本页不用通用建议冒充结果。`} actionLabel="重新读取" onAction={retry} />
        ) : failure || !current ? (
          <ResumeCompareState title="本次没有可对照的改写" description={failure ?? '服务没有返回可选择的逐条候选。'} actionLabel="重新读取" onAction={retry} />
        ) : (
          <>
            <div className="qx-r1-stats" aria-label="改写选择统计">
              <span>全部<b>{stats.total}</b></span><span>已采纳<b>{stats.adopt}</b></span><span>保留原文<b>{stats.keep}</b></span><span>自己写<b>{stats.custom}</b></span><span>待定<b>{stats.todo}</b></span>
            </div>
            <ResumeCompareBatchBar
              note={batchNote}
              onAdoptEligible={() => {
                const result = adoptEligible(items, confirmedByModule, decisions)
                setDecisions(result.next)
                setBatchNote(`已采纳 ${result.adopted} 条；跳过 ${result.skipped} 条 —— 那几条的改写里有原文没有的事实，要逐项确认后才能采纳。批量动作不会绕过这道拦截。`)
              }}
              onKeepUndecided={() => {
                const result = keepUndecided(items, decisions)
                setDecisions(result.next)
                setBatchNote(`已把 ${result.count} 条还没决定的记为「保留原文」。选择可以反复改，随时逐条回去重选。`)
              }}
              onClear={() => {
                setDecisions({})
                setConfirmedByModule({})
                setCustomByModule({})
                setBatchNote('已清空全部选择，连事实确认标记一起清掉 —— 回到刚读到建议时的样子。')
              }}
            />
            <ResumeCompareCard
              item={current}
              index={currentIndex}
              total={items.length}
              decision={decisions[keyAt(currentIndex)]}
              confirmed={confirmedByModule[keyAt(currentIndex)] ?? []}
              customText={customByModule[keyAt(currentIndex)] ?? ''}
              isDemoResult={isDemoResult}
              onExit={backToOptimize}
              onSaveCustom={(text) => {
                const key = keyAt(currentIndex)
                setCustomByModule((previous) => ({ ...previous, [key]: text }))
                setDecisions((previous) => ({ ...previous, [key]: 'custom' }))
              }}
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
            <ResumeCompareDraft
              items={items}
              decisions={decisions}
              confirmedByModule={confirmedByModule}
              customByModule={customByModule}
            />
          </>
        )}
      </section>
    </QxPageFrame>
  )
}
