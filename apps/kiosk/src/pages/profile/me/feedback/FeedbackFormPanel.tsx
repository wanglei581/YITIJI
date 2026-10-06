import type { Dispatch, SetStateAction } from 'react'
import { KIcon } from '../../../../components/kiosk-icon'
import type { FeedbackCategory } from '../../../../services/api/memberFeedback'
import { AI_COMPLAINT_NOTE, AI_COMPLAINT_REPLY_DAYS } from './aiComplaint'
import { feedbackPhoneOk } from './feedbackRules'
import { CATEGORY_OPTIONS, type FeedbackFormState } from './types'

export function FeedbackFormPanel({
  form,
  categoryChosen,
  relatedPrintTaskId,
  submitBusy,
  onFormChange,
  onCategoryChosen,
}: {
  form: FeedbackFormState
  categoryChosen: boolean
  relatedPrintTaskId: string
  submitBusy: boolean
  onFormChange: Dispatch<SetStateAction<FeedbackFormState>>
  onCategoryChosen: (category: FeedbackCategory) => void
}) {
  const locked = Boolean(relatedPrintTaskId)
  const isAiComplaint = !locked && categoryChosen && form.category === 'ai_content'
  const phoneInvalid = form.contactPhone.trim().length > 0 && !feedbackPhoneOk(form.contactPhone)
  return (
    <section className="qx-card fb-form" aria-label="提交反馈" data-testid="member-feedback-form">
      <div className="fb-field-row">
        <h2 className="fb-sec">提交反馈</h2>
        <span className="fb-count">正文至少 10 个字</span>
      </div>

      <div className="fb-field">
        <span className="fb-field-label" id="feedback-category-label">分类</span>
        <div className="fb-picker" role="group" aria-labelledby="feedback-category-label">
          {CATEGORY_OPTIONS.map((option) => {
            const pressed = locked ? option.value === 'print' : categoryChosen && form.category === option.value
            return (
              <button
                key={option.value}
                type="button"
                className="fb-pick"
                data-testid={`member-feedback-cat-${option.value}`}
                aria-pressed={pressed}
                disabled={Boolean(relatedPrintTaskId)}
                onClick={() => onCategoryChosen(option.value)}
              >
                {option.label}
                <span>{option.hint}</span>
              </button>
            )
          })}
        </div>
        <p className="fb-note" data-testid={isAiComplaint ? 'member-feedback-ai-content-note' : undefined}>
          {isAiComplaint
            ? AI_COMPLAINT_NOTE
            : `AI 内容投诉 ${AI_COMPLAINT_REPLY_DAYS} 个工作日内答复，其他分类不承诺回复时限。`}
        </p>
        {locked ? <p className="fb-note">关联打印订单时固定为打印服务</p> : null}
      </div>

      {locked ? (
        <div className="fb-note">
          <p>已关联打印订单</p>
          <p>{relatedPrintTaskId}</p>
        </div>
      ) : null}

      <div className="fb-form-grid">
        <label className="fb-field" htmlFor="fb-title">
          <span className="fb-field-label" aria-hidden="true">标题 <span>选填</span></span>
          <input
            id="fb-title"
            className="fb-input"
            aria-label="标题（选填）"
            value={form.title}
            disabled={submitBusy}
            onChange={(event) => onFormChange((value) => ({ ...value, title: event.target.value }))}
            maxLength={80}
            placeholder="如：打印预览页显示不完整"
          />
        </label>
        <label className="fb-field" htmlFor="fb-phone">
          <span className="fb-field-label" aria-hidden="true">联系电话 <span>选填</span></span>
          <input
            id="fb-phone"
            className="fb-input"
            aria-label="联系电话（选填）"
            value={form.contactPhone}
            disabled={submitBusy}
            onChange={(event) => onFormChange((value) => ({ ...value, contactPhone: event.target.value }))}
            inputMode="tel"
            maxLength={11}
            placeholder="便于必要时联系确认设备或文件问题"
          />
          {phoneInvalid ? <span className="fb-field-error">联系电话需为 11 位大陆手机号，或留空</span> : null}
        </label>
      </div>

      <label className="fb-field" htmlFor="fb-content">
        <span className="fb-field-row">
          <span className="fb-field-label">反馈内容</span>
          <span className="fb-count">{form.content.length} / 500</span>
        </span>
        <textarea
          id="fb-content"
          className="fb-textarea"
          aria-label="反馈内容"
          value={form.content}
          disabled={submitBusy}
          onChange={(event) => onFormChange((value) => ({ ...value, content: event.target.value }))}
          maxLength={500}
          placeholder={isAiComplaint ? '哪个 AI 功能、什么时间、哪段内容有问题（10–500 字）' : '请说明遇到的情况、发生在哪一页，或希望改进的地方'}
        />
      </label>
    </section>
  )
}

/** 提交键在底栏，组件仍留在本文件，供页面放进操作条。 */
export function FeedbackSubmitButton({
  ready,
  why,
  busy,
  failed,
  onSubmit,
}: {
  ready: boolean
  why: string
  busy: boolean
  failed: boolean
  onSubmit: () => void
}) {
  const disabled = busy || !ready
  const label = busy ? '正在提交…' : failed && ready ? '重试提交' : '提交反馈'
  return (
    <button
      type="button"
      className={disabled && !busy ? 'qx-btn fb-hold' : 'qx-btn'}
      data-variant="primary"
      disabled={disabled}
      aria-label={disabled && !busy ? `提交反馈（${why}）` : undefined}
      onClick={onSubmit}
    >
      <span className="fb-hold-main">
        <KIcon name="send" />
        <span>{label}</span>
      </span>
      {disabled && !busy && why ? <small>{why}</small> : null}
    </button>
  )
}
