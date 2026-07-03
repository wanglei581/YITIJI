import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { ActivityIcon, BuildingIcon, FileTextIcon, LayoutGridIcon, MapPinIcon, PencilIcon } from 'lucide-react'
import { Page } from '../Page'
import { VenueGuideTab } from './VenueGuideTab'
import { CompaniesTab } from './components/CompaniesTab'
import { EditFairDrawer } from './components/EditFairDrawer'
import { MaterialsTab } from './components/MaterialsTab'
import { StatsTab } from './components/StatsTab'
import { ZonesTab } from './components/ZonesTab'
import {
  PUBLISH_BADGE,
  REVIEW_BADGE,
  THEME_LABELS,
  TIME_STATUS_LABELS,
  TIME_STATUS_STYLES,
  deriveTimeStatus,
  fmtDateTime,
} from './components/shared'
import {
  fairsAdminService,
  type AdminFairDetail,
  type AdminFairListItem,
  type AdminFairStats,
} from '../../services/api/fairsAdmin'

// ─── 主组件 ───────────────────────────────────────────────────────────────────

type TabKey = 'companies' | 'zones' | 'venue' | 'materials' | 'stats'

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'companies', label: '参展企业', icon: BuildingIcon },
  { key: 'zones',     label: '展区管理', icon: LayoutGridIcon },
  { key: 'venue',     label: '场馆导览', icon: MapPinIcon },
  { key: 'materials', label: '活动资料', icon: FileTextIcon },
  { key: 'stats',     label: '数据统计', icon: ActivityIcon },
]

export default function FairsPage() {
  const [fairs, setFairs] = useState<AdminFairListItem[]>([])
  const [listState, setListState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminFairDetail | null>(null)
  const [detailState, setDetailState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [stats, setStats] = useState<AdminFairStats | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('companies')
  const [editOpen, setEditOpen] = useState(false)

  const loadList = useCallback(async () => {
    setListState('loading')
    try {
      const rows = await fairsAdminService.listFairs()
      setFairs(rows)
      setListState('ready')
      setSelectedId((prev) => prev && rows.some((f) => f.id === prev) ? prev : rows[0]?.id ?? null)
    } catch {
      setListState('error')
    }
  }, [])

  const loadDetail = useCallback(async (fairId: string) => {
    setDetailState('loading')
    setStats(null)
    try {
      const [d, s] = await Promise.all([
        fairsAdminService.getFairDetail(fairId),
        fairsAdminService.getStats(fairId),
      ])
      setDetail(d)
      setStats(s)
      setDetailState('ready')
    } catch {
      setDetailState('error')
    }
  }, [])

  useEffect(() => { void loadList() }, [loadList])
  useEffect(() => { if (selectedId) void loadDetail(selectedId) }, [selectedId, loadDetail])

  /** 子资源变更后刷新详情 + 列表计数。 */
  const refresh = useCallback(() => {
    if (selectedId) void loadDetail(selectedId)
    void loadList()
  }, [selectedId, loadDetail, loadList])

  const selectedFair = useMemo(() => detail?.fair ?? null, [detail])

  return (
    <Page
      title="招聘会管理"
      subtitle="招聘会内容运营 — 基本信息 · 参展企业 · 展区 · 活动资料 · 统计(审核/发布请到「招聘会信息源」)"
    >
      {listState === 'loading' && <LoadingState className="py-24" />}
      {listState === 'error' && <ErrorState className="py-24" onRetry={() => void loadList()} />}
      {listState === 'ready' && fairs.length === 0 && (
        <EmptyState
          className="py-24"
          title="暂无招聘会数据"
          description="招聘会由合作机构在机构后台导入,经「招聘会信息源」审核后在此进行内容运营。"
        />
      )}

      {listState === 'ready' && fairs.length > 0 && (
        <>
          {/* 招聘会选择器 */}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {fairs.map((fair) => {
              const timeStatus = deriveTimeStatus(fair.startAt, fair.endAt)
              return (
                <button
                  key={fair.id}
                  onClick={() => setSelectedId(fair.id)}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    selectedId === fair.id
                      ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex-1 text-sm font-semibold leading-snug text-gray-900">{fair.title}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TIME_STATUS_STYLES[timeStatus]}`}>
                      {TIME_STATUS_LABELS[timeStatus]}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-gray-400">{fair.venue} · {fair.city}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{fmtDateTime(fair.startAt)}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <StatusBadge status={REVIEW_BADGE[fair.reviewStatus]?.status ?? 'default'} label={REVIEW_BADGE[fair.reviewStatus]?.label ?? fair.reviewStatus} />
                    <StatusBadge status={PUBLISH_BADGE[fair.publishStatus]?.status ?? 'default'} label={PUBLISH_BADGE[fair.publishStatus]?.label ?? fair.publishStatus} />
                    <span className="ml-auto text-xs text-gray-400">
                      企业 {fair.counts.companies} · 展区 {fair.counts.zones} · 资料 {fair.counts.materials}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {detailState === 'loading' && <LoadingState className="py-24" />}
          {detailState === 'error' && selectedId && <ErrorState className="py-24" onRetry={() => void loadDetail(selectedId)} />}

          {detailState === 'ready' && selectedFair && (
            <>
              {/* 当前招聘会标题区 */}
              <div className="mb-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-gray-900">{selectedFair.title}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {THEME_LABELS[selectedFair.theme] ?? selectedFair.theme}
                    {' · '}{fmtDateTime(selectedFair.startAt)} ~ {fmtDateTime(selectedFair.endAt)}
                    {' · '}{selectedFair.venue}
                    {selectedFair.address ? `(${selectedFair.address})` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    来源:{selectedFair.sourceName} · 外部编号 {selectedFair.externalId} · 同步于 {fmtDateTime(selectedFair.syncTime)}
                  </p>
                </div>
                <button
                  onClick={() => setEditOpen(true)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                  编辑基本信息
                </button>
              </div>

              {/* 标签页 */}
              <div className="mb-4 flex gap-1 border-b border-gray-200">
                {TABS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                      activeTab === key
                        ? 'border-b-2 border-primary-600 text-primary-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>

              {activeTab === 'companies' && <CompaniesTab fairId={selectedFair.id} companies={detail?.companies ?? []} onChanged={refresh} />}
              {activeTab === 'zones'     && <ZonesTab fairId={selectedFair.id} zones={detail?.zones ?? []} onChanged={refresh} />}
              {activeTab === 'venue'     && <VenueGuideTab fairId={selectedFair.id} venueDefault={selectedFair.venue} companies={detail?.companies ?? []} />}
              {activeTab === 'materials' && <MaterialsTab fairId={selectedFair.id} materials={detail?.materials ?? []} onChanged={refresh} />}
              {activeTab === 'stats'     && <StatsTab stats={stats} />}

              <EditFairDrawer
                fair={selectedFair}
                open={editOpen}
                onClose={() => setEditOpen(false)}
                onSaved={refresh}
              />
            </>
          )}
        </>
      )}

      <p className="mt-6 text-xs text-gray-400">
        招聘会数字化模块:仅提供信息展示和现场服务,不接收简历,不参与招聘闭环。所有修改操作均记录审计日志。
      </p>
    </Page>
  )
}
