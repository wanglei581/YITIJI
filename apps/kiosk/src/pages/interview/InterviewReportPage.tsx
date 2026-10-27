// ============================================================
// 模拟面试 — 练习报告页（2C）。
//
// 数据：路由 state（刚结束）或凭 sessionId+凭证从服务端读回（会员历史/刷新）。
// 操作：打印报告（服务端真实 PDF → 既有打印链路）、重新练习。
// 合规：不显示等级、不写岗位匹配；固定免责说明，只给本人复盘。
// ============================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useLocation, useNavigate } from 'react-router-dom'
import { Card, ComplianceBanner } from '@ai-job-print/ui'
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
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClipboardListIcon,
  HelpCircleIcon,
  LightbulbIcon,
  MessageSquareTextIcon,
  TargetIcon,
} from 'lucide-react'
import { getInterviewReport, printInterviewReport } from '../../services/api/interview'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { useSupportContact } from '../../hooks/useSupportContact'
import { InterviewShell } from './InterviewShell'
import { InterviewArt } from './InterviewArt'
import { InterviewRail, InterviewStatus } from './interviewQxParts'
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

const REPORT_AI_DRAFT = '我刚完成一场模拟面试，想看懂练习报告。请先问我想看的部分，再说明这只供我自己复盘，不要预测录用。'

interface ReportState {
  sessionId?: string
  accessToken?: string
  report?: InterviewReportView
}

function Section({ icon: Icon, title, children, className = '', headingRef }: { icon: React.ElementType; title: string; children: React.ReactNode; className?: string; headingRef?: React.Ref<HTMLHeadingElement> }) {
  return (
    <Card className={['interview-card interview-report__section p-5', className].filter(Boolean).join(' ')}>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <h2 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="text-base font-semibold text-neutral-900">{title}</h2>
      </div>
      {children}
    </Card>
  )
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((t) => (
        <li key={t.slice(0, 24)} className="flex items-start gap-2 text-sm leading-relaxed text-neutral-700">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400" aria-hidden="true" />
          {t}
        </li>
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

  useLayoutEffect(() => {
    const target = more ? moreTitleRef.current : overviewRef.current
    target?.focus({ preventScroll: true })
    document.querySelector<HTMLElement>('.qxt-body-iv > .interview-flow')?.scrollTo(0, 0)
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
        <div data-kiosk-domain="interview" data-kiosk-screen="interview-report" data-qx-interview="" className="interview-flow interview-state-page" data-visual-theme="service-desk" data-ux-density="touch">
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
            primary={{ label: '重新开始练习', onClick: goSetup, noArrow: true }}
          />
        }
      >
      <div data-kiosk-domain="interview" data-kiosk-screen="interview-report" data-qx-interview="" className="interview-flow interview-state-page" data-visual-theme="service-desk" data-ux-density="touch">
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
          primary={more ? { label: '回到这份报告', onClick: () => setMore(false), noArrow: true, testId: 'interview-primary' } : undefined}
          primarySlot={more ? undefined : (
            <button
              type="button"
              className="qxt-btn qxt-btn-pri"
              data-testid="interview-primary"
              disabled={printing}
              onClick={() => void handlePrint()}
            >
              {printing ? '正在生成打印版…' : '生成打印版'}
            </button>
          )}
        />
      }
    >
    <div data-kiosk-domain="interview" data-kiosk-screen="interview-report" data-qx-interview="" className="interview-flow interview-report" data-visual-theme="service-desk" data-ux-density="touch">

      <div className="interview-flow__scroll">
        {more ? (
          <>
            <ComplianceBanner tone="info">
              <b>{AI_LABEL_COPY.INTERVIEW_REPORT}。</b>不代表任何招聘结果，不参与企业筛选、面试邀约或录用决策，也不会发送给任何企业。
            </ComplianceBanner>
            <Section headingRef={moreTitleRef} icon={HelpCircleIcon} title="高频问题预测" className="interview-report__questions">
              <div className="flex flex-col gap-3">
                {data.report.predictedQuestions.map((q, i) => (
                  <div key={q.question.slice(0, 24)} className="qxt-iv-q">
                    <p><b>{i + 1}. {q.question}</b></p>
                    <p>考察点：{q.why}</p>
                    <p>回答思路：{q.approach}</p>
                  </div>
                ))}
              </div>
            </Section>
            <Section icon={ClipboardListIcon} title="面试前准备清单">
              <ul className="flex flex-col gap-2">
                {data.report.checklist.map((c) => (
                  <li key={c.slice(0, 24)}>{c}</li>
                ))}
              </ul>
            </Section>
            {Array.isArray(data.qaExcerpts) && data.qaExcerpts.length > 0 && (
              <Section icon={MessageSquareTextIcon} title="问答摘录">
                <p>{data.includeAnswersInPrint === false ? '你选择了不把回答印进打印件。下面仍可在屏幕上回看摘录。' : `${printNote}。`}</p>
                <div className="flex flex-col gap-3">
                  {data.qaExcerpts.map((item, i) => (
                    <div key={`${i}-${item.question.slice(0, 24)}`} className="qxt-iv-q">
                      <p><b>{i + 1}. {item.question}</b></p>
                      <p>{item.skipped ? '回答：（跳过）' : `回答：${item.answerExcerpt?.trim() || '（未作答）'}`}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}
            <Section icon={LightbulbIcon} title="STAR 回答建议">
              <div className="flex flex-col gap-2">
                <p><b>S 情境：</b>{data.report.starAdvice.s}</p>
                <p><b>T 任务：</b>{data.report.starAdvice.t}</p>
                <p><b>A 行动：</b>{data.report.starAdvice.a}</p>
                <p><b>R 结果：</b>{data.report.starAdvice.r}</p>
                <p>{data.report.starAdvice.reminder}</p>
              </div>
            </Section>
          </>
        ) : (
          <>
            <ComplianceBanner tone="info">
              <b>{AI_LABEL_COPY.INTERVIEW_REPORT}。</b>不代表任何招聘结果，不参与企业筛选、面试邀约或录用决策，也不会发送给任何企业。
            </ComplianceBanner>
            <InterviewStatus
              label="报告与打印状态"
              items={[
                { k: '报告内容', v: '可以查看', tone: 'ok' },
                { k: '打印版', v: printing ? '生成中' : printError ? '没有生成' : '还没有', tone: printError ? 'off' : undefined },
                { k: '录用预测', v: '不提供' },
              ]}
            />
            <Card className="interview-card interview-report__hero p-5">
              <h2 ref={overviewRef} tabIndex={-1}>综合表现概览</h2>
              <p>{data.report.overall.summary}</p>
            </Card>
            <div className="interview-report__abilities">
              <Section icon={MessageSquareTextIcon} title="表达清晰度"><Bullets items={data.report.expression} /></Section>
              <Section icon={TargetIcon} title="和目标岗位要求的对照"><Bullets items={data.report.positionFit} /></Section>
              <Section icon={CheckCircle2Icon} title="经历可信度与细节"><Bullets items={data.report.credibility} /></Section>
              <Section icon={LightbulbIcon} title="专业能力表现"><Bullets items={data.report.professional} /></Section>
              <Section icon={MessageSquareTextIcon} title="沟通与应变能力"><Bullets items={data.report.adaptability} /></Section>
            </div>
            <Section icon={AlertTriangleIcon} title="风险点与改进建议" className="interview-report__risk">
              <ul className="flex flex-col gap-2">
                {data.report.risks.map((t) => (
                  <li key={t.slice(0, 24)}>{t}</li>
                ))}
              </ul>
            </Section>
            {shownPrintError ? <p className="iv-alert" role="alert">{shownPrintError}</p> : null}
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
        <InterviewRail />
      </div>
    </div>
    </InterviewShell>
  )
}
