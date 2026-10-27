// ============================================================
// 模拟面试 — 练习报告页（2C）。
//
// 数据：路由 state（刚结束）或凭 sessionId+凭证从服务端读回（会员历史/刷新）。
// 操作：打印报告（服务端真实 PDF → 既有打印链路）、重新练习。
// 合规：不显示等级、不写岗位匹配；固定免责说明，只给本人复盘。
// 版式（稿 iv-report / iv-report-more）：主视图是概览、五个维度、风险点；预测题、STAR、清单、摘录在「更多」视图。
// 整页只有一个滚动容器，说明卡和维度行都不收缩，条目多就往下滑，不压扁、不裁字。
// ============================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useLocation, useNavigate } from 'react-router-dom'
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
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { useSupportContact } from '../../hooks/useSupportContact'
import { InterviewShell } from './InterviewShell'
import { InterviewArt } from './InterviewArt'
import { InterviewStatus } from './interviewQxParts'
import { scrollInterviewToTop } from './interviewScroll'
import { interviewUserLine } from './interviewMicCopy'
import { type InterviewStage } from './interviewWorkbenchModel'
import {
  patchInterviewWorkbenchSession,
  readInterviewWorkbenchSession,
} from './interviewWorkbenchSession'
import { useStartPrintHandoff } from '../print/usePrintHandoff'
import './interview-service-desk.css'
import './styles/interview-workbench-qx.css'
import './styles/interview-qx2.css'
import './styles/interview-touch-report.css'

const REPORT_AI_DRAFT = '我刚完成一场模拟面试，想看懂练习报告。请先问我想看的部分，再说明这只供我自己复盘，不要预测录用。'

interface ReportState {
  sessionId?: string
  accessToken?: string
  report?: InterviewReportView
}

/** 一个维度：标题是真正的标题，下面是这一维的几条观察。 */
function Dimension({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="qxt-iv-ab">
      <h2>{title}</h2>
      <ul>
        {items.map((t) => (
          <li key={t.slice(0, 24)}>{t}</li>
        ))}
      </ul>
    </section>
  )
}

/** 报告顶部的 AI 标识与边界。主视图和「更多」都带，只用于本人复盘，不发给任何企业。 */
function AiBanner() {
  return (
    <div role="note" aria-label="合规提示" className="qxt-iv-banner">
      <b>{AI_LABEL_COPY.INTERVIEW_REPORT}。</b>不代表任何招聘结果，不参与企业筛选、面试邀约或录用决策，也不会发送给任何企业。
    </div>
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
  const [more, setMore] = useState(false)
  const moreTitleRef = useRef<HTMLHeadingElement>(null)
  const overviewRef = useRef<HTMLHeadingElement>(null)
  const contact = useSupportContact()
  const shownPrintError = interviewUserLine(printError, contact)

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
  const leave = () => navigate('/interview-service')

  // 切到「更多」或回主视图：回到顶，焦点放到新视图的第一个标题（点下去的按钮已被卸载）。
  useLayoutEffect(() => {
    const target = more ? moreTitleRef.current : overviewRef.current
    target?.focus({ preventScroll: true })
    scrollInterviewToTop()
  }, [more])

  if (loading) {
    return (
      <InterviewShell
        eyebrow="练面试 · 报告"
        title="正在核对报告状态。"
        subtitle="报告只按这场练习读取。读取完成前不展示上一次内容，也不提前放开打印。"
        status={{ tone: 'unknown', label: '正在读取' }}
        ctabar={
          <QxTouchDock
            onBack={leave}
            ask={{ label: '问小青：报告还在读取怎么办', draft: '练习报告还在读取。请说明我可以先做什么，不要假装报告已经生成。' }}
          />
        }
      >
        <div data-kiosk-domain="interview" data-kiosk-screen="interview-report" data-qx-interview="" className="interview-flow interview-report" data-visual-theme="service-desk" data-ux-density="touch">
          <div className="interview-flow__scroll">
            <InterviewStatus label="报告读取状态" items={[{ k: '报告内容', v: '读取中' }, { k: '打印版', v: '未生成' }, { k: '录用预测', v: '不提供' }]} />
            <InterviewArt title="正在读取本场练习报告">读取完成前，这里不展示上一次的内容，也不显示评分、打印成功或可下载文件。读取没有完成之前，不能生成打印版。</InterviewArt>
          </div>
        </div>
      </InterviewShell>
    )
  }
  if (loadError || !data) {
    return (
      <InterviewShell
        eyebrow="练面试 · 报告"
        title="这份报告暂时不能查看。"
        subtitle="报告可能还没生成、已经过期，或当前账号不能查看；不能用固定内容替代实际结果。"
        status={{ tone: 'bad', label: '报告不可用' }}
        ctabar={
          <QxTouchDock
            onBack={leave}
            ask={{ label: '问小青：这份练习报告怎么看', draft: REPORT_AI_DRAFT }}
            primary={{ label: '重新开始练习', onClick: goSetup }}
          />
        }
      >
        <div data-kiosk-domain="interview" data-kiosk-screen="interview-report" data-qx-interview="" className="interview-flow interview-report" data-visual-theme="service-desk" data-ux-density="touch">
          <div className="interview-flow__scroll">
            <button type="button" className="qxt-iv-wide" onClick={goReports}>
              <b>查看报告历史</b>
              <small>回到本人的练习记录</small>
            </button>
            <InterviewArt title="报告不存在或已过期">没有真实报告时，不显示评分、打印成功或可下载文件。可以重新开始一场练习，或先看历史里别的记录。</InterviewArt>
          </div>
        </div>
      </InterviewShell>
    )
  }

  const printNote = data.includeAnswersInPrint === false
    ? '你选择了不把回答印进打印件'
    : '打印件会收录每题回答的前 200 字'
  const excerpts = Array.isArray(data.qaExcerpts) ? data.qaExcerpts : []

  return (
    <InterviewShell
      eyebrow="练面试 · 报告"
      title="报告用来复盘练习。"
      subtitle={more
        ? '预测题、STAR、准备清单和问答摘录。'
        : `${data.position} · ${data.industry} · ${data.interviewerLabel}。只用于本人复盘，不代表通过率或录用结果。`}
      onBack={more ? () => setMore(false) : undefined}
      status={printing
        ? { tone: 'warn', label: '正在生成打印版' }
        : printError
          ? { tone: 'bad', label: '打印版没有生成' }
          : { tone: 'ok', label: '报告可以查看' }}
      ctabar={
        <QxTouchDock
          onBack={more ? () => setMore(false) : leave}
          ask={{ label: '问小青：这份练习报告怎么看', draft: REPORT_AI_DRAFT }}
          primary={more
            ? { label: '回到这份报告', onClick: () => setMore(false), testId: 'interview-primary' }
            : {
                label: printing ? '正在生成打印版…' : '生成打印版',
                onClick: () => void handlePrint(),
                disabled: printing,
                testId: 'interview-primary',
              }}
        />
      }
    >
      <div data-kiosk-domain="interview" data-kiosk-screen="interview-report" data-qx-interview="" className="interview-flow interview-report" data-visual-theme="service-desk" data-ux-density="touch">
        <div className="interview-flow__scroll">
          <AiBanner />
          {more ? (
            <>
              <section className="qxt-iv-note">
                <h2 ref={moreTitleRef} tabIndex={-1}>高频问题预测</h2>
                {data.report.predictedQuestions.map((q, i) => (
                  <div key={q.question.slice(0, 24)} className="qxt-iv-q-row">
                    <span><b>{i + 1}. {q.question}</b></span>
                    <span>考察点：{q.why}</span>
                    <span>回答思路：{q.approach}</span>
                  </div>
                ))}
              </section>
              <section className="qxt-iv-note">
                <h2>面试前准备清单</h2>
                {data.report.checklist.map((c) => (
                  <span key={c.slice(0, 24)}>{c}</span>
                ))}
              </section>
              {excerpts.length > 0 && (
                <section className="qxt-iv-note">
                  <h2>问答摘录</h2>
                  <span>{data.includeAnswersInPrint === false ? '你选择了不把回答印进打印件。下面仍可在屏幕上回看摘录。' : `${printNote}。`}</span>
                  {excerpts.map((item, i) => (
                    <div key={`${i}-${item.question.slice(0, 24)}`} className="qxt-iv-q-row">
                      <span><b>{i + 1}. {item.question}</b></span>
                      <span>{item.skipped ? '回答：（跳过）' : `回答：${item.answerExcerpt?.trim() || '（未作答）'}`}</span>
                    </div>
                  ))}
                </section>
              )}
              <section className="qxt-iv-note">
                <h2>STAR 回答建议</h2>
                <span><b>S 情境：</b>{data.report.starAdvice.s}</span>
                <span><b>T 任务：</b>{data.report.starAdvice.t}</span>
                <span><b>A 行动：</b>{data.report.starAdvice.a}</span>
                <span><b>R 结果：</b>{data.report.starAdvice.r}</span>
                <span>{data.report.starAdvice.reminder}</span>
              </section>
              <InterviewArt variant="fill" title="这些栏目只属于这一场练习">
                预测题、STAR 建议、准备清单和问答摘录都按这一场练习的报告显示，只用于本人复盘，不预测录用，也不发送给任何企业。
              </InterviewArt>
            </>
          ) : (
            <>
              <InterviewStatus
                label="报告与打印状态"
                items={[
                  { k: '报告内容', v: '可以查看', tone: 'ok' },
                  { k: '打印版', v: printing ? '生成中' : printError ? '没有生成' : '还没有', tone: printError ? 'off' : undefined },
                  { k: '录用预测', v: '不提供' },
                ]}
              />
              <section className="qxt-iv-note">
                <h2 ref={overviewRef} tabIndex={-1}>综合表现概览</h2>
                <span>{data.report.overall.summary}</span>
              </section>
              <div className="qxt-iv-abs">
                <Dimension title="表达清晰度" items={data.report.expression} />
                <Dimension title="和目标岗位要求的对照" items={data.report.positionFit} />
                <Dimension title="经历可信度与细节" items={data.report.credibility} />
                <Dimension title="专业能力表现" items={data.report.professional} />
                <Dimension title="沟通与应变能力" items={data.report.adaptability} />
              </div>
              <section className="qxt-iv-note">
                <h2>风险点与改进建议</h2>
                <ul>
                  {data.report.risks.map((t) => (
                    <li key={t.slice(0, 24)}>{t}</li>
                  ))}
                </ul>
              </section>
              {shownPrintError ? <p className="qxt-iv-err" role="alert">{shownPrintError}</p> : null}
              <button type="button" className="qxt-iv-wide" onClick={() => setMore(true)}>
                <b>预测题、STAR、清单、摘录</b>
                <small>{printNote}</small>
              </button>
              <div className="qxt-iv-acts">
                <button type="button" onClick={goReports}>查看历史报告</button>
                <button type="button" onClick={goSetup}>重新练习</button>
              </div>
              <div className="qxt-iv-note">
                <span>{COMPLIANCE_COPY.INTERVIEW_PRACTICE_RESULT_DISCLAIMER}</span>
                <span><b>打印不会先假装成功。</b>只有真正生成文件之后，才会进入打印确认；失败时仍停在报告页并写明原因。</span>
              </div>
            </>
          )}
        </div>
      </div>
    </InterviewShell>
  )
}
