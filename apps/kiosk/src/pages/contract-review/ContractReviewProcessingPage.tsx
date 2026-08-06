// ============================================================
// 合同审查 — 分析中（步骤 2/3）
//
// 轮询后端状态，展示各阶段进度。awaiting_confirmation 时弹窗
// 让用户确认页数/OCR 覆盖，再推进到 AI 分析。
// completed → 跳结果页；failed/cancelled → 错误提示。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Button,
  KioskModal,
  KioskPageFrame,
  KioskPageHeader,
} from '@ai-job-print/ui'
import type { ContractReviewTaskView, ContractType } from '@ai-job-print/shared'
import {
  BrainCircuitIcon,
  CheckIcon,
  ClipboardCheckIcon,
  FileSearchIcon,
  Loader2Icon,
  ShieldCheckIcon,
  XCircleIcon,
} from 'lucide-react'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { KioskFullscreenShell } from '../../components/kiosk-shell/KioskFullscreenShell'
import {
  confirmContractReview,
  deleteContractReview,
  getContractReview,
} from '../../services/api/contractReview'
import './contract-review.css'

interface PageState {
  taskId?: string
  accessToken?: string | null
  contractType?: ContractType
}

const STAGES = [
  {
    key: 'extracting',
    label: 'OCR 文字提取',
    desc: '识别合同页面中的文字内容',
    Icon: FileSearchIcon,
  },
  {
    key: 'awaiting_confirmation',
    label: '提取完成确认',
    desc: '请确认页数与内容覆盖情况',
    Icon: ClipboardCheckIcon,
  },
  {
    key: 'rule_checking',
    label: '规则集检测',
    desc: '对照劳动法规定逐条检查',
    Icon: ShieldCheckIcon,
  },
  {
    key: 'ai_analyzing',
    label: 'AI 深度分析',
    desc: '理解合同语境，识别潜在风险',
    Icon: BrainCircuitIcon,
  },
  {
    key: 'safety_reviewing',
    label: '安全门审核',
    desc: '合规性最终核验',
    Icon: ShieldCheckIcon,
  },
] as const

const STAGE_ORDER: string[] = [
  'queued',
  'extracting',
  'awaiting_confirmation',
  'rule_checking',
  'ai_analyzing',
  'safety_reviewing',
  'completed',
]

function stageProgress(status: string): number {
  const idx = STAGE_ORDER.indexOf(status)
  if (idx < 0) return 0
  return Math.round((idx / (STAGE_ORDER.length - 1)) * 100)
}


export function ContractReviewProcessingPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as PageState

  const taskId = state.taskId ?? ''
  const accessToken = state.accessToken ?? null
  const contractType: ContractType = state.contractType ?? 'labor_contract'

  const [task, setTask] = useState<ContractReviewTaskView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useBusyLock(confirming || cancelling)

  const poll = useCallback(async () => {
    if (!taskId || !mountedRef.current) return
    try {
      const t = await getContractReview(taskId, { accessToken })
      if (!mountedRef.current) return
      setTask(t)

      if (t.status === 'completed') {
        navigate('/contract-review/result', {
          replace: true,
          state: { taskId, accessToken, result: t.result, contractType: t.contractType },
        })
        return
      }
      if (t.status === 'failed' || t.status === 'cancelled' || t.status === 'expired') {
        setError(
          t.status === 'expired'
            ? '审查任务已超时，请重新上传合同'
            : '审查任务失败，请重新上传合同',
        )
        return
      }
      if (t.status === 'awaiting_confirmation') {
        setShowConfirmModal(true)
        return
      }
      // 继续轮询
      pollRef.current = setTimeout(poll, 2500)
    } catch {
      if (!mountedRef.current) return
      setError('获取任务状态失败，请稍后重试')
    }
  }, [taskId, accessToken, contractType, navigate])

  useEffect(() => {
    if (!taskId) {
      navigate('/contract-review', { replace: true })
      return
    }
    mountedRef.current = true
    poll()
    return () => {
      mountedRef.current = false
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [taskId, poll, navigate])

  async function handleConfirm() {
    if (!task) return
    setShowConfirmModal(false)
    setConfirming(true)
    try {
      await confirmContractReview(
        taskId,
        {
          contractType,
          totalPages: task.totalPages ?? task.analyzedPages,
          analyzedPages: task.analyzedPages,
          truncated: task.truncated,
        },
        { accessToken },
      )
      pollRef.current = setTimeout(poll, 1500)
    } catch {
      setError('确认失败，请重试')
    } finally {
      if (mountedRef.current) setConfirming(false)
    }
  }

  async function handleCancel() {
    setCancelling(true)
    await deleteContractReview(taskId, { accessToken })
    navigate('/contract-review', { replace: true })
  }

  const progress = task ? stageProgress(task.status) : 0
  const circumference = 2 * Math.PI * 70 // r=70
  const dashOffset = circumference - (circumference * progress) / 100

  if (error) {
    return (
      <KioskFullscreenShell>
        <main className="flex min-h-0 flex-1 flex-col">
          <KioskPageFrame
            className="fusion-w3 fusion-w3--resume"
            header={
              <KioskPageHeader
                title="AI 合同审查"
                description="分析中"
                onBack={() => navigate('/contract-review', { replace: true })}
                backLabel="返回"
              />
            }
          >
          <div className="cr-done-screen">
            <div className="cr-done-screen__icon" style={{ background: 'var(--error-soft)', color: 'var(--error)' }}>
              <XCircleIcon size={52} />
            </div>
            <p className="cr-done-screen__title">审查未完成</p>
            <p className="cr-done-screen__sub">{error}</p>
            <Button size="lg" onClick={() => navigate('/contract-review', { replace: true })}>
              重新上传
            </Button>
          </div>
          </KioskPageFrame>
        </main>
      </KioskFullscreenShell>
    )
  }

  return (
    <KioskFullscreenShell>
      <main className="flex min-h-0 flex-1 flex-col">
        <KioskPageFrame
          className="fusion-w3 fusion-w3--resume"
          header={
            <KioskPageHeader
              title="AI 合同审查"
              description="正在分析，请稍候…"
              onBack={undefined}
            />
          }
        >
        {/* 步骤指示器 */}
        <div className="cr-steps">
          <div className="cr-step cr-step--done">
            <div className="cr-step__dot">✓</div>
            <span className="cr-step__label">上传合同</span>
          </div>
          <div className="cr-step-line cr-step-line--done" />
          <div className="cr-step cr-step--active">
            <div className="cr-step__dot">2</div>
            <span className="cr-step__label">AI 分析</span>
          </div>
          <div className="cr-step-line" />
          <div className="cr-step">
            <div className="cr-step__dot">3</div>
            <span className="cr-step__label">查看结果</span>
          </div>
        </div>

        <div className="cr-progress-shell">
          {/* 环形进度 */}
          <div className="cr-progress-ring">
            <svg className="cr-progress-ring__svg" viewBox="0 0 160 160">
              <circle className="cr-progress-ring__bg" cx="80" cy="80" r="70" />
              <circle
                className="cr-progress-ring__fg"
                cx="80"
                cy="80"
                r="70"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="cr-progress-ring__center">
              {progress === 100 ? (
                <CheckIcon size={44} style={{ color: 'var(--teal)' }} />
              ) : (
                <>
                  <span className="cr-progress-ring__pct">{progress}%</span>
                  <span className="cr-progress-ring__sub">分析中</span>
                </>
              )}
            </div>
          </div>

          {/* 阶段列表 */}
          <div className="cr-stage-list">
            {STAGES.map((stage) => {
              const currentIdx = task ? STAGE_ORDER.indexOf(task.status) : 0
              const stageIdx = STAGE_ORDER.indexOf(stage.key)
              const isDone = currentIdx > stageIdx
              const isActive = task?.status === stage.key || (task?.status === 'queued' && stage.key === 'extracting')
              const isActive2 = isActive && !isDone

              return (
                <div
                  key={stage.key}
                  className={[
                    'cr-stage-item',
                    isDone ? 'cr-stage-item--done' : '',
                    isActive2 ? 'cr-stage-item--active' : '',
                  ].join(' ')}
                >
                  <div className="cr-stage-item__icon">
                    {isDone ? (
                      <CheckIcon size={26} />
                    ) : isActive2 ? (
                      <Loader2Icon size={26} className="animate-spin" />
                    ) : (
                      <stage.Icon size={26} />
                    )}
                  </div>
                  <div className="cr-stage-item__text">
                    <div className="cr-stage-item__name">{stage.label}</div>
                    <div className="cr-stage-item__desc">{stage.desc}</div>
                  </div>
                  {isDone && <span className="cr-stage-item__status">完成</span>}
                  {isActive2 && <span className="cr-stage-item__status">进行中</span>}
                </div>
              )
            })}
          </div>

          <Button
            variant="ghost"
            size="sm"
            disabled={cancelling}
            onClick={handleCancel}
            style={{ marginTop: 8, color: 'var(--muted)' }}
          >
            {cancelling ? <Loader2Icon size={18} className="animate-spin mr-1" /> : null}
            取消审查
          </Button>
        </div>
        </KioskPageFrame>
      </main>

      {/* awaiting_confirmation 确认弹窗 */}
      {showConfirmModal && task && (
        <KioskModal
          title="确认文件提取结果"
          open={showConfirmModal}
          onClose={() => setShowConfirmModal(false)}
          actions={
            <div style={{ display: 'flex', gap: 16 }}>
              <Button variant="ghost" onClick={handleCancel} style={{ flex: 1 }}>
                取消审查
              </Button>
              <Button onClick={handleConfirm} disabled={confirming} style={{ flex: 2 }}>
                {confirming ? <Loader2Icon size={18} className="animate-spin mr-1" /> : null}
                确认，开始分析
              </Button>
            </div>
          }
        >
          <div className="cr-confirm-modal">
            <div className="cr-confirm-modal__info">
              文字提取完成，请确认以下信息后继续 AI 分析。
              {task.ocrConfidence === 'low' && (
                <p style={{ marginTop: 8, color: 'var(--error)', fontWeight: 700 }}>
                  ⚠️ 部分页面识别置信度偏低，建议确认原件图像清晰度。
                </p>
              )}
            </div>
            <div>
              <div className="cr-confirm-modal__row">
                <span>识别页数</span>
                <span>
                  {task.analyzedPages} / {task.totalPages ?? task.analyzedPages} 页
                  {task.truncated && '（已截断）'}
                </span>
              </div>
              <div className="cr-confirm-modal__row">
                <span>识别质量</span>
                <span>
                  {task.ocrConfidence === 'high'
                    ? '高'
                    : task.ocrConfidence === 'medium'
                      ? '中'
                      : '低'}
                </span>
              </div>
              <div className="cr-confirm-modal__row">
                <span>合同类型</span>
                <span>
                  {contractType === 'labor_contract'
                    ? '劳动合同'
                    : contractType === 'internship_agreement'
                      ? '实习协议'
                      : contractType === 'non_compete'
                        ? '竞业限制协议'
                        : '录用通知书'}
                </span>
              </div>
            </div>
            <p style={{ fontSize: 17, color: 'var(--muted)', lineHeight: 1.55 }}>
              本次分析结果仅作风险提示，不构成正式法律意见。重大争议请咨询律师或官方窗口。
            </p>
          </div>
        </KioskModal>
      )}
    </KioskFullscreenShell>
  )
}
