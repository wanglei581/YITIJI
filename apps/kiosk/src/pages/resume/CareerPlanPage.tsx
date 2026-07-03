// ============================================================
// 2E 职业规划建议（真实化首页既有「职业规划」磁贴，不新增卡片）。
//
// 状态分支（user-data-flow-matrix §三）：
//   无简历（无 taskId）→ 引导上传诊断；有 → 生成（自动聚合本人岗位匹配/面试摘要，
//   依据材料如实展示）；失败 → 原因 + 重试；成功 → 结果页（现状画像含原文依据 /
//   方向 / 技能计划 / 行动清单）→ 打印建议单（PDF → 我的文档 + 打印订单）→
//   CTA 串联 简历优化 / 岗位匹配 / 模拟面试。
// 合规：仅供本人参考；无薪资/录用/Offer/通过率承诺（服务端双层拦截）。
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import type { CareerPlanResponse } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import {
  CompassIcon,
  ClipboardListIcon,
  Loader2Icon,
  MapIcon,
  MicIcon,
  PencilLineIcon,
  PrinterIcon,
  TargetIcon,
  UserRoundCheckIcon,
} from 'lucide-react'
import { generateCareerPlan, getLatestCareerPlan, printCareerPlan } from '../../services/api/careerPlan'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { readAiResumeSession } from './aiResumeSession'

interface PageState {
  taskId?: string
  accessToken?: string
}

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
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
  const [loading, setLoading] = useState(!!taskId) // 先尝试读回最近一次
  const [generating, setGenerating] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBusyLock(generating || printing)

  // 有规划记录则直接展示（刷新恢复 / 会员回看）；没有则停在生成引导
  useEffect(() => {
    if (!taskId) { setLoading(false); return }
    let cancelled = false
    getLatestCareerPlan(taskId, { token: getToken(), accessToken })
      .then((r) => { if (!cancelled && r.status === 'completed') setPlan(r) })
      .catch(() => undefined) // 无记录是正常态
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [taskId, accessToken, getToken])

  const handleGenerate = async () => {
    if (!taskId) return
    setGenerating(true)
    setError(null)
    try {
      const r = await generateCareerPlan(taskId, { token: getToken(), accessToken })
      if (r.status === 'failed') {
        setError(r.failReason ?? '生成未完成，请稍后重试')
      } else {
        setPlan(r)
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
      setError(err instanceof Error ? err.message : '打印版生成失败，请稍后重试')
    } finally {
      setPrinting(false)
    }
  }

  // ── 无简历：引导上传（矩阵状态分支①）──────────────────────────────────────
  if (!taskId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <CompassIcon className="h-10 w-10 text-neutral-300" aria-hidden="true" />
        <p className="text-base font-semibold text-neutral-900">先上传简历，再生成职业规划</p>
        <p className="max-w-md text-center text-sm text-neutral-500">
          职业规划基于你的真实简历生成；完成简历诊断后，还可结合岗位匹配参考与模拟面试表现，建议会更具体
        </p>
        <Button size="lg" className="h-14 px-8" onClick={() => navigate('/resume/source?intent=diagnose')}>
          去上传简历
        </Button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-neutral-400">
        <Loader2Icon className="h-5 w-5 animate-spin" aria-hidden="true" />
        正在加载…
      </div>
    )
  }

  // ── 结果页 ────────────────────────────────────────────────────────────────
  if (plan) {
    return (
      <div className="flex h-full flex-col px-6 pt-6">
        <PageHeader
          title="职业规划建议"
          subtitle={`依据：本人简历${plan.basedOn?.jobFit ? ` + 岗位匹配参考（${plan.basedOn.jobFit}）` : ''}${plan.basedOn?.interview ? ` + 模拟面试表现（${plan.basedOn.interview}）` : ''}`}
          actions={<Button size="sm" variant="secondary" onClick={() => navigate('/')}>返回首页</Button>}
        />
        <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-32">
          <ComplianceBanner tone="info">
            本建议仅供本人职业发展参考，不构成任何就业、薪资或录用承诺；行动请基于真实经历，不要虚构。
          </ComplianceBanner>

          <Card className="p-5">
            <h2 className="text-base font-semibold text-neutral-900">总览</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-700">{plan.summary}</p>
          </Card>

          <Section icon={UserRoundCheckIcon} title="现状画像（含简历原文依据）">
            <div className="flex flex-col gap-2.5">
              {(plan.currentSnapshot ?? []).map((c) => (
                <div key={c.point.slice(0, 24)} className="rounded-xl bg-neutral-50/80 px-4 py-3">
                  <p className="text-sm font-medium text-neutral-900">{c.point}</p>
                  <p className="mt-1 text-xs text-neutral-500">依据：“{c.evidence}”</p>
                </div>
              ))}
            </div>
          </Section>

          <Section icon={MapIcon} title="发展方向建议（参考）">
            <div className="flex flex-col gap-3">
              {(plan.directions ?? []).map((d, i) => (
                <div key={d.title} className="rounded-xl border border-primary-100 bg-primary-50/40 p-4">
                  <p className="text-sm font-bold text-primary-800">{i + 1}. {d.title}</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-neutral-600">为什么适合：{d.why}</p>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-700"><span className="font-semibold">第一步：</span>{d.firstStep}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section icon={TargetIcon} title="技能提升计划">
            <div className="flex flex-col gap-2">
              {(plan.skillPlan ?? []).map((s) => (
                <div key={s.skill} className="flex items-start gap-3 rounded-xl bg-neutral-50/80 px-4 py-3">
                  <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-primary-700 shadow-sm">{s.timeframe}</span>
                  <div>
                    <p className="text-sm font-medium text-neutral-900">{s.skill}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-neutral-600">{s.action}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section icon={ClipboardListIcon} title="近期行动清单">
            <ul className="flex flex-col gap-2">
              {(plan.actionChecklist ?? []).map((a) => (
                <li key={a.slice(0, 24)} className="flex items-start gap-2.5 text-sm leading-relaxed text-neutral-700">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-neutral-300" aria-hidden="true" />
                  {a}
                </li>
              ))}
            </ul>
          </Section>

          {/* CTA 串联（结果页链路，不新增首页入口） */}
          <Card className="p-4">
            <p className="mb-2 text-xs font-medium text-neutral-500">继续下一步</p>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="secondary" className="h-12" onClick={() => navigate('/resume/optimize', { state: { taskId, accessToken } })}>
                <PencilLineIcon className="mr-1 h-4 w-4" aria-hidden="true" />
                优化简历
              </Button>
              <Button variant="secondary" className="h-12" onClick={() => navigate('/resume/job-fit', { state: { taskId, accessToken } })}>
                <TargetIcon className="mr-1 h-4 w-4" aria-hidden="true" />
                岗位匹配
              </Button>
              <Button variant="secondary" className="h-12" onClick={() => navigate('/interview/setup')}>
                <MicIcon className="mr-1 h-4 w-4" aria-hidden="true" />
                模拟面试
              </Button>
            </div>
          </Card>

          {error && <p className="rounded-xl bg-error-bg px-4 py-3 text-sm text-error-fg">{error}</p>}
        </div>

        <div className="absolute inset-x-0 bottom-0 border-t border-neutral-100 bg-white/95 px-6 py-4 backdrop-blur">
          <div className="flex gap-3">
            <Button size="lg" className="h-14 flex-1 text-base" disabled={printing} onClick={() => void handlePrint()}>
              <PrinterIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />
              {printing ? '正在生成建议单…' : '打印建议单'}
            </Button>
            <Button size="lg" variant="secondary" className="h-14 min-w-[140px] text-base" disabled={generating} onClick={() => void handleGenerate()}>
              {generating ? <Loader2Icon className="h-5 w-5 animate-spin" aria-hidden="true" /> : '重新生成'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── 生成引导（有简历，未生成）───────────────────────────────────────────
  return (
    <div className="flex h-full flex-col px-6 pt-6">
      <PageHeader
        title="职业规划建议"
        subtitle="基于你的真实简历，生成发展方向与行动计划"
        actions={<Button size="sm" variant="secondary" onClick={() => navigate('/')}>返回首页</Button>}
      />
      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-28">
        <ComplianceBanner tone="info">
          本建议仅供本人职业发展参考，不构成任何就业、薪资或录用承诺。
        </ComplianceBanner>
        <Card className="p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-50">
              <CompassIcon className="h-6 w-6 text-primary-600" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-neutral-900">将为你生成</h2>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm text-neutral-600">
                <li>· 现状画像（每条附简历原文依据，不编造）</li>
                <li>· 1-3 个发展方向建议与第一步行动</li>
                <li>· 分阶段技能提升计划</li>
                <li>· 近期可执行行动清单（可打印带走）</li>
              </ul>
              <p className="mt-3 text-xs text-neutral-400">
                如你已做过岗位匹配参考或模拟面试，本次规划会自动结合这些表现，建议更具体；没有也可直接生成。
              </p>
            </div>
          </div>
        </Card>
        {error && (
          <div className="rounded-xl bg-error-bg px-4 py-3">
            <p className="text-sm text-error-fg">{error}</p>
          </div>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 border-t border-neutral-100 bg-white/95 px-6 py-4 backdrop-blur">
        <Button size="lg" className="h-14 w-full text-base" disabled={generating} onClick={() => void handleGenerate()}>
          {generating ? (
            <>
              <Loader2Icon className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
              正在生成（约 15-30 秒）…
            </>
          ) : (
            '生成职业规划建议'
          )}
        </Button>
      </div>
    </div>
  )
}
