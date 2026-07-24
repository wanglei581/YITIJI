// ============================================================
// AI 简历生成 - 预览 / 编辑 / 导出(阶段2A)
//
// - 预览生成结果,所有文本可直接编辑(用户对自己的简历有最终修改权)。
// - 缺失提示(missingHints)来自服务端确定性计算:AI 不代填,提示用户返回补充。
// - 导出 = 服务端 pdfkit 渲染真实 PDF → FileObject + 短时签名 URL →
//   进入既有打印链路(/print/confirm),不构造假文件。
// - 公共设备:结果只在路由 state(内存),离开即丢;导出文件短期自动清理。
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, KioskActionBar, KioskPageFrame, KioskPageHeader, Stepper } from '@ai-job-print/ui'
import type { StepperStep } from '@ai-job-print/ui'
import type {
  GeneratedResume,
  ResumeGenerateExportResponse,
  ResumeGenerateInput,
  ResumeGenerateResponse,
} from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileDownIcon,
  FlaskConicalIcon,
  PencilLineIcon,
  PrinterIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { exportGeneratedResume, getResumeGenerate } from '../../services/api'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import './resume-authoring-lightflow.css'
import './resume-fusion-youth.css'

interface LocationState {
  result?: ResumeGenerateResponse
  input?: ResumeGenerateInput
  /** 会员从「我的简历」回看：仅带 taskId，页面凭本人 token 读回结果（C-2D） */
  taskId?: string
}

const taCls =
  'resume-lightflow__field w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100'

const GENERATE_PREVIEW_STEPS: StepperStep[] = [
  { title: '填写信息' },
  { title: '预览编辑' },
  { title: '导出打印' },
]

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="h-4 w-1 rounded-full bg-primary-600" aria-hidden="true" />
      <p className="text-base font-semibold text-neutral-900">{title}</p>
    </div>
  )
}

export function ResumeGeneratePreviewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null
  const { getToken } = useAuth()
  const queryTaskId = useMemo(() => new URLSearchParams(location.search).get('taskId') ?? undefined, [location.search])
  const stateTaskId = typeof state?.taskId === 'string' ? state.taskId : undefined
  const restoreTaskId = !state?.result ? (stateTaskId ?? queryTaskId ?? null) : null

  const [resume, setResume] = useState<GeneratedResume | null>(state?.result?.resume ?? null)
  const [result, setResult] = useState<ResumeGenerateResponse | null>(state?.result ?? null)
  const [restoring, setRestoring] = useState(Boolean(restoreTaskId))
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<ResumeGenerateExportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useBusyLock(exporting)

  // 会员回看（C-2D）：无内存结果但带 taskId → 凭本人会员 token 读回（归属由后端门禁校验）。
  useEffect(() => {
    if (!restoreTaskId) return
    let cancelled = false
    getResumeGenerate(restoreTaskId, { token: getToken() })
      .then((res) => {
        if (cancelled) return
        setResult(res)
        setResume(res.resume ?? null)
      })
      .catch(() => {
        // 读不回（过期 / 非本人 / 网络）→ 走下方诚实空态引导重新生成
      })
      .finally(() => {
        if (!cancelled) setRestoring(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreTaskId])

  if (restoring) {
    return (
      <KioskPageFrame className="fusion-w3 fusion-w3--resume"><main data-kiosk-domain="resume" data-kiosk-screen="resume-generate-preview" className="resume-lightflow resume-generate-preview-lightflow resume-lightflow__state flex h-full flex-col items-center justify-center gap-3 px-6 text-neutral-400">
        <p className="text-base">正在读取生成结果…</p>
      </main></KioskPageFrame>
    )
  }

  if (!result || !resume) {
    // 刷新 / 待机后内存态丢失(公共设备隐私设计):引导重新生成
    return (
      <KioskPageFrame className="fusion-w3 fusion-w3--resume"><main data-kiosk-domain="resume" data-kiosk-screen="resume-generate-preview" className="resume-lightflow resume-generate-preview-lightflow resume-lightflow__state flex h-full flex-col items-center justify-center gap-4 px-6">
        <AlertCircleIcon className="h-10 w-10 text-neutral-300" aria-hidden="true" />
        <p className="text-base text-neutral-500">生成结果已清除(公共设备不保留个人信息)</p>
        <Button size="lg" onClick={() => navigate('/resume/generate')}>重新填写生成</Button>
      </main></KioskPageFrame>
    )
  }

  const isMock = result.providerName === 'mock'
  const hints = result.missingHints ?? []

  const handleExport = async () => {
    setExporting(true)
    setError(null)
    try {
      const file = await exportGeneratedResume(resume, result.taskId, getToken())
      setExported(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败，请稍后重试')
    } finally {
      setExporting(false)
    }
  }

  const handlePrint = () => {
    if (!exported?.printFileUrl) return
    navigate('/print/confirm', {
      state: {
        file: {
          name: exported.filename,
          size: exported.sizeBytes >= 1024 * 1024
            ? `${(exported.sizeBytes / 1024 / 1024).toFixed(1)} MB`
            : `${Math.max(1, Math.round(exported.sizeBytes / 1024))} KB`,
          pages: exported.pageCount,
          fileId: exported.fileId,
          fileUrl: exported.printFileUrl,
          mimeType: 'application/pdf',
        },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  return (
    <KioskPageFrame className="fusion-w3 fusion-w3--resume">
    <main data-kiosk-domain="resume" data-kiosk-screen="resume-generate-preview" className="resume-lightflow resume-generate-preview-lightflow flex h-full flex-col">
      <div className="resume-lightflow__header px-6 pt-6">
        <KioskPageHeader
          title="简历预览"
          description="轻触段落进入编辑；内容修改后需重新生成 PDF 再打印"
          onBack={() => navigate('/resume/generate')}
          backLabel="重新填写"
        />
        {isMock && (
          <div className="resume-lightflow__notice mt-3 flex items-start gap-2 rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning-fg">
            <FlaskConicalIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>当前为演示模式生成的内容(未接入真实 AI 模型)，仅用于体验流程；正式环境由管理员配置 AI 模型后生效。</p>
          </div>
        )}
        <div className="resume-lightflow__stepper mt-4">
          <Stepper steps={GENERATE_PREVIEW_STEPS} currentIndex={1} />
        </div>
      </div>

      <div className="resume-lightflow__content mt-4 min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <div className="flex min-h-full gap-5">

          {/* 左：可编辑简历纸面 */}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <Card className="resume-lightflow__work-card resume-lightflow__paper p-6">
              <div className="resume-lightflow__paper-header border-b-2 border-primary-600 pb-3">
                <p className="text-2xl font-bold text-neutral-900">{resume.basic.name}</p>
                <p className="mt-1 text-sm text-neutral-500">
                  {[
                    resume.intention.position ? `求职意向:${resume.intention.position}` : '',
                    resume.intention.city ? `意向城市:${resume.intention.city}` : '',
                    resume.basic.phone ? `电话:${resume.basic.phone}` : '',
                    resume.basic.email ? `邮箱:${resume.basic.email}` : '',
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>

              <div className="mt-4 space-y-5">
                <div>
                  <SectionTitle title="个人简介" />
                  <textarea
                    className={`${taCls} h-20 resize-none`}
                    value={resume.summary}
                    placeholder="(空)可手动填写,或返回上一步补充自我评价后重新生成"
                    onChange={(e) => setResume((r) => r ? { ...r, summary: e.target.value.slice(0, 600) } : r)}
                  />
                </div>

                {resume.education.length > 0 && (
                  <div>
                    <SectionTitle title="教育经历" />
                    <div className="space-y-3">
                      {resume.education.map((e, i) => (
                        <div key={i}>
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="text-sm font-semibold text-neutral-800">
                              {[e.school, e.major, e.degree].filter(Boolean).join(' · ')}
                            </p>
                            {e.period && <p className="shrink-0 text-xs text-neutral-400">{e.period}</p>}
                          </div>
                          <textarea
                            className={`${taCls} mt-1.5 h-16 resize-none`}
                            value={e.description ?? ''}
                            placeholder="(无描述)"
                            onChange={(ev) => setResume((r) => r ? {
                              ...r,
                              education: r.education.map((x, idx) => idx === i ? { ...x, description: ev.target.value.slice(0, 1000) } : x),
                            } : r)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {resume.experience.length > 0 && (
                  <div>
                    <SectionTitle title="实习 / 工作经历" />
                    <div className="space-y-3">
                      {resume.experience.map((e, i) => (
                        <div key={i}>
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="text-sm font-semibold text-neutral-800">{e.company} · {e.role}</p>
                            {e.period && <p className="shrink-0 text-xs text-neutral-400">{e.period}</p>}
                          </div>
                          <textarea
                            className={`${taCls} mt-1.5 h-20 resize-none`}
                            value={e.description}
                            onChange={(ev) => setResume((r) => r ? {
                              ...r,
                              experience: r.experience.map((x, idx) => idx === i ? { ...x, description: ev.target.value.slice(0, 1000) } : x),
                            } : r)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {resume.projects.length > 0 && (
                  <div>
                    <SectionTitle title="项目经历" />
                    <div className="space-y-3">
                      {resume.projects.map((p, i) => (
                        <div key={i}>
                          <p className="text-sm font-semibold text-neutral-800">{p.role ? `${p.name} · ${p.role}` : p.name}</p>
                          <textarea
                            className={`${taCls} mt-1.5 h-20 resize-none`}
                            value={p.description}
                            onChange={(ev) => setResume((r) => r ? {
                              ...r,
                              projects: r.projects.map((x, idx) => idx === i ? { ...x, description: ev.target.value.slice(0, 1000) } : x),
                            } : r)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {resume.skills.length > 0 && (
                  <div>
                    <SectionTitle title="技能" />
                    <div className="flex flex-wrap gap-2">
                      {resume.skills.map((s, i) => (
                        <span key={i} className="rounded-lg bg-primary-50 px-2.5 py-1 text-sm text-primary-700">{s}</span>
                      ))}
                    </div>
                  </div>
                )}

                {resume.certificates.length > 0 && (
                  <div>
                    <SectionTitle title="证书 / 资质" />
                    <p className="text-sm text-neutral-700">{resume.certificates.join(' · ')}</p>
                  </div>
                )}
              </div>
            </Card>

            <p className="flex items-center gap-1.5 text-xs text-neutral-400">
              <PencilLineIcon className="h-3.5 w-3.5" aria-hidden="true" />
              所有描述均可直接点击修改；事实信息(学校/公司/证书)以你填写的为准，AI 未做任何添加。
            </p>
            {error && <p className="rounded-xl bg-error-bg px-4 py-3 text-sm text-error-fg">{error}</p>}
          </div>

          {/* 右：建议补充 + PDF 状态 + 说明 */}
          <div className="flex w-[340px] flex-none flex-col gap-4">
            {hints.length > 0 && (
              <Card className="resume-lightflow__work-card p-5">
                <p className="mb-3 text-base font-semibold text-neutral-800">建议补充</p>
                <p className="mb-2 text-xs text-neutral-400">AI 不会替你编造这些内容</p>
                <ul className="flex flex-col gap-2">
                  {hints.map((h, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-xl border border-warning-bg bg-warning-bg px-3 py-2.5 text-sm text-warning-fg">
                      <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      {h}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {exported && (
              <Card className="resume-lightflow__export-card p-5">
                <p className="flex items-center gap-2 text-base font-semibold text-success-fg">
                  <CheckCircle2Icon className="h-5 w-5" aria-hidden="true" />
                  PDF 已生成
                </p>
                <p className="mt-1 text-sm text-success-fg">
                  {exported.filename} · {exported.pageCount} 页
                  {exported.sizeBytes > 0 ? ` · ${Math.max(1, Math.round(exported.sizeBytes / 1024))} KB` : ''}
                  {exported.printFileUrl ? ' · 打印链接已就绪' : ''}
                </p>
                {!exported.printFileUrl && (
                  <p className="mt-1 text-xs text-warning-fg">{exported.signedUrl ? '打印链接未就绪，请重新导出后再试。' : '演示模式未生成真实文件，暂不可打印。'}</p>
                )}
                <p className="mt-1 flex items-center gap-1 text-xs text-success-fg/80">
                  <ShieldCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  文件短期保留后自动清理，本机不长期保存你的简历。
                </p>
              </Card>
            )}

            <Card className="resume-lightflow__work-card p-5">
              <p className="mb-3 text-base font-semibold text-neutral-800">说明</p>
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-2 text-xs leading-relaxed text-neutral-500">
                  <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
                  AI 生成内容，仅供参考；请核对每一段信息属实后再导出使用。
                </div>
                <div className="flex items-start gap-2 text-xs leading-relaxed text-neutral-500">
                  <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
                  简历仅供个人保存与打印，系统不收取求职者简历给企业。
                </div>
              </div>
            </Card>
          </div>

        </div>
      </div>

      {/* 底部操作条 */}
      <KioskActionBar className="resume-lightflow__action-bar border-t border-neutral-100 px-6 pb-6 pt-3">
        <div className="flex gap-3">
          {!exported ? (
            <Button
              size="lg"
              className="flex flex-1 items-center justify-center gap-2"
              disabled={exporting}
              onClick={() => void handleExport()}
            >
              <FileDownIcon className="h-5 w-5" />
              {exporting ? '正在生成 PDF…' : '确认内容，导出 PDF'}
            </Button>
          ) : (
            <>
              <Button size="lg" variant="secondary" className="flex-1" disabled={exporting} onClick={() => void handleExport()}>
                重新导出
              </Button>
              <Button
                size="lg"
                className="flex flex-[2] items-center justify-center gap-2"
                disabled={!exported.printFileUrl}
                onClick={handlePrint}
              >
                <PrinterIcon className="h-5 w-5" />
                去打印这份简历
              </Button>
            </>
          )}
        </div>
      </KioskActionBar>
    </main>
    </KioskPageFrame>
  )
}
