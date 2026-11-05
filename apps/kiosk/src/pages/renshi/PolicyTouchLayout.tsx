import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock, type QxTouchPrimary } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchArtChecklist } from '../../components/qingxu/touch/QxTouchArt'
import { useInterviewAiCapabilities } from '../interview/useInterviewAiCapabilities'
import { useKioskLicense } from '../../layouts/KioskLicenseContext'
import { IS_MOCK_MODE } from '../../services/api/client'
import { POLICY_ASK_HOME } from './policyModel'
import '../service-hubs/policy-touch.css'

export function PolicyTouchLayout({ title, eyebrow, sub, state, children, home = false, compact = false,
  ask = true, askPrompt = POLICY_ASK_HOME, path, pathLabel, nav = !compact, primary, alert }: {
  title: string; eyebrow: string; sub?: string; state: string; children: ReactNode
  home?: boolean; compact?: boolean; ask?: boolean; askPrompt?: { label: string; draft: string }
  path?: readonly string[]; pathLabel?: string
  /** 底部导航：首页、类别列表、公告照稿都有（policy-min.js nav: 'home'），详情（紧凑顶带）没有。 */
  nav?: boolean
  primary?: QxTouchPrimary; alert?: ReactNode
}) {
  const navigate = useNavigate()
  const capabilities = useInterviewAiCapabilities()
  const winding = useKioskLicense().mode === 'winding-down'
  return (
    <QxTouchScreen page="policy-min" testId={home ? 'policy-touch-hub' : 'renshi-page'} stateId={state}
      className={compact ? 'policy-min-compact' : ''} bodyClassName="qxt-body-scroll"
      band={<QxTouchBand kind={compact ? 'compact' : 'std'} seal={null} title={title} eyebrow={eyebrow}
        sub={sub} onBack={() => navigate(home ? '/' : '/policy-service')}
        path={path ?? (home ? ['选类别', '看条件和材料', '打印清单或扫码看原文'] : undefined)} pathLabel={pathLabel ?? '查一条政策'} />}
      dock={<QxTouchDock onBack={() => navigate(home ? '/' : '/policy-service')} backLabel={home ? '返回首页' : '返回政策首页'}
        ask={!ask ? false : winding || capabilities.state('assistant_chat') !== 'available'
          ? { label: '小青暂时不可用 · 查看政策照常', disabled: true }
          : { label: askPrompt.label, draft: askPrompt.draft, voice: import.meta.env.VITE_USE_TRTC_CALL === 'true' }}
        primary={primary} alert={alert} />}
      nav={nav ? <QxTouchNav onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} /> : undefined}>
      <div className="policy-min-body">
        {IS_MOCK_MODE && <p className="policy-min-fine" role="note">演示数据 · 当前为演示模式</p>}
        {children}
      </div>
    </QxTouchScreen>
  )
}

export function PolicyChecklistSample({ empty = false }: { empty?: boolean }) {
  return <section className="policy-min-sample">
    <div><h2>{empty ? '有政策后可打印这样一页' : '可以打印一页办事清单'}</h2>
      <p>谁可以申请、要准备的材料、去哪办，整理在同一页。</p>
      <p>带走纸质清单，或扫码看发布机构原文。</p>
      <p className="policy-min-fine">清单示意 · 不是可办理的政策文件</p>
    </div>
    <QxTouchArtChecklist width={210} />
  </section>
}

export function PolicyReadState({ failed, retry }: { failed: boolean; retry: () => void }) {
  return <>
    <section className="policy-min-section" role="status">
      <h2>{failed ? '这次没读到政策' : '正在读取政策'}</h2>
      <p>{failed ? '打印、扫描照常。可以重新读取，或返回首页办别的事。' : '读回来后再显示条数、标题和内容。打印、扫描照常。'}</p>
      {failed && <button type="button" className="policy-min-button" onClick={retry}>重新读取</button>}
    </section>
    <PolicyChecklistSample />
  </>
}
