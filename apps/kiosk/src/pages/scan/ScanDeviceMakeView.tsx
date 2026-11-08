import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { SCAN_DEVICE_RAIL, ScanWorkbenchShell } from './ScanWorkbenchChrome'
import { ScanDeviceArmNote, ScanDeviceStopButton } from './ScanDeviceStopButton'
import { ScanSheetArt } from './ScanSheetArt'

interface MakeStop {
  armed: boolean
  busy: boolean
  disabled: boolean
  onPress: () => void
}

/** 合成或传回。这一屏不跳成功，等云端 completed。 */
export function ScanDeviceMakeView({
  phase,
  pages,
  armed,
  stop,
}: {
  phase: 'composing' | 'delivering'
  pages: number | null
  armed: boolean
  stop: MakeStop
}) {
  const delivering = phase === 'delivering'
  return (
    <ScanWorkbenchShell
      page="scan-make"
      state="polling"
      title="正在生成文件"
      subtitle="扫描仪已经扫完，正在把页面合成一个文件。"
      status={{ tone: 'ok', label: '正在生成文件' }}
      bandEyebrow="屏上扫描"
      bandRail={{ labels: SCAN_DEVICE_RAIL, now: 3 }}
      bandBack={false}
      dock={{
        omitLeft: true,
        secondary: <ScanDeviceStopButton label="停止" armed={stop.armed} busy={stop.busy} disabled={stop.disabled} onPress={stop.onPress} />,
      }}
    >
      <div className="cs-flow cs-make" data-testid="scan-device-make">
        <div className="stagelist">
          <div className="it ok">
            <span className="ico"><QxTouchIcon name="check" size={24} strokeWidth={3} /></span>
            {pages != null ? `扫描仪已扫完 · 共收到 ${pages} 页` : '扫描仪已扫完'}
          </div>
          <div className={`it${delivering ? ' ok' : ' now'}`}>
            <span className="ico">{delivering ? <QxTouchIcon name="check" size={24} strokeWidth={3} /> : null}</span>
            生成一个 PDF
          </div>
          <div className={`it${delivering ? ' now' : ''}`}>
            <span className="ico" />
            传回这台机器
          </div>
        </div>
        <div className="cs-merge">
          <div className="cs-pile" aria-hidden="true">
            <span className="p1"><ScanSheetArt width={300} height={424} /></span>
            <span className="p2"><ScanSheetArt width={300} height={424} /></span>
            <span className="p3"><ScanSheetArt width={300} height={424} /></span>
          </div>
          <div className="cs-facts">
            <div><b>{pages != null ? `${pages} 页` : '还没回报'}</b><span>刚收到的</span></div>
            <div><b>1 个 PDF</b><span>合成后的文件</span></div>
            <div><b>这台机器</b><span>文件先放在这里</span></div>
          </div>
        </div>
        <ScanDeviceArmNote armed={armed} />
        <p className="cs-fine">文件传回来之前，请先别离开。</p>
      </div>
    </ScanWorkbenchShell>
  )
}
