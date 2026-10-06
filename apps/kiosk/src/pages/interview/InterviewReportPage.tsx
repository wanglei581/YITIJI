// ============================================================
// 模拟面试 — 练习报告页（2C）。
//
// 数据：路由 state（刚结束）或凭 sessionId+凭证从服务端读回（会员历史/刷新）。
// 操作：打印报告（服务端真实 PDF → 既有打印链路）、重新练习。
// 合规：不显示等级、不写岗位匹配；固定免责说明，只给本人复盘。
// ============================================================

import { useEffect, useState } from 'react'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useLocation, useNavigate } from 'react-router-dom'
import { ComplianceBanner } from '@ai-job-print/ui'
import type { InterviewReportResponse } from '@ai-job-print/shared'

type InterviewQaExcerpt = {
  question: string
  answerExcerpt: string | null
  skipped: boolean
}

type InterviewReportView = InterviewReportResponse & {
  qaExcerpts?: InterviewQaExcerpt[]
  includeAnswersInPrint?: boolean
}
import { AI_LABEL_COPY, COMPLIANCE_COPY } from '@ai-job-print/shared'
import { getInterviewReport, printInterviewReport } from '../../services/api/interview'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { QxAiHelp, QxStepActions } from '../../components/qingxu/QxAiHelp'
import { InterviewShell } from './InterviewShell'
import { InterviewCardHead, InterviewNotice, InterviewRail, InterviewStatus } from './interviewQxParts'
import { INTERVIEW_STAGE_COPY, emphasizedTitle, type InterviewStage } from './interviewWorkbenchModel'
import {
  patchInterviewWorkbenchSession,
  readInterviewWorkbenchSession,
} from './interviewWorkbenchSession'
import { useStartPrintHandoff } from '../print/usePrintHandoff'
import './interview-service-desk.css'
import './styles/interview-workbench-qx.css'
import './styles/interview-qx2.css'

const REPORT_AI_DRAFT = '我刚完成一场模拟面试，想看懂练习报告。请先问我想看的部分，再说明这只供我自己复盘，不要预测录用。'

interface ReportState {
  sessionId?: string
  accessToken?: string
  report?: InterviewReportView
}

function Lines({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((item, index) => (
        <li key={`${index}-${item.slice(0, 24)}`}>{item}</li>
      ))}
    </ul>
  )
}

export function InterviewReportPage({ onGoStage }: { onGoStage?: (stage: InterviewStage) => void } = {}) {
  const navigate = useNavigate()
  const startPrint = useStartPrintHandoff()
  const location = useLocation()
  const { getToken } = useAuth()
  const storedReport = readInterviewWorkbenchSession()?.report
  const locationState = (location.state ?? {}) as ReportState
  const state: ReportState = {
    sessionId: locationState.sessionId ?? storedReport?.sessionId,
    accessToken: locationState.accessToken ?? storedReport?.accessToken,
    report: locationState.report,
  }

  const [data, setData] = useState<InterviewReportView | null>(state.report ?? null)
  const [loading, setLoading] = useState(!state.report && !!state.sessionId)
  const [loadError, setLoadError] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState<string | null>(null)

  useBusyLock(printing)

  useEffect(() => {
    if (data || !state.sessionId) return
    let cancelled = false
    getInterviewReport(state.sessionId, { token: getToken(), accessToken: state.accessToken })
      .then((r) => { if (!cancelled) setData(r) })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [data, state.sessionId, state.accessToken, getToken])

  useEffect(() => {
    if (!state.sessionId) return
    patchInterviewWorkbenchSession({
      stage: 'report',
      report: { sessionId: state.sessionId, accessToken: state.accessToken },
    })
  }, [state.sessionId, state.accessToken])

  const handlePrint = async () => {
    if (!data) return
    setPrinting(true)
    setPrintError(null)
    try {
      const file = await printInterviewReport(data.sessionId, { token: getToken(), accessToken: state.accessToken })
      if (!file.printFileUrl) throw new Error('打印链接未就绪，请稍后重试')
      startPrint({
        origin: 'interview_report',
        returnPath: window.location.pathname,
        file: {
          name: file.filename,
          size: file.sizeBytes >= 1024 * 1024 ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`,
          pages: file.pageCount,
          fileId: file.fileId,
          fileUrl: file.printFileUrl,
          mimeType: 'application/pdf',
        },
      })
    } catch (err) {
      setPrintError(userMessageOf(err, '打印版生成失败，请稍后重试'))
    } finally {
      setPrinting(false)
    }
  }

  const goSetup = () => onGoStage ? onGoStage('setup') : navigate('/interview/setup')
  const goReports = () => onGoStage ? onGoStage('reports') : navigate('/interview/reports')

  if (loading) {
    return (
      <InterviewShell
        title={<>正在核对<em>报告状态</em>。</>}
        subtitle="报告只按这场练习读取。读取完成前不展示上一次内容，也不提前放开打印。"
        status={{ tone: 'unknown', label: '正在读取' }}
        ctabar={
          <div className="interview-qx-cta">
            <QxStepActions>
              <QxAiHelp label="问小青：报告还在读取怎么办" draft="练习报告还在读取。请说明我可以先做什么，不要假装报告已经生成。" />
            </QxStepActions>
          </div>
        }
      >
        <div data-kiosk-domain="interview" data-kiosk-screen="interview-report" data-qx-interview="" className="interview-flow interview-state-page" data-visual-theme="service-desk" data-ux-density="touch">
          <div className="interview-flow__scroll">
            <InterviewStatus label="报告读取状态" items={[{ k: '报告内容', v: '读取中' }, { k: '打印版', v: '未生成' }, { k: '录用预测', v: '不提供' }]} />
            <section className="iv-card iv-empty"><div><h2>正在读取本场练习报告</h2><p>读取完成前，这里不展示上一次的内容。</p></div></section>
          </div>
        </div>
      </InterviewShell>
    )
  }
  if (loadError || !data) {
    return (
      <InterviewShell
        title={<>这份报告暂时<em>不能查看</em>。</>}
        subtitle="报告可能还没生成、已经过期，或当前账号不能查看；不能用固定内容替代实际结果。"
        status={{ tone: 'bad', label: '报告不可用' }}
        ctabar={
          <div className="interview-qx-cta">
            <div className="iv-cta-row">
              <button type="button" className="qx-btn" data-variant="ghost" onClick={goReports}>查看报告历史</button>
              <button type="button" className="qx-btn" data-variant="primary" onClick={goSetup}>重新开始练习<em aria-hidden="true">→</em></button>
            </div>
          </div>
        }
      >
      <div data-kiosk-domain="interview" data-kiosk-screen="interview-report" data-qx-interview="" className="interview-flow interview-state-page" data-visual-theme="service-desk" data-ux-density="touch">
        <div className="interview-flow__scroll">
          <section className="iv-card iv-empty is-bad">
            <div>
              <h2>报告不存在或已过期</h2>
              <p>没有真实报告时，不显示评分、打印成功或可下载文件。</p>
            </div>
          </section>
        </div>
      </div>
      </InterviewShell>
    )
  }

  const copy = INTERVIEW_STAGE_COPY.report
  const titleParts = emphasizedTitle(copy)

  return (
    <InterviewShell
      title={<>{titleParts.before}<em>{titleParts.em}</em>{titleParts.after}</>}
      subtitle={`${data.position} · ${data.industry} · ${data.interviewerLabel}。只用于本人复盘，不代表通过率或录用结果。`}
      ctabar={
        <div className="interview-qx-cta">
          <QxStepActions onPrev={goReports} prevLabel="查看历史报告">
            <QxAiHelp label="问小青：这份练习报告怎么看" draft={REPORT_AI_DRAFT} />
          </QxStepActions>
          <div className="iv-history-actions">
            <button type="button" className="qx-btn" data-variant="ghost" onClick={goSetup}>重新练习</button>
            <button
              type="button"
              className="qx-btn"
              data-variant="primary"
              data-testid="interview-primary"
              disabled={printing}
              onClick={() => void handlePrint()}
            >
              {printing ? '正在生成打印版…' : '生成打印版'}
            </button>
          </div>
        </div>
      }
    >
    <div data-kiosk-domain="interview" data-kiosk-screen="interview-report" data-qx-interview="" className="interview-flow interview-report" data-visual-theme="service-desk" data-ux-density="touch">

      <div className="interview-flow__scroll">
        <p className="iv-copy">{COMPLIANCE_COPY.INTERVIEW_PRACTICE_RESULT_DISCLAIMER}</p>
        <InterviewStatus
          label="报告与打印状态"
          items={[
            { k: '报告内容', v: '可以查看', tone: 'ok' },
            { k: '打印版', v: printing ? '生成中' : printError ? '没有生成' : '还没有', tone: printError ? 'off' : undefined },
            { k: '录用预测', v: '不提供' },
          ]}
        />
        {/* 横幅以 AI 可见标识开头（审计表一「模拟面试报告（一体机）」，next-tasks 3.5c）。 */}
        <ComplianceBanner tone="info">
          <b>{AI_LABEL_COPY.INTERVIEW_REPORT}。</b>不代表任何招聘结果，不参与企业筛选、面试邀约或录用决策，也不会发送给任何企业。
        </ComplianceBanner>

        <section className="iv-card">
          <InterviewCardHead title="本场练习报告" hint="AI 生成 · 供参考" />
          <p className="iv-copy">{data.report.overall.summary}</p>
        </section>

        <section className="iv-report-grid" aria-label="报告概览" data-testid="interview-report-overview">
          <div>
            <i aria-hidden="true">总</i>
            <b>综合表现概览</b>
            <p>{data.report.overall.summary}</p>
          </div>
          <div>
            <i aria-hidden="true">5</i>
            <b>五项能力维度</b>
            <p>
              表达 {data.report.expression.length} 条，岗位对照 {data.report.positionFit.length} 条，经历 {data.report.credibility.length} 条，专业 {data.report.professional.length} 条，应变 {data.report.adaptability.length} 条。
            </p>
          </div>
          <div>
            <i aria-hidden="true">问</i>
            <b>下一轮准备</b>
            <p>
              风险 {data.report.risks.length} 条，高频问题 {data.report.predictedQuestions.length} 题，准备清单 {data.report.checklist.length} 条。
            </p>
          </div>
        </section>

        <section className="iv-card">
          <InterviewCardHead title="五项能力" hint="按本场已确认的回答归纳" />
          <div className="iv-mini-list">
            <div>
              <h2>表达清晰度</h2>
              <Lines items={data.report.expression} />
            </div>
            <div>
              <h2>和目标岗位要求的对照</h2>
              <Lines items={data.report.positionFit} />
            </div>
            <div>
              <h2>经历可信度与细节</h2>
              <Lines items={data.report.credibility} />
            </div>
            <div>
              <h2>专业能力表现</h2>
              <Lines items={data.report.professional} />
            </div>
            <div>
              <h2>沟通与应变能力</h2>
              <Lines items={data.report.adaptability} />
            </div>
          </div>
        </section>

        <section className="iv-card" data-testid="interview-report-review">
          <InterviewCardHead title="报告包含的复盘区" hint="按实际结果填写" />
          <div className="iv-mini-list">
            <div>
              <small>风险点</small>
              <Lines items={data.report.risks} />
            </div>
            <div>
              <small>高频问题</small>
              {data.report.predictedQuestions.map((q, i) => (
                <div key={`${i}-${q.question.slice(0, 24)}`} className="iv-q">
                  <p>{i + 1}. {q.question}</p>
                  <p>考察点：{q.why}</p>
                  <p>回答思路：{q.approach}</p>
                </div>
              ))}
            </div>
            <div>
              <small>STAR 建议</small>
              <p>S 情境：{data.report.starAdvice.s}</p>
              <p>T 任务：{data.report.starAdvice.t}</p>
              <p>A 行动：{data.report.starAdvice.a}</p>
              <p>R 结果：{data.report.starAdvice.r}</p>
              <p>{data.report.starAdvice.reminder}</p>
            </div>
          </div>
          <div className="iv-checklist" aria-label="准备清单">
            {data.report.checklist.map((item, index) => (
              <div key={`${index}-${item.slice(0, 24)}`}>
                <i aria-hidden="true">✓</i>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>

        {Array.isArray(data.qaExcerpts) && data.qaExcerpts.length > 0 && (
          <section className="iv-card">
            <InterviewCardHead title="问答摘录" hint="只在屏幕上复盘" as="h2" />
            <p className="iv-copy">
              {data.includeAnswersInPrint === false
                ? '你选择了不把回答印进打印件。下面仍可在屏幕上回看摘录。'
                : '打印件会收录每题回答的前 200 字。'}
            </p>
            <div className="iv-mini-list">
              {data.qaExcerpts.map((item, i) => (
                <div key={`${i}-${item.question.slice(0, 24)}`}>
                  <p>{i + 1}. {item.question}</p>
                  <p>{item.skipped ? '回答：（跳过）' : `回答：${item.answerExcerpt?.trim() || '（未作答）'}`}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {printError && <p className="iv-alert" role="alert">{printError}</p>}
        <InterviewNotice>
          <b>打印不会先假装成功。</b>只有真正生成文件之后，才会进入打印确认；失败时仍停在报告页并写明原因。
        </InterviewNotice>
        <InterviewRail />
      </div>
    </div>
    </InterviewShell>
  )
}
