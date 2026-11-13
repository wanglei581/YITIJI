import { Eraser, Hand } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { FeederArt, GlassArt } from '../scan/ScanGuideArt'
import { clearCopySession } from './copySession'
import { CopyShell } from './CopyShell'
import '../scan/styles/scan-device-errors.css'
import './copy-print.css'
import './copy-device.css'

/**
 * 已停止复印（稿 cs-scan-stopped?flow=copy；11/08 产品负责人定第 4 条，11/09 第三轮版式）。
 *
 * 「已扫的页已从这台机器删除」有依据才写：只有 copyDeviceFlow.stop() 拿到本机 abort 回包
 * state=cancelled 且 purged === true、云端 cancel 也确认同一单之后，才会进 'stopped' 这一屏；
 * 任何一边拿不准都落「状态未知」，到不了这里。不画倒计时：复印取消回包不带静默期。
 * 离开即清场（撤销云端单、删本机扫描页），和复印各屏出口同一条。
 */
export function CopyStoppedView() {
  const navigate = useNavigate()
  const leave = (path: string) => { clearCopySession(); navigate(path) }
  return <CopyShell stage="stopped" title="已停止复印" subtitle="这次到这里为止，不会再继续。" status="已停止" statusTone="warn"
    reason={null} onBack={() => leave('/print-scan')} hideBack ask="怎么复印更合适"
    left={<button type="button" className="qxt-btn qxt-btn-sec" onClick={() => leave('/print-scan')}>
      <QxTouchIcon name="chevL" size={30} strokeWidth={2.4} />回打印扫描</button>}
    primary={{ label: '回首页', onClick: () => leave('/'), testId: 'copy-stopped-home' }}>
    <div data-qx-page="scan-workbench" className="cc-copy-stopped">
      <div className="cs-stopped">
        <div className="cs-fact big"><span className="ic"><Eraser size={40} strokeWidth={2} aria-hidden /></span><b>已停止复印，已扫的页已从这台机器删除。</b></div>
        <div className="cc-original"><Hand size={64} aria-hidden="true" /><span>原件还在玻璃上或进纸器里，请带走</span></div>
        <div className="cc-cstop" aria-hidden="true">
          <GlassArt viewBox="4 18 142 124" />
          <FeederArt viewBox="4 16 142 120" />
        </div>
      </div>
    </div>
  </CopyShell>
}
