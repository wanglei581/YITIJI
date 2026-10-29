import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangleIcon, InfoIcon, PrinterIcon, ScaleIcon, ShieldCheckIcon } from 'lucide-react'
import { getPublishedPolicies, getPublishedPolicy, type PolicyPostView, type PublishedPoliciesResult } from '../../services/api/policies'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { isValidSourceUrl } from '../../lib/url'
import { useAuth } from '../../auth/useAuth'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { rememberAssistantDraft } from '../../services/assistantDraft'
import { AUDIENCE_CHIPS, fromPublished, getInitialTab, type AudienceKey, type PolicyItem, type TabKey } from './shared'
import { BUILTIN_GUIDES } from './builtinData'
import { OfficialEntryQrOverlay, RqDeadEnd, SourceLine, TabBar, type DeadEndExit, type SourceQrTarget } from './components'
import { PolicyPanel } from './PolicyPanel'
import { PolicyFocusDeadEnd } from './policyFocus'
import { usePolicyActionGuard, usePolicyFocus } from './usePolicyFocus'
import { EligibilityPanel, type EligibilityChrome } from './EligibilityPanel'
import { SocialPanel } from './SocialPanel'
import { RegisterPanel } from './RegisterPanel'
import { NoticePanel } from './NoticePanel'
import './renshi-policy-fusion.css'
import './renshi-eligibility-qx.css'
import './renshi-narrow-qx.css'
import './renshi-touch.css'

const TAB_TITLE: Record<TabKey, string> = {
  policy: '就业政策',
  eligibility: '条件核对',
  social: '社保指南',
  register: '就业登记',
  notice: '政策公告',
}

const AI_LABEL = '问小青别的问题，不判断能不能办'
// 无人值守时每 30 秒核对一次，兼顾紧急下架时效与服务端请求量。
const POLICY_REFRESH_MS = 30_000
// 按条核对的上限：读不回来就当这一轮没确认，不让一次挂住拖死后面每一轮。
const POLICY_CHECK_TIMEOUT_MS = 8_000
const AI_DRAFT: Record<TabKey, string> = {
  policy: '这一条政策来源在哪里？请说明如何核对发布机构和来源地址，不要解释政策原文，也不要判断能否办理。',
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

  const [guides, setGuides] = useState<PolicyPostView[]>([])
  const [guideTotal, setGuideTotal] = useState(0)
  const [notices, setNotices] = useState<PolicyPostView[]>([])
  const [noticeTotal, setNoticeTotal] = useState(0)
  const [policyState, setPolicyState] = useState<'loading' | 'error' | 'ready'>('loading')
  const withdrawnIds = useRef(new Set<string>())
  const loadGeneration = useRef(0)
  const [withdrawnDetail, setWithdrawnDetail] = useState<string | null>(null)

  const loadPolicies = useCallback((mode: 'block' | 'quiet' = 'block') => {
    const mergePolicyResults = (chunks: PublishedPoliciesResult[]): PublishedPoliciesResult => {
      const byId = new Map<string, PolicyPostView>()
      let total = 0
      for (const chunk of chunks) {
        total += chunk.total
        for (const item of chunk.items) byId.set(item.id, item)
      }
      return { items: [...byId.values()], total }
    }
    const generation = ++loadGeneration.current
    if (mode !== 'quiet') setPolicyState('loading')
    const keep = (items: PolicyPostView[]) => items.filter((item) => !withdrawnIds.current.has(item.id))
    const guideReq = audience === 'all'
      ? getPublishedPolicies({ kind: 'policy_guide' })
      : Promise.all([
          getPublishedPolicies({ kind: 'policy_guide', audience }),
          getPublishedPolicies({ kind: 'policy_guide', audience: 'general' }),
        ]).then((chunks) => mergePolicyResults(chunks))
    Promise.all([guideReq, getPublishedPolicies({ kind: 'notice' })])
      .then(([guideRes, noticeRes]) => {
        if (generation !== loadGeneration.current) return
        const nextGuides = keep(guideRes.items)
        const nextNotices = keep(noticeRes.items)
        setGuides(nextGuides)
        setGuideTotal(Math.max(0, guideRes.total - (guideRes.items.length - nextGuides.length)))
        setNotices(nextNotices)
        setNoticeTotal(Math.max(0, noticeRes.total - (noticeRes.items.length - nextNotices.length)))
        setPolicyState('ready')
      })
      .catch(() => {
        if (generation === loadGeneration.current && mode !== 'quiet') setPolicyState('error')
      })
  }, [audience])

  useEffect(() => { loadPolicies('block') }, [loadPolicies])

  const focusId = (searchParams.get('policy') ?? '').trim() || null
  const focus = usePolicyFocus({
    focusId,
    ready: policyState === 'ready',
    guides,
    notices,
    setGuides,
    setNotices,
    setSearchParams,
  })
  const reloadQuiet = useCallback(() => { loadPolicies('quiet') }, [loadPolicies])
  const guard = usePolicyActionGuard({
    focusId,
    setGuides,
    setNotices,
    setSearchParams,
    reloadQuiet,
    withdrawnIds,
  })
  const [activeId, setActiveId] = useState<string | null>(null)
  // 本人点开（或地址点名）的那一条才算「正在看详情」；默认自动展开的第一条不算。由 PolicyPanel 报上来。
  const [detailSelected, setDetailSelected] = useState(false)
  // 定时刷新读最新的展开状态走 ref：展开、收起不该让 30 秒的计时重新开始。
  const watched = useRef<{ id: string | null; userOpened: boolean }>({ id: null, userOpened: false })
  useEffect(() => { watched.current = { id: activeId, userOpened: detailSelected } }, [activeId, detailSelected])
  useEffect(() => {
    if (policyState !== 'ready') return
    let cancelled = false
    let checking = false
    const refresh = async () => {
      if (checking) return
      checking = true
      try {
        const { id } = watched.current
        // 内置指引是本机内容，没有「下架」；只核对政策库、公告里展开着的那一条。
        if (id && !id.startsWith('builtin-')) {
          // 按条读取没有自己的超时：弱网下挂住会让 checking 一直为真、后面每一轮都被吞掉，所以自己加上限。
          let timer: number | undefined
          const timeout = new Promise<{ status: 'failed' }>((resolve) => {
            timer = window.setTimeout(() => resolve({ status: 'failed' }), POLICY_CHECK_TIMEOUT_MS)
          })
          const result = await Promise.race([getPublishedPolicy(id), timeout]).finally(() => window.clearTimeout(timer))
          if (!cancelled && result.status === 'missing') {
            withdrawnIds.current.add(id)
            setGuides((rows) => rows.filter((row) => row.id !== id))
            setNotices((rows) => rows.filter((row) => row.id !== id))
            // 等待期间本人可能已经换到别的条目：只有「现在展开的还是这一条」才关二维码；
            // 且只有本人点开的这一条才整页换成「已下架」（自动展开的第一条只从列表摘掉），不留旧正文。
            const now = watched.current
            if (now.id === id) {
              setQrEntry(null)
              if (now.userOpened) setWithdrawnDetail(id)
            }
          }
        }
        if (!cancelled) loadPolicies('quiet')
      } finally {
        checking = false
      }
    }
    const timer = window.setInterval(() => { void refresh() }, POLICY_REFRESH_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [loadPolicies, policyState])
  const uploadTarget = focus.phase === 'idle' && !withdrawnDetail ? activeId : null

  async function uploadOwn(id: string | null) {
    const result = await guard.confirm(id)
    if (result.kind === 'blocked') return
    navigate('/print/upload')
  }
  async function openPublishedSource(
    item: { id: string; title: string; sourceName: string },
    target: SourceQrTarget,
  ) {
    const result = await guard.confirm(item.id)
    if (result.kind !== 'ready') return
    const url = result.policy.externalUrl?.trim() ?? ''
    if (!url || !isValidSourceUrl(url)) return
    if (!isBuiltin(item.id)) recordExternalJump(getToken(), 'policy', item.id, 'external_open')
    setQrEntry({
      title: result.policy.title || item.title,
      url,
      sourceKind: target.sourceKind,
      sourceDetail: result.policy.sourceName || item.sourceName,
    })
  }
  const isBuiltin = (id: string) => id.startsWith('builtin-')
  const handlePolicyItemOpened = (item: PolicyItem) => {
    if (isBuiltin(item.id)) return
    recordBrowse(getToken(), 'policy', item.id)
  }
  const handlePolicyItemEntry = (item: PolicyItem, target: SourceQrTarget) => {
    if (isBuiltin(item.id)) {
      if (!item.officialUrl || !isValidSourceUrl(item.officialUrl)) return
      setQrEntry(target)
      return
    }
    void openPublishedSource({ id: item.id, title: item.title, sourceName: item.sourceName }, target)
  }
  const handleNoticeOpened = (policy: PolicyPostView) => {
    recordBrowse(getToken(), 'policy', policy.id)
  }
  const handleNoticeEntry = (policy: PolicyPostView, target: SourceQrTarget) => {
    void openPublishedSource({ id: policy.id, title: policy.title, sourceName: policy.sourceName }, target)
  }
  const focusOnList = focus.phase !== 'idle' && (activeTab === 'policy' || activeTab === 'notice')
  const leaveFocusedPolicy = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('policy')
      return next
    }, { replace: true })
  }
  const focusFrame = focus.phase === 'checking'
    ? { subtitle: '正在打开你点的那一条，确认之前不显示别的政策。', status: { tone: 'unknown' as const, label: '正在打开' } }
    : focus.phase === 'missing'
      ? { subtitle: '这条现在打不开。可以看其他政策，或回到收藏。', status: { tone: 'warn' as const, label: '这条打不开' } }
      : focus.phase === 'failed'
        ? { subtitle: '这次没有打开。可以再试一次，或先看其他政策。', status: { tone: 'bad' as const, label: '这次没打开' } }
        : null

  const libraryItems = useMemo<PolicyItem[]>(() => guides.map(fromPublished), [guides])
  const visibleLibraryCount = libraryItems.filter((item) => (
    audience === 'all' || item.audiences.includes(audience) || item.audiences.includes('general')
  )).length
  // 选了身份时服务端只回这一身份与通用事项：一条都没有是筛选结果，不是政策库空（稿 48 的 filtered-empty）。
  const libraryEmpty = libraryItems.length === 0 && audience === 'all'
  const audienceLabel = AUDIENCE_CHIPS.find((chip) => chip.key === audience)?.label ?? ''

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
  const policySourceLine = libraryEmpty
    ? `政策库暂无已发布政策；下方「通用办事指引」是本机整理的参考${guideTruncated ? `。${guideTruncated}` : ''}`
    : visibleLibraryCount === 0
      ? `当前按「${audienceLabel}」筛选：政策库没有命中，下方指引仍可查看`
      : `政策库${describeSources(guides)}；「通用办事指引」是本机整理的参考${guideTruncated ? `。${guideTruncated}` : ''}`
  const noticeSourceLine = notices.length === 0
    ? null
    : `政策公告${describeSources(notices)}${noticeTruncated ? `。${noticeTruncated}` : ''}`

  const policyPill = (): Pill => {
    if (policyState === 'loading') return { tone: 'unknown', label: '正在读取政策' }
    if (policyState === 'error') return { tone: 'bad', label: '政策读取失败' }
    if (libraryEmpty) return { tone: 'warn', label: '政策库暂无内容' }
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
              : '公告由发布机构自己审核并发布，正文与来源链接原样呈现。',
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
          : libraryEmpty
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
  const bodyHint = activeTab === 'eligibility'
    ? null
    : readFailed
      ? '重试会先回到读取中，本机不把「点了重试」直接显示成读取成功。'
      : activeTab === 'policy'
        ? (policyState === 'loading'
          ? '政策还没读回来，打印你自己带来的材料不受影响。'
          : '政策与指引只做说明；需要纸质件请上传你自己的材料。')
        : activeTab === 'social'
          ? '社保材料请自行准备，本机只负责打印。'
          : activeTab === 'register'
            ? '把清单里需要复印的材料上传，本机可直接出纸。'
            : policyState === 'loading'
              ? '公告还没读回来，打印你自己带来的材料不受影响。'
              : notices.length === 0
                ? '公告为空不影响打印你自己带来的材料。'
                : '公告本身不提供下载；如需打印你自己带来的材料，可在这里上传。'
  // 问小青预填：政策分区里本人点开（或地址点名）的那一条，带上这一条的标题，并写明小青不解释原文、不判断能否办理；
  // 其余按分区的通用问句。没有真实的政策解读能力，不替它承诺。
  const activeItem = [...libraryItems, ...BUILTIN_GUIDES].find((item) => item.id === activeId)
  const onDetail = activeTab === 'policy' && (detailSelected || Boolean(focusId))
  const askDraft = onDetail && activeItem
    ? `关于「${activeItem.title}」，如何核对发布机构和来源地址？小青还不能解释政策原文，也不判断能否办理。`
    : AI_DRAFT[activeTab]
  const askLabel = activeTab === 'policy' && !onDetail ? '问小青：这一条来源在哪？' : AI_LABEL

  // 稿 48 的死路屏：政策与公告同一次读取，读取中 / 读取失败时两个分区给同一屏；三条出口都不等这次读取。
  const offReadExits = (hint: string): DeadEndExit[] => [
    { key: 'eligibility', icon: ScaleIcon, title: '去条件核对', desc: hint, onClick: () => setActiveTab('eligibility') },
    { key: 'social', icon: ShieldCheckIcon, title: '看社保指南', desc: '本机内置内容', onClick: () => setActiveTab('social') },
  ]
  const loadingDeadEnd = (
    <RqDeadEnd
      tone="info"
      icon={InfoIcon}
      title="正在读取政策与公告"
      exitsHint="这三条都不等政策读取"
      exits={offReadExits('不等这次读取')}
      uploadDesc="本机随时可用"
      note="社保指南与就业登记是本机内置内容，随时可看；政策与公告读回来会自动出现在这一屏。"
    >
      读回来之前不显示条数、标题与来源，也不会拿上一次的内容顶替。
    </RqDeadEnd>
  )
  const errorDeadEnd = (
    <RqDeadEnd
      tone="error"
      icon={AlertTriangleIcon}
      title="政策与公告这次没读到"
      exitsHint="这三条都不依赖这次读取"
      exits={offReadExits('不受这次失败影响')}
      uploadDesc="本机随时可用"
      note="重试会留在政策服务里重新读取一次，不会把你送回首页，也不会显示上一次的内容。"
      noteTone="warn"
    >
      这次读取没有成功，所以本页不显示任何条目。这不等于政策库是空的：库里确实没有内容时会另有一屏说明。
    </RqDeadEnd>
  )

  // 展开着的那一条被下架：整页换成「已下架」，顶栏也跟着说，不留旧正文；出路是回政策列表。
  const backToPolicyList = () => { setWithdrawnDetail(null); leaveFocusedPolicy(); setActiveTab('policy') }
  const bandStatus: Pill = withdrawnDetail
    ? { tone: 'warn', label: '这条已下架' }
    : focusOnList && focusFrame ? focusFrame.status : frame.status
  const bandSub = withdrawnDetail
    ? '这条政策已不在可查看范围内，下架后的正文和来源入口不再显示。'
    : focusOnList && focusFrame ? focusFrame.subtitle : frame.subtitle
  const renshiPageAttr = { 'data-qx-page': 'renshi' } as const
  return (
    <div {...renshiPageAttr} className="rq-touch-fill">
    <QxTouchScreen
      testId="renshi-touch"
      stateId={activeTab}
      bodyClassName="qxt-body-scroll"
      band={(
        <QxTouchBand
          seal={null}
          eyebrow="政策服务"
          title={TAB_TITLE[activeTab]}
          sub={bandSub}
          onBack={goHub}
          status={{
            text: bandStatus.label,
            tone: bandStatus.tone === 'ok' ? 'ok' : bandStatus.tone === 'warn' || bandStatus.tone === 'bad' ? 'warn' : 'unknown',
          }}
        />
      )}
      nav={(
        <QxTouchNav
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      )}
      dock={(
        withdrawnDetail ? <footer className="qxt-dock rq-touch-dock">
          <button type="button" className="qxt-btn qxt-btn-pri qxt-wide" onClick={backToPolicyList}>返回政策列表</button>
        </footer> : <footer className="qxt-dock rq-touch-dock">
          <button type="button" className="qxt-btn qxt-btn-sec" onClick={goHub}>返回政策服务</button>
          <button
            type="button"
            className="qxt-askq"
            onClick={() => {
              rememberAssistantDraft(askDraft)
              navigate('/assistant')
            }}
          >
            <span>{askLabel}</span>
          </button>
          <div className="rq-cta-row" data-testid="renshi-ctabar">
            {activeTab === 'eligibility' ? (
              <div ref={setEligHost} className="rq-cta-host" />
            ) : readFailed ? (
              <button type="button" className="qxt-btn qxt-btn-pri" onClick={() => loadPolicies('block')}>重新读取</button>
            ) : activeTab === 'policy' ? (
              <button type="button" className="qxt-btn qxt-btn-pri" data-upload-target={uploadTarget ?? ''} onClick={() => uploadOwn(uploadTarget)}>
                <PrinterIcon aria-hidden="true" />
                上传自备材料打印
              </button>
            ) : activeTab === 'social' ? (
              <button type="button" className="qxt-btn qxt-btn-pri" onClick={() => navigate('/print/upload')}>
                <PrinterIcon aria-hidden="true" />
                上传自备材料打印
              </button>
            ) : activeTab === 'register' ? (
              <button type="button" className="qxt-btn qxt-btn-pri" onClick={() => navigate('/print/upload')}>
                <PrinterIcon aria-hidden="true" />
                上传自备材料打印
              </button>
            ) : (
              <button type="button" className="qxt-btn qxt-btn-pri" data-upload-target={uploadTarget ?? ''} onClick={() => uploadOwn(uploadTarget)}>
                <PrinterIcon aria-hidden="true" />
                上传自备材料打印
              </button>
            )}
          </div>
        </footer>
      )}
    >
      {withdrawnDetail ? (
        <RqDeadEnd tone="warn" icon={AlertTriangleIcon} title="这条政策已下架" testId="renshi-policy-withdrawn"
          exitsHint="可以返回政策列表"
          exits={[{ key: 'others', icon: InfoIcon, title: '返回政策列表', desc: '查看当前可用的政策', onClick: backToPolicyList }]}
          uploadDesc="打印你自己带来的文件" note="已下架的正文和来源入口不再显示。">
          这条政策已不在可查看范围内。
        </RqDeadEnd>
      ) : <div className="w4-policy-page rq-page" data-renshi-tab={activeTab}>
        {qrEntry && <OfficialEntryQrOverlay target={qrEntry} onClose={() => setQrEntry(null)} />}
        <div className="rq-lead">
          <p className="rq-more">看政策、对条件、备材料。不代办，也不判断你能不能领。</p>
          <ol className="rq-steps">
            <li><b>1</b>先选下面的分区</li>
            <li><b>2</b>展开一条，看原文和材料</li>
            <li><b>3</b>扫码去来源页自己办</li>
          </ol>
          {focusOnList ? null : frame.source ? <SourceLine text={frame.source} /> : null}
          <TabBar active={activeTab} onChange={setActiveTab} />
        </div>
        <div className="qx-scroll rq-scroll">
          {bodyHint ? <p className="rq-touch-hint why">{bodyHint}</p> : null}
          <p className="rq-truth rq-touch-hint" data-testid="renshi-truth">
            <b>仅信息指引 · 不代办</b>
            本机只做政策说明、材料清单、来源入口与打印辅助；不代申请、不收费、不承诺补贴到账，也不保存身份证、银行卡或社保材料。
          </p>
          {guard.message && focus.phase === 'idle' && (activeTab === 'policy' || activeTab === 'notice') ? (
            <p className="rq-note rq-note-warn" role="status" data-testid="renshi-policy-action" data-action-phase={guard.phase}>
              {guard.message}
            </p>
          ) : null}
          {activeTab === 'policy' && (
            policyState === 'loading' ? loadingDeadEnd : policyState === 'error' ? errorDeadEnd : focus.phase !== 'idle' ? (
              <PolicyFocusDeadEnd phase={focus.phase} onOthers={leaveFocusedPolicy} onFavorites={() => navigate('/me/favorites')} onRetry={focus.retry} />
            ) : (
              <PolicyPanel
                libraryItems={libraryItems}
                guideItems={BUILTIN_GUIDES}
                audience={audience}
                focusId={focusId}
                suppressAutoOpen={guard.suppressAutoOpen}
                onAudienceChange={(key) => {
                  guard.release()
                  setAudience(key)
                }}
                onOpened={handlePolicyItemOpened}
                onActiveId={setActiveId}
                onDetailSelected={setDetailSelected}
                onUpload={(id) => { void uploadOwn(id) }}
                onOfficialEntry={handlePolicyItemEntry}
                aiLabel={AI_LABEL}
                aiDraft={AI_DRAFT.policy}
              />
            )
          )}
          {activeTab === 'eligibility' && <EligibilityPanel onChrome={setEligChrome} ctaHost={eligHost} onTab={setActiveTab} />}
          {activeTab === 'notice' && (
            policyState === 'loading' ? loadingDeadEnd : policyState === 'error' ? errorDeadEnd : focus.phase !== 'idle' ? (
              <PolicyFocusDeadEnd phase={focus.phase} onOthers={leaveFocusedPolicy} onFavorites={() => navigate('/me/favorites')} onRetry={focus.retry} />
            ) : (
              <NoticePanel
                notices={notices}
                focusId={focusId}
                suppressAutoOpen={guard.suppressAutoOpen}
                onOpened={handleNoticeOpened}
                onActiveId={setActiveId}
                onUpload={(id) => { void uploadOwn(id) }}
                onOfficialEntry={handleNoticeEntry}
                onTab={setActiveTab}
              />
            )
          )}
          {activeTab === 'social' && <SocialPanel onOfficialEntry={setQrEntry} />}
          {activeTab === 'register' && <RegisterPanel />}
        </div>
      </div>}
    </QxTouchScreen>
    </div>
  )
}
