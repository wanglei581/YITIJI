import { AIGC_SCREEN_MARK, HTML_PREVIEW_NOTE, SYNTHETIC_BANNER } from './constants'

export function ResumeAigcBadge({ synthetic }: { synthetic?: boolean }) {
  return (
    <div className="qx-rd-aigc" role="status">
      <b>{AIGC_SCREEN_MARK}</b>
      <span>换模板出新稿，不保留原件版式。AI 生成内容请自行核对后再带走。</span>
      {synthetic ? <em>{SYNTHETIC_BANNER}</em> : null}
    </div>
  )
}

export function ResumeHtmlPreviewNote() {
  return (
    <p className="qx-rd-html-note" role="note">
      {HTML_PREVIEW_NOTE} · 导出后的 PDF 才是打印稿。
    </p>
  )
}
