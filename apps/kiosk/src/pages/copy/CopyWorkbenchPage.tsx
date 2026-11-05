import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { COPY_GUIDE_ROUTE } from '../print-scan/printHubContent'
import { CopyShell } from './CopyShell'
import { CopySettingsView } from './CopySettingsView'
import { CopyWays } from './CopyWays'
import { allowedCopySettings, clearCopySession, pickCopySettings } from './copySession'
import { useCopyFlow } from './useCopyFlow'
import { CopyDeviceView } from './CopyDeviceView'
import { readCopyDeviceFlow } from './copyDeviceFlow'

/** URL 只表示视图意图；建单和后续扫描从来不因深链或刷新自动执行。 */
export function CopyWorkbenchPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const flow = useCopyFlow()
  const { snapshot, options } = flow
  const [online, setOnline] = useState(navigator.onLine)
  const requested = params.get('stage')
  const stage = requested === 'off' ? 'off' : requested === 'scan' && snapshot.session ? 'scan'
    : requested === 'set' ? (flow.denied ? 'off' : 'set') : 'how'
  const go = (next: string) => setParams(next === 'how' ? {} : { stage: next })
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => {
    if (!snapshot.attempt) pickCopySettings(allowedCopySettings(snapshot.settings, options))
    // 只有能力变化才校正不可用选项，不能覆盖用户刚选的参数。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.color, options.duplex])
  useEffect(() => {
    if (requested === 'scan' && !snapshot.session) setParams({}, { replace: true })
  }, [requested, snapshot.session, setParams])
  const guide = () => { clearCopySession(); navigate(COPY_GUIDE_ROUTE) }
  const back = () => {
    if (stage === 'how') { clearCopySession(); navigate('/print-scan') }
    else { clearCopySession(); go('how') }
  }
  const reason = !online ? '网络断开时，我们会收到提醒并远程处理' : flow.reason
  const title = stage === 'how' ? '怎么复印？' : stage === 'set' ? '放好原件，选份数'
    : stage === 'off' ? '这台机器暂时只能在打印机面板上复印' : snapshot.session?.controlToken ? '下一步' : '状态未知'
  const start = () => {
    void flow.start().then((outcome) => {
      if (outcome === 'ready') go('scan')
      if (outcome === 'off') go('off')
    })
  }
  const pending = snapshot.phase === 'creating'
  const rescan = async (source?: 'flatbed') => {
    const settings = snapshot.session?.input
    if (!settings || !await readCopyDeviceFlow()?.clearForRescan()) return
    clearCopySession()
    pickCopySettings({ ...settings, ...(source ? { source } : {}) })
    go('set')
    const outcome = await flow.start(true)
    if (outcome === 'ready') go('scan')
    if (outcome === 'off') go('off')
  }
  if (stage === 'scan' && snapshot.session?.controlToken) return <CopyDeviceView session={snapshot.session}
    onBack={back} onRescan={rescan} printerReady={flow.printer.printerReady} online={online} />
  return <CopyShell stage={stage} title={title} reason={reason} onBack={back}
    subtitle={stage === 'off' && flow.printer.printerReady ? '面板上的复印、身份证复印、票据复印都能用。' : undefined}
    primary={stage === 'off' ? { label: '怎么在打印机上复印', onClick: guide, testId: 'copy-primary' }
      : stage === 'set' ? { label: flow.printer.kind === 'offline' ? '打印机离线' : '开始复印', onClick: start, testId: 'copy-primary',
        disabled: pending || Boolean(snapshot.session) || Boolean(reason) }
        : undefined}>
    {stage === 'how' || stage === 'off' ? <CopyWays off={stage === 'off'} reason={reason} guide={guide} screen={() => go('set')} />
      : stage === 'set' ? <CopySettingsView settings={allowedCopySettings(snapshot.settings, options)} color={options.color} duplex={options.duplex}
        locked={Boolean(snapshot.attempt)} notice={snapshot.notice ?? reason} onPick={pickCopySettings} />
        : <div className="cc-next" data-testid="copy-c3b-entry" role="status">
          <p>{snapshot.notice ?? '原件几页，扫完才知道；扫完会给你核对'}</p>
        </div>}
  </CopyShell>
}
