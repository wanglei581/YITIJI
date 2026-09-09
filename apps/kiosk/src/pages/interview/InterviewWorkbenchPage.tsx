import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { InterviewReportPage } from './InterviewReportPage'
import { InterviewReportsPage } from './InterviewReportsPage'
import { InterviewSessionPage } from './InterviewSessionPage'
import { InterviewSetupPage } from './InterviewSetupPage'
import { InterviewTipsPage } from './InterviewTipsPage'
import {
  parseInterviewStage,
  resolveInterviewView,
  type InterviewStage,
} from './interviewWorkbenchModel'
import { readInterviewWorkbenchSession } from './interviewWorkbenchSession'

/**
 * 青序流光 29-interview-training：设置 / 作答 / 报告 / 技巧 / 记录同页分阶段。
 * 阶段切换只 replace `?stage=`，不推新的历史条目。
 * 首屏从 sessionStorage 复水，看门狗 reload 后仍停在用户原来的阶段。
 */
export function InterviewWorkbenchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = parseInterviewStage(searchParams.get('stage'))
  const stored = readInterviewWorkbenchSession()
  const view = useMemo(
    () => resolveInterviewView({ requested, storedStage: stored?.stage ?? null }),
    [requested, stored?.stage],
  )

  useEffect(() => {
    if (requested === view) return
    // 没带 ?stage= 进来（首屏 / 复水）时补上当前阶段。
    // 一律 replace：阶段纠正不是用户的一次导航，不该进历史。
    setSearchParams({ stage: view }, { replace: true })
  }, [requested, view, setSearchParams])

  const go = (stage: InterviewStage) => {
    setSearchParams({ stage }, { replace: true })
  }

  return (
    <div data-interview-workbench="" data-interview-stage={view} style={{ display: 'contents' }}>
      {view === 'session' ? (
        <InterviewSessionPage onGoStage={go} />
      ) : view === 'report' ? (
        <InterviewReportPage onGoStage={go} />
      ) : view === 'tips' ? (
        <InterviewTipsPage onGoStage={go} />
      ) : view === 'reports' ? (
        <InterviewReportsPage onGoStage={go} />
      ) : (
        <InterviewSetupPage onGoStage={go} />
      )}
    </div>
  )
}
