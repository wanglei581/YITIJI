import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { PrintArt } from '../print/art/PrintArt'
import { PhoneHelpLine } from '../print-scan/phoneHelp'
import { clearCopySession } from './copySession'
import { COPY_LOGIN_PATH, COPY_QUOTA_FACTS, copyQuotaText } from './copyQuotaCopy'
import { CopyShell } from './CopyShell'
import '../scan/styles/scan-device-qx.css'
import '../scan/styles/scan-device-errors.css'
import './copy-print.css'

/**
 * 确认时超过免费额度：没有建单、没有出纸。不给「改用面板复印」——面板复印不经过额度，
 * 引导过去等于绕开上限。离开即清场（撤销云端单、删本机扫描页）。
 */
export function CopyQuotaView({ errorCode, limit }: { errorCode: string | null; limit: number | null }) {
  const navigate = useNavigate()
  const text = copyQuotaText(errorCode, limit)
  const home = () => { clearCopySession(); navigate('/') }
  // 去登录只跳转：先清场会让复印页「没有会话就去掉 stage」的副作用按新地址把 ?from= 冲掉；
  // 离开复印页时 useCopyFlow 卸载照样清场（撤销云端单、删本机扫描页）。
  const login = () => navigate(COPY_LOGIN_PATH)
  const card = (label: string, detail: string, art: ReactNode, onClick: () => void, testId: string) => <button type="button"
    className="cs-way" data-testid={testId} onClick={onClick}>
    <span className="vis" aria-hidden="true">{art}</span><span className="tx"><h3>{label}</h3><p>{detail}</p></span>
    <span className="arrow" aria-hidden="true"><QxTouchIcon name="arrowR" size={30} /></span>
  </button>
  return <CopyShell stage="error" title={text.title} status={text.chip} statusTone="warn" reason={null}
    onBack={home} hideBack ask="免费额度什么时候恢复"
    left={text.login ? <button type="button" className="qxt-btn qxt-btn-sec" onClick={home}>回首页</button> : undefined}
    primary={text.login ? { label: '去登录', onClick: login, testId: 'copy-quota-login' }
      : { label: '回首页', onClick: home, testId: 'copy-quota-home' }}>
    <div data-qx-page="scan-workbench" className="cc-copy-error">
      <div className={`cs-err cs-err2${text.login ? '' : ' cc-quota-solo'}`} role="alert" data-testid="copy-quota">
        <div className="cs-why"><span className="vis"><PrintArt name="mfp" /><i className="warn"><QxTouchIcon name="alert" size={34} /></i></span>
          <div><b>{text.reason}</b><p>本次没有建单，也没有出纸。{text.login ? '登录后要重新放原件、再扫一次。' : ''}</p>
            <ul className="cc-quota-facts">{COPY_QUOTA_FACTS.map((fact) => <li key={fact}>{fact}</li>)}</ul></div></div>
        <div className="cs-ways">
          {text.login ? card('去登录', '用手机号登录后，一次可以复印更多；要重新放原件、再扫一次', <PrintArt name="phone" />, login, 'copy-quota-way-login') : null}
          {card('回首页', '先去办别的事', <PrintArt name="stack" />, home, 'copy-quota-way-home')}
        </div>
        <p className="cc-result-help">原件还在玻璃上或进纸器里，请带走</p>
        <PhoneHelpLine />
      </div>
    </div>
  </CopyShell>
}
