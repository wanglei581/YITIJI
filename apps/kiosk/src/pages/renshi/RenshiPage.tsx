import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PrinterIcon } from 'lucide-react'
import { getPublishedPolicies, type PolicyPostView, type PublishedPoliciesResult } from '../../services/api/policies'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { QxAiHelp, QxStepActions } from '../../components/qingxu/QxAiHelp'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { fromPublished, getInitialTab, type AudienceKey, type PolicyItem, type TabKey } from './shared'
import { BUILTIN_GUIDES } from './builtinData'
import { OfficialEntryQrOverlay, SourceLine, TabBar, type SourceQrTarget } from './components'
import { PolicyPanel } from './PolicyPanel'
import { EligibilityPanel, type EligibilityChrome } from './EligibilityPanel'
import { SocialPanel } from './SocialPanel'
import { RegisterPanel } from './RegisterPanel'
import { NoticePanel } from './NoticePanel'
import './renshi-policy-fusion.css'

const TAB_TITLE: Record<TabKey, string> = {
  policy: '就业政策',
  eligibility: '条件核对',
  social: '社保指南',
  register: '就业登记',
  notice: '政策公告',
}

const AI_LABEL = '问小青别的问题，不判断能不能办'
const AI_DRAFT: Record<TabKey, string> = {
  policy: '我想看懂政策和办事材料该怎么准备、去哪里办。请只做说明，不要判断我能不能领。',
  eligibility: '条件核对的结果怎么看？请帮我理解「无法判定」是什么意思，不要替我下能不能办的结论。',
  social: '社保查询、参保证明和异地就医备案，我该去哪个入口、先准备什么？',
  register: '失业登记、就业登记和档案转移分别要带什么材料？请只告诉我去哪里问，不要代我办理。',
  notice: '这条公告里哪些内容要以发布机构原文为准？请帮我看懂，不要判断我能不能办。',
}

type Pill = { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }

export function RenshiPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = getInitialTab(searchParams)
  const [audience, setAudience] = useState<AudienceKey>('all')
  const { getToken } = useAuth()
  const [qrEntry, setQrEntry] = useState<SourceQrTarget | null>(null)
  const [eligChrome, setEligChrome] = useState<EligibilityChrome | null>(null)
  const [eligHost, setEligHost] = useState<HTMLDivElement | null>(null)

  const setActiveTab = (tab: TabKey) => {
    const next = new URLSearchParams(searchParams)
    if (tab === 'policy') next.delete('tab')
    else next.set('tab', tab)
    setSearchParams(next, { replace: true })
  }

  const isBuiltin = (id: string) => id.startsWith('builtin-')
  const handlePolicyItemOpened = (item: PolicyItem) => {
    if (isBuiltin(item.id)) return
    recordBrowse(getToken(), 'policy', item.id)
  }
  const handlePolicyItemEntry = (item: PolicyItem, target: SourceQrTarget) => {
    if (!item.officialUrl) return
    if (!isBuiltin(item.id)) recordExternalJump(getToken(), 'policy', item.id, 'external_open')
    setQrEntry(target)
  }
  const handleNoticeOpened = (policy: PolicyPostView) => {
    recordBrowse(getToken(), 'policy', policy.id)
  }
  const handleNoticeEntry = (policy: PolicyPostView, target: SourceQrTarget) => {
    if (!policy.externalUrl) return
    recordExternalJump(getToken(), 'policy', policy.id, 'external_open')
    setQrEntry(target)
  }

  const [guides, setGuides] = useState<PolicyPostView[]>([])
  const [guideTotal, setGuideTotal] = useState(0)
  const [notices, setNotices] = useState<PolicyPostView[]>([])
  const [noticeTotal, setNoticeTotal] = useState(0)
  const [policyState, setPolicyState] = useState<'loading' | 'error' | 'ready'>('loading')

  const loadPolicies = useCallback(() => {
    const mergePolicyResults = (chunks: PublishedPoliciesResult[]): PublishedPoliciesResult => {
      const byId = new Map<string, PolicyPostView>()
      let total = 0
      for (const chunk of chunks) {
        total += chunk.total
        for (const item of chunk.items) byId.set(item.id, item)
      }
      return { items: [...byId.values()], total }
    }
    setPolicyState('loading')
    const guideReq = audience === 'all'
      ? getPublishedPolicies({ kind: 'policy_guide' })
      : Promise.all([
          getPublishedPolicies({ kind: 'policy_guide', audience }),
          getPublishedPolicies({ kind: 'policy_guide', audience: 'general' }),
        ]).then((chunks) => mergePolicyResults(chunks))
    Promise.all([guideReq, getPublishedPolicies({ kind: 'notice' })])
      .then(([guideRes, noticeRes]) => {
        setGuides(guideRes.items)
        setGuideTotal(guideRes.total)
        setNotices(noticeRes.items)
        setNoticeTotal(noticeRes.total)
        setPolicyState('ready')
      })
      .catch(() => setPolicyState('error'))
  }, [audience])

  useEffect(() => { loadPolicies() }, [loadPolicies])

  const libraryItems = useMemo<PolicyItem[]>(() => guides.map(fromPublished), [guides])
  const visibleLibraryCount = libraryItems.filter((item) => (
    audience === 'all' || item.audiences.includes(audience) || item.audiences.includes('general')
  )).length

  const describeSources = (rows: PolicyPostView[]) => {
    const names = [...new Set(rows.map((row) => row.sourceName).filter(Boolean))].slice(0, 2).join('、')
    const latest = rows.map((row) => row.syncTime).sort().at(-1)?.slice(0, 10) ?? ''
    if (!names && !latest) return ''
    return `来源：${names || '发布机构未提供'} · 同步于 ${latest || '日期未提供'}`
  }
  const guideTruncated = guideTotal > guides.length
    ? audience === 'all'
      ? `已发布政策共 ${guideTotal} 条，这一页显示 ${guides.length} 条，可用上方身份筛选缩小范围`
      : `该身份下已发布政策共 ${guideTotal} 条，这一页显示 ${guides.length} 条`
    : ''
  const noticeTruncated = noticeTotal > notices.length
    ? `已发布公告共 ${noticeTotal} 条，这一页显示 ${notices.length} 条`
    : ''
  const policySourceLine = libraryItems.length === 0
    ? `政策库暂无已发布政策；下方「通用办事指引」是本机整理的参考${guideTruncated ? `。${guideTruncated}` : ''}`
    : `政策库${describeSources(guides)}；「通用办事指引」是本机整理的参考${guideTruncated ? `。${guideTruncated}` : ''}`
  const noticeSourceLine = notices.length === 0
    ? null
    : `政策公告${describeSources(notices)}${noticeTruncated ? `。${noticeTruncated}` : ''}`

  const policyPill = (): Pill => {
    if (policyState === 'loading') return { tone: 'unknown', label: '正在读取政策' }
    if (policyState === 'error') return { tone: 'bad', label: '政策读取失败' }
    if (libraryItems.length === 0) return { tone: 'warn', label: '政策库暂无内容' }
    if (visibleLibraryCount === 0) return { tone: 'warn', label: '筛选后无匹配' }
    return { tone: 'unknown', label: '政策库与办事指引' }
  }
  const noticePill = (): Pill => {
    if (policyState === 'loading') return { tone: 'unknown', label: '正在读取政策' }
    if (policyState === 'error') return { tone: 'bad', label: '政策读取失败' }
    if (notices.length === 0) return { tone: 'warn', label: '暂无公告' }
    return { tone: 'ok', label: '公告已展示' }
  }

  const frame = (() => {
    if (activeTab === 'eligibility') {
      return {
        subtitle: eligChrome?.subtitle ?? '先确认有可比对的政策，再决定是否请你填写。',
        status: {
          tone: eligChrome?.tone ?? 'unknown',
          label: eligChrome?.label ?? '正在检查可比对政策',
        } satisfies Pill,
        source: null as string | null,
      }
    }
    if (activeTab === 'social') {
      return {
        subtitle: '查询、证明、异地就医备案与社保卡四项，办理均以对应平台为准。',
        status: { tone: 'ok' as const, label: '本机整理指引' },
        source: '本机整理的办事指引，办理以对应平台为准',
      }
    }
    if (activeTab === 'register') {
      return {
        subtitle: '办理地点与材料清单以当地发布渠道最新说明为准。不代办。',
        status: { tone: 'ok' as const, label: '办理材料指引' },
        source: '办理地点与材料以当地就业服务机构公布为准',
      }
    }
    if (activeTab === 'notice') {
      const pill = noticePill()
      return {
        subtitle: policyState === 'error'
          ? '这次读取失败，本页不显示任何公告，也不猜是空还是有。'
          : policyState === 'loading'
            ? '公告与政策一起读取，读回来之前不显示任何条目。'
            : notices.length === 0
              ? '当前一条公告都没有；这是内容进度，不是读取失败。'
              : '公告由合作机构发布、管理员审核后展示，正文与来源链接原样呈现。',
        status: pill,
        source: policyState === 'ready' ? noticeSourceLine : null,
      }
    }
    const pill = policyPill()
    return {
      subtitle: policyState === 'error'
        ? '这次读取失败，本页不显示任何条目，也不猜政策库是空还是有。'
        : policyState === 'loading'
          ? '政策与公告一起读取，读回来之前不显示任何条目。'
          : libraryItems.length === 0
            ? '政策库当前为空；下方指引是本机整理的参考，不用来冒充政策库有内容。'
            : visibleLibraryCount === 0
              ? '按身份筛选后政策库没有命中；这是筛选结果，不是库里没有政策。'
              : '政策库条目与本机整理的指引分区展示，展开即看原文、条件与办理路径。',
      status: pill,
      source: policyState === 'ready' ? policySourceLine : null,
    }
  })()

  const goHub = () => navigate('/policy-service')
  const readFailed = policyState === 'error' && (activeTab === 'policy' || activeTab === 'notice')

  return (
    <QxPageFrame
      back={{ label: '返回政策服务', onBack: goHub }}
      title={TAB_TITLE[activeTab]}
      subtitle={frame.subtitle}
      status={frame.status}
      ctabar={(
        <div className="rq-cta-stack">
          <div className="rq-cta-row" data-testid="renshi-ctabar">
            {activeTab === 'eligibility' ? (
              <div ref={setEligHost} className="rq-cta-host" />
            ) : readFailed ? (
              <>
                <button type="button" className="qx-btn" data-variant="primary" onClick={loadPolicies}>重新读取</button>
                <span className="why">重试会先回到读取中，本机不把「点了重试」直接显示成读取成功。</span>
              </>
            ) : activeTab === 'policy' ? (
              <>
                <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/print/upload')}>
                  <PrinterIcon aria-hidden="true" />
                  上传自备材料打印
                </button>
                <span className="why">
                  {policyState === 'loading'
                    ? '政策还没读回来，打印你自己带来的材料不受影响。'
                    : '政策与指引只做说明；需要纸质件请上传你自己的材料。'}
                </span>
              </>
            ) : activeTab === 'social' ? (
              <>
                <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/print/upload')}>
                  <PrinterIcon aria-hidden="true" />
                  上传自备材料打印
                </button>
                <span className="why">社保材料请自行准备，本机只负责打印。</span>
              </>
            ) : activeTab === 'register' ? (
              <>
                <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/print/upload')}>
                  <PrinterIcon aria-hidden="true" />
                  上传自备材料打印
                </button>
                <span className="why">把清单里需要复印的材料上传，本机可直接出纸。</span>
              </>
            ) : (
              <>
                <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/print/upload')}>
                  <PrinterIcon aria-hidden="true" />
                  上传自备材料打印
                </button>
                <span className="why">
                  {policyState === 'loading'
                    ? '公告还没读回来，打印你自己带来的材料不受影响。'
                    : notices.length === 0
                      ? '公告为空不影响打印你自己带来的材料。'
                      : '公告本身不提供下载；如需打印你自己带来的材料，可在这里上传。'}
                </span>
              </>
            )}
          </div>
          <p className="rq-truth" data-testid="renshi-truth">
            <b>仅信息指引 · 不代办</b>
            本机只做政策说明、材料清单、来源入口与打印辅助；不代申请、不收费、不承诺补贴到账，也不保存身份证、银行卡或社保材料。
          </p>
        </div>
      )}
      navbar={<QxAppNavbar onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />}
    >
      <div className="w4-policy-page rq-page" data-renshi-tab={activeTab}>
        {qrEntry && <OfficialEntryQrOverlay target={qrEntry} onClose={() => setQrEntry(null)} />}
        <div className="rq-lead">
          <p className="rq-more">看政策、对条件、备材料。不代办，也不判断你能不能领。</p>
          <ol className="rq-steps">
            <li><b>1</b>先选下面的分区</li>
            <li><b>2</b>展开一条，看原文和材料</li>
            <li><b>3</b>扫码去来源页自己办</li>
          </ol>
          {frame.source ? <SourceLine text={frame.source} /> : null}
          <TabBar active={activeTab} onChange={setActiveTab} />
        </div>
        <div className="qx-scroll rq-scroll">
          {activeTab === 'policy' && (
            policyState === 'loading' ? (
              <div className="rq-state" data-kind="info"><b>正在读取政策与公告</b><p>社保指南和就业登记是本机整理的，可以先切到上面的分区看。</p></div>
            ) : policyState === 'error' ? (
              <div className="rq-state" data-kind="error">
                <b>政策与公告这次没读到</b>
                <p>这次读取没有成功，所以本页不显示任何条目。这不等于政策库是空的。</p>
                <button type="button" className="rq-retry" onClick={loadPolicies}>重新读取</button>
              </div>
            ) : (
              <PolicyPanel
                libraryItems={libraryItems}
                guideItems={BUILTIN_GUIDES}
                audience={audience}
                onAudienceChange={setAudience}
                onOpened={handlePolicyItemOpened}
                onOfficialEntry={handlePolicyItemEntry}
                aiLabel={AI_LABEL}
                aiDraft={AI_DRAFT.policy}
              />
            )
          )}
          {activeTab === 'eligibility' && <EligibilityPanel onChrome={setEligChrome} ctaHost={eligHost} />}
          {activeTab === 'notice' && (
            policyState === 'loading' ? (
              <div className="rq-state" data-kind="info"><b>正在读取政策与公告</b><p>社保指南和就业登记是本机整理的，可以先切到上面的分区看。</p></div>
            ) : policyState === 'error' ? (
              <div className="rq-state" data-kind="error">
                <b>政策与公告这次没读到</b>
                <p>这次读取没有成功，所以本页不显示任何公告。这不等于没有公告。</p>
                <button type="button" className="rq-retry" onClick={loadPolicies}>重新读取</button>
              </div>
            ) : (
              <NoticePanel notices={notices} onOpened={handleNoticeOpened} onOfficialEntry={handleNoticeEntry} />
            )
          )}
          {activeTab === 'social' && <SocialPanel onOfficialEntry={setQrEntry} />}
          {activeTab === 'register' && <RegisterPanel />}
          {activeTab === 'policy' && policyState === 'ready' ? null : (
            <QxStepActions onPrev={goHub}>
              <QxAiHelp label={AI_LABEL} draft={AI_DRAFT[activeTab]} testId="renshi-ask-ai" />
            </QxStepActions>
          )}
        </div>
      </div>
    </QxPageFrame>
  )
}
