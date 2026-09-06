// ============================================================
// AI 签约风险提示结果页（步骤 3/3）
//
// 展示统计概览（优先核查 / 关注 / 信息不足）+ 各风险项详情。
// 免责声明置顶，结果仅作参考；本人确认后可保存到我的文档，不可打印。
// ============================================================

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  KioskActionBar,
  KioskModal,
  KioskPageFrame,
  KioskPageHeader,
} from '@ai-job-print/ui'
import type { ContractReviewFinding } from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  HelpCircleIcon,
  HomeIcon,
  InfoIcon,
  Loader2Icon,
  SaveIcon,
  Trash2Icon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { KioskFullscreenShell } from '../../components/kiosk-shell/KioskFullscreenShell'
import { deleteContractReview, keepContractReviewReport } from '../../services/api/contractReview'
import { ContractReviewSessionNotice } from './ContractReviewSessionNotice'
import {
  clearContractReviewSession,
  readContractReviewSession,
} from './contractReviewSession'
import './contract-review.css'

const PRIORITY_LABELS: Record<string, string> = {
  priority_check: '优先核查',
  attention: '关注',
  insufficient_info: '信息不足',
}

const CATEGORY_LABELS: Record<string, string> = {
  parties: '合同主体',
  term: '合同期限',
  probation: '试用期',
  compensation: '薪酬待遇',
  position_location: '岗位与工作地点',
  working_time: '工作时间',
  social_insurance: '社保公积金',
  training_service: '培训服务期',
  penalty: '违约金',
  non_compete: '竞业限制',
  deposit_documents: '押金 / 证件',
  termination: '合同解除 / 终止',
  imbalance: '权利义务失衡',
  offer_conditions: '录用条件',
}

const KEEP_RETENTION_COPY =
  '保存后仅本人可在「我的文档」查看，保存期限 90 天，可随时删除。报告不会进入打印链路，也不会发给企业或合作机构。合同原件仍按短期策略删除。'

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`cr-priority-badge cr-priority-badge--${priority}`}>
      {PRIORITY_LABELS[priority] ?? priority}
    </span>
  )
}

function FindingCard({ finding }: { finding: ContractReviewFinding }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="cr-finding-card">
      <button
        type="button"
        className="cr-finding-card__header"
        style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <PriorityBadge priority={finding.priority} />
        <span className="cr-finding-card__title">{finding.title}</span>
        <span style={{ color: 'var(--muted)', flexShrink: 0 }}>
          {expanded ? <ChevronUpIcon size={24} /> : <ChevronDownIcon size={24} />}
        </span>
      </button>

      {expanded && (
        <div className="cr-finding-card__body">
          {/* 原文摘录 */}
          {finding.evidence.excerpt && (
            <div className="cr-finding-excerpt">
              {finding.evidence.pageNumber != null && (
                <div className="cr-finding-excerpt__page">
                  第 {finding.evidence.pageNumber} 页
                </div>
              )}
              「{finding.evidence.excerpt}」
            </div>
          )}

          {/* 说明 */}
          <p className="cr-finding-explanation">{finding.explanation}</p>

          {/* 法律依据 / 不确定性 */}
          <div className="cr-finding-meta">
            {finding.basisRef && (
              <div className="cr-finding-meta-row">
                <span className="cr-finding-meta-row__key">法律依据</span>
                <span className="cr-finding-meta-row__val">{finding.basisRef}</span>
              </div>
            )}
            <div className="cr-finding-meta-row">
              <span className="cr-finding-meta-row__key">条款类别</span>
              <span className="cr-finding-meta-row__val">
                {CATEGORY_LABELS[finding.category] ?? finding.category}
              </span>
            </div>
            {finding.uncertainty && finding.uncertainty !== '无' && (
              <div className="cr-finding-meta-row">
                <span className="cr-finding-meta-row__key">局限性</span>
                <span className="cr-finding-meta-row__val">{finding.uncertainty}</span>
              </div>
            )}
          </div>

          {/* 建议追问 */}
          {finding.verificationQuestion && finding.verificationQuestion !== '无' && (
            <div className="cr-finding-question">{finding.verificationQuestion}</div>
          )}
        </div>
      )}
    </div>
  )
}

export function ContractReviewResultPage() {
  const navigate = useNavigate()
  const { getToken, user } = useAuth()
  const session = readContractReviewSession(user?.id ?? null)
  const result = session?.result ?? null
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [showKeepConfirm, setShowKeepConfirm] = useState(false)
  const [keeping, setKeeping] = useState(false)
  const [keepError, setKeepError] = useState<string | null>(null)
  const [keepDone, setKeepDone] = useState(false)

  useBusyLock(deleting || keeping)

  const canKeep = Boolean(user?.id && session?.taskId)
  const keepDisabledReason = user?.id
    ? null
    : '保存到「我的文档」需要先登录本人会员账号'

  async function continueKeep() {
    if (!canKeep || keeping || !session?.taskId) return
    setKeeping(true)
    setKeepError(null)
    try {
      const kept = await keepContractReviewReport(session.taskId, {
        token: getToken(),
        accessToken: session.accessToken,
      })
      if (!kept.savedToDocuments) {
        throw new Error('SAVE_NOT_CONFIRMED')
      }
      setKeepDone(true)
      setShowKeepConfirm(false)
    } catch {
      setKeepError('保存失败。请确认已登录后重试。当前不会进入打印或收费流程。')
    } finally {
      setKeeping(false)
    }
  }

  async function deleteAndNavigate(destination: '/contract-review' | '/resume-service') {
    if (deleting) return
    if (!session?.taskId) {
      clearContractReviewSession()
      navigate(destination, { replace: true })
      return
    }
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteContractReview(session.taskId, {
        token: getToken(),
        accessToken: session.accessToken,
      })
      clearContractReviewSession()
      navigate(destination, { replace: true })
    } catch {
      setDeleteError('立即删除失败，合同仍可能处于短期保留状态。请重试；系统仍会按最长保留时限自动清理。')
    } finally {
      setDeleting(false)
    }
  }

  // 若直接进入此页但没有结果（刷新/深链），回首页
  if (!result) {
    return (
      <KioskFullscreenShell>
        <main className="flex min-h-0 flex-1 flex-col">
          <KioskPageFrame
            className="fusion-w3 fusion-w3--resume"
            header={
              <KioskPageHeader
                title="AI 签约风险提示"
                description="结果"
                onBack={() => void deleteAndNavigate('/contract-review')}
                backLabel="返回"
              />
            }
          >
          <div className="cr-done-screen">
            <div className="cr-done-screen__icon">
              <HelpCircleIcon size={52} />
            </div>
            <p className="cr-done-screen__title">未找到审查结果</p>
            <p className="cr-done-screen__sub">
              {deleteError ?? '请重新上传合同进行审查'}
            </p>
            <Button size="lg" disabled={deleting} onClick={() => void deleteAndNavigate('/contract-review')}>
              重新上传
            </Button>
          </div>
          </KioskPageFrame>
        </main>
      </KioskFullscreenShell>
    )
  }

  const priorityFindings = result.findings.filter((f) => f.priority === 'priority_check')
  const attentionFindings = result.findings.filter((f) => f.priority === 'attention')
  const infoFindings = result.findings.filter((f) => f.priority === 'insufficient_info')

  return (
    <KioskFullscreenShell>
      <main className="flex min-h-0 flex-1 flex-col">
        <KioskPageFrame
          className="fusion-w3 fusion-w3--resume"
          header={
            <KioskPageHeader
              title="审查结果"
              description="AI 签约风险提示 · 仅供参考"
              onBack={() => void deleteAndNavigate('/contract-review')}
              backLabel="重新审查"
            />
          }
          footer={
            <KioskActionBar>
            <Button
              variant="outline"
              size="lg"
              style={{ flex: 1 }}
              disabled={deleting}
              onClick={() => void deleteAndNavigate('/contract-review')}
            >
              <HomeIcon size={20} className="mr-2" />
              重新审查
            </Button>
            <Button
              size="lg"
              style={{ flex: 2 }}
              disabled={!canKeep || deleting || keeping || keepDone}
              aria-disabled={!canKeep || undefined}
              title={keepDisabledReason ?? (keepDone ? '已保存到我的文档' : '保存到我的文档')}
              onClick={() => {
                if (!canKeep) return
                setShowKeepConfirm(true)
              }}
            >
              {keeping
                ? <Loader2Icon size={20} className="mr-2 animate-spin" />
                : <SaveIcon size={20} className="mr-2" />}
              {keepDone ? '已保存到我的文档' : '保存到我的文档'}
            </Button>
            <Button
              size="lg"
              style={{ flex: 2 }}
              disabled={deleting}
              onClick={() => void deleteAndNavigate('/resume-service')}
            >
              {deleting
                ? <Loader2Icon size={20} className="mr-2 animate-spin" />
                : <Trash2Icon size={20} className="mr-2" />}
              结束并删除
            </Button>
            </KioskActionBar>
          }
        >
        {deleteError && (
          <div className="cr-disclaimer-banner" role="alert" style={{ color: 'var(--error)', borderColor: 'rgba(193,74,52,.3)', background: 'var(--error-soft)' }}>
            <AlertCircleIcon />
            <span>{deleteError}</span>
          </div>
        )}
        {keepError && (
          <div className="cr-disclaimer-banner" role="alert" style={{ color: 'var(--error)', borderColor: 'rgba(193,74,52,.3)', background: 'var(--error-soft)' }}>
            <AlertCircleIcon />
            <span>{keepError}</span>
          </div>
        )}
        {!canKeep && keepDisabledReason && (
          <div className="cr-disclaimer-banner" role="status">
            <InfoIcon />
            <span>{keepDisabledReason}</span>
          </div>
        )}
        {session && <ContractReviewSessionNotice expiresAt={session.expiresAt} />}
        {/* 步骤指示器 */}
        <div className="cr-steps">
          <div className="cr-step cr-step--done">
            <div className="cr-step__dot">✓</div>
            <span className="cr-step__label">上传合同</span>
          </div>
          <div className="cr-step-line cr-step-line--done" />
          <div className="cr-step cr-step--done">
            <div className="cr-step__dot">✓</div>
            <span className="cr-step__label">AI 分析</span>
          </div>
          <div className="cr-step-line cr-step-line--done" />
          <div className="cr-step cr-step--active">
            <div className="cr-step__dot">3</div>
            <span className="cr-step__label">查看结果</span>
          </div>
        </div>

        {/* 统计概览 */}
        <div className="cr-summary-bar">
          <div className="cr-summary-stat cr-summary-stat--critical">
            <div className="cr-summary-stat__num">{result.priorityCheckCount}</div>
            <div className="cr-summary-stat__label">
              <AlertCircleIcon size={16} style={{ display: 'inline', marginRight: 4 }} />
              优先核查
            </div>
          </div>
          <div className="cr-summary-stat cr-summary-stat--attention">
            <div className="cr-summary-stat__num">{result.attentionCount}</div>
            <div className="cr-summary-stat__label">
              <AlertTriangleIcon size={16} style={{ display: 'inline', marginRight: 4 }} />
              关注
            </div>
          </div>
          <div className="cr-summary-stat cr-summary-stat--info">
            <div className="cr-summary-stat__num">{result.insufficientInfoCount}</div>
            <div className="cr-summary-stat__label">
              <InfoIcon size={16} style={{ display: 'inline', marginRight: 4 }} />
              信息不足
            </div>
          </div>
        </div>

        {/* OCR 覆盖提示 */}
        {result.coverage === 'truncated' && (
          <div
            style={{
              display: 'flex',
              gap: 12,
              background: 'var(--wheat-soft)',
              border: '1px solid rgba(169,120,31,.3)',
              borderRadius: 'var(--r-sm)',
              padding: '14px 18px',
              fontSize: 19,
              color: 'var(--wheat-deep)',
              flexShrink: 0,
            }}
          >
            <AlertTriangleIcon size={22} style={{ flexShrink: 0 }} />
            合同页数超出分析上限，本次分析为部分覆盖，请对照纸质原件核查后续条款。
          </div>
        )}

        {/* 免责声明 */}
        <div className="cr-disclaimer-banner">
          <InfoIcon />
          <span>
            本结果由 AI 生成，<strong>仅作风险提示，不构成正式法律意见</strong>。
            重大争议请咨询律师或官方机构。点击“结束并删除”会立即请求清理合同原件；
            异常情况下仍按知情同意中的最长保留时限自动清理。
          </span>
        </div>

        {/* 风险项列表（可滚动） */}
        <div className="cr-results-list">
          {result.findings.length === 0 ? (
            <div className="cr-done-screen" style={{ flex: 'none', padding: '40px 0' }}>
              <div className="cr-done-screen__icon">
                <CheckCircle2Icon size={52} />
              </div>
              <p className="cr-done-screen__title">未发现明显风险项</p>
              <p className="cr-done-screen__sub">
                AI 未在本合同中发现明显风险条款，但仍建议您仔细阅读全文，
                重要条款请咨询专业律师。
              </p>
            </div>
          ) : (
            <>
              {priorityFindings.length > 0 && (
                <>
                  <p
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: 'var(--error)',
                      paddingTop: 4,
                    }}
                  >
                    ⚠️ 优先核查（{priorityFindings.length} 项）
                  </p>
                  {priorityFindings.map((f) => (
                    <FindingCard key={f.id} finding={f} />
                  ))}
                </>
              )}
              {attentionFindings.length > 0 && (
                <>
                  <p
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: 'var(--wheat-deep)',
                      paddingTop: 8,
                    }}
                  >
                    ⚡ 关注（{attentionFindings.length} 项）
                  </p>
                  {attentionFindings.map((f) => (
                    <FindingCard key={f.id} finding={f} />
                  ))}
                </>
              )}
              {infoFindings.length > 0 && (
                <>
                  <p
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: 'var(--slate-deep)',
                      paddingTop: 8,
                    }}
                  >
                    ℹ️ 信息不足（{infoFindings.length} 项）
                  </p>
                  {infoFindings.map((f) => (
                    <FindingCard key={f.id} finding={f} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
        </KioskPageFrame>
      </main>
      <KioskModal
        title="保存到我的文档"
        open={showKeepConfirm}
        onClose={() => !keeping && setShowKeepConfirm(false)}
        actions={
          <div style={{ display: 'flex', gap: 16 }}>
            <Button
              variant="ghost"
              disabled={keeping}
              onClick={() => setShowKeepConfirm(false)}
              style={{ flex: 1 }}
            >
              暂不保存
            </Button>
            <Button
              disabled={keeping}
              onClick={() => void continueKeep()}
              style={{ flex: 2 }}
            >
              {keeping
                ? <Loader2Icon size={18} className="animate-spin mr-1" />
                : <SaveIcon size={18} className="mr-1" />}
              确认保存 90 天
            </Button>
          </div>
        }
      >
        <div className="cr-confirm-modal">
          <div className="cr-confirm-modal__info">
            {KEEP_RETENTION_COPY}
          </div>
          <div>
            <div className="cr-confirm-modal__row"><span>保存位置</span><span>我的文档（仅本人）</span></div>
            <div className="cr-confirm-modal__row"><span>保存期限</span><span>90 天，可随时删除</span></div>
            <div className="cr-confirm-modal__row"><span>打印</span><span>不可打印</span></div>
          </div>
        </div>
      </KioskModal>
    </KioskFullscreenShell>
  )
}
