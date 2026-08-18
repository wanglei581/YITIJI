import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorState, KioskPageFrame, KioskPageHeader, LoadingState } from '@ai-job-print/ui'
import { getPublishedPolicies, type PolicyPostView } from '../../services/api/policies'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { MessageCircleQuestionIcon, ShieldCheckIcon } from 'lucide-react'
import { fromPublished, getInitialTab, type AudienceKey, type PolicyItem, type TabKey } from './shared'
import { BUILTIN_GUIDES } from './builtinData'
import { OfficialEntryQrOverlay, TabBar } from './components'
import { PolicyPanel } from './PolicyPanel'
import { EligibilityPanel } from './EligibilityPanel'
import { SocialPanel } from './SocialPanel'
import { RegisterPanel } from './RegisterPanel'
import { NoticePanel } from './NoticePanel'
import './renshi-policy-fusion.css'

export function RenshiPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabKey>(() => getInitialTab(searchParams))
  const [audience, setAudience] = useState<AudienceKey>('all')
  const { getToken } = useAuth()

  const [qrEntry, setQrEntry] = useState<{ title: string; url: string } | null>(null)
  const isBuiltin = (id: string) => id.startsWith('builtin-')
  const handlePolicyItemOpened = (item: PolicyItem) => {
    if (isBuiltin(item.id)) return
    recordBrowse(getToken(), 'policy', item.id)
  }
  const handlePolicyItemEntry = (item: PolicyItem) => {
    if (!item.officialUrl) return
    if (!isBuiltin(item.id)) recordExternalJump(getToken(), 'policy', item.id, 'external_open')
    setQrEntry({ title: item.title, url: item.officialUrl })
  }
  const handleNoticeOpened = (policy: PolicyPostView) => {
    recordBrowse(getToken(), 'policy', policy.id)
  }
  const handleNoticeEntry = (policy: PolicyPostView) => {
    if (!policy.externalUrl) return
    recordExternalJump(getToken(), 'policy', policy.id, 'external_open')
    setQrEntry({ title: policy.title, url: policy.externalUrl })
  }

  const [policies, setPolicies] = useState<PolicyPostView[]>([])
  /** 服务端已发布政策总数;大于已取回条数时页面必须如实说明,不能静默截断。 */
  const [policyTotal, setPolicyTotal] = useState(0)
  const [policyState, setPolicyState] = useState<'loading' | 'error' | 'ready'>('loading')

  const loadPolicies = () => {
    setPolicyState('loading')
    getPublishedPolicies()
      .then((res) => {
        setPolicies(res.items)
        setPolicyTotal(res.total)
        setPolicyState('ready')
      })
      .catch(() => setPolicyState('error'))
  }

  useEffect(() => { loadPolicies() }, [])

  useEffect(() => {
    setActiveTab(getInitialTab(searchParams))
  }, [searchParams])

  const notices = policies.filter((p) => p.kind === 'notice')
  const policyGuides = policies.filter((p) => p.kind === 'policy_guide')

  // 政策库条目与内置办事指引分开传给 PolicyPanel，绝不合并成一个数组。
  // 合并后政策库为空时页面照样满屏（内置指引常驻 5 条，其中一条对任何身份都命中），
  // 运营录完种子政策无法判断到底进没进去，验收因此失去判别力（CLAUDE.md §9）。
  // useMemo 的引用稳定性要保住：fromPublished 每次都造新对象，
  // 掉了 memo 会让详情面板的选中项每帧换新身份，白跑 onOpened 副作用。
  const libraryItems = useMemo<PolicyItem[]>(
    () => policies.filter((p) => p.kind === 'policy_guide').map(fromPublished),
    [policies],
  )
  const guideItems = BUILTIN_GUIDES

  // 单页有上限，取回条数少于服务端总数时如实说明，不让多出来的条目无声消失。
  const truncated = policyTotal > policies.length
    ? `；服务端共 ${policyTotal} 条已发布内容，本页取回 ${policies.length} 条，可用上方身份筛选缩小范围`
    : ''
  /** 来源行必须按 kind 各算各的：政策 Tab 引用公告的来源机构会把「库里其实没有政策」说成有。 */
  const describeSources = (rows: PolicyPostView[]) => {
    const names = [...new Set(rows.map((p) => p.sourceName))].slice(0, 2).join('、')
    const latest = rows.map((p) => p.syncTime).sort().at(-1)?.slice(0, 10) ?? ''
    return `来源：${names} · 同步于 ${latest}`
  }
  const policySourceLine = libraryItems.length === 0
    ? `政策库暂无已发布政策；下方「通用办事指引」为本机整理参考，以官方发布为准${truncated}`
    : `政策库${describeSources(policyGuides)}；「通用办事指引」为本机整理参考${truncated}`
  const noticeSourceLine = notices.length === 0
    ? null
    : `政策公告${describeSources(notices)}${truncated}`

  const renderPolicyTab = () => {
    if (policyState === 'loading') return <LoadingState className="py-16" />
    if (policyState === 'error') return <ErrorState className="py-16" onRetry={loadPolicies} />
    return (
      <PolicyPanel
        libraryItems={libraryItems}
        guideItems={guideItems}
        audience={audience}
        onAudienceChange={setAudience}
        sourceLine={policySourceLine}
        onOpened={handlePolicyItemOpened}
        onOfficialEntry={handlePolicyItemEntry}
      />
    )
  }

  const renderNoticeTab = () => {
    if (policyState === 'loading') return <LoadingState className="py-16" />
    if (policyState === 'error') return <ErrorState className="py-16" onRetry={loadPolicies} />
    return <NoticePanel notices={notices} sourceLine={noticeSourceLine} onOpened={handleNoticeOpened} onOfficialEntry={handleNoticeEntry} />
  }

  return (
    <KioskPageFrame
      className="w4-policy-page k8-policy-shell h-full"
      header={<KioskPageHeader title="政策服务" description="就业政策 · 补贴指引 · 社保 · 就业登记 · 政策公告" onBack={() => navigate('/')} backLabel="返回首页" />}
    >
      <div className="k8-policy">
      {qrEntry && <OfficialEntryQrOverlay title={qrEntry.title} url={qrEntry.url} onClose={() => setQrEntry(null)} />}

      <div className="k8-policy-banner">
        <ShieldCheckIcon className="h-[30px] w-[30px] shrink-0 text-wheat-fg" aria-hidden="true" />
        <div className="k8-policy-banner__text min-w-0 flex-1">
          <b>仅信息指引 · 不代办</b>
          <span>
            只做政策说明、材料清单、来源链接与打印辅助；不代申请、不承诺补贴到账，不保存身份证 / 银行卡 / 社保等材料。
          </span>
        </div>
        <button
          type="button"
          onClick={() => navigate('/assistant')}
          className="k8-policy-banner__action"
        >
          <MessageCircleQuestionIcon className="h-5 w-5" aria-hidden="true" />
          问 AI 助手
        </button>
      </div>

      <TabBar active={activeTab} onChange={setActiveTab} />

      {activeTab === 'policy' && renderPolicyTab()}
      {/*
        条件核对自己取数（两个 P21 端点），不复用上面的 /policies 结果：
        比对面只认 approved+published 且 kind=policy_guide 的条目，
        与列表页的取数口径不同，借用会让「有没有可比对的政策」判错。
        它也**不依赖 AI**（服务端确定性比对，零 LLM），所以不挂任何 AI 降级分支。
      */}
      {activeTab === 'eligibility' && <EligibilityPanel />}
      {activeTab === 'notice' && renderNoticeTab()}
      {activeTab === 'social' && <SocialPanel onOfficialEntry={(title, url) => setQrEntry({ title, url })} />}
      {activeTab === 'register' && <RegisterPanel />}

      <p className="k8-policy-footer">
        政策与公告内容仅作展示说明，具体要求请向发布主体或主管部门核对；如需办理，请前往对应窗口或核对目标域名后扫码访问。
      </p>
      </div>
    </KioskPageFrame>
  )
}
