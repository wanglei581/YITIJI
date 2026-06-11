// ============================================================
// 模拟面试 — 练习报告页（2C）。
//
// 数据：路由 state（刚结束）或凭 sessionId+凭证从服务端读回（会员历史/刷新）。
// 操作：打印报告（服务端真实 PDF → 既有打印链路）、重新练习。
// 合规：等级是练习表现，不是通过率/录用概率；页面明示边界。
// ============================================================

import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { InterviewReportResponse } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClipboardListIcon,
  HelpCircleIcon,
  LightbulbIcon,
  MessageSquareTextIcon,
  PrinterIcon,
  RotateCcwIcon,
  TargetIcon,
} from 'lucide-react'
import { getInterviewReport, printInterviewReport } from '../../services/api/interview'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'

interface ReportState {
  sessionId?: string
  accessToken?: string
  report?: InterviewReportResponse
}

const LEVEL_META: Record<string, { label: string; cls: string }> = {
  needs_work: { label: '需要加强', cls: 'bg-orange-50 text-orange-700' },
  pass: { label: '基础达标', cls: 'bg-blue-50 text-blue-700' },
  good: { label: '表现良好', cls: 'bg-green-50 text-green-700' },
  excellent: { label: '表现突出', cls: 'bg-emerald-50 text-emerald-700' },
}

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      </div>
      {children}
    </Card>
  )
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((t) => (
        <li key={t.slice(0, 24)} className="flex items-start gap-2 text-sm leading-relaxed text-gray-700">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400" aria-hidden="true" />
          {t}
        </li>
      ))}
    </ul>
  )
}

export function InterviewReportPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as ReportState

  const [data, setData] = useState<InterviewReportResponse | null>(state.report ?? null)
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

  const handlePrint = async () => {
    if (!data) return
    setPrinting(true)
    setPrintError(null)
    try {
      const file = await printInterviewReport(data.sessionId, { token: getToken(), accessToken: state.accessToken })
      navigate('/print/confirm', {
        state: {
          file: {
            name: file.filename,
            size: file.sizeBytes >= 1024 * 1024 ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`,
            pages: file.pageCount,
            fileId: file.fileId,
            fileUrl: file.signedUrl || undefined,
            mimeType: 'application/pdf',
          },
          params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
        },
      })
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : '打印版生成失败，请稍后重试')
    } finally {
      setPrinting(false)
    }
  }

  if (loading) return <LoadingState className="py-24" />
  if (loadError || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <ErrorState message="报告不存在或已过期" className="py-4" />
        <Button size="lg" onClick={() => navigate('/interview/setup')}>重新开始练习</Button>
      </div>
    )
  }

  const level = LEVEL_META[data.report.overall.level] ?? LEVEL_META['pass']

  return (
    <div className="flex h-full flex-col px-6 pt-6">
      <PageHeader
        title="模拟面试练习报告"
        subtitle={`${data.position} · ${data.industry} · ${data.interviewerLabel}`}
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>返回首页</Button>
        }
      />

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-32">
        <ComplianceBanner tone="info">
          本报告仅供本人面试练习与准备参考，不代表任何招聘结果承诺，不参与企业筛选、面试邀约或录用决策。
        </ComplianceBanner>

        {/* 综合表现 */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">综合表现概览</h2>
            <span className={['rounded-full px-3 py-1 text-sm font-semibold', level.cls].join(' ')}>{level.label}</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-gray-700">{data.report.overall.summary}</p>
          <p className="mt-2 text-xs text-gray-400">「{level.label}」为本次练习表现等级，不代表录用结果</p>
        </Card>

        <Section icon={MessageSquareTextIcon} title="表达清晰度"><Bullets items={data.report.expression} /></Section>
        <Section icon={TargetIcon} title="岗位匹配度参考"><Bullets items={data.report.positionFit} /></Section>
        <Section icon={CheckCircle2Icon} title="经历可信度与细节"><Bullets items={data.report.credibility} /></Section>
        <Section icon={LightbulbIcon} title="专业能力表现"><Bullets items={data.report.professional} /></Section>
        <Section icon={MessageSquareTextIcon} title="沟通与应变能力"><Bullets items={data.report.adaptability} /></Section>

        <Section icon={AlertTriangleIcon} title="风险点与改进建议">
          <ul className="flex flex-col gap-2">
            {data.report.risks.map((t) => (
              <li key={t.slice(0, 24)} className="flex items-start gap-2 rounded-lg bg-orange-50 px-3 py-2 text-sm leading-relaxed text-orange-800">
                <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
        </Section>

        <Section icon={HelpCircleIcon} title="高频问题预测（建议继续准备）">
          <div className="flex flex-col gap-3">
            {data.report.predictedQuestions.map((q, i) => (
              <div key={q.question.slice(0, 24)} className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5">
                <p className="text-sm font-semibold text-gray-900">{i + 1}. {q.question}</p>
                <p className="mt-1.5 text-xs text-gray-500">考察点：{q.why}</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-600">回答思路:{q.approach}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section icon={LightbulbIcon} title="STAR 回答建议">
          <div className="flex flex-col gap-2 text-sm leading-relaxed text-gray-700">
            <p><span className="font-semibold text-primary-700">S 情境：</span>{data.report.starAdvice.s}</p>
            <p><span className="font-semibold text-primary-700">T 任务：</span>{data.report.starAdvice.t}</p>
            <p><span className="font-semibold text-primary-700">A 行动：</span>{data.report.starAdvice.a}</p>
            <p><span className="font-semibold text-primary-700">R 结果：</span>{data.report.starAdvice.r}</p>
            <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{data.report.starAdvice.reminder}</p>
          </div>
        </Section>

        <Section icon={ClipboardListIcon} title="面试前准备清单">
          <ul className="flex flex-col gap-2">
            {data.report.checklist.map((c) => (
              <li key={c.slice(0, 24)} className="flex items-start gap-2.5 text-sm leading-relaxed text-gray-700">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-gray-300 text-[10px] text-transparent" aria-hidden="true">✓</span>
                {c}
              </li>
            ))}
          </ul>
        </Section>

        {printError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{printError}</p>}
      </div>

      {/* 底部操作 */}
      <div className="absolute inset-x-0 bottom-0 border-t border-gray-100 bg-white/95 px-6 py-4 backdrop-blur">
        <div className="flex gap-3">
          <Button size="lg" className="h-14 flex-1 text-base" disabled={printing} onClick={() => void handlePrint()}>
            <PrinterIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />
            {printing ? '正在生成打印版…' : '打印报告'}
          </Button>
          <Button size="lg" variant="secondary" className="h-14 flex-1 text-base" onClick={() => navigate('/interview/setup')}>
            <RotateCcwIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />
            重新练习
          </Button>
        </div>
      </div>
    </div>
  )
}
