// ============================================================
// P11 岗位匹配 · 差距行动清单（S2-2 拆页）。
//
// 拆页依据（`ai-capability-wiring-matrix-2026-08-16.md` §3.5）：
//   职责 —— 只列「要补什么、怎么补、本机能不能补」，并直连打印 / 简历优化 / 材料工厂。
//   入口 —— 比对结果页的「我要补这些差距」。
//   返回 —— 回比对结果页。
//   判据 —— 比对页专心做「差在哪」，行动页专心做「怎么办」。
//
// 合规（CLAUDE.md §2 / compliance-boundary §4）：
//   本页只做「改简历、备材料、打印」三件本机能做的事。
//   **不出现任何投递动作** —— 岗位只是第三方来源信息，投递一律回来源平台完成。
//   底部来源卡的 CTA 用白名单里的「查看岗位」，跳回岗位详情页，由那里承载来源平台入口；
//   本页不自建第二个外跳入口，也不复述投递类文案。
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import type { JobFitResponse } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import { AlertCircleIcon, Loader2Icon, PencilLineIcon, PrinterIcon } from 'lucide-react'
import {
  AiDisclaimerLine,
  AigcMark,
  AiTaskRegion,
  EvidenceLegend,
  aiErrorMessageOf,
  deriveAiAvailability,
  isAiOutage,
  useAiTask,
  type AiTaskFallback,
} from '../../ai'
import { getLatestJobFit, printJobFit } from '../../services/api/jobFit'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { readAiResumeSession } from './aiResumeSession'
import { GapActionCards } from './jobFit/GapActionCards'
import { ResumeRewriteCard } from './jobFit/ResumeRewriteCard'
import './jobFit-inkpaper.css'
import './jobFit-inkpaper-ext.css'
import './resume-fusion-youth.css'
import './job-fit-actions.css'

const JOB_FIT_ROUTE = '/resume/job-fit'

export function JobFitActionsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = location.state as Record<string, unknown> | null

  const session = useMemo(() => readAiResumeSession(), [])
  const queryTaskId = useMemo(
    () => new URLSearchParams(location.search).get('taskId') ?? undefined,
    [location.search],
  )
  const currentToken = getToken()
  const stateTaskId = typeof state?.taskId === 'string' ? state.taskId : undefined
  const taskId = stateTaskId ?? queryTaskId ?? session?.taskId
  const usingSessionTask = !stateTaskId && !queryTaskId && Boolean(session?.taskId)
  const accessToken =
    (typeof state?.accessToken === 'string' ? state.accessToken : undefined) ??
    (usingSessionTask ? session?.accessToken : undefined)
  /** 与 JobFitPage 同一判据：无会员 token 但持匿名一次性令牌 = 匿名会话。 */
  const isAnonymous = !currentToken && Boolean(accessToken)

  const [result, setResult] = useState<JobFitResponse | null>(null)
  const [loading, setLoading] = useState(Boolean(taskId))
  const [aiOutage, setAiOutage] = useState<string | null>(null)
  const [probed, setProbed] = useState(false)
  const [failReason, setFailReason] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBusyLock(printing)

  useEffect(() => {
    if (!taskId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    getLatestJobFit(taskId, { token: getToken(), accessToken })
      .then((res) => {
        if (cancelled) return
        setProbed(true)
        if (res.status === 'completed') {
          setResult(res)
          if ((res.gapPoints ?? []).length === 0 && (res.targetedSuggestions ?? []).length === 0) {
            setFailReason('这次没有生成差距与准备建议。')
          }
        } else {
          setFailReason(res.failReason || '这次没有生成差距与准备建议。')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (isAiOutage(err)) {
          setAiOutage(aiErrorMessageOf(err, 'AI 服务当前不可用'))
          return
        }
        setProbed(true)
        setFailReason(aiErrorMessageOf(err, '匹配结果读取失败'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [taskId, accessToken, getToken])

  const availability = deriveAiAvailability({ outage: aiOutage, probed })

  const hasActions =
    (result?.gapPoints ?? []).length > 0 || (result?.targetedSuggestions ?? []).length > 0

  const task = useAiTask({
    availability,
    pending: loading,
    failed: Boolean(failReason),
    hasResult: hasActions,
  })

  const backToCompare = () =>
    navigate(JOB_FIT_ROUTE, { state: taskId ? { taskId, accessToken } : undefined })

  const goResumeOptimize = () =>
    navigate('/resume/optimize', { state: taskId ? { taskId, accessToken } : undefined })

  /**
   * 打印差距清单走既有 `POST /resume/job-fit/:taskId/print`，
   * 与比对页同一个端点、同一份 PDF —— 不为本页另造一种产物。
   * `printFileUrl` 缺失时诚实报错，不静默跳转到一个打不出东西的确认页。
   */
  const handlePrint = async () => {
    if (!taskId) return
    setPrinting(true)
    setError(null)
    try {
      const file = await printJobFit(taskId, { token: getToken(), accessToken })
      if (!file.printFileUrl) throw new Error('打印链接未就绪，请稍后重试')
      navigate('/print/confirm', {
        state: {
          file: {
            name: file.filename,
            size:
              file.sizeBytes >= 1024 * 1024
                ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB`
                : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`,
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

  /**
   * 降级两类：
   *  blocked            差距清单由 AI 生成，本页有「重新读取」入口 → 置灰 + 常显原因。
   *  result-unavailable 服务通了但这次没出清单 → 结果区说清这次没有，保留返回入口。
   *
   * 两类都保证「AI 挂了仍拿得到东西」：岗位原文照常可看，简历原文照常可打印，
   * 简历优化编辑区照常能改。这不是安慰话 —— 那三条都不经过本页这条 AI 链路。
   */
  const fallback: AiTaskFallback = aiOutage
    ? {
        mode: 'blocked',
        reason: `${aiOutage} —— 差距与准备建议由 AI 生成，这次生成不了。`,
        blockedActionLabel: '重新读取差距清单',
        stillAvailable:
          '岗位原文与来源信息照常可看；你的简历原文照常可打印；简历优化编辑区也照常能改。想投递请回岗位详情页，从来源平台入口走。',
        action: { label: '返回比对结果', onClick: backToCompare },
      }
    : {
        mode: 'result-unavailable',
        reason: failReason
          ? `本次没有可执行的差距清单：${failReason}`
          : '本次没有可执行的差距清单。',
        retryHint:
          '这不是你的操作问题。可以回比对结果页重新分析一次；若这个岗位的要求写得很笼统，通常就抽不出可执行的差距项。',
        action: { label: '返回比对结果', onClick: backToCompare },
      }

  if (!taskId) {
    return (
      <KioskPageFrame className="fusion-w3 fusion-w3--resume">
        <main
          data-kiosk-domain="resume"
          data-kiosk-screen="resume-job-fit-actions"
          className="service-desk job-fit-inkpaper job-fit-actions flex h-full flex-col items-center justify-center gap-4 px-6"
          data-visual-theme="service-desk"
          data-ux-density="touch"
        >
          <div className="job-fit-state-card" role="alert">
            <AlertCircleIcon className="h-10 w-10 text-primary-600" aria-hidden="true" />
            <p className="text-base text-neutral-500">请先完成一次岗位匹配参考，再看差距行动清单</p>
            <Button size="lg" className="job-fit-primary-action" onClick={() => navigate(JOB_FIT_ROUTE)}>
              去做岗位匹配参考
            </Button>
          </div>
        </main>
      </KioskPageFrame>
    )
  }

  return (
    <KioskPageFrame className="fusion-w3 fusion-w3--resume">
      <main
        data-kiosk-domain="resume"
        data-kiosk-screen="resume-job-fit-actions"
        className="service-desk job-fit-inkpaper job-fit-actions flex h-full flex-col px-6 pt-6"
        data-visual-theme="service-desk"
        data-ux-density="touch"
      >
        <div className="job-fit-header">
          <KioskPageHeader
            title="差距行动清单"
            description={
              result?.job?.title
                ? `目标岗位：${result.job.title}${result.job.company ? ` · ${result.job.company}` : ''}`
                : '要补什么、怎么补、本机能不能补'
            }
            onBack={backToCompare}
            backLabel="返回比对结果"
          />
        </div>

        <div className="job-fit-content mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-28">
          <ComplianceBanner tone="info">
            以下内容仅为帮助你修改简历与准备材料的参考，不代表任何招聘结果；本平台不提供投递功能，投递请前往岗位来源平台。
          </ComplianceBanner>

          <AiTaskRegion
            task={task}
            label="AI 差距与准备建议"
            className="job-fit-actions__region"
            running={
              <div className="job-fit-state-card" role="status" aria-live="polite">
                <Loader2Icon
                  className="h-10 w-10 animate-spin text-primary-600"
                  aria-hidden="true"
                  data-ai-progress="spinner"
                />
                <p className="text-base text-neutral-500">正在读取差距清单…</p>
              </div>
            }
            /*
              同 `ResumeOptimizeComparePage`：availability 为 unknown 时状态恒为 idle，
              首次往返完成前也落在这里。读取中必须说「在读取」，
              不能把一次正常加载写成「服务状态未确认」。
            */
            idle={
              loading ? (
                <div className="job-fit-state-card" role="status" aria-live="polite">
                  <Loader2Icon
                    className="h-10 w-10 animate-spin text-primary-600"
                    aria-hidden="true"
                  />
                  <p className="text-base text-neutral-500">正在读取差距清单…</p>
                </div>
              ) : (
                <div className="job-fit-state-card" role="status">
                  <p className="text-base text-neutral-500">
                    还没有确认 AI 服务状态，本页暂不展示差距清单 —— 状态不明时不假装能算。
                  </p>
                  <Button size="lg" className="job-fit-primary-action" onClick={backToCompare}>
                    返回比对结果
                  </Button>
                </div>
              )
            }
            fallback={fallback}
          >
            <AiDisclaimerLine>
              以下差距与准备建议由 AI 依据你的简历与该岗位公开要求生成，仅供参考，不代表任何招聘结果。
            </AiDisclaimerLine>

            <GapActionCards gapPoints={result?.gapPoints ?? []} />
            <ResumeRewriteCard items={result?.targetedSuggestions ?? []} />

            {/* 本机能做什么：三件事都是真实存在的路径，不列做不到的。 */}
            <Card className="job-fit-card job-fit-actions__do p-5">
              <h2 className="job-fit-actions__do-title">本机现在能帮你做的</h2>
              <div className="job-fit-actions__do-grid">
                <Button
                  size="lg"
                  variant="secondary"
                  className="job-fit-actions__do-btn"
                  onClick={goResumeOptimize}
                >
                  <PencilLineIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />
                  按建议改简历
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  className="job-fit-actions__do-btn"
                  onClick={() => navigate('/resume/materials')}
                >
                  准备求职材料
                </Button>
                <Button
                  size="lg"
                  className="job-fit-actions__do-btn"
                  disabled={printing}
                  aria-busy={printing}
                  onClick={() => void handlePrint()}
                >
                  <PrinterIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />
                  {printing ? '正在生成打印版…' : '打印这份清单'}
                </Button>
              </div>
            </Card>

            <EvidenceLegend className="job-fit-actions__legend" />
            <AigcMark className="job-fit-actions__aigc" />
          </AiTaskRegion>

          {result?.job?.sourceName && (
            <Card className="job-fit-card job-fit-source p-5">
              <p className="text-xs text-neutral-400">
                岗位来源：{result.job.sourceName}
                {result.job.externalId ? ` · 外部ID ${result.job.externalId}` : ''}
              </p>
              <p className="mt-1 text-sm text-neutral-600">
                准备好之后，请前往来源平台完成投递。
              </p>
              {result.job.id && (
                <Button
                  size="lg"
                  variant="secondary"
                  className="job-fit-actions__source-btn mt-3"
                  onClick={() => navigate(`/jobs/${result.job?.id ?? ''}`)}
                >
                  查看岗位
                </Button>
              )}
            </Card>
          )}

          {isAnonymous && (
            <p className="job-fit-actions__anon-note">
              未登录时，本次结果只保留在这台机器的当前会话里，离场即清。
            </p>
          )}

          {error && (
            <p className="job-fit-alert rounded-xl bg-error-bg px-4 py-3 text-sm text-error-fg" role="alert">
              {error}
            </p>
          )}
        </div>
      </main>
    </KioskPageFrame>
  )
}
