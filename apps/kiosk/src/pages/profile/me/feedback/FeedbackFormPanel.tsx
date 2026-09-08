import type { Dispatch, SetStateAction } from 'react'
import { KIcon } from '../../../../components/kiosk-icon'
import type { FeedbackCategory } from '../../../../services/api/memberFeedback'
import { CATEGORY_OPTIONS, type FeedbackFormState } from './types'

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
    <section className="qx-card" aria-label="提交反馈">
      <div className="qx-sec-h">
        <h2 className="t">提交反馈</h2>
        <span className="hint">请描述设备、打印、文件处理或页面建议</span>
      </div>

      <div className="fb-field" style={{ marginTop: 14 }}>
        <span className="fb-field-label" id="feedback-category-label">分类</span>
        <div className="fb-picker" role="group" aria-labelledby="feedback-category-label">
          {CATEGORY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="fb-pick"
              aria-pressed={form.category === option.value}
              disabled={Boolean(relatedPrintTaskId)}
              onClick={() => onFormChange((value) => ({ ...value, category: option.value as FeedbackCategory }))}
            >
              {option.label}
              <span>{option.hint}</span>
            </button>
          ))}
        </div>
        {relatedPrintTaskId ? <p className="fb-note">关联打印订单时固定为打印服务</p> : null}
      </div>

      {relatedPrintTaskId ? (
        <div className="fb-note" style={{ marginTop: 12 }}>
          <p>已关联打印订单</p>
          <p>{relatedPrintTaskId}</p>
        </div>
      ) : null}

      <label className="fb-field" style={{ marginTop: 14 }}>
        <span className="fb-field-label">标题（选填）</span>
        <input
          className="fb-input"
          value={form.title}
          onChange={(event) => onFormChange((value) => ({ ...value, title: event.target.value }))}
          maxLength={80}
          placeholder="如：打印预览页显示不完整"
        />
      </label>

      <label className="fb-field" style={{ marginTop: 14 }}>
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

      <label className="fb-field" style={{ marginTop: 14 }}>
        <span className="fb-field-label">反馈内容</span>
        <textarea
          className="fb-textarea"
          value={form.content}
          onChange={(event) => onFormChange((value) => ({ ...value, content: event.target.value }))}
          maxLength={500}
          placeholder="请说明遇到的情况、发生页面或希望改进的地方"
        />
      </label>

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
        <p className="fb-legal" style={{ flex: 1 }}>
          {CATEGORY_OPTIONS.find((item) => item.value === form.category)?.hint}
        </p>
        <button type="button" className="qx-btn" data-variant="primary" disabled={submitBusy} onClick={onSubmit}>
          <KIcon name="send" />
          提交反馈
        </button>
      </div>
    </section>
  )
}
