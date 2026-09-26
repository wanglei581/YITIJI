import { FileTextIcon, ScanLineIcon } from 'lucide-react'

interface ResumeScanReadyProps {
  name: string
  size: string
  format: string
  /** 「换一种来源」：放下这份扫描件，回到来源选择。 */
  onDrop: () => void
  /** 「回扫描台重扫一份」：扫描登记在交接时已清，只能从扫描工作台起点重新开始。 */
  onRescan: () => void
}

/**
 * 稿 21 scan-ready：扫描工作台交接来的这一份。
 * 只说清来路与本页做过什么（什么都没做），不假装本页扫过、改过它，也不补造它没有的字段。
 */
export function ResumeScanReady({ name, size, format, onDrop, onRescan }: ResumeScanReadyProps) {
  return (
    <section className="qx-rt-scan" aria-label="扫描件交接">
      <div className="qx-rt-track">
        <span className="ti" aria-hidden="true"><ScanLineIcon size={28} /></span>
        <span className="tx">
          <b>扫描原件 · 由扫描工作台交接</b>
          <small>第 1 步：确认交接过来的这一份</small>
        </span>
        <button type="button" className="tbtn" onClick={onDrop}>换一种来源</button>
      </div>
      <div className="qx-rt-filecard">
        <span className="fi" aria-hidden="true"><FileTextIcon size={32} /></span>
        <span className="fx">
          <b>{name}</b>
          <small>{format.toUpperCase()} · {size} · 来自扫描工作台</small>
        </span>
        <span className="fb">已交接</span>
      </div>
      <dl className="qx-rt-kv">
        <div><dt>来路</dt><dd>扫描工作台交接过来的，不是本页去扫的</dd></div>
        <div><dt>本页没做什么</dt><dd>没有重新扫描，也没有改动这份文件</dd></div>
        <div><dt>保存期限</dt><dd>归属在建扫描会话时已定，本页读不到</dd></div>
      </dl>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={onRescan}>
        回扫描台重扫一份
      </button>
    </section>
  )
}
