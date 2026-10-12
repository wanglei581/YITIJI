import type { UploadTab } from './fileSourceModel'
import { ChannelGrid, FileSourceStatus, SourceChooserNotes } from './FileSourceBits'

/** 本机会话 failed：来源选择原样留着，来源卡置灰，不催人现在上传。 */
export function FileSourceSessionHold({
  keys,
  usbMode,
}: {
  keys: UploadTab[]
  usbMode: 'ok' | 'unavailable' | 'offline'
}) {
  return (
    <>
      <FileSourceStatus kind="warn" title="这台机器现在下不了打印单">
        机器会自己再试，恢复后这里会自动变回可用。你可以等一会儿，或稍后再来。
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
