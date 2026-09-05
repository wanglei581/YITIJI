import { InfoIcon } from 'lucide-react'
import { describePrintFileRetention, type PrintFileRetentionInput } from './printFileRetention'

export function PrintFileRetentionNotice({ retention }: { retention: PrintFileRetentionInput }) {
  const copy = describePrintFileRetention(retention)
  return (
    <div className="print-done-card print-file-retention" data-print-file-retention="true">
      <b className="print-done-card-hd">文件保留与删除</b>
      <p className="print-file-retention-headline">{copy.headline}</p>
      <p className="print-done-card-sub">{copy.detail}</p>
      {copy.whenLabel ? (
        <div className="print-done-i-row">
          <span className="k">到期/删除时点</span>
          <span className="v" data-print-file-retention-when="true">{copy.whenLabel}</span>
        </div>
      ) : null}
      <p className="print-file-retention-note">
        <InfoIcon aria-hidden="true" />
        公共一体机不会长期保存你的简历或证件复印件。具体时点以后端返回的过期字段为准。
      </p>
    </div>
  )
}
