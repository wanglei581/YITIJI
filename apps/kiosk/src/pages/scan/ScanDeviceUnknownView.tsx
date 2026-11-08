import { SCAN_DEVICE_RAIL, ScanWorkbenchShell } from './ScanWorkbenchChrome'
import { ScanDeviceArmNote, ScanDeviceStopButton } from './ScanDeviceStopButton'
import { ScanSheetArt } from './ScanSheetArt'

/** 本机或云端这一步还没有确定结果。不写成功，也不写失败。 */
export function ScanDeviceUnknownView({
  tone,
  armed,
  stop,
}: {
  tone: 'unreachable' | 'unconfirmed'
  armed: boolean
  stop: { armed: boolean; busy: boolean; disabled: boolean; onPress: () => void }
}) {
  const detail = tone === 'unreachable'
    ? '本机程序连不上。这一步还没有结果。'
    : '这一步的结果还没确认。'
  return (
    <ScanWorkbenchShell
      page="scan-unknown"
      state="polling"
      title="状态未知"
      subtitle={detail}
      status={{ tone: 'unknown', label: '状态未知' }}
      bandEyebrow="屏上扫描"
      bandRail={{ labels: SCAN_DEVICE_RAIL, now: 3 }}
      bandBack={false}
      dock={{
        omitLeft: true,
        secondary: (
          <ScanDeviceStopButton
            label="停止扫描"
            armed={stop.armed}
            busy={stop.busy}
            disabled={stop.disabled}
            onPress={stop.onPress}
          />
        ),
      }}
    >
      <div className="cs-flow cs-unknown" data-testid="scan-device-unknown">
        <div className="cs-hero none">
          <div className="cs-hrow">
            <div className="cs-reader" aria-hidden="true">
              <ScanSheetArt width={520} height={736} stretch />
            </div>
            <div className="cs-side">
              <b className="cs-big">状态未知</b>
              <p className="cs-cap">{detail}</p>
            </div>
          </div>
        </div>
        <ScanDeviceArmNote armed={armed} />
      </div>
    </ScanWorkbenchShell>
  )
}
