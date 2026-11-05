import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock, type QxTouchPrimary } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { clearCopySession } from './copySession'
import '../../styles/qingxu/index.css'
import './copy.css'

export function CopyShell({ stage, title, subtitle, reason, onBack, primary, children, status, statusTone, left, secondary, hideBack }: {
  stage: 'how' | 'set' | 'off' | 'scan' | 'check' | 'confirmed'
  title: string; subtitle?: string; reason: string | null; onBack: () => void
  primary?: QxTouchPrimary; children: ReactNode
  status?: string; statusTone?: 'ok' | 'warn' | 'unknown'; left?: ReactNode; secondary?: ReactNode; hideBack?: boolean
}) {
  const navigate = useNavigate()
  const question = stage === 'how' ? '怎么复印更合适' : stage === 'set' ? '份数怎么选'
    : stage === 'scan' ? '一直扫不完怎么办' : stage === 'check' || stage === 'confirmed' ? '核对什么' : '面板上怎么复印'
  const leave = (path: string) => { clearCopySession(); navigate(path) }
  return <QxTouchScreen legacyFrame className="copy-touch" page="copy-workbench" testId={`copy-${stage}`} motion="none"
    band={<QxTouchBand kind="compact" back={false} eyebrow={['set', 'scan', 'check', 'confirmed'].includes(stage) ? '屏上复印' : '复印'}
      title={title} sub={subtitle} seal={null}
      status={{ text: status ?? (stage === 'off' ? '屏上复印未开通' : reason ?? '扫描仪就绪 · 刚刚检查'), tone: statusTone ?? (reason || stage === 'off' ? 'warn' : 'ok') }}
      rail={stage === 'off' ? undefined : { labels: ['扫原件', '核对', '打印', '取走'], now: stage === 'check' ? 1 : stage === 'confirmed' ? 2 : stage === 'set' || stage === 'scan' ? 0 : -1 }} />}
    dock={<QxTouchDock onBack={onBack} back={!hideBack} backLabel="返回" left={left} secondary={secondary}
      ask={{ label: `问小青：${question}`, draft: question, voice: true, beforeAsk: () => { clearCopySession() } }} primary={primary} />}
    nav={<QxTouchNav onHome={() => leave('/')} onAdvisor={() => leave('/assistant')} onProfile={() => leave('/profile')} />}>
    {children}
  </QxTouchScreen>
}
