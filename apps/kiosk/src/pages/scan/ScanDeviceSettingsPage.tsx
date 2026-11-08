import { useEffect, useState } from 'react'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { useAuth } from '../../auth/useAuth'
import { useLocalScanProbe } from '../../hooks/useTerminalDeviceStatus'
import { FeederArt, GlassArt } from './ScanGuideArt'
import { SCAN_MATERIALS, defaultDeviceChoice, type ScanDeviceChoice, type ScanMaterial } from './scanMaterials'
import { scanReadyChipText } from './scanProbeCopy'
import { SCAN_DEVICE_RAIL, ScanWorkbenchShell } from './ScanWorkbenchChrome'
import { type ScanStage } from './scanWorkbenchModel'
import { patchScanWorkbenchSession, readScanWorkbenchSession } from './scanWorkbenchSession'
import { useScanDeviceCapability } from './useScanDeviceCapability'
import { recoverDeviceSession } from './scanDeviceRecovery'
import { beginDeviceScan, useScanDeviceStartState } from './useScanDeviceStart'
import './styles/scan-device-qx.css'
import './styles/scan-device-flow.css'

function labelOf(material: ScanMaterial): string {
  return SCAN_MATERIALS.find((item) => item.material === material)?.label ?? ''
}

/**
 * 放纸和颜色。点「开始扫描」才建会话，挂载时不发。
 */
export function ScanDeviceSettingsPage({ onGoStage }: { onGoStage?: (stage: ScanStage) => void } = {}) {
  const cap = useScanDeviceCapability()
  const probe = useLocalScanProbe(true)
  const { getToken } = useAuth()
  const start = useScanDeviceStartState()
  const session = readScanWorkbenchSession()
  const material = session?.material ?? null
  const recovery = Boolean(session?.live && session.deviceFlow)
  const [recovering, setRecovering] = useState(false)
  const back = (): void => {
    const stage = recovery ? 'progress' : 'how'
    patchScanWorkbenchSession({ stage })
    onGoStage?.(stage)
  }
  const [choice, setChoice] = useState<ScanDeviceChoice>(() => (
    session?.deviceChoice ?? (material ? defaultDeviceChoice(material) : { source: 'feeder', colorMode: 'gray' })
  ))

  useEffect(() => {
    if (!material) {
      onGoStage?.('start')
      return
    }
    if (recovery || cap.loading || probe.phase !== 'done') return
    if (!cap.allowed || !probe.freshReady) onGoStage?.('how')
  }, [material, recovery, cap.loading, cap.allowed, probe.phase, probe.freshReady, onGoStage])

  if (!material) return null

  const pick = (next: ScanDeviceChoice): void => {
    setChoice(next)
    patchScanWorkbenchSession({ deviceChoice: next })
  }
  const readyLabel = scanReadyChipText(probe.freshReady && cap.allowed)

  return (
    <ScanWorkbenchShell
      page="scan-set"
      state="setup"
      title="纸放哪？扫成黑白还是彩色？"
      subtitle={null}
      status={readyLabel
        ? { tone: 'ok', label: readyLabel }
        : { tone: 'warn', label: '正在确认扫描仪' }}
      bandEyebrow={`屏上扫描 · ${labelOf(material)}`}
      bandRail={{ labels: SCAN_DEVICE_RAIL, now: 2 }}
      bandBackLabel="返回"
      onBandBack={back}
      dock={{
        left: { label: '返回', disabled: recovering, onClick: back },
        primary: {
          label: recovering || start.phase === 'starting' ? '正在开始' : '开始扫描',
          testId: 'scan-device-start',
          disabled: (!recovery && !probe.freshReady) || !cap.allowed || recovering || start.phase === 'starting' || start.locked,
          onClick: () => {
            if (recovery) {
              setRecovering(true)
              void recoverDeviceSession({ action: 'retry', settings: choice, token: getToken(), onGoStage: onGoStage ?? (() => undefined) }).finally(() => setRecovering(false))
              return
            }
            beginDeviceScan({
            material,
            choice,
            memberToken: getToken(),
            onGoStage: onGoStage ?? (() => undefined),
            })
          },
        },
      }}
    >
      <div className="cs-set">
      <div className="cs-sec">纸放哪？</div>
      <div className="cs-two">
        <button
          type="button"
          className="cs-src"
          data-testid="scan-source-flatbed"
          aria-pressed={choice.source === 'flatbed'}
          onClick={() => pick({ ...choice, source: 'flatbed' })}
        >
          <span className="vis" aria-hidden="true"><GlassArt /></span>
          <b>玻璃台</b>
          <span className="d">一次一页，适合证件、书本</span>
          <span className="d2">字朝下，对齐左上角</span>
          <span className="cs-tick" aria-hidden="true"><QxTouchIcon name="check" size={26} strokeWidth={3} /></span>
        </button>
        <button
          type="button"
          className="cs-src"
          data-testid="scan-source-feeder"
          aria-pressed={choice.source === 'feeder'}
          onClick={() => pick({ ...choice, source: 'feeder' })}
        >
          <span className="vis" aria-hidden="true"><FeederArt /></span>
          <b>进纸器</b>
          <span className="d">一叠最多 50 页，只扫单面</span>
          <span className="d2">字朝上</span>
          <span className="cs-tick" aria-hidden="true"><QxTouchIcon name="check" size={26} strokeWidth={3} /></span>
        </button>
      </div>
      <div className="cs-sec">黑白还是彩色？</div>
      <div className="cs-seg" role="group" aria-label="黑白还是彩色">
        <button
          type="button"
          data-testid="scan-color-gray"
          aria-pressed={choice.colorMode === 'gray'}
          onClick={() => pick({ ...choice, colorMode: 'gray' })}
        >
          黑白<small>文字材料</small>
        </button>
        <button
          type="button"
          data-testid="scan-color-color"
          aria-pressed={choice.colorMode === 'color'}
          onClick={() => pick({ ...choice, colorMode: 'color' })}
        >
          彩色<small>带照片、带颜色的材料</small>
        </button>
      </div>
      <div className="cs-howto">
        <QxTouchIcon name="help" size={34} strokeWidth={2} />
        <span>多页单面材料用进纸器一次扫完；玻璃台适合证件、书本，一面一面扫</span>
      </div>
      {start.notice ? <p className="cs-warn" role="status">{start.notice}</p> : null}
      </div>
    </ScanWorkbenchShell>
  )
}
