import { useState } from 'react'
import type { EnabledModule, PartnerCoopStatus, PartnerType, SceneTemplate } from '@ai-job-print/shared'
import {
  MODULE_LABELS,
  PARTNER_TYPE_LABELS,
  SCENE_DEFAULT_MODULES,
  SCENE_TEMPLATE_LABELS,
} from '@ai-job-print/shared'
import { Card, StatusBadge, EmptyState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { Building2Icon } from 'lucide-react'
import { Pagination, useTableState } from '../components/DataTable'

// ─── Local display config ─────────────────────────────────────────────────────

const PARTNER_TYPE_STYLES: Record<PartnerType, string> = {
  school_employment_center:  'bg-blue-50 text-blue-600',
  public_employment_service: 'bg-green-50 text-green-600',
  licensed_hr_agency:        'bg-purple-50 text-purple-600',
  fair_organizer:            'bg-orange-50 text-orange-600',
  enterprise_source:         'bg-gray-100 text-gray-600',
}

const SCENE_TEMPLATE_STYLES: Record<SceneTemplate, string> = {
  school:               'bg-blue-50 text-blue-500',
  public_employment:    'bg-teal-50 text-teal-600',
  licensed_hr_service:  'bg-purple-50 text-purple-500',
}

const COOP_MAP: Record<PartnerCoopStatus, { badge: 'success' | 'error' | 'warning'; label: string }> = {
  active:    { badge: 'success', label: '合作中' },
  suspended: { badge: 'error',   label: '已暂停' },
  pending:   { badge: 'warning', label: '审核中' },
}

// ─── Types & mock ─────────────────────────────────────────────────────────────

interface Partner {
  id: string
  name: string
  partnerType: PartnerType
  sceneTemplate: SceneTemplate
  enabledModules: EnabledModule[]
  contact: string
  contactPhone: string
  coopStatus: PartnerCoopStatus
  terminalCount: number
  sourceCount: number
  joinedAt: string
}

const MOCK_PARTNERS: Partner[] = [
  {
    id: 'pt1', name: '市人力资源和社会保障局',
    partnerType: 'public_employment_service', sceneTemplate: 'public_employment',
    enabledModules: SCENE_DEFAULT_MODULES.public_employment,
    contact: '张主任',   contactPhone: '138****0001', coopStatus: 'active',    terminalCount: 3, sourceCount: 12, joinedAt: '2026-01-15',
  },
  {
    id: 'pt2', name: '市人才交流中心',
    partnerType: 'public_employment_service', sceneTemplate: 'public_employment',
    enabledModules: SCENE_DEFAULT_MODULES.public_employment,
    contact: '李老师',   contactPhone: '139****0002', coopStatus: 'active',    terminalCount: 2, sourceCount: 8,  joinedAt: '2026-02-01',
  },
  {
    id: 'pt3', name: '某大学就业指导中心',
    partnerType: 'school_employment_center', sceneTemplate: 'school',
    enabledModules: SCENE_DEFAULT_MODULES.school,
    contact: '王老师',   contactPhone: '150****0003', coopStatus: 'active',    terminalCount: 2, sourceCount: 15, joinedAt: '2026-02-20',
  },
  {
    id: 'pt4', name: '市就业服务中心',
    partnerType: 'public_employment_service', sceneTemplate: 'public_employment',
    enabledModules: SCENE_DEFAULT_MODULES.public_employment,
    contact: '陈科长',   contactPhone: '137****0004', coopStatus: 'active',    terminalCount: 2, sourceCount: 6,  joinedAt: '2026-03-05',
  },
  {
    id: 'pt5', name: '某社区就业服务站',
    partnerType: 'public_employment_service', sceneTemplate: 'public_employment',
    enabledModules: ['print_scan', 'policy_service', 'job_info', 'external_apply_redirect'],
    contact: '赵站长',   contactPhone: '136****0005', coopStatus: 'active',    terminalCount: 1, sourceCount: 0,  joinedAt: '2026-03-18',
  },
  {
    id: 'pt6', name: '市行政服务中心',
    partnerType: 'public_employment_service', sceneTemplate: 'public_employment',
    enabledModules: SCENE_DEFAULT_MODULES.public_employment,
    contact: '孙副主任', contactPhone: '135****0006', coopStatus: 'active',    terminalCount: 1, sourceCount: 4,  joinedAt: '2026-04-01',
  },
  {
    id: 'pt7', name: '某人力资源服务有限公司',
    partnerType: 'licensed_hr_agency', sceneTemplate: 'licensed_hr_service',
    enabledModules: SCENE_DEFAULT_MODULES.licensed_hr_service,
    contact: '周总',     contactPhone: '134****0007', coopStatus: 'suspended', terminalCount: 1, sourceCount: 2,  joinedAt: '2026-04-10',
  },
  {
    id: 'pt8', name: '某招聘会承办有限公司',
    partnerType: 'fair_organizer', sceneTemplate: 'licensed_hr_service',
    enabledModules: ['print_scan', 'job_fair', 'external_apply_redirect'],
    contact: '吴经理',   contactPhone: '158****0008', coopStatus: 'pending',   terminalCount: 0, sourceCount: 0,  joinedAt: '2026-05-20',
  },
]

const COOP_FILTERS = ['全部', '合作中', '已暂停', '审核中'] as const
const COOP_FILTER_MAP: Record<string, PartnerCoopStatus | null> = { 全部: null, 合作中: 'active', 已暂停: 'suspended', 审核中: 'pending' }

const TYPE_FILTERS: Array<{ label: string; value: PartnerType | null }> = [
  { label: '全部类型', value: null },
  { label: '公共就业服务机构', value: 'public_employment_service' },
  { label: '高校就业中心',     value: 'school_employment_center'  },
  { label: '持证人力资源机构', value: 'licensed_hr_agency'        },
  { label: '招聘会主办方',     value: 'fair_organizer'            },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function PartnersPage() {
  const [partners] = useState(MOCK_PARTNERS)
  const [coopFilter, setCoopFilter]   = useState('全部')
  const [typeFilter, setTypeFilter]   = useState<PartnerType | null>(null)
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)

  const filtered = partners.filter((p) => {
    const matchCoop = coopFilter === '全部' || p.coopStatus === COOP_FILTER_MAP[coopFilter]
    const matchType = typeFilter === null   || p.partnerType === typeFilter
    return matchCoop && matchType
  })

  const searched = search.trim()
    ? filtered.filter((p) =>
        p.name.includes(search) ||
        p.contact.includes(search)
      )
    : filtered

  const total = searched.length
  const paginated = searched.slice((page - 1) * pageSize, page * pageSize)

  const coopCounts = {
    全部:   partners.length,
    合作中: partners.filter((p) => p.coopStatus === 'active').length,
    已暂停: partners.filter((p) => p.coopStatus === 'suspended').length,
    审核中: partners.filter((p) => p.coopStatus === 'pending').length,
  }

  return (
    <Page title="合作机构管理" subtitle={`共 ${partners.length} 家合作机构`}>
      {/* 双行筛选 */}
      <div className="mb-4 space-y-2">
        {/* 合作状态 */}
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-gray-400">合作状态</span>
          <div className="flex gap-2">
            {COOP_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => { setCoopFilter(f); setPage(1) }}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  coopFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f}
                <span className="ml-1 text-xs opacity-70">{coopCounts[f]}</span>
              </button>
            ))}
          </div>
        </div>
        {/* 机构类型 */}
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-gray-400">机构类型</span>
          <div className="flex gap-2 flex-wrap">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.label}
                onClick={() => { setTypeFilter(f.value); setPage(1) }}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  typeFilter === f.value ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="relative mt-2">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索机构名称、联系人..." className="h-8 w-64 rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200" />
          <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
        </div>
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['机构名称', '机构类型', '场景模板', '启用模块', '联系人', '联系电话', '合作状态', '绑定终端', '数据源', '加入时间', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={11}>
                    <EmptyState title={search ? '未找到匹配的机构' : '该分类暂无合作机构'} description={search ? '请尝试其他关键词' : undefined} icon={Building2Icon} className="py-12" />
                  </td>
                </tr>
              ) : (
                paginated.map((p) => {
                  const coop = COOP_MAP[p.coopStatus]
                  return (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{p.name}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${PARTNER_TYPE_STYLES[p.partnerType]}`}>
                          {PARTNER_TYPE_LABELS[p.partnerType]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${SCENE_TEMPLATE_STYLES[p.sceneTemplate]}`}>
                          {SCENE_TEMPLATE_LABELS[p.sceneTemplate]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-500">
                          {p.enabledModules.map((m) => MODULE_LABELS[m]).join(' · ')}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">{p.contact}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{p.contactPhone}</td>
                      <td className="px-4 py-3"><StatusBadge status={coop.badge} label={coop.label} /></td>
                      <td className="px-4 py-3 text-center text-gray-700">{p.terminalCount}</td>
                      <td className="px-4 py-3 text-center text-gray-700">{p.sourceCount}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{p.joinedAt}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex gap-2">
                          <button className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">查看详情</button>
                          {p.coopStatus !== 'pending' && (
                            <button
                              disabled
                              title="合作状态写入端点未接入，已禁用，避免误以为操作生效"
                              className="cursor-not-allowed rounded px-2 py-1 text-xs font-medium text-gray-300"
                            >
                              {p.coopStatus === 'active' ? '停用' : '启用'}
                            </button>
                          )}
                          <button
                            disabled
                            title="场景配置写入端点未接入，已禁用"
                            className="cursor-not-allowed rounded px-2 py-1 text-xs font-medium text-gray-300"
                          >
                            配置场景
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }} />
      </Card>

      <p className="mt-3 text-xs text-gray-400">
        所有合作机构共用同一套系统，通过机构类型 + 场景模板 + 启用模块进行差异化配置。状态与场景写入端点接入前，相关按钮保持禁用。
      </p>
    </Page>
  )
}
