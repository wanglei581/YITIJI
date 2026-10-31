import type { Dispatch, SetStateAction } from 'react'
import type { FeedbackCategory } from '../../../../services/api/memberFeedback'
import { MeSeg } from '../../touch/MeKit'
import { AI_COMPLAINT_NOTE } from './aiComplaint'
import { CATEGORY_OPTIONS, type FeedbackFormState } from './types'

/** 反馈表单：五个分类分段，下面一张「情况」卡。提交按钮在页面底栏（稿 pageFeedback），这里不再放。 */
export function FeedbackFormPanel({
  form,
  relatedPrintTaskId,
  onFormChange,
}: {
  form: FeedbackFormState
  relatedPrintTaskId: string
  onFormChange: Dispatch<SetStateAction<FeedbackFormState>>
}) {
  const isAiComplaint = !relatedPrintTaskId && form.category === 'ai_content'
  const hint = CATEGORY_OPTIONS.find((item) => item.value === form.category)?.hint
  return (
    <>
      <MeSeg
        mode="pressed"
        label="分类"
        current={form.category}
        disabled={Boolean(relatedPrintTaskId)}
        items={CATEGORY_OPTIONS.map((option) => ({ id: option.value, label: option.label }))}
        onPick={(id) => onFormChange((value) => ({ ...value, category: id as FeedbackCategory }))}
      />
      <section className="me-form" aria-label="提交反馈">
        <b className="me-form-t">情况</b>
        <p className="me-p">{hint}。本人工单，不承诺回复时限。</p>
        {relatedPrintTaskId ? <p className="me-p" data-testid="member-feedback-related">关联打印订单时固定为打印服务。已关联打印订单 {relatedPrintTaskId}</p> : null}
        {isAiComplaint ? <p className="me-p" data-testid="member-feedback-ai-content-note">{AI_COMPLAINT_NOTE}</p> : null}

        <label className="fb-field">
          <span className="fb-field-label">标题（选填）</span>
          <input
            className="fb-input"
            value={form.title}
            onChange={(event) => onFormChange((value) => ({ ...value, title: event.target.value }))}
            maxLength={80}
            placeholder="如：打印预览页显示不完整"
          />
        </label>

        <label className="fb-field">
          <span className="fb-field-label">联系电话（选填）</span>
          <input
            className="fb-input"
            value={form.contactPhone}
            onChange={(event) => onFormChange((value) => ({ ...value, contactPhone: event.target.value }))}
            inputMode="tel"
            maxLength={11}
            placeholder="便于必要时联系确认设备或文件问题"
          />
        </label>

        <label className="fb-field fb-field-grow">
          <span className="fb-field-label">反馈内容</span>
          <textarea
            className="fb-textarea"
            value={form.content}
            onChange={(event) => onFormChange((value) => ({ ...value, content: event.target.value }))}
            maxLength={500}
            placeholder={isAiComplaint ? '哪个 AI 功能、什么时间、哪段内容有问题（10–500 字）' : '请说明遇到的情况、发生页面或希望改进的地方'}
          />
        </label>
      </section>
    </>
  )
}
