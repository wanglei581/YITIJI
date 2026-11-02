import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { QxTouchOverlay } from '../../../../components/qingxu/touch/QxTouchOverlay'
import { maskPii } from '../../../../utils/maskPii'
import { UNCONFIRMED_WHY, type ConfirmableFact } from './facts'

/**
 * 导出前核对事实：逐项勾「已核对」，未全勾不能出文件。系统不替本人确认学校、公司、时间段、证书或电话。
 * variant="touch" 是触屏弹层（优化页用）；默认写法不变（生成预览页用）。两种写法同一份勾选逻辑与同一套脱敏。
 */
export function ResumeFactConfirmDialog(props: {
  facts: ConfirmableFact[]
  unconfirmed: string[]
  busy: boolean
  onCancel: () => void
  onConfirm: (factsConfirmedAt: string) => void
  variant?: 'default' | 'touch'
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const allChecked = useMemo(
    () => props.facts.length > 0 && props.facts.every((fact) => checked[fact.id]),
    [checked, props.facts],
  )
  const canExport = props.facts.length === 0 || allChecked
  const touch = props.variant === 'touch'
  const confirm = () => {
    if (!canExport || props.busy) return
    props.onConfirm(new Date().toISOString())
  }

  if (touch) {
    return (
      <QxTouchOverlay
        kind="dialog"
        title="导出前核对事实"
        onClose={props.onCancel}
        actions={(
          <>
            <button type="button" className="qxt-btn qxt-btn-pri" aria-disabled={!canExport || props.busy || undefined} onClick={confirm}>
              {props.busy ? '正在生成文件…' : '确认导出'}
            </button>
            <button type="button" className="qxt-btn qxt-btn-sec" onClick={props.onCancel}>返回修改</button>
          </>
        )}
      >
        <div data-qx-page="resume-fact">
          <p>请逐项勾选「已核对」。未全勾不能出文件。系统不会替你确认学校、公司、时间段、证书或电话。</p>
          {props.unconfirmed.length > 0 && (
            <p className="qxt-pending" role="note">
              待本人确认：{props.unconfirmed.map((item) => maskPii(item)).join('、')}
              <span className="qxt-pending-why">{UNCONFIRMED_WHY}</span>
            </p>
          )}
          {props.facts.length === 0 ? (
            <p>这份稿里没有可勾选的学校 / 公司 / 时间段 / 证书 / 电话。</p>
          ) : (
            <ul className="qxt-factlist">
              {props.facts.map((fact) => (
                <li key={fact.id}>
                  <label className="qxt-factrow">
                    <input
                      type="checkbox"
                      checked={Boolean(checked[fact.id])}
                      onChange={(event) => setChecked((prev) => ({ ...prev, [fact.id]: event.target.checked }))}
                    />
                    <span>
                      <b>{fact.label}</b>
                      {maskPii(fact.value)}
                    </span>
                    <em>已核对</em>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {!canExport && <p className="qxt-why-not">还有未勾选的事实，不能出文件。</p>}
        </div>
      </QxTouchOverlay>
    )
  }

  return (
    <div className="qx-rd-overlay" role="dialog" aria-modal="true" aria-labelledby="resume-fact-title">
      <div className="qx-rd-dialog">
        <h2 id="resume-fact-title">导出前核对事实</h2>
        <p>
          请逐项勾选「已核对」。未全勾不能出文件。系统不会替你确认学校、公司、时间段、证书或电话。
        </p>
        {props.unconfirmed.length > 0 && (
          <p className="qx-rd-pending" role="note">
            待本人确认：{props.unconfirmed.map((item) => maskPii(item)).join('、')}
            <span className="qx-rd-pending-why">{UNCONFIRMED_WHY}</span>
          </p>
        )}
        {props.facts.length === 0 ? (
          <p>这份稿里没有可勾选的学校 / 公司 / 时间段 / 证书 / 电话。</p>
        ) : (
          <ul className="qx-rd-fact-list">
            {props.facts.map((fact) => (
              <li key={fact.id}>
                <label className="qx-rd-fact">
                  <input
                    type="checkbox"
                    checked={Boolean(checked[fact.id])}
                    onChange={(event) => setChecked((prev) => ({ ...prev, [fact.id]: event.target.checked }))}
                  />
                  <span>
                    <b>{fact.label}</b>
                    {maskPii(fact.value)}
                  </span>
                  <em>已核对</em>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="qx-rd-dialog-actions">
          <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onCancel}>
            返回修改
          </button>
          <button
            type="button"
            className="qx-btn"
            data-variant="primary"
            aria-disabled={!canExport || props.busy || undefined}
            onClick={confirm}
          >
            {props.busy ? '正在生成文件…' : '确认导出'}
          </button>
        </div>
        {!canExport && (
          <p className="qx-rd-why">还有未勾选的事实，不能出文件。</p>
        )}
      </div>
    </div>
  )
}

/** 优化页和生成预览页共用。文案与按钮样式保持两边一致，只换挂载的屏幕。 */
export function DeleteEntryButton(props: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="qx-btn mt-1.5" data-variant="ghost" aria-label={props.label} onClick={props.onClick}>
      删掉这一条
    </button>
  )
}

export function EntryDeleteDialog(props: {
  hostSelector: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialog = (
    <div className="qx-rd-overlay" role="dialog" aria-modal="true" aria-labelledby="resume-entry-delete-title">
      <div className="qx-rd-dialog">
        <h2 id="resume-entry-delete-title">确定删掉这一条吗？</h2>
        <p>删了以后导出和打印都不会再带这一条。</p>
        <div className="qx-rd-dialog-actions">
          <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onCancel}>取消</button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={props.onConfirm}>确定</button>
        </div>
      </div>
    </div>
  )
  const host = typeof document !== 'undefined' ? document.querySelector(props.hostSelector) : null
  return host ? createPortal(dialog, host) : dialog
}
