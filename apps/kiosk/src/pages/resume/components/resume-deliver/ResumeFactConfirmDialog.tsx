import { useMemo, useState } from 'react'
import type { ConfirmableFact } from './facts'

export function ResumeFactConfirmDialog(props: {
  facts: ConfirmableFact[]
  unconfirmed: string[]
  busy: boolean
  onCancel: () => void
  onConfirm: (factsConfirmedAt: string) => void
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const allChecked = useMemo(
    () => props.facts.length > 0 && props.facts.every((fact) => checked[fact.id]),
    [checked, props.facts],
  )
  const canExport = props.facts.length === 0 || allChecked

  return (
    <div className="qx-rd-overlay" role="dialog" aria-modal="true" aria-labelledby="resume-fact-title">
      <div className="qx-rd-dialog">
        <h2 id="resume-fact-title">导出前核对事实</h2>
        <p>
          请逐项勾选「已核对」。未全勾不能出文件。系统不会替你确认学校、公司、时间段、证书或电话。
        </p>
        {props.unconfirmed.length > 0 && (
          <p className="qx-rd-pending" role="note">
            待本人确认：{props.unconfirmed.join('、')}
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
                    {fact.value}
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
            onClick={() => {
              if (!canExport || props.busy) return
              props.onConfirm(new Date().toISOString())
            }}
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
