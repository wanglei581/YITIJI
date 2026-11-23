import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand, type QxTouchStatus } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock, type QxTouchPrimary } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchArtChecklist } from '../../components/qingxu/touch/QxTouchArt'
import { useInterviewAiCapabilities } from '../interview/useInterviewAiCapabilities'
import { useKioskLicense } from '../../layouts/KioskLicenseContext'
import { IS_MOCK_MODE } from '../../services/api/client'
import { POLICY_ASK_HOME } from './policyModel'
import '../service-hubs/policy-touch.css'

/**
 * 政策各屏顶栏状态胶囊：按实际读取与内容态诚实映射，避免漏传 status 回落为「状态未知」（PlanA-3）。
 */
export function policyBandStatus(state: string): QxTouchStatus {
  if (state === 'loading') return { text: '正在读取', tone: 'reading' }
  if (state === 'failed') return { text: '读取失败', tone: 'warn' }
  if (state === 'missing' || state === 'withdrawn') return { text: '当前不可查看', tone: 'warn' }
  if (state === 'too-long') return { text: '关键词过长', tone: 'warn' }
  if (state === 'empty') return { text: '暂无已发布政策', tone: 'unknown' }
  if (state === 'none') return { text: '未找到匹配政策', tone: 'unknown' }
  if (state === 'idle') return { text: '等待输入关键词', tone: 'unknown' }
  return { text: '机构发布 · 仅作指引', tone: 'ok' }
}

export function PolicyTouchLayout({ title, eyebrow, sub, state, children, home = false, compact = false,
  ask = true, askPrompt = POLICY_ASK_HOME, path, pathLabel, nav = true, primary, alert, overlay, bodyClass }: {
  title: string; eyebrow: string; sub?: string; state: string; children: ReactNode
  home?: boolean; compact?: boolean; ask?: boolean; askPrompt?: { label: string; draft: string }
  path?: readonly string[]; pathLabel?: string
  /** 底部导航：政策各屏照稿都有（policy-min.js 详情写 nav: null，ui.js 的 nav(null) 画的是没有选中项的导航，不是不画）。 */
  nav?: boolean
  primary?: QxTouchPrimary; alert?: ReactNode
  /** 盖住这一屏的阅读层。有它时，下面的政策页不再接收点击。 */
  overlay?: ReactNode
  /** 有原文摘录时收紧详情，两张出路卡才能回到首屏。 */
  bodyClass?: string
}) {
  const navigate = useNavigate()
  const capabilities = useInterviewAiCapabilities()
  const winding = useKioskLicense().mode === 'winding-down'
  return (
    <QxTouchScreen page="policy-min" testId={home ? 'policy-touch-hub' : 'renshi-page'} stateId={state}
      className={compact ? 'policy-min-compact' : ''} bodyClassName="qxt-body-scroll"
      band={<QxTouchBand kind={compact ? 'compact' : 'std'} seal={home ? 'idle' : null} title={title} eyebrow={eyebrow}
        sub={sub} status={policyBandStatus(state)} onBack={() => navigate(home ? '/' : '/policy-service')}
        path={path ?? (home ? ['选类别', '看条件和材料', '打印清单或扫码看原文'] : undefined)} pathLabel={pathLabel ?? '查一条政策'} />}
      dock={<QxTouchDock onBack={() => navigate(home ? '/' : '/policy-service')} backLabel="返回"
        ask={!ask ? false : winding || capabilities.state('assistant_chat') !== 'available'
          ? { label: '小青暂时不可用 · 查看政策照常', disabled: true }
          : { label: askPrompt.label, draft: askPrompt.draft, voice: import.meta.env.VITE_USE_TRTC_CALL === 'true' }}
        primary={primary} alert={alert} />}
      nav={nav ? <QxTouchNav onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} /> : undefined}
      overlay={overlay}>
      <div className={bodyClass ? `policy-min-body ${bodyClass}` : 'policy-min-body'}>
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
