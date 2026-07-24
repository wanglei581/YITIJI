// 职业规划：真实规划读回、生成与打印逻辑保持在本页；LightFlow 仅重组视觉与状态层级。
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, KioskActionBar, KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import type { CareerPlanResponse } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import {
  ArrowRightIcon,
  CompassIcon,
  Loader2Icon,
  MicIcon,
  PencilLineIcon,
  PrinterIcon,
  TargetIcon,
} from 'lucide-react'
import { generateCareerPlan, getLatestCareerPlan, printCareerPlan } from '../../services/api/careerPlan'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { readAiResumeSession } from './aiResumeSession'
import './careerPlan-lightflow.css'

interface PageState {
  taskId?: string
  accessToken?: string
}

function Section({ title, Icon, children }: {
  title: string
  Icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <Card className="career-plan-lightflow__section">
      <div className="career-plan-lightflow__section-heading">
        <span className="career-plan-lightflow__section-icon" aria-hidden="true"><Icon /></span>
        <h2>{title}</h2>
      </div>
      {children}
    </Card>
  )
}

export function CareerPlanPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as PageState
  const session = useMemo(() => readAiResumeSession(), [])
  const taskId = state.taskId ?? session?.taskId
  const accessToken = state.accessToken ?? session?.accessToken
  const [plan, setPlan] = useState<CareerPlanResponse | null>(null)
  const [loading, setLoading] = useState(!!taskId)
  const [generating, setGenerating] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBusyLock(generating || printing)

  useEffect(() => {
    if (!taskId) { setLoading(false); return }
    let cancelled = false
    getLatestCareerPlan(taskId, { token: getToken(), accessToken })
      .then((result) => { if (!cancelled && result.status === 'completed') setPlan(result) })
      .catch(() => undefined) // 无记录是正常态
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [taskId, accessToken, getToken])

  const handleGenerate = async () => {
    if (!taskId) return
    setGenerating(true)
    setError(null)
    try {
      const result = await generateCareerPlan(taskId, { token: getToken(), accessToken })
      if (result.status === 'failed') {
        setError(result.failReason ?? '生成未完成，请稍后重试')
      } else {
        setPlan(result)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请稍后重试')
    } finally {
      setGenerating(false)
    }
  }

  const handlePrint = async () => {
    if (!taskId) return
    setPrinting(true)
    setError(null)
    try {
      const file = await printCareerPlan(taskId, { token: getToken(), accessToken })
      if (!file.printFileUrl) throw new Error('打印链接未就绪，请稍后重试')
      navigate('/print/confirm', {
        state: {
          file: {
            name: file.filename,
            size: file.sizeBytes >= 1024 * 1024 ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`,
            pages: file.pageCount,
            fileId: file.fileId,
            fileUrl: file.printFileUrl,
            mimeType: 'application/pdf',
          },
          params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '打印版生成失败，请稍后重试')
    } finally {
      setPrinting(false)
    }
  }

  if (!taskId) {
    return (
      <KioskPageFrame className="fusion-w3 fusion-w3--resume"><main data-kiosk-domain="resume" data-kiosk-screen="resume-career-plan" className="service-desk career-plan-lightflow career-plan-lightflow--gate" data-visual-theme="service-desk" data-ux-density="touch">
        <section className="career-plan-lightflow__state-card" aria-labelledby="career-plan-gate-title">
          <span className="career-plan-lightflow__state-icon" aria-hidden="true"><CompassIcon /></span>
          <p className="career-plan-lightflow__eyebrow">职业方向服务</p>
          <h1 id="career-plan-gate-title">先准备简历，再规划方向</h1>
          <p>职业规划会基于已完成的简历诊断整理发展方向与行动建议，不会替代真实的简历上传与诊断流程。</p>
          <Button size="lg" className="career-plan-lightflow__primary-action" onClick={() => navigate('/resume/source?intent=diagnose')}>
            去上传简历<ArrowRightIcon aria-hidden="true" />
          </Button>
        </section>
      </main></KioskPageFrame>
    )
  }

  if (loading) {
    return (
      <KioskPageFrame className="fusion-w3 fusion-w3--resume"><main data-kiosk-domain="resume" data-kiosk-screen="resume-career-plan" className="service-desk career-plan-lightflow career-plan-lightflow--loading" data-visual-theme="service-desk" data-ux-density="touch">
        <section className="career-plan-lightflow__state-card" role="status" aria-live="polite" aria-label="正在恢复职业规划">
          <Loader2Icon className="career-plan-lightflow__spinner" aria-hidden="true" />
          <p className="career-plan-lightflow__eyebrow">职业方向服务</p>
          <h1>正在读取你的职业规划</h1>
          <p>正在确认是否存在可继续查看的真实规划结果。</p>
        </section>
      </main></KioskPageFrame>
    )
  }

  if (plan) {
    return (
      <KioskPageFrame className="fusion-w3 fusion-w3--resume"><main data-kiosk-domain="resume" data-kiosk-screen="resume-career-plan" className="service-desk career-plan-lightflow career-plan-lightflow--result" data-visual-theme="service-desk" data-ux-density="touch">
        <header className="career-plan-lightflow__header">
          <KioskPageHeader
            title="职业规划建议"
            description={`依据：本人简历${plan.basedOn?.jobFit ? ` + 岗位匹配参考（${plan.basedOn.jobFit}）` : ''}${plan.basedOn?.interview ? ` + 模拟面试表现（${plan.basedOn.interview}）` : ''}`}
            onBack={() => navigate('/')}
            backLabel="返回首页"
          />
        </header>

        <div className="career-plan-lightflow__content" aria-label="职业规划结果">
          <section className="career-plan-lightflow__summary-card" aria-labelledby="career-plan-summary-title">
            <p className="career-plan-lightflow__eyebrow">已生成的规划</p>
            <h2 id="career-plan-summary-title">先看结论，再安排下一步</h2>
            <p>{plan.summary}</p>
            <div className="career-plan-lightflow__meta-chips">
              <span className="career-plan-lightflow__chip">已存入 AI服务记录</span>
            </div>
          </section>
          <ComplianceBanner tone="info">本建议仅供本人职业发展参考，不构成任何就业、薪资或录用承诺；行动请基于真实经历，不要虚构。</ComplianceBanner>

          <Section title="现状画像" Icon={CompassIcon}>
            <div className="career-plan-lightflow__stack">
              {(plan.currentSnapshot ?? []).map((item) => (
                <div key={item.point} className="career-plan-lightflow__evidence">
                  <p>{item.point}</p>
                  <span>简历依据：{item.evidence}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="发展方向" Icon={TargetIcon}>
            <div className="career-plan-lightflow__stack">
              {(plan.directions ?? []).map((direction, index) => (
                <div key={direction.title} className="career-plan-lightflow__direction">
                  <span aria-hidden="true">{index + 1}</span>
                  <div>
                    <h3>{direction.title}</h3>
                    <p>为什么适合：{direction.why}</p>
                    <p><strong>第一步：</strong>{direction.firstStep}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="技能提升计划" Icon={PencilLineIcon}>
            <div className="career-plan-lightflow__stack">
              {(plan.skillPlan ?? []).map((item) => (
                <div key={item.skill} className="career-plan-lightflow__skill">
                  <span>{item.timeframe}</span>
                  <div><h3>{item.skill}</h3><p>{item.action}</p></div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="近期行动清单" Icon={ArrowRightIcon}>
            <ol className="career-plan-lightflow__checklist">
              {(plan.actionChecklist ?? []).map((item) => <li key={item}>{item}</li>)}
            </ol>
          </Section>

          <Section title="继续下一步" Icon={CompassIcon}>
            <div className="career-plan-lightflow__next-actions">
              <Button variant="secondary" onClick={() => navigate('/resume/optimize', { state: { taskId, accessToken } })}><PencilLineIcon aria-hidden="true" />优化简历</Button>
              <Button variant="secondary" onClick={() => navigate('/resume/job-fit', { state: { taskId, accessToken } })}><TargetIcon aria-hidden="true" />岗位匹配</Button>
              <Button variant="secondary" onClick={() => navigate('/interview/setup')}><MicIcon aria-hidden="true" />模拟面试</Button>
            </div>
          </Section>

          {error && <p className="career-plan-lightflow__alert" role="alert">{error}</p>}
        </div>

        <KioskActionBar className="career-plan-lightflow__action-bar">
          <Button size="lg" className="career-plan-lightflow__print-action" disabled={printing} onClick={() => void handlePrint()}>
            {printing ? <Loader2Icon className="career-plan-lightflow__button-spinner" aria-hidden="true" /> : <PrinterIcon aria-hidden="true" />}
            {printing ? '正在生成建议单…' : '打印建议单'}
          </Button>
          <Button size="lg" variant="secondary" className="career-plan-lightflow__secondary-action" disabled={generating} onClick={() => void handleGenerate()}>
            {generating ? <Loader2Icon className="career-plan-lightflow__button-spinner" aria-hidden="true" /> : '重新生成'}
          </Button>
        </KioskActionBar>
      </main></KioskPageFrame>
    )
  }

  return (
    <KioskPageFrame className="fusion-w3 fusion-w3--resume">
    <main data-kiosk-domain="resume" data-kiosk-screen="resume-career-plan" className="service-desk career-plan-lightflow career-plan-lightflow--guide" data-visual-theme="service-desk" data-ux-density="touch">
      <header className="career-plan-lightflow__header">
        <KioskPageHeader
          title="职业规划建议"
          description="基于你的真实简历，生成发展方向与行动计划"
          onBack={() => navigate('/')}
          backLabel="返回首页"
        />
      </header>

      <div className="career-plan-lightflow__content">
        <ComplianceBanner tone="info">本建议仅供本人职业发展参考，不构成任何就业、薪资或录用承诺。</ComplianceBanner>
        <section className="career-plan-lightflow__summary-card" aria-labelledby="career-plan-guide-title">
          <span className="career-plan-lightflow__state-icon" aria-hidden="true"><CompassIcon /></span>
          <p className="career-plan-lightflow__eyebrow">生成前说明</p>
          <h1 id="career-plan-guide-title">把简历经历变成可执行的下一步</h1>
          <ul className="career-plan-lightflow__guide-list">
            <li>现状画像：每条结论附简历原文依据，不编造经历。</li>
            <li>发展方向：提供 1–3 个建议及可开始的第一步。</li>
            <li>提升计划：按阶段整理技能和近期行动清单。</li>
          </ul>
          <p className="career-plan-lightflow__muted">岗位匹配或模拟面试已完成时，会在真实数据可用的范围内帮助建议更具体；没有也能直接生成。</p>
        </section>
        {error && <p className="career-plan-lightflow__alert" role="alert">{error}</p>}
      </div>

      <KioskActionBar className="career-plan-lightflow__action-bar">
        <Button size="lg" className="career-plan-lightflow__primary-action" disabled={generating} onClick={() => void handleGenerate()} aria-live="polite">
          {generating ? <><Loader2Icon className="career-plan-lightflow__button-spinner" aria-hidden="true" />正在生成（约 15–30 秒）…</> : <>生成职业规划建议<ArrowRightIcon aria-hidden="true" /></>}
        </Button>
      </KioskActionBar>
    </main>
    </KioskPageFrame>
  )
}
