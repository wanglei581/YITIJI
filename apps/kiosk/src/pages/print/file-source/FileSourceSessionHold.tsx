import type { UploadTab } from './fileSourceModel'
import { ChannelGrid, FileSourceStatus } from './FileSourceBits'

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
          <span className="hint">选一条，下面跟着换</span>
        </div>
        <ChannelGrid keys={keys} active={null} usbMode={usbMode} onSelect={() => undefined} locked />
      </section>
      <section className="fs-sec fs-hold-notes">
        <div className="fs-split">
          <div className="fs-mini" data-static="true">
            <h4>第三方网盘尚未接入</h4>
            <p>本机不做百度网盘 / 微信文件的授权登录 —— 公共终端上登录你的网盘账号不安全。<b>但你自己存过的材料一直在</b>：登录后从「我的文档」直接选，不用重传。</p>
          </div>
          <div className="fs-mini" data-static="true">
            <h4>两个上限不一样</h4>
            <p>手机上传单份 <b>≤ 10MB</b>；本机选和 U 盘导入单份 <b>≤ 15MB</b>。Word 是否可收由本机转换能力决定，能力关闭时请另存为 PDF。</p>
          </div>
        </div>
      </section>
    </>
  )
}
