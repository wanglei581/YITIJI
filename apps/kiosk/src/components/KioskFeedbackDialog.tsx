// ============================================================
// 一体机「反馈问题」弹层（匿名可提交）。
//
// 为什么是页内弹层而不是跳转到 /me/feedback：
// /me/feedback 是会员面，必须登录。刚打印失败的人绝大多数没登录，
// 跳过去只会撞上登录墙 —— 那正是本批次要修的问题。本弹层直接打 POST /kiosk/feedback，
// 不带 token、不带 Cookie，任何人站在机器前都能提交。
//
// 三条诚实性红线（CLAUDE.md §9）：
//   1. 提交失败如实展示服务端返回的原因，绝不显示假成功。
//   2. 成功文案只承诺「会核实并现场处理」。**不承诺退款，也不承诺推送回复** ——
//      匿名工单没有账号归属，后台连回复入口都不渲染
//      （apps/admin/src/routes/member-feedback/index.tsx），
//      写「我们会回复你」就是承诺一件系统结构上做不到的事。
//   3. 命中服务端幂等窗口时如实说明「没有重复建单」，不假装又新建了一条。
//
// 合规：本弹层任何文案都不得出现「退款 / 申请退款 / 赔付 / 理赔」——
// 退款裁决权在后台，一体机只负责上报（PrintCashierPage 的
// 「本机不提供自助退款」继续为真）。由 verify:kiosk-feedback-entry 静态守护。
//
// 隐私：不提供联系方式输入框（后端 DTO 也没有该字段），
// 自由文本内的手机号 / 身份证 / 邮箱由服务端**拒绝**而非脱敏。
// ============================================================

import { useEffect, useState } from 'react'
import { KioskModal } from '@ai-job-print/ui'
import { AlertCircleIcon, CheckCircle2Icon, SendIcon } from 'lucide-react'
import {
  KIOSK_FEEDBACK_CONTENT_MAX,
  KioskFeedbackApiError,
  submitKioskFeedback,
  type KioskFeedbackIssueCode,
  type KioskFeedbackIssueOption,
  type KioskFeedbackReceipt,
  type KioskFeedbackSatisfaction,
} from '../services/api/kioskFeedback'
import './styles/kiosk-feedback-dialog.css'

const SATISFACTION_OPTIONS: readonly { value: KioskFeedbackSatisfaction; label: string }[] = [
  { value: 'good', label: '满意' },
  { value: 'fair', label: '一般' },
  { value: 'bad', label: '不满意' },
]

interface KioskFeedbackDialogProps {
  open: boolean
  onClose: () => void
  /** 本入口开放的问题类型子集。P06 打印完成页与 P39 打印 Hub 的词表不同。 */
  issueOptions: readonly KioskFeedbackIssueOption[]
  relatedPrintTaskId?: string | null
  relatedScanTaskId?: string | null
  /** 打印完成页额外收满意度评分；报障入口不需要。 */
  showSatisfaction?: boolean
  title?: string
  description?: string
}

export function KioskFeedbackDialog({
  open,
  onClose,
  issueOptions,
  relatedPrintTaskId,
  relatedScanTaskId,
  showSatisfaction = false,
  title = '反馈问题',
  description = '选择这次遇到的问题，工作人员会核实打印记录后现场处理',
}: KioskFeedbackDialogProps) {
  const [issueCode, setIssueCode] = useState<KioskFeedbackIssueCode | null>(null)
  const [satisfaction, setSatisfaction] = useState<KioskFeedbackSatisfaction | null>(null)
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<KioskFeedbackReceipt | null>(null)

  // 每次重新打开都回到干净表单，避免上一位用户的输入留在公共位设备上。
  useEffect(() => {
    if (open) return
    setIssueCode(null)
    setSatisfaction(null)
    setContent('')
    setSubmitting(false)
    setError(null)
    setReceipt(null)
  }, [open])

  const canSubmit = !submitting && (issueCode !== null || satisfaction !== null)

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const next = await submitKioskFeedback({
        ...(issueCode ? { issueCode } : {}),
        ...(satisfaction ? { satisfaction } : {}),
        ...(content.trim() ? { content: content.trim() } : {}),
        ...(relatedPrintTaskId ? { relatedPrintTaskId } : {}),
        ...(relatedScanTaskId ? { relatedScanTaskId } : {}),
      })
      setReceipt(next)
    } catch (caught) {
      // 如实展示：服务端给了原因就用服务端的（PII 拒绝 / 限流 / 终端无效），
      // 拿不到原因也不编造成功。
      setError(
        caught instanceof KioskFeedbackApiError
          ? caught.message
          : '提交失败，反馈未送出，请联系现场工作人员',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (receipt) {
    return (
      <KioskModal
        open={open}
        onClose={onClose}
        title="已收到你的反馈"
        closeLabel="关闭"
        actions={(
          <button type="button" className="kiosk-fb-btn kiosk-fb-btn-primary" onClick={onClose}>
            知道了
          </button>
        )}
      >
        <div className="kiosk-fb-result" data-kiosk-feedback-result="submitted">
          <CheckCircle2Icon className="kiosk-fb-result-icon" aria-hidden="true" />
          <p className="kiosk-fb-result-title">
            {receipt.deduplicated
              ? '这条反馈刚才已经提交过，系统没有重复建单'
              : '反馈已提交，工作人员会核实这次打印记录后现场处理'}
          </p>
          <p className="kiosk-fb-result-note">
            本次为匿名反馈，系统不会把处理结果推送到账号。
            如需当面跟进，请向现场工作人员出示下方反馈编号。
          </p>
          <div className="kiosk-fb-ticket">
            <span className="kiosk-fb-ticket-label">反馈编号</span>
            <span className="kiosk-fb-ticket-code">{receipt.ticketId}</span>
          </div>
        </div>
      </KioskModal>
    )
  }

  return (
    <KioskModal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      closeLabel="关闭"
      actions={(
        <>
          <button type="button" className="kiosk-fb-btn kiosk-fb-btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="kiosk-fb-btn kiosk-fb-btn-primary"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            <SendIcon aria-hidden="true" />
            {submitting ? '提交中…' : '提交反馈'}
          </button>
        </>
      )}
    >
      <div className="kiosk-fb-body">
        <div className="kiosk-fb-section" role="group" aria-label="问题类型">
          <p className="kiosk-fb-section-title">这次遇到的问题</p>
          <div className="kiosk-fb-options">
            {issueOptions.map((option) => (
              <button
                key={option.code}
                type="button"
                className="kiosk-fb-option"
                aria-pressed={issueCode === option.code}
                onClick={() => setIssueCode(issueCode === option.code ? null : option.code)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {showSatisfaction && (
          <div className="kiosk-fb-section" role="group" aria-label="满意度评分">
            <p className="kiosk-fb-section-title">本次服务评价（选填）</p>
            <div className="kiosk-fb-options">
              {SATISFACTION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="kiosk-fb-option"
                  aria-pressed={satisfaction === option.value}
                  onClick={() => setSatisfaction(satisfaction === option.value ? null : option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="kiosk-fb-section">
          <label className="kiosk-fb-section-title" htmlFor="kiosk-fb-content">
            补充说明（选填）
          </label>
          <textarea
            id="kiosk-fb-content"
            className="kiosk-fb-textarea"
            value={content}
            maxLength={KIOSK_FEEDBACK_CONTENT_MAX}
            disabled={submitting}
            placeholder="例如：第 3 页开始整页发黑"
            onChange={(event) => setContent(event.target.value)}
          />
          <p className="kiosk-fb-hint">
            请勿填写手机号、身份证号等个人信息；含个人信息的内容会被系统拒绝。
            已输入 {content.length} / {KIOSK_FEEDBACK_CONTENT_MAX} 字。
          </p>
        </div>

        {error && (
          <div className="kiosk-fb-error" role="alert" data-kiosk-feedback-error="true">
            <AlertCircleIcon aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </KioskModal>
  )
}

