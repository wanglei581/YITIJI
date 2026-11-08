import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchTile } from '../../components/qingxu/touch/QxTouchTile'
import { getPublishedPolicies, type PublishedPoliciesResult } from '../../services/api/policies'
import { useAuth } from '../../auth/useAuth'
import { useOfficialChannels } from '../../hooks/useOfficialChannels'
import { useKioskLicense } from '../../layouts/KioskLicenseContext'
import { LICENSE_NO_NEW_TASK_REASON } from '../../copy/unattendedCopy'
import { rememberAssistantDraft } from '../../services/assistantDraft'
import { useInterviewAiCapabilities } from '../interview/useInterviewAiCapabilities'
import { PolicyChecklistSample, PolicyReadState, PolicyTouchLayout } from '../renshi/PolicyTouchLayout'
import { POLICY_CATEGORIES, POLICY_GENERAL_QUESTION, policyCategorySummaries, policyRead } from '../renshi/policyModel'
import { policyPublishedOn } from '../renshi/policyFacts'
import { SERVICE_HUB_SPECS } from './serviceHubSpecs'
import './policy-touch.css'

type HomeData = { categories: PublishedPoliciesResult[]; latest: PublishedPoliciesResult; notices: PublishedPoliciesResult }

export function PolicyTouchHub() {
  const navigate = useNavigate()
  const { isLoggedIn } = useAuth()
  const winding = useKioskLicense().mode === 'winding-down'
  const ai = useInterviewAiCapabilities()
  // 没有发布的政策时，本机构有官方渠道就给一条去官网 / 公众号看的出路（与首页磁贴同一判据）。我们不代发政策。
  const channels = useOfficialChannels()
  const channelCount = channels.status === 'ready' ? channels.items.length : 0
  const [attempt, setAttempt] = useState(0)
  const [data, setData] = useState<HomeData | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    setData(null)
    setFailed(false)
    policyRead(Promise.all([
      Promise.all(POLICY_CATEGORIES.map(({ key: audience }) => getPublishedPolicies({ kind: 'policy_guide', audience, pageSize: 1 }))),
      getPublishedPolicies({ kind: 'policy_guide', pageSize: 1 }),
      getPublishedPolicies({ kind: 'notice', pageSize: 1 }),
    ])).then(([categories, latest, notices]) => {
      if (active) setData({ categories, latest, notices })
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [attempt])
  const empty = data?.latest.total === 0 && data.notices.total === 0
  const latest = data?.latest.items[0]
  const spec = SERVICE_HUB_SPECS.policy
  return <PolicyTouchLayout home title={empty ? '这里还没有发布的政策' : spec.title}
    eyebrow={empty ? '查政策' : spec.eyebrow}
    path={empty ? ['机构在后台发布', '这里按类别列出', '打印清单或扫码看原文'] : undefined}
    pathLabel={empty ? '有政策以后' : undefined} sub={empty
      ? '机构在后台审核发布后，这里按类别列出，每条写清条件、材料和去哪办。' : spec.subtitle}
    ask={!empty} state={failed ? 'failed' : !data ? 'loading' : empty ? 'empty' : 'ready'}
    alert={winding ? <p role="status">{LICENSE_NO_NEW_TASK_REASON}</p> : undefined}>
    {!data ? <PolicyReadState failed={failed} retry={() => setAttempt((value) => value + 1)} /> : empty ? <>
      <section className="policy-min-section">
        <h2>政策由谁发布</h2>
        <ul><li>政策由发布机构在机构后台自己审核、发布，并对内容负责</li>
          <li>本机不自己编写政策，也不拿别处的内容顶替</li>
          <li>有了政策，可以在这里打印一页办事清单带走，或扫码看原文</li></ul>
      </section>
      <PolicyChecklistSample empty />
      <div className="policy-min-grid">
        <QxTouchTile icon="sparkle" title={ai.state('assistant_chat') === 'available' ? '问小青' : '小青暂时不可用'}
          desc="问通用问题；不解释具体政策，不判断能不能领" off={winding || ai.state('assistant_chat') !== 'available'}
          onClick={() => { rememberAssistantDraft(POLICY_GENERAL_QUESTION); navigate('/assistant') }} />
        {channelCount > 0 ? (
          <QxTouchTile icon="qr" title="本机构官方渠道" desc={`本机有 ${channelCount} 个渠道，扫码到机构官网或官方账号`} onClick={() => navigate('/official-channels')} />
        ) : null}
        <QxTouchTile icon="home" title="回首页办别的事" desc="打印、扫描、改简历、练面试照常" onClick={() => navigate('/')} />
      </div>
    </> : <>
      <div className="policy-min-grid policy-min-categories" data-testid="policy-categories">
        {policyCategorySummaries(data.categories).map((category, index) => <QxTouchTile key={category.key} icon={category.icon}
          title={category.label} desc={category.disabled ? '还没有机构发布' : `${category.total} 条 · 最近：${category.latest?.title ?? '标题未提供'}`}
          layout="stack" off={winding || category.disabled} index={index} testId={`policy-category-${category.key}`}
          onClick={() => navigate(`/renshi?audience=${category.key}`)} />)}
      </div>
      {latest && <button type="button" className="policy-min-row" disabled={winding} onClick={() => navigate(`/renshi?policy=${encodeURIComponent(latest.id)}`)}>
        最近更新 · {latest.title} · {policyPublishedOn(latest) ?? '日期未提供'}
      </button>}
      {data.notices.total > 0 && <button type="button" className="policy-min-row" disabled={winding} onClick={() => navigate('/renshi?tab=notice')}>
        机构公告 · {data.notices.total} 条
      </button>}
      {isLoggedIn && <button type="button" className="policy-min-row" disabled={winding} onClick={() => navigate('/me/favorites?tab=policy')}>政策收藏</button>}
      <p className="policy-min-fine">条数从发布数据读；政策由发布机构自行审核发布，以官方原文为准</p>
    </>}
  </PolicyTouchLayout>
}
