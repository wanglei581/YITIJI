import { useEffect, useState } from 'react'
import { Eraser, Hand } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { clearScanWorkbenchSession } from './scanWorkbenchSession'
import { ScanWorkbenchShell } from './ScanWorkbenchChrome'
import { remainingQuietSeconds, type DeviceStopReceipt } from './scanDeviceStopState'
import './styles/scan-device-errors.css'

export function ScanDeviceStoppedPage({ receipt }: { receipt: DeviceStopReceipt }) {
  const navigate = useNavigate()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const seconds = remainingQuietSeconds(receipt, now)
  return (
    <ScanWorkbenchShell
      page="scan-unknown" state="failed" title="已停止扫描" subtitle="这次到这里为止，不会再继续。"
      status={{ tone: 'warn', label: '已停止' }} bandRail={null} bandBack={false}
      dock={{
        askLabel: seconds === null ? '问小青：为什么要等' : `问小青：为什么要等 ${seconds} 秒`,
        left: { label: '回打印扫描', leaveTo: '/print-scan' },
        primary: { label: '回首页', onClick: () => { clearScanWorkbenchSession(); navigate('/') } },
      }}
    >
      <div className="cs-stopped" data-testid="scan-device-stopped">
        <div className="cs-fact big"><span className="ic"><Eraser size={40} strokeWidth={2} aria-hidden /></span><b>已停止扫描{receipt.purged ? '，已扫的页已从这台机器删除。' : ''}</b></div>
        <div className="cs-wait" role="status">
          {seconds === null ? <>
            <div className="cs-ring is-pending" data-testid="scan-device-quiet-ring"><b>请稍候</b></div>
            <div className="tx"><b>请稍候再开始新的扫描</b><span>为了不让下一位看到你的材料，过一会儿才能开始新的扫描。</span></div>
          </> : <>
            <div className="cs-ring" data-testid="scan-device-quiet-seconds"><b>{seconds}<small>秒</small></b></div>
            <div className="tx"><b>{seconds} 秒后才能开始新的扫描</b><span>为了不让下一位看到你的材料，{seconds} 秒后才能开始新的扫描。</span></div>
          </>}
        </div>
        <div className="cs-fact"><span className="ic"><Hand size={36} strokeWidth={2} aria-hidden /></span><b>原件还在玻璃台或进纸器里，请取走</b></div>
      </div>
    </ScanWorkbenchShell>
  )
}
