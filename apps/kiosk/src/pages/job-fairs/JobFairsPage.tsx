import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobFair } from '@ai-job-print/shared'
import { CalendarIcon, MapPinIcon, UsersIcon } from 'lucide-react'

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_FAIRS: ExternalJobFair[] = [
  {
    id: 'f1',
    name: '2026春季高校毕业生双选会',
    organizer: '市人力资源和社会保障局',
    startTime: '2026-05-28T09:00:00Z',
    endTime: '2026-05-28T17:00:00Z',
    venue: '市人才交流中心 A 展厅（XX大道 88 号）',
    status: 'upcoming',
    description: '面向2026届本科及以上应届毕业生，汇聚150余家用人单位，涵盖互联网、金融、制造、政府等行业。',
    boothCount: 152,
    sourceOrgId: 'org-002',
    externalId: 'GOV-FAIR-2026-0312',
    sourceName: '市人社局官网',
    sourceUrl: 'https://example-hrss.gov.cn/fairs/GOV-FAIR-2026-0312',
    syncTime: '2026-05-24T08:00:00Z',
    reviewStatus: 'published',
    publishStatus: 'published',
  },
  {
    id: 'f2',
    name: '互联网行业专场招聘会',
    organizer: '市就业服务中心',
    startTime: '2026-05-25T10:00:00Z',
    endTime: '2026-05-25T16:00:00Z',
    venue: '科技园区创新中心 B 厅（高新路 12 号）',
    status: 'ongoing',
    description: '聚焦互联网、大数据、人工智能领域，面向应届生及3年内社招人员，提供岗位200余个。',
    boothCount: 68,
    sourceOrgId: 'org-002',
    externalId: 'GOV-FAIR-2026-0289',
    sourceName: '市就业网',
    sourceUrl: 'https://example-employment.gov.cn/fairs/GOV-FAIR-2026-0289',
    syncTime: '2026-05-23T12:00:00Z',
    reviewStatus: 'published',
    publishStatus: 'published',
  },
  {
    id: 'f3',
    name: '2026届研究生专项招聘会',
    organizer: '市高校联合就业服务联盟',
    startTime: '2026-05-10T09:00:00Z',
    endTime: '2026-05-10T17:00:00Z',
    venue: '大学路展览馆（大学路 256 号）',
    status: 'ended',
    description: '针对硕士、博士应届毕业生，提供科研机构、高校、大型企业等高端岗位。',
    boothCount: 95,
    sourceOrgId: 'org-002',
    externalId: 'GOV-FAIR-2026-0201',
    sourceName: '市人社局官网',
    sourceUrl: 'https://example-hrss.gov.cn/fairs/GOV-FAIR-2026-0201',
    syncTime: '2026-05-11T08:00:00Z',
    reviewStatus: 'published',
    publishStatus: 'published',
  },
]

const STATUS_CONFIG = {
  upcoming: { label: '未开始', bg: 'bg-blue-50', text: 'text-blue-600' },
  ongoing:  { label: '进行中', bg: 'bg-green-50', text: 'text-green-700' },
  ended:    { label: '已结束', bg: 'bg-gray-100', text: 'text-gray-400' },
}

const ALL_STATUS = ['全部', '未开始', '进行中', '已结束'] as const
const STATUS_FILTER_MAP: Record<string, string> = { 未开始: 'upcoming', 进行中: 'ongoing', 已结束: 'ended' }

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatSync(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日 同步`
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JobFairsPage() {
  const navigate = useNavigate()
  const [activeFilter, setActiveFilter] = useState('全部')

  const filtered =
    activeFilter === '全部'
      ? MOCK_FAIRS
      : MOCK_FAIRS.filter((f) => f.status === STATUS_FILTER_MAP[activeFilter])

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          title="招聘会"
          subtitle="来源：第三方平台 · 官方机构"
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
              返回首页
            </Button>
          }
        />

        {/* 合规提示 */}
        <p className="mt-3 text-xs text-gray-400">
          本系统仅展示第三方来源招聘会信息，不参与活动报名流程，请前往来源平台预约
        </p>

        {/* 状态筛选 */}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {ALL_STATUS.map((s) => (
            <button
              key={s}
              onClick={() => setActiveFilter(s)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                activeFilter === s
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* 列表 */}
      <div className="mt-4 flex flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6">
        {filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-16">
            <CalendarIcon className="h-12 w-12 text-gray-200" />
            <p className="mt-4 text-sm text-gray-400">该状态暂无招聘会</p>
          </div>
        ) : (
          filtered.map((fair) => {
            const sc = STATUS_CONFIG[fair.status]
            return (
              <Card key={fair.id} className={`p-5 ${fair.status === 'ended' ? 'opacity-70' : ''}`}>
                {/* 标题行 + 状态 */}
                <div className="flex items-start justify-between gap-3">
                  <p className="flex-1 text-base font-semibold text-gray-900">{fair.name}</p>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${sc.bg} ${sc.text}`}>
                    {sc.label}
                  </span>
                </div>

                {/* 信息行 */}
                <div className="mt-2 space-y-1.5 text-sm text-gray-600">
                  <div className="flex items-start gap-1.5">
                    <CalendarIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                    <span>{formatDate(fair.startTime)}–{formatDate(fair.endTime)}</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                    <span>{fair.venue}</span>
                  </div>
                  {fair.boothCount && (
                    <div className="flex items-center gap-1.5">
                      <UsersIcon className="h-4 w-4 shrink-0 text-gray-400" />
                      <span>{fair.boothCount} 家单位参展</span>
                    </div>
                  )}
                </div>

                {/* 来源 + 操作 */}
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-400">
                    {fair.sourceName} · {formatSync(fair.syncTime)}
                  </span>
                  <Button
                    size="sm"
                    variant={fair.status === 'ended' ? 'secondary' : 'primary'}
                    onClick={() => navigate(`/job-fairs/${fair.id}`, { state: { fair } })}
                  >
                    查看详情
                  </Button>
                </div>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
