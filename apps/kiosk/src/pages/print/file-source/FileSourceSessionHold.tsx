import { usePrintSessionDeferred } from '../../../hooks/useTerminalSessionState'
import { EndThisUseButton } from '../EndThisUseButton'
import { PRINT_SESSION_DEFERRED_LINE, PRINT_SESSION_RETRY_LINE } from '../printSessionHoldCopy'
import type { UploadTab } from './fileSourceModel'
import { ChannelGrid, FileSourceStatus, SourceChooserNotes } from './FileSourceBits'

/** 本机会话 failed：来源选择原样留着，来源卡置灰，不催人现在上传。压着时换成第 5 句并给出结束使用。 */
export function FileSourceSessionHold({
  keys,
  usbMode,
}: {
  keys: UploadTab[]
  usbMode: 'ok' | 'unavailable' | 'offline'
}) {
  const deferred = usePrintSessionDeferred()
  return (
    <>
      <FileSourceStatus kind="warn" title="这台机器现在下不了打印单">
        <div className="fs-status-p">{deferred ? PRINT_SESSION_DEFERRED_LINE : PRINT_SESSION_RETRY_LINE}</div>
        {deferred ? (
          <div className="fs-status-act">
            <EndThisUseButton />
          </div>
        ) : null}
      </FileSourceStatus>
      <section className="fs-sec fs-hold-sources">
        <div className="fs-sec-h">
          <span className="no">01</span>
          <span className="t">文件从哪来</span>
        </div>
        <ChannelGrid keys={keys} active={null} usbMode={usbMode} onSelect={() => undefined} locked />
      </section>
      <section className="fs-sec fs-hold-notes">
        <SourceChooserNotes />
      </section>
    </>
  )
}
