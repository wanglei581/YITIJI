import type { Dispatch, SetStateAction } from 'react'
import { Button, Card } from '@ai-job-print/ui'
import { KIcon } from '../../../../components/kiosk-icon'
import type { FeedbackCategory } from '../../../../services/api/memberFeedback'
import { CATEGORY_OPTIONS, feedbackInputClass, type FeedbackFormState } from './types'

export function FeedbackFormPanel({
  form,
  relatedPrintTaskId,
  submitBusy,
  onFormChange,
  onSubmit,
}: {
  form: FeedbackFormState
  relatedPrintTaskId: string
  submitBusy: boolean
  onFormChange: Dispatch<SetStateAction<FeedbackFormState>>
  onSubmit: () => void
}) {
  return (
    <Card className="me-benefit-card">
      <div className="flex items-center justify-between gap-3">
        <div className="me-section-copy">
          <h2>提交反馈</h2>
          <p>请描述设备、打印、文件处理或页面建议</p>
        </div>
        <span className="me-row-icon me-tone-teal" aria-hidden="true">
          <KIcon name="feedback" />
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-[color:var(--muted)]">分类</span>
          <select
            className={feedbackInputClass}
            value={form.category}
            disabled={Boolean(relatedPrintTaskId)}
            onChange={(event) => onFormChange((value) => ({ ...value, category: event.target.value as FeedbackCategory }))}
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {relatedPrintTaskId && <span className="text-xs font-semibold text-[#85611f]">关联打印订单时固定为打印服务</span>}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-[color:var(--muted)]">联系电话（选填）</span>
          <input
            className={feedbackInputClass}
            value={form.contactPhone}
            onChange={(event) => onFormChange((value) => ({ ...value, contactPhone: event.target.value }))}
            inputMode="tel"
            maxLength={11}
            placeholder="便于必要时联系确认设备或文件问题"
          />
        </label>
      </div>

      {relatedPrintTaskId && (
        <div className="me-note mt-3 px-4 py-3">
          <p className="text-xs font-bold text-[#85611f]">已关联打印订单</p>
          <p className="mt-1 break-all text-xs text-[#85611f]">{relatedPrintTaskId}</p>
        </div>
      )}

      <label className="mt-3 flex flex-col gap-1.5">
        <span className="text-xs font-bold text-[color:var(--muted)]">标题（选填）</span>
        <input
          className={feedbackInputClass}
          value={form.title}
          onChange={(event) => onFormChange((value) => ({ ...value, title: event.target.value }))}
          maxLength={80}
          placeholder="如：打印预览页显示不完整"
        />
      </label>

      <label className="mt-3 flex flex-col gap-1.5">
        <span className="text-xs font-bold text-[color:var(--muted)]">反馈内容</span>
        <textarea
          className={`${feedbackInputClass} min-h-[112px] resize-none`}
          value={form.content}
          onChange={(event) => onFormChange((value) => ({ ...value, content: event.target.value }))}
          maxLength={500}
          placeholder="请说明遇到的情况、发生页面或希望改进的地方"
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-6 text-[color:var(--muted)]">{CATEGORY_OPTIONS.find((item) => item.value === form.category)?.hint}</p>
        <Button disabled={submitBusy} onClick={onSubmit} className="me-ripple h-12 rounded-full px-6">
          <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
            <KIcon name="send" />
          </span>
          提交反馈
        </Button>
      </div>
    </Card>
  )
}
