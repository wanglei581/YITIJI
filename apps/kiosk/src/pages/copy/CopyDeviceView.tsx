import { useEffect, useState, useSyncExternalStore } from 'react'
import { ScanDeviceRunContent } from '../scan/ScanDeviceRunView'
import { ScanDeviceStopButton } from '../scan/ScanDeviceStopButton'
import { GlassArt } from '../scan/ScanGuideArt'
import { canConfirmCopy } from './copyCheckModel'
import { ensureCopyDevice, readCopyDevice, readCopyDeviceFlow, subscribeCopyDevice } from './copyDeviceFlow'
import type { CopySession } from './copySession'
import { CopyShell } from './CopyShell'
import { CopyCheckView } from './CopyCheckView'
import '../scan/styles/scan-device-flow.css'
import './copy-device.css'

export function CopyDeviceView({ session, onBack, onRescan, printerReady, online }: {
  session: CopySession; onBack: () => void; onRescan: () => Promise<void>; printerReady: boolean; online: boolean
}) {
  const state = useSyncExternalStore(subscribeCopyDevice, readCopyDevice)
  const [armed, setArmed] = useState(false)
  const [previewReady, setPreviewReady] = useState(false)
  useEffect(() => { ensureCopyDevice(session) }, [session])
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), 6000)
    return () => window.clearTimeout(timer)
  }, [armed])
  const device = readCopyDeviceFlow()
  const stop = () => {
    if (!armed) { setArmed(true); return }
    setArmed(false)
    void device?.stop()
  }
  const check = state.phase === 'check'
  const confirmed = state.phase === 'confirmed'
  const terminal = confirmed || state.phase === 'stopped' || state.phase === 'unknown'
  const more = state.phase === 'more'
  const title = check ? '核对一下，再开始打印' : confirmed ? '已确认' : state.phase === 'unknown' ? '状态未知'
    : state.phase === 'stopped' ? '已停止复印' : more ? '这一页扫好了，还有下一页吗？' : '正在扫原件'
  const stopping = <ScanDeviceStopButton label="停止复印" armed={armed} busy={state.busy} onPress={stop} />
  return <CopyShell stage={check ? 'check' : confirmed ? 'confirmed' : 'scan'} title={title} reason={null}
    statusTone={state.phase === 'unknown' ? 'unknown' : state.phase === 'starting' ? 'warn' : 'ok'}
    status={check ? '原件已扫完，等你核对' : confirmed ? '已确认' : terminal ? title : more ? '这一页已扫好' : state.phase === 'finishing' ? '整理成预览' : state.started ? '扫描中' : '等待扫描仪'}
    subtitle={terminal || check || more ? undefined : state.phase === 'finishing' ? '扫完后准备给你核对' : state.started ? '先别动原件，扫描仪正在工作。' : '还在等扫描仪回报已经开始。先别动原件。'}
    onBack={onBack} hideBack={!terminal && !check}
    left={check ? <button type="button" className="qxt-btn qxt-btn-sec" disabled={state.busy} onClick={() => { void onRescan() }}>重扫</button> : undefined}
    secondary={!check && !confirmed && state.phase !== 'stopped' ? stopping : undefined}
    primary={check ? { label: !online ? '网络已断开' : printerReady ? '开始打印' : '打印机离线', testId: 'copy-confirm',
      disabled: !device || state.busy || !previewReady || !printerReady || !online || !canConfirmCopy(state.job), onClick: () => { void device?.confirm() } }
      : more ? { label: '扫完了', disabled: state.busy, onClick: () => { void device?.command('finish') } } : undefined}>
    {check ? (state.job && device ? <CopyCheckView job={state.job} device={device} busy={state.busy} onPreviewReady={setPreviewReady} />
      : <p role="status" className="cc-note">报价暂时无法确认</p>)
      : confirmed ? <div className="cc-next" data-testid="copy-print-entry" role="status"><b>下一步：打印</b><p>已确认，等待进入打印步骤。</p></div>
        : more ? <div className="cc-more"><p>{state.pages != null ? `已收到 ${state.pages} 页` : '这一页已扫好'}</p>
          <button type="button" className="cc-source" disabled={state.busy} onClick={() => { void device?.command('next-page') }}>
            <span className="vis"><GlassArt /></span><b>再扫一页</b><span>先把下一页放上玻璃台，字朝下，对齐左上角</span></button></div>
          : !terminal ? <div data-qx-page="scan-workbench" className="cc-run" data-testid="copy-c3b-entry"><ScanDeviceRunContent copy
            pages={state.pages} scannerStarted={state.started} armed={armed} preparing={state.phase === 'finishing'} /></div> : null}
    {armed && (more || terminal) ? <p className="cc-note">再按一次才会停止，已扫的页会从这台机器删除。</p> : null}
    {state.notice ? <p role="status" className="cc-note">{state.notice}</p> : null}
  </CopyShell>
}
