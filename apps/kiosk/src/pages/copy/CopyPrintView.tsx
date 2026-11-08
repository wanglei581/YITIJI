import { useState } from 'react'
import { ArrowDown, Hand } from 'lucide-react'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { useSupportContact } from '../../hooks/useSupportContact'
import { PrintArt } from '../print/art/PrintArt'
import { CopyShell } from './CopyShell'
import { COPY_PRINT_LABELS, type CopyPrintStage } from './copyPrintModel'
import './copy-print.css'

const ORIGINAL = '原件还在玻璃上或进纸器里，请和复印件一起带走'
export function CopyPrintView({ phase, printStage, onEnd }: {
  phase: 'printing' | 'done' | 'unconfirmed'; printStage: CopyPrintStage; onEnd: () => void
}) {
  const contact = useSupportContact()
  const [phoneOpen, setPhoneOpen] = useState(false)
  const printing = phase === 'printing'
  const done = phase === 'done'
  const status = printing ? COPY_PRINT_LABELS[printStage] : done ? '已交给打印机' : '结果未确认'
  const title = printing ? '正在打印' : done ? '请到出纸口取走复印件' : '这次没收到打印结果'
  const endLabel = done ? '拿到了，结束' : '纸出来了，结束'
  const phone = contact.servicePhone
  return <CopyShell stage={phase} title={title} status={status} statusTone={phase === 'unconfirmed' ? 'unknown' : 'ok'}
    subtitle={printing ? '复印件会从出纸口出来，请留在机器旁。' : done ? undefined : '先看出纸口；这次不会自动重打'}
    reason={null} onBack={onEnd} hideBack ask={printing ? '纸没出来怎么办' : done ? '怎么取纸' : '取纸或异常怎么办'}
    primary={printing ? undefined : { label: endLabel, onClick: onEnd, kind: done ? 'danger' : 'pri', noArrow: true, testId: 'copy-end' }}>
    {printing ? <div className="cc-print" data-testid="copy-print-progress">
      <div className="cc-print-steps">
        <div className={printStage === 'received' ? 'now' : 'on'}><span>1</span><b>已收到</b><em>{printStage === 'received' ? '进行中' : '完成'}</em><small>这台机器收到了打印请求</small></div>
        <div className={printStage === 'handing' ? 'now' : ''}><span>2</span><b>正在交给打印机</b><em>{printStage === 'handing' ? '进行中' : '未开始'}</em><small>把要印的页交给打印机</small></div>
        <div><span>3</span><b>已交给打印机</b><em>未开始</em><small>页都交给打印机之后</small></div>
      </div>
      <div className="cc-print-hero"><PrintArt name="mfp" /></div>
      <p className="cc-fine">出了几张，以出纸口为准</p>
    </div> : done ? <>
      <div className="cc-original"><Hand size={64} aria-hidden="true" /><span>{ORIGINAL}</span></div>
      <div className="cc-take"><div className="cc-take-printer" aria-hidden="true"><PrintArt name="mfp" /><i /><i /><i /></div>
        <div className="cc-take-label"><ArrowDown size={72} aria-hidden="true" /><b>出纸口在下面</b><span>先看出纸口，再看玻璃台和进纸器。</span></div></div>
      <p className="cc-result-help"><QxTouchIcon name="call" size={34} /><span>没出纸？看打印机屏幕上的提示{phone ? `，或拨打服务电话 ${phone}` : ''}。这次不会自动重打，也不会重复收费</span></p>
    </> : <>
      <div className="cc-result-steps">
        <div><span>1</span><b>先看出纸口是否已有纸张</b><small>没收到打印结果，不能确定纸有没有出来。</small></div>
        <div><span>2</span><b>这次不会自动重打，先别再点复印</b><small>不猜成功也不猜失败，免得多印。</small></div>
        {phone ? <div><span>3</span><b>需要帮助？拨打服务电话 {phone}</b>{contact.serviceHours ? <small>服务时间：{contact.serviceHours}</small> : null}</div> : null}
      </div>
      <div className="cc-result-actions">
        <button type="button" onClick={onEnd}><span className="vis"><PrintArt name="stack" size={130} /></span><span><b>纸出来了，结束</b><small>看到复印件了，就结束这次使用</small></span><span className="arrow" aria-hidden="true"><QxTouchIcon name="arrowR" size={30} /></span></button>
        {phone ? <button type="button" onClick={() => setPhoneOpen(true)}><span className="vis"><QxTouchIcon name="call" size={120} /></span><span><b>需要帮助，拨打服务电话</b><small>{contact.serviceHours ? '看服务电话和服务时间' : '看服务电话'}</small></span><span className="arrow" aria-hidden="true"><QxTouchIcon name="arrowR" size={30} /></span></button> : null}
      </div>
      <p className="cc-result-help">这次不会自动重打，也不会重复收费</p>
      <div className="cc-original"><Hand size={40} aria-hidden="true" /><span>{ORIGINAL}</span></div>
    </>}
    {phoneOpen && phone ? <div className="cc-phone-shade"><section role="dialog" aria-modal="true" aria-label="服务电话">
      <h2>服务电话</h2><p>{phone}</p><p>请用自己的手机拨打。{contact.serviceHours ? `服务时间：${contact.serviceHours}` : ''}</p>
      <button type="button" className="qxt-btn qxt-btn-pri" autoFocus onClick={() => setPhoneOpen(false)}>知道了</button>
    </section></div> : null}
  </CopyShell>
}
