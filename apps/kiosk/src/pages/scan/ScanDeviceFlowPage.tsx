import { type ScanStage } from './scanWorkbenchModel'
import { ScanDeviceMakeView } from './ScanDeviceMakeView'
import { ScanDeviceMoreView } from './ScanDeviceMoreView'
import { ScanDeviceRunView } from './ScanDeviceRunView'
import { ScanDeviceUnknownView } from './ScanDeviceUnknownView'
import { useScanDeviceFlow } from './useScanDeviceFlow'
import './styles/scan-device-flow.css'

/** 屏上扫描进行中的几屏。云端状态决定画哪一屏，本页不发 start。 */
export function ScanDeviceFlowPage({ onGoStage }: { onGoStage?: (stage: ScanStage) => void } = {}) {
  const flow = useScanDeviceFlow(onGoStage ?? (() => undefined))
  if (!flow.ready || flow.screen.kind === 'terminal') return null
  const stop = {
    armed: flow.armed,
    busy: flow.stopping,
    disabled: flow.stopLocked,
    onPress: flow.pressStop,
  }
  if (flow.screen.kind === 'unknown') {
    return <ScanDeviceUnknownView tone={flow.screen.tone} armed={flow.armed} stop={stop} />
  }
  if (flow.screen.kind === 'more') {
    return (
      <ScanDeviceMoreView
        pages={flow.screen.pages}
        maxPages={flow.screen.maxPages}
        armed={flow.armed}
        busy={flow.commandBusy}
        stop={stop}
        onNext={flow.sendNext}
        onFinish={flow.sendFinish}
      />
    )
  }
  if (flow.screen.kind === 'make') {
    return <ScanDeviceMakeView phase={flow.screen.phase} pages={flow.screen.pages} armed={flow.armed} stop={stop} />
  }
  return (
    <ScanDeviceRunView
      pages={flow.screen.pages}
      scannerStarted={flow.screen.scannerStarted}
      armed={flow.armed}
      stop={stop}
    />
  )
}
