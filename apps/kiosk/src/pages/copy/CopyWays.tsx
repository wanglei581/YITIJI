import type { ReactNode } from 'react'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { PrintArt } from '../print/art/PrintArt'
import { ScanPaperArt } from '../scan/ScanPaperArt'
import { PhoneHelpLine } from '../print-scan/phoneHelp'

function Way({ screen, title, text, chip, disabled, onClick }: {
  screen?: boolean; title: string; text: string; chip?: string; disabled?: boolean; onClick?: () => void
}) {
  return <button type="button" className="cc-way" disabled={disabled} onClick={onClick}>
    <span className="vis" aria-hidden="true">{screen ? <ScanPaperArt /> : <PrintArt name="mfp" />}</span>
    <span className="tx">{chip ? <span className="cc-chip">{chip}</span> : null}<h2>{title}</h2><span>{text}</span></span>
    {disabled ? <span /> : <span className="arrow"><QxTouchIcon name="arrowR" size={30} strokeWidth={2.4} /></span>}
  </button>
}
export function CopyNote({ children }: { children: ReactNode }) {
  return <div className="cc-note"><QxTouchIcon name="shield" size={32} /><span>{children}</span></div>
}
export function CopyWays({ off, reason, guide, screen }: {
  off: boolean; reason: string | null; guide: () => void; screen: () => void
}) {
  const panel = <Way title={off ? '在打印机面板上复印' : '在打印机面板上快速复印'} chip={off ? '现在可以用' : '最快'}
    text={off ? '复印、身份证复印、票据复印，都在打印机屏幕上点。' : '身份证复印、票据复印也在面板上'} onClick={guide} />
  const screenWay = <Way screen title="在这块屏上复印" disabled={off || Boolean(reason)}
    chip={off ? '这台机器还没开通' : reason ? undefined : '可先看效果'} onClick={screen}
    text={off ? '先看扫描效果再打印、能改份数。这台机器暂时做不到。' : reason ?? '先看扫描效果再打印，能改份数，彩色原件也能印成黑白；比面板慢；扫描件只在这台机器上处理，不上传'} />
  return <div className="cc-stack"><div className="cc-ways">{off ? <>{screenWay}{panel}</> : <>{panel}{screenWay}</>}</div>
    {off ? <div className="cc-note"><PhoneHelpLine /></div> : <CopyNote>不得复印伪造的证件、印章、票据。只能复印本人的真实证件和票据。</CopyNote>}
  </div>
}
