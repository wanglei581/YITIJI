// 选文件页的出错板件（稿 st-error）。八种出错屏共用：
//   文件卡（带「未收下」标；没有文件名的失败——二维码没出来、读不了 U 盘——省掉）
//   → 原因卡 → 两张大出口卡（重试这一步 / 换一种办法）→ 求助行（和原来就有「使用帮助」的几屏多一行入口）。
// 只画传进来的文字与动作：不发请求、不判定状态。文案在 fileSourceErrorModel.ts。

import { QxTouchCallout } from '../../../components/qingxu/touch/QxTouchCallout'
import { QxTouchChip } from '../../../components/qingxu/touch/QxTouchChip'
import { QxTouchIcon } from '../../../components/qingxu/touch/QxTouchIcon'
import { QxTouchSlab } from '../../../components/qingxu/touch/QxTouchSlab'
import { PrintArt } from '../art/PrintArt'
import type { ErrorArt, FileSourceErrorCopy } from './fileSourceErrorModel'
import { displayFileName } from './fileSourceModel'

function artOf(art: ErrorArt) {
  return art === 'phone'
    ? <PrintArt name="phone" size={86} />
    : art === 'usb'
      ? <PrintArt name="usb" size={120} />
      : <PrintArt name="stack" size={100} count={2} />
}

/** 左侧类型字：取扩展名前 4 位大写，取不到就写「文件」。 */
function badgeOf(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop() ?? '' : ''
  const clean = ext.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase()
  return clean || '文件'
}

export function FileSourceError({
  copy,
  file,
  onRetry,
  onAlt,
  onHelp,
  remind,
  fine,
}: {
  copy: FileSourceErrorCopy
  /** 没有文件名的失败传 null。 */
  file: { name: string; meta: string | null; testId?: string } | null
  onRetry: () => void
  onAlt: () => void
  /** 只有 copy.helpRow 为真才画。 */
  onHelp: () => void
  /** 求助行（无人值守标准句），由页面按服务联系方式拼好。 */
  remind: string
  /** 小字补充（例如 Word 为什么不能转）。 */
  fine?: string | null
}) {
  return (
    <div className="fs-err" data-testid="file-source-error-board">
      {file ? (
        <div className="qxt-file qxt-rise" data-testid={file.testId}>
          <span className="qxt-file-badge">{badgeOf(file.name)}</span>
          <div>
            <b title={file.name}>{displayFileName(file.name)}</b>
            <small>{file.meta ?? '大小未取得'}</small>
          </div>
          <QxTouchChip tone="cin">{copy.chip}</QxTouchChip>
        </div>
      ) : null}
      <div className="qxt-reason-box qxt-rise" data-testid="file-source-error-reason">
        <h4><QxTouchIcon name="alert" size={30} strokeWidth={2} />原因</h4>
        <p className="qxt-reason">{copy.reason}</p>
      </div>
      <QxTouchSlab row index={2} title={copy.retry.title} desc={copy.retry.desc} visual={artOf(copy.retry.art)} onClick={onRetry} />
      <QxTouchSlab row index={3} title={copy.alt.title} desc={copy.alt.desc} visual={artOf(copy.alt.art)} onClick={onAlt} />
      {fine ? <QxTouchCallout kind="fine">{fine}</QxTouchCallout> : null}
      <QxTouchCallout kind="remind" icon="call">{remind}</QxTouchCallout>
      {copy.helpRow ? (
        <button type="button" className="qxt-rowlink fs-err-help" data-testid="file-source-help" onClick={onHelp}>
          <QxTouchIcon name="help" size={32} />
          <span><b>使用帮助</b></span>
          <span className="qxt-chev"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>
        </button>
      ) : null}
    </div>
  )
}
