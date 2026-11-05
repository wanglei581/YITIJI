import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { PrintArt } from '../print/art/PrintArt'
import { PhoneHelpLine } from '../print-scan/phoneHelp'
import { COPY_GUIDE_ROUTE } from '../print-scan/printHubContent'
import { DEVICE_ERROR_COPY } from '../scan/scanDeviceErrorCopy'
import { FeederArt, GlassArt } from '../scan/ScanGuideArt'
import { copyFault } from './copyPrintModel'
import { clearCopySession } from './copySession'
import { CopyShell } from './CopyShell'
import '../scan/styles/scan-device-qx.css'
import '../scan/styles/scan-device-errors.css'
import './copy-print.css'

export function CopyErrorView({ errorCode, printing, busy, onRetry }: {
  errorCode: string | null; printing: boolean; busy: boolean; onRetry: (source?: 'flatbed') => Promise<void>
}) {
  const navigate = useNavigate()
  const fault = copyFault(errorCode)
  const leave = (path: string) => { clearCopySession(); navigate(path) }
  const panel = () => leave(COPY_GUIDE_ROUTE)
  const home = () => leave('/')
  const base = DEVICE_ERROR_COPY[fault === 'limit' || fault === 'off' ? 'noresp' : fault]
  const retry = !printing && !['noresp', 'off'].includes(fault)
  const title = printing ? '打印失败' : fault === 'limit' ? '这次超过了这台机器能收的大小'
    : fault === 'off' ? '这台机器暂时只能在打印机面板上复印' : base.title
  const primary = retry ? (fault === 'limit' ? '减少页数再试' : base.primary) : '改用面板复印'
  const reason = printing ? '看打印机屏幕上的提示。这次不会自动重打，也不会重复收费。'
    : fault === 'limit' ? '减少原件页数后再试。' : fault === 'off' ? '这次不能继续屏上复印，请改用面板复印。' : base.reason
  const card = (label: string, detail: string, art: ReactNode, onClick: () => void) => <button type="button" className="cs-way" disabled={busy} onClick={onClick}>
    <span className="vis" aria-hidden="true">{art}</span><span className="tx"><h3>{label}</h3><p>{detail}</p></span>
    <span className="arrow" aria-hidden="true"><QxTouchIcon name="arrowR" size={30} /></span>
  </button>
  const art = fault === 'nopaper' ? <FeederArt empty /> : fault === 'jam' ? <FeederArt /> : <PrintArt name="mfp" />
  return <CopyShell stage={fault === 'off' && !printing ? 'off' : 'error'} title={title} status={printing ? '打印失败' : fault === 'limit' ? '超过限制' : fault === 'off' ? '屏上复印未开通' : base.chip}
    statusTone="warn" reason={null} subtitle={printing || fault === 'limit' || fault === 'off' ? undefined : base.sub}
    onBack={home} hideBack ask={printing ? '取纸或异常怎么办' : base.ask.replace('问小青：', '')}
    primary={{ label: primary, disabled: busy, onClick: retry ? () => { void onRetry() } : panel }}>
    <div data-qx-page="scan-workbench" className="cc-copy-error">
      <div className={`cs-err cs-err${fault === 'nopaper' && !printing ? 3 : 2}`} role="alert" data-testid="copy-device-error">
        <div className="cs-why"><span className="vis">{art}<i className="warn"><QxTouchIcon name="alert" size={34} /></i></span>
          <div><b>{reason}</b>{!printing && fault !== 'limit' && fault !== 'off' && base.detail ? <p>{base.detail}</p> : null}</div></div>
        <div className="cs-ways">
          {retry ? card(primary, fault === 'limit' ? '减少原件页数后再试' : fault === 'timeout' ? '回到第一步，重新放原件、选份数' : base.retryDetail, <GlassArt />, () => { void onRetry() }) : null}
          {fault === 'nopaper' && !printing ? card('改用玻璃台', '一次一页，字朝下，对齐左上角', <GlassArt />, () => { void onRetry('flatbed') }) : null}
          {card('改用面板复印', '在打印机屏幕上点复印，不用在这块屏上办', <PrintArt name="mfp" />, panel)}
          {!retry ? card('回首页', '先去办别的事', <PrintArt name="stack" />, home) : null}
        </div>
        {printing ? <p className="cc-result-help">原件还在玻璃上或进纸器里，请和复印件一起带走</p> : null}
        <PhoneHelpLine />
      </div>
    </div>
  </CopyShell>
}
