import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock, type QxTouchPrimary } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { clearCopySession } from './copySession'
import '../../styles/qingxu/index.css'
import './copy.css'

export function CopyShell({ stage, title, subtitle, reason, onBack, primary, children }: {
  stage: 'how' | 'set' | 'off' | 'scan'
  title: string; subtitle?: string; reason: string | null; onBack: () => void
  primary?: QxTouchPrimary; children: ReactNode
}) {
  const navigate = useNavigate()
  const question = stage === 'how' ? '怎么复印更合适' : stage === 'set' ? '份数怎么选' : '面板上怎么复印'
  const leave = (path: string) => { clearCopySession(); navigate(path) }
  return <QxTouchScreen legacyFrame className="copy-touch" page="copy-workbench" testId={`copy-${stage}`} motion="none"
    band={<QxTouchBand kind="compact" back={false} eyebrow={stage === 'set' || stage === 'scan' ? '屏上复印' : '复印'}
      title={title} sub={subtitle} seal={null}
      status={{ text: stage === 'off' ? '屏上复印未开通' : reason ?? '扫描仪就绪 · 刚刚检查', tone: reason || stage === 'off' ? 'warn' : 'ok' }}
      rail={stage === 'off' ? undefined : { labels: ['扫原件', '核对', '打印', '取走'], now: stage === 'set' ? 0 : -1 }} />}
    dock={<QxTouchDock onBack={onBack} backLabel="返回"
      ask={{ label: `问小青：${question}`, draft: question, voice: true, beforeAsk: () => { clearCopySession() } }} primary={primary} />}
    nav={<QxTouchNav onHome={() => leave('/')} onAdvisor={() => leave('/assistant')} onProfile={() => leave('/profile')} />}>
    {children}
  </QxTouchScreen>
}
