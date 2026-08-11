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

  useEffect(() => {
    setActiveTab(getInitialTab(searchParams))
  }, [searchParams])

  const notices = policies.filter((p) => p.kind === 'notice')

  const policyItems = useMemo<PolicyItem[]>(
    () => [...policies.filter((p) => p.kind === 'policy_guide').map(fromPublished), ...BUILTIN_GUIDES],
    [policies],
  )

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
