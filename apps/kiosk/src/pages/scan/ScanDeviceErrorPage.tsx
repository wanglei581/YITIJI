import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { PhoneHelpLine } from '../print-scan/phoneHelp'
import { DocStackArt } from '../print-scan/ToolArt'
import { PrintArt } from '../print/art/PrintArt'
import { FeederArt, GlassArt } from './ScanGuideArt'
import { ScanPaperArt } from './ScanPaperArt'
import { ScanWorkbenchShell } from './ScanWorkbenchChrome'
import { DEVICE_ERROR_COPY } from './scanDeviceErrorCopy'
import type { DeviceFault } from './scanDeviceState'
import type { ScanStage } from './scanWorkbenchModel'
import { patchScanWorkbenchSession, clearScanWorkbenchSession } from './scanWorkbenchSession'
import { revokeLiveScanSession } from './scanSessionRevoke'
import './styles/scan-device-qx.css'
import './styles/scan-device-errors.css'

export function ScanDeviceErrorPage({ fault, busy, onRetry, onGlass, onPanel, onGoStage }: {
  fault: DeviceFault; busy: boolean
  onRetry: () => void; onGlass: () => void; onPanel: () => void
  onGoStage: (stage: ScanStage) => void
}) {
  const copy = DEVICE_ERROR_COPY[fault]
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const leave = (to: string): void => {
    revokeLiveScanSession(getToken())
    clearScanWorkbenchSession()
    navigate(to)
  }
  const settings = (): void => {
    patchScanWorkbenchSession({ stage: 'device-settings' })
    onGoStage('device-settings')
  }
  const restart = (): void => {
    revokeLiveScanSession(getToken())
    clearScanWorkbenchSession()
    onGoStage('start')
  }
  const back = fault === 'noresp' || fault === 'timeout' ? () => leave('/print-scan') : settings
  const primary = fault === 'noresp' ? onPanel : fault === 'timeout' ? restart : onRetry
  const card = (title: string, detail: string, art: ReactNode, onClick: () => void) => (
    <button type="button" key={title} className="cs-way" disabled={busy} onClick={onClick}>
      <span className="vis" aria-hidden="true">{art}</span>
      <span className="tx"><h3>{title}</h3><p>{detail}</p></span>
      <span className="arrow" aria-hidden="true"><QxTouchIcon name="arrowR" size={30} strokeWidth={2.4} /></span>
    </button>
  )
  const panel = card('改用面板扫描', '在打印机屏幕上按扫描，文件传回这台机器', <PrintArt name="mfp" size={150} />, onPanel)
  const art = fault === 'nopaper' ? <FeederArt empty /> : fault === 'jam' ? <FeederArt />
    : fault === 'busy' ? <PrintArt name="mfp" size={220} /> : <ScanPaperArt />
  return (
    <ScanWorkbenchShell
      page="scan-unknown" state="failed" title={copy.title} subtitle={copy.sub}
      status={{ tone: 'warn', label: copy.chip }} bandRail={null} bandBack={false}
      dock={{
        askLabel: copy.ask,
        left: { label: '返回', disabled: busy, onClick: back },
        primary: { label: copy.primary, disabled: busy, onClick: primary, testId: 'scan-device-error-primary' },
      }}
    >
      <div className={`cs-err cs-err${fault === 'nopaper' ? 3 : 2}`} data-testid={`scan-device-error-${fault}`} role="alert">
        <div className="cs-why">
          <span className="vis" aria-hidden="true">{art}<i className="warn"><QxTouchIcon name="alert" size={34} strokeWidth={2.4} /></i></span>
          <div><b>{copy.reason}</b>{copy.detail ? <p>{copy.detail}</p> : null}</div>
        </div>
        <div className="cs-ways">
          {fault === 'noresp' ? <>{panel}{card('回首页', '先去办别的事', <DocStackArt />, () => leave('/'))}</>
            : <>
              {card(copy.primary, copy.retryDetail, fault === 'nopaper' ? <FeederArt /> : fault === 'jam' ? <GlassArt /> : <ScanPaperArt />, primary)}
              {fault === 'nopaper' ? card('改用玻璃台', '一次一页，字朝下，对齐左上角', <GlassArt />, onGlass) : null}
              {fault === 'busy' ? card('取消', '先不扫了，回到打印扫描', <DocStackArt />, () => leave('/print-scan')) : panel}
            </>}
        </div>
        {fault !== 'busy' ? <PhoneHelpLine /> : null}
      </div>
    </ScanWorkbenchShell>
  )
}
