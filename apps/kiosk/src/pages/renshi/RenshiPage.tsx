import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import { getPublishedPolicies, type PolicyPostView } from '../../services/api/policies'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { MessageCircleQuestionIcon, ShieldCheckIcon } from 'lucide-react'
import { fromPublished, getInitialTab, type AudienceKey, type PolicyItem, type TabKey } from './shared'
import { BUILTIN_GUIDES } from './builtinData'
import { OfficialEntryQrOverlay, PrintPackBanner, TabBar } from './components'
import { PolicyPanel } from './PolicyPanel'
import { SocialPanel } from './SocialPanel'
import { RegisterPanel } from './RegisterPanel'
import { NoticePanel } from './NoticePanel'

// ── Page ───────────────────────────────────────────────────────────────────────

export function RenshiPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabKey>(() => getInitialTab(searchParams))
  const [audience, setAudience] = useState<AudienceKey>('all')
  const { getToken } = useAuth()

  // P1 浏览/跳转记录：fire-and-forget，失败不影响浏览与官方入口打开；匿名不上报。
  // 内置指引（builtin-*）不在政策库中，服务端会拒绝记录，前端直接跳过。
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

  // 政策内容（阶段1D 接真）：一次拉取，前端按 kind 拆分。
  const [policies, setPolicies] = useState<PolicyPostView[]>([])
  const [policyState, setPolicyState] = useState<'loading' | 'error' | 'ready'>('loading')

  const loadPolicies = () => {
    setPolicyState('loading')
    getPublishedPolicies()
      .then((rows) => {
        setPolicies(rows)
        setPolicyState('ready')
      })
      .catch(() => setPolicyState('error'))
  }

  useEffect(() => { loadPolicies() }, [])

  // 同一路由内 search params 变化时同步首页深链 Tab，非法值回退「就业政策」。
  useEffect(() => {
    setActiveTab(getInitialTab(searchParams))
  }, [searchParams])

  const notices = policies.filter((p) => p.kind === 'notice')

  // 混合数据源：后端发布政策（审核为准）在前，内置办事指引模板在后。
  const policyItems = useMemo<PolicyItem[]>(
    () => [...policies.filter((p) => p.kind === 'policy_guide').map(fromPublished), ...BUILTIN_GUIDES],
    [policies],
  )

  /** 数据来源说明：库内政策取真实来源机构名 + 最近同步时间；内置指引单独表述，避免被误认为同步内容。 */
  const sourceLine = (() => {
    if (policies.length === 0) return '当前展示内置办事指引（整理参考，以官方发布为准）；标注「政策发布」的为合作机构发布、管理员审核内容'
    const names = [...new Set(policies.map((p) => p.sourceName))].slice(0, 2).join('、')
    const latest = policies.map((p) => p.syncTime).sort().at(-1)?.slice(0, 10) ?? ''
    return `「政策发布」来源：${names} · 同步于 ${latest}；其余为内置办事指引（整理参考，以官方发布为准）`
  })()

  const renderPolicyTab = () => {
    if (policyState === 'loading') return <LoadingState className="py-16" />
    if (policyState === 'error') return <ErrorState className="py-16" onRetry={loadPolicies} />
    return (
      <PolicyPanel
        items={policyItems}
        audience={audience}
        onAudienceChange={setAudience}
        sourceLine={sourceLine}
        onOpened={handlePolicyItemOpened}
        onOfficialEntry={handlePolicyItemEntry}
      />
    )
  }

  const renderNoticeTab = () => {
    if (policyState === 'loading') return <LoadingState className="py-16" />
    if (policyState === 'error') return <ErrorState className="py-16" onRetry={loadPolicies} />
    return <NoticePanel notices={notices} sourceLine={sourceLine} onOpened={handleNoticeOpened} onOfficialEntry={handleNoticeEntry} />
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      {qrEntry && <OfficialEntryQrOverlay title={qrEntry.title} url={qrEntry.url} onClose={() => setQrEntry(null)} />}
      <PageHeader title="政策服务" subtitle="就业政策 · 补贴指引 · 社保 · 就业登记 · 政策公告" />

      {/* 合规边界：仅信息指引 + 直达 AI 助手政策问答 */}
      <div className="flex flex-wrap items-start gap-3 rounded-xl border border-warning/30 bg-warning-bg px-4 py-3.5">
        <ShieldCheckIcon className="h-5 w-5 shrink-0 text-warning-fg" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-warning-fg">仅信息指引 · 不代办</p>
          <p className="mt-0.5 text-xs leading-relaxed text-warning-fg">
            只做政策说明、材料清单、官方入口与打印辅助；不代申请、不承诺补贴到账，不保存身份证 / 银行卡 / 社保等材料。
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/assistant')}
          className="flex min-h-[48px] shrink-0 items-center gap-1.5 rounded-lg border border-warning/50 bg-white px-3 text-sm font-semibold text-warning-fg hover:bg-warning/20"
        >
          <MessageCircleQuestionIcon className="h-4 w-4" aria-hidden="true" />
          问 AI 助手
        </button>
      </div>

      {/* Tab 导航 */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* Tab 面板 */}
      {activeTab === 'policy' && renderPolicyTab()}
      {activeTab === 'notice' && renderNoticeTab()}
      {activeTab === 'social' && <SocialPanel onOfficialEntry={(title, url) => setQrEntry({ title, url })} />}
      {activeTab === 'register' && <RegisterPanel />}

      {/* 常用材料打印包 */}
      <PrintPackBanner />

      {/* 合规页脚 */}
      <p className="pb-2 text-center text-xs leading-relaxed text-neutral-400">
        政策与公告内容仅作展示说明，具体以官方发布为准。如需办理具体业务，请前往对应窗口或扫码访问官方平台。
      </p>
    </div>
  )
}
