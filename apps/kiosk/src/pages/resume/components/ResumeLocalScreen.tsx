import type { ReactNode } from 'react'
import { FileTextIcon, FolderIcon } from 'lucide-react'

export type LocalChannelPhase = 'local-guide' | 'local-cancelled' | 'local-oversize' | 'local-unreadable' | 'local-ready'

interface ResumeLocalScreenProps {
  phase: LocalChannelPhase
  uploading: boolean
  pendingName: string | null
  error: string | null
  readyName: string | null
  readySize: string | null
  wordOpen: boolean
  onOpenPicker: () => void
  onUsePhone: () => void
  onContinue: () => void
}

function Acts({ children }: { children: ReactNode }): ReactNode {
  return <div className="qx-rt-channel-acts">{children}</div>
}

/** 稿 21 本机文件整屏。只覆盖从「打开文件选择」走进来的路径。 */
export function ResumeLocalScreen({
  phase, uploading, pendingName, error, readyName, readySize, wordOpen, onOpenPicker, onUsePhone, onContinue,
}: ResumeLocalScreenProps): ReactNode {
  const formats = wordOpen ? 'PDF / JPG / PNG / WEBP / DOC / DOCX' : 'PDF / JPG / PNG / WEBP'
  if (phase === 'local-ready' && readyName) {
    return (
      <section className="qx-rt-channel" aria-label="本机简历文件">
        <p className="qx-rt-track"><span className="tx"><b>第 4 步：已收到，可以继续</b></span></p>
        <div className="qx-rt-filecard">
          <span className="fx"><b>{readyName}</b><small>{readySize} · 来自本机</small></span>
          <span className="fb">已收到</span>
        </div>
        <p className="qx-rt-hint">上面的文件名和大小是系统发回这台机器的结果。确认之前还没有发起解析。</p>
        <Acts>
          <button type="button" className="qx-btn" data-variant="primary" onClick={onContinue}>继续：确认这次办理</button>
        </Acts>
      </section>
    )
  }
  if (phase === 'local-cancelled') {
    return (
      <section className="qx-rt-channel" aria-label="本机简历文件">
        <p className="qx-rt-track"><span className="tx"><b>第 2 步：已取消选择</b></span></p>
        <div className="qx-rt-note" data-tone="warn" role="status">
          <b>这一步还没有文件</b>
          <span>你关掉了文件选择，什么都没有被读取或上传。已经点好的诊断方向还留着。</span>
        </div>
        <Acts>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={onUsePhone}>改用手机扫码上传</button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={onOpenPicker}>重新打开文件选择</button>
        </Acts>
      </section>
    )
  }
  if (phase === 'local-oversize' || phase === 'local-unreadable') {
    const empty = phase === 'local-unreadable'
    return (
      <section className="qx-rt-channel" aria-label="本机简历文件">
        <p className="qx-rt-track"><span className="tx"><b>第 2 步：这一份收不了，请换一份</b></span></p>
        <div className="qx-rt-filecard">
          <span className="fi" aria-hidden="true"><FileTextIcon size={32} /></span>
          <span className="fx"><b>{pendingName || '这一份'}</b><small>来自本机 · {empty ? '读不出内容' : '超过 10MB'}</small></span>
          <span className="fb">{empty ? '读不出内容' : '超过 10MB'}</span>
        </div>
        <div className="qx-rt-note" data-tone="error" role="alert">
          <b>{empty ? '文件为空或大小未知' : '文件超过 10MB，请压缩后重试'}</b>
          <span>{error}这一份没有被上传。</span>
        </div>
        <Acts>
          <button type="button" className="qx-btn" data-variant="primary" onClick={onOpenPicker}>重新选一份文件</button>
        </Acts>
      </section>
    )
  }
  return (
    <section className="qx-rt-channel" aria-label="本机简历文件">
      <p className="qx-rt-track"><span className="tx"><b>第 1 步：先把文件放到这台机器上</b></span></p>
      <div className="qx-rt-note" role="status">
        <FolderIcon className="h-6 w-6" aria-hidden="true" />
        <b>{uploading ? '正在上传这一份' : '打开这台机器上的文件选择'}</b>
        <span>
          {uploading
            ? `${pendingName || '这一份'}正在送出。这里不显示进度条，也没有取消。`
            : `云盘里的文件要先下载到这台机器。本页不登录、不保存云盘账号。可接收 ${formats}，单份不超过 10MB。`}
        </span>
      </div>
      {!wordOpen ? <p className="qx-rt-hint">Word 转换暂未开放，请另存为 PDF 再上传。</p> : null}
      <Acts>
        <button type="button" className="qx-btn" data-variant="primary" disabled={uploading} onClick={onOpenPicker}>打开文件选择</button>
      </Acts>
    </section>
  )
}
