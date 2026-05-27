import { useState } from 'react'
import { Card, StatusBadge } from '@ai-job-print/ui'

// ─── 本地展示类型（Phase 7 接入 API 前的临时定义，不属于 packages/shared）─────

type CompanyScale        = 'startup' | 'small' | 'medium' | 'large' | 'enterprise'
type CompanyCheckinStatus = 'pending' | 'checked_in' | 'absent'
type FairBoothStatus     = 'available' | 'occupied' | 'reserved'
type FairMaterialType    = 'schedule' | 'venue_map' | 'company_list' | 'position_list' | 'brochure' | 'other'

interface FairCompanyPosition { id: string; title: string; headcount: number; requirements: string }
interface FairCompany {
  id: string; fairId: string; companyName: string; industry: string; scale: CompanyScale
  description: string; boothNumber?: string; zoneId?: string; zoneName?: string
  positions: FairCompanyPosition[]; sourceUrl?: string
  checkinStatus: CompanyCheckinStatus; checkinTime?: string
}
interface FairZone { id: string; fairId: string; zoneName: string; description: string; boothCount: number; checkedInCount: number }
interface FairBooth {
  id: string; fairId: string; zoneId: string; zoneName: string; boothNumber: string
  status: FairBoothStatus; companyId?: string; companyName?: string; areaSqm?: number
}
interface FairMaterial {
  id: string; fairId: string; name: string; type: FairMaterialType; description: string
  pageCount: number; fileSizeKB: number; printCount: number; fileUrl: string
  allowPrint: boolean; publishStatus: 'draft' | 'published' | 'unpublished'
}
interface FairLiveStats {
  fairId: string; totalCompanies: number; checkedInCompanies: number
  totalPositions: number; totalHeadcount: number
  browseCount: number; scanCount: number; printCount: number; checkinCount: number; lastUpdated: string
}

const COMPANY_SCALE_LABELS: Record<CompanyScale, string> = {
  startup: '初创', small: '小型', medium: '中型', large: '大型', enterprise: '超大型',
}
const COMPANY_CHECKIN_LABELS: Record<CompanyCheckinStatus, string> = {
  pending: '未签到', checked_in: '已签到', absent: '缺席',
}
const BOOTH_STATUS_LABELS: Record<FairBoothStatus, string> = {
  available: '空闲', occupied: '已入驻', reserved: '已预留',
}
const FAIR_MATERIAL_TYPE_LABELS: Record<FairMaterialType, string> = {
  schedule: '活动日程', venue_map: '展馆地图', company_list: '企业名册',
  position_list: '岗位汇总', brochure: '宣传手册', other: '其他资料',
}

// ─────────────────────────────────────────────────────────────────────────────
import { Page } from '../Page'
import {
  ActivityIcon,
  BriefcaseIcon,
  BuildingIcon,
  CalendarIcon,
  CheckCircleIcon,
  FileTextIcon,
  MapPinIcon,
  PrinterIcon,
  QrCodeIcon,
  UploadIcon,
  UsersIcon,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ManagedFair {
  id: string
  name: string
  organizer: string
  venue: string
  startTime: string
  endTime: string
  status: 'upcoming' | 'ongoing' | 'ended'
  totalBooths: number
  externalId?: string
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_FAIRS: ManagedFair[] = [
  { id: 'f1', name: '2026春季高校毕业生双选会', organizer: '市人力资源和社会保障局', venue: '市人才交流中心 A 展厅', startTime: '2026-05-28 09:00', endTime: '2026-05-28 17:00', status: 'upcoming', totalBooths: 152, externalId: 'GOV-FAIR-2026-0312' },
  { id: 'f2', name: '互联网行业专场招聘会',       organizer: '市就业服务中心',         venue: '科技园区创新中心 B 厅', startTime: '2026-05-25 10:00', endTime: '2026-05-25 16:00', status: 'ongoing',  totalBooths: 68,  externalId: 'GOV-FAIR-2026-0289' },
  { id: 'f3', name: '2026届研究生专项招聘会',     organizer: '市高校联合就业服务联盟', venue: '大学路展览馆',           startTime: '2026-05-10 09:00', endTime: '2026-05-10 17:00', status: 'ended',    totalBooths: 95,  externalId: 'GOV-FAIR-2026-0201' },
]

const MOCK_COMPANIES: FairCompany[] = [
  { id: 'c1', fairId: 'f2', companyName: '某互联网平台公司', industry: '互联网/软件', scale: 'enterprise', description: '国内头部互联网公司，DAU超2亿。', boothNumber: 'A-01', zoneId: 'z1', zoneName: 'A区 产品研发', positions: [{ id: 'p1', title: '前端工程师', headcount: 10, requirements: '本科计算机专业' }, { id: 'p2', title: 'iOS开发', headcount: 5, requirements: '3年以上iOS开发经验' }], sourceUrl: 'https://example.com', checkinStatus: 'checked_in', checkinTime: '2026-05-25T09:05:00Z' },
  { id: 'c2', fairId: 'f2', companyName: 'AI算法公司',       industry: '数据/AI',     scale: 'large',       description: '专注计算机视觉与NLP的AI公司。',   boothNumber: 'B-03', zoneId: 'z2', zoneName: 'B区 数据/AI',  positions: [{ id: 'p3', title: '算法工程师', headcount: 8, requirements: '硕士及以上' }], sourceUrl: 'https://example-ai.com', checkinStatus: 'checked_in', checkinTime: '2026-05-25T09:10:00Z' },
  { id: 'c3', fairId: 'f2', companyName: '电商运营公司',     industry: '运营/市场',   scale: 'medium',      description: '专注电商代运营与内容营销。',       boothNumber: 'C-05', zoneId: 'z3', zoneName: 'C区 运营市场', positions: [{ id: 'p4', title: '电商运营专员', headcount: 10, requirements: '1年以上电商经验' }], sourceUrl: 'https://example-ecom.com', checkinStatus: 'pending' },
  { id: 'c4', fairId: 'f2', companyName: '云计算服务商',     industry: '产品/技术',   scale: 'large',       description: '国内TOP5云服务提供商。',           boothNumber: 'A-08', zoneId: 'z1', zoneName: 'A区 产品研发', positions: [{ id: 'p5', title: '云原生工程师', headcount: 6, requirements: '熟悉 K8s/Docker' }], sourceUrl: 'https://example-cloud.com', checkinStatus: 'checked_in', checkinTime: '2026-05-25T09:08:00Z' },
]

const MOCK_ZONES: FairZone[] = [
  { id: 'z1', fairId: 'f2', zoneName: 'A区 产品研发', description: '互联网产品/前后端/移动端', boothCount: 34, checkedInCount: 34 },
  { id: 'z2', fairId: 'f2', zoneName: 'B区 数据/AI',  description: '大数据/人工智能/算法',    boothCount: 20, checkedInCount: 19 },
  { id: 'z3', fairId: 'f2', zoneName: 'C区 运营市场', description: '产品运营/市场/内容创作',  boothCount: 14, checkedInCount: 13 },
]

const MOCK_BOOTHS: FairBooth[] = [
  { id: 'b1', fairId: 'f2', zoneId: 'z1', zoneName: 'A区 产品研发', boothNumber: 'A-01', status: 'occupied',  companyId: 'c1', companyName: '某互联网平台公司', areaSqm: 18 },
  { id: 'b2', fairId: 'f2', zoneId: 'z1', zoneName: 'A区 产品研发', boothNumber: 'A-02', status: 'occupied',  companyId: undefined, companyName: '移动应用开发公司', areaSqm: 9 },
  { id: 'b3', fairId: 'f2', zoneId: 'z1', zoneName: 'A区 产品研发', boothNumber: 'A-08', status: 'occupied',  companyId: 'c4', companyName: '云计算服务商', areaSqm: 12 },
  { id: 'b4', fairId: 'f2', zoneId: 'z2', zoneName: 'B区 数据/AI',  boothNumber: 'B-03', status: 'occupied',  companyId: 'c2', companyName: 'AI算法公司', areaSqm: 12 },
  { id: 'b5', fairId: 'f2', zoneId: 'z2', zoneName: 'B区 数据/AI',  boothNumber: 'B-06', status: 'available', companyId: undefined, companyName: undefined, areaSqm: 9 },
  { id: 'b6', fairId: 'f2', zoneId: 'z3', zoneName: 'C区 运营市场', boothNumber: 'C-05', status: 'occupied',  companyId: 'c3', companyName: '电商运营公司', areaSqm: 9 },
  { id: 'b7', fairId: 'f2', zoneId: 'z3', zoneName: 'C区 运营市场', boothNumber: 'C-09', status: 'reserved',  companyId: undefined, companyName: undefined, areaSqm: 9 },
]

const MOCK_MATERIALS: FairMaterial[] = [
  { id: 'm1', fairId: 'f2', name: '专场招聘日程',   type: 'schedule',     description: '现场签到流程及各时段安排', pageCount: 1, fileSizeKB: 120, printCount: 143, fileUrl: '/materials/f2-schedule.pdf',  allowPrint: true,  publishStatus: 'published' },
  { id: 'm2', fairId: 'f2', name: '展区分布图',     type: 'venue_map',    description: 'B厅三个展区分布及导览路线', pageCount: 1, fileSizeKB: 280, printCount: 98,  fileUrl: '/materials/f2-map.pdf',       allowPrint: true,  publishStatus: 'published' },
  { id: 'm3', fairId: 'f2', name: '参会企业与岗位', type: 'position_list', description: '互联网专场全部岗位清单',   pageCount: 4, fileSizeKB: 350, printCount: 67,  fileUrl: '/materials/f2-positions.pdf', allowPrint: true,  publishStatus: 'published' },
  { id: 'm4', fairId: 'f2', name: '活动宣传折页',   type: 'brochure',     description: '活动主办方宣传资料',       pageCount: 2, fileSizeKB: 480, printCount: 0,   fileUrl: '/materials/f2-brochure.pdf',  allowPrint: true,  publishStatus: 'draft'     },
]

const MOCK_STATS: FairLiveStats = {
  fairId: 'f2', totalCompanies: 68, checkedInCompanies: 66, totalPositions: 210, totalHeadcount: 750,
  browseCount: 892, scanCount: 267, printCount: 308, checkinCount: 0, lastUpdated: '2026-05-25T11:45:00Z',
}

// ─── Display helpers ──────────────────────────────────────────────────────────

const FAIR_STATUS_STYLES = {
  upcoming: 'bg-blue-50 text-blue-600',
  ongoing:  'bg-green-50 text-green-600',
  ended:    'bg-gray-100 text-gray-400',
}
const FAIR_STATUS_LABELS = { upcoming: '未开始', ongoing: '进行中', ended: '已结束' }

const CHECKIN_STYLES: Record<CompanyCheckinStatus, 'success' | 'warning' | 'default'> = {
  checked_in: 'success',
  pending:    'warning',
  absent:     'default',
}

const BOOTH_STYLES: Record<FairBoothStatus, string> = {
  available: 'bg-gray-50 border-gray-200 text-gray-400',
  occupied:  'bg-blue-50 border-blue-200 text-blue-700',
  reserved:  'bg-orange-50 border-orange-200 text-orange-600',
}

const MATERIAL_STATUS_STYLES: Record<string, 'success' | 'warning' | 'default'> = {
  published:   'success',
  draft:       'warning',
  unpublished: 'default',
}
const MATERIAL_STATUS_LABELS = { published: '已发布', draft: '待发布', unpublished: '已下架' }

const MATERIAL_TYPE_ICONS: Record<FairMaterialType, React.ElementType> = {
  schedule:     CalendarIcon,
  venue_map:    MapPinIcon,
  company_list: BuildingIcon,
  position_list:BriefcaseIcon,
  brochure:     FileTextIcon,
  other:        FileTextIcon,
}

// ─── Tab panels ───────────────────────────────────────────────────────────────

function CompaniesTab({ fairId }: { fairId: string }) {
  const companies = MOCK_COMPANIES.filter((c) => c.fairId === fairId)
  const [checkinFilter, setCheckinFilter] = useState<CompanyCheckinStatus | 'all'>('all')

  const filtered = checkinFilter === 'all' ? companies : companies.filter((c) => c.checkinStatus === checkinFilter)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-2">
          {(['all', 'checked_in', 'pending', 'absent'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setCheckinFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${checkinFilter === s ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {s === 'all' ? `全部 ${companies.length}` : `${COMPANY_CHECKIN_LABELS[s]} ${companies.filter((c) => c.checkinStatus === s).length}`}
            </button>
          ))}
        </div>
        <button className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
          <UploadIcon className="h-3.5 w-3.5" />
          Excel 导入企业
        </button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['企业名称', '行业', '规模', '展位', '岗位/人次', '签到状态', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-xs text-gray-400">暂无数据</td></tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{c.companyName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{c.industry}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{COMPANY_SCALE_LABELS[c.scale].split('（')[0]}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {c.boothNumber && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">{c.boothNumber}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">
                      {c.positions.length} 岗 · {c.positions.reduce((s, p) => s + p.headcount, 0)} 人
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={CHECKIN_STYLES[c.checkinStatus]} label={COMPANY_CHECKIN_LABELS[c.checkinStatus]} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex gap-2">
                        <button className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">查看岗位</button>
                        <button className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100">
                          <QrCodeIcon className="h-3.5 w-3.5" />
                        </button>
                        {c.checkinStatus === 'pending' && (
                          <button className="rounded px-2 py-1 text-xs font-medium text-green-600 hover:bg-green-50">
                            <CheckCircleIcon className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-gray-400">
        合规说明：系统不接收求职者简历，不参与招聘闭环。企业信息仅用于现场服务展示。
      </p>
    </div>
  )
}

function BoothsTab({ fairId }: { fairId: string }) {
  const zones  = MOCK_ZONES.filter((z) => z.fairId === fairId)
  const booths = MOCK_BOOTHS.filter((b) => b.fairId === fairId)
  const [activeZone, setActiveZone] = useState<string | null>(null)

  const boothCounts = {
    total:     booths.length,
    occupied:  booths.filter((b) => b.status === 'occupied').length,
    available: booths.filter((b) => b.status === 'available').length,
    reserved:  booths.filter((b) => b.status === 'reserved').length,
  }

  return (
    <div className="space-y-4">
      {/* 展区概览 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-gray-900">{boothCounts.total}</p>
          <p className="text-xs text-gray-500">总展位数</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-blue-600">{boothCounts.occupied}</p>
          <p className="text-xs text-gray-500">已入驻</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-orange-500">{boothCounts.reserved}</p>
          <p className="text-xs text-gray-500">已预留</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-green-600">{boothCounts.available}</p>
          <p className="text-xs text-gray-500">空闲</p>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        {/* 展区筛选 */}
        <div className="flex gap-2">
          <button onClick={() => setActiveZone(null)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${activeZone === null ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            全部展区
          </button>
          {zones.map((z) => (
            <button key={z.id} onClick={() => setActiveZone(z.id)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${activeZone === z.id ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {z.zoneName}
            </button>
          ))}
        </div>
        <button className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
          <UploadIcon className="h-3.5 w-3.5" />
          Excel 导入展位
        </button>
      </div>

      {/* 展区详情 */}
      {zones.filter((z) => activeZone === null || z.id === activeZone).map((zone) => {
        const zoneBooths = booths.filter((b) => b.zoneId === zone.id)
        const rate = zone.boothCount > 0 ? Math.round((zone.checkedInCount / zone.boothCount) * 100) : 0
        return (
          <Card key={zone.id} className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-800">{zone.zoneName}</p>
                <p className="text-xs text-gray-400">{zone.description}</p>
              </div>
              <div className="text-right text-xs text-gray-500">
                <p className="text-green-600">签到 {zone.checkedInCount}/{zone.boothCount}</p>
                <p>{rate}%</p>
              </div>
            </div>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {zoneBooths.map((booth) => (
                <div
                  key={booth.id}
                  className={`rounded border p-1.5 text-center text-xs ${BOOTH_STYLES[booth.status]}`}
                  title={booth.companyName ?? BOOTH_STATUS_LABELS[booth.status]}
                >
                  <p className="font-mono font-medium">{booth.boothNumber}</p>
                  {booth.companyName && <p className="mt-0.5 truncate">{booth.companyName.slice(0, 4)}</p>}
                </div>
              ))}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function MaterialsTab({ fairId }: { fairId: string }) {
  const [materials, setMaterials] = useState(MOCK_MATERIALS.filter((m) => m.fairId === fairId))

  const togglePublish = (id: string) => {
    setMaterials((prev) => prev.map((m) =>
      m.id === id
        ? { ...m, publishStatus: m.publishStatus === 'published' ? 'unpublished' : 'published' }
        : m
    ))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">{materials.length} 份资料</p>
        <button className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
          <UploadIcon className="h-3.5 w-3.5" />
          上传资料
        </button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['资料名称', '类型', '页数', '文件大小', '打印次数', '状态', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {materials.map((m) => {
                const Icon = MATERIAL_TYPE_ICONS[m.type]
                return (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-gray-400" />
                        <span className="font-medium text-gray-800">{m.name}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{FAIR_MATERIAL_TYPE_LABELS[m.type]}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{m.pageCount} 页</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{m.fileSizeKB >= 1024 ? `${(m.fileSizeKB/1024).toFixed(1)} MB` : `${m.fileSizeKB} KB`}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="flex items-center gap-1 text-xs text-gray-600">
                        <PrinterIcon className="h-3.5 w-3.5 text-gray-400" />
                        {m.printCount}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={MATERIAL_STATUS_STYLES[m.publishStatus]} label={MATERIAL_STATUS_LABELS[m.publishStatus as keyof typeof MATERIAL_STATUS_LABELS]} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex gap-2">
                        <button className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">预览</button>
                        <button
                          className={`rounded px-2 py-1 text-xs font-medium ${m.publishStatus === 'published' ? 'text-orange-500 hover:bg-orange-50' : 'text-green-600 hover:bg-green-50'}`}
                          onClick={() => togglePublish(m.id)}
                        >
                          {m.publishStatus === 'published' ? '下架' : '发布'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function StatsTab({ stats }: { stats: FairLiveStats }) {
  const checkinRate = stats.totalCompanies > 0
    ? Math.round((stats.checkedInCompanies / stats.totalCompanies) * 100)
    : 0

  const zones = MOCK_ZONES

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: '参展企业', value: stats.totalCompanies,    note: `签到 ${stats.checkedInCompanies}`,   icon: BuildingIcon,  accent: 'text-blue-600 bg-blue-50' },
          { label: '招聘岗位', value: stats.totalPositions,    note: `合计 ${stats.totalHeadcount} 人次`,  icon: BriefcaseIcon, accent: 'text-green-600 bg-green-50' },
          { label: '信息浏览', value: stats.browseCount,       note: '终端页面浏览次数',                   icon: UsersIcon,     accent: 'text-purple-600 bg-purple-50' },
          { label: '资料打印', value: stats.printCount,        note: '活动资料打印次数',                   icon: PrinterIcon,   accent: 'text-orange-500 bg-orange-50' },
        ].map(({ label, value, note, icon: Icon, accent }) => (
          <Card key={label} className="p-4">
            <div className={`w-fit rounded-lg p-2 ${accent}`}>
              <Icon className="h-4 w-4" />
            </div>
            <p className="mt-3 text-xl font-bold text-gray-900">{value}</p>
            <p className="mt-0.5 text-xs font-medium text-gray-500">{label}</p>
            <p className="mt-0.5 text-xs text-gray-400">{note}</p>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">企业签到进度</p>
          <span className="text-sm font-semibold text-green-600">{checkinRate}%</span>
        </div>
        <div className="h-3 rounded-full bg-gray-100">
          <div className="h-3 rounded-full bg-green-400" style={{ width: `${checkinRate}%` }} />
        </div>
        <p className="mt-2 text-xs text-gray-400">{stats.checkedInCompanies} / {stats.totalCompanies} 家企业已签到</p>
        <div className="mt-4 space-y-2">
          {zones.map((zone) => {
            const rate = zone.boothCount > 0 ? Math.round((zone.checkedInCount / zone.boothCount) * 100) : 0
            return (
              <div key={zone.id}>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{zone.zoneName}</span>
                  <span>{zone.checkedInCount}/{zone.boothCount} · {rate}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                  <div className="h-1.5 rounded-full bg-primary-400" style={{ width: `${rate}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="text-center">
            <QrCodeIcon className="mx-auto h-5 w-5 text-gray-400" />
            <p className="mt-1.5 text-xl font-bold text-gray-900">{stats.scanCount}</p>
            <p className="text-xs text-gray-500">二维码展示</p>
          </div>
          <div className="text-center">
            <ActivityIcon className="mx-auto h-5 w-5 text-gray-400" />
            <p className="mt-1.5 text-xl font-bold text-gray-900">{stats.checkinCount}</p>
            <p className="text-xs text-gray-500">现场签到</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          系统仅记录服务数据（浏览、扫码、打印、签到），不记录求职者个人信息，不参与招聘闭环。
        </p>
      </Card>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type TabKey = 'companies' | 'booths' | 'materials' | 'stats'

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'companies', label: '参会企业', icon: BuildingIcon },
  { key: 'booths',    label: '展位管理', icon: MapPinIcon },
  { key: 'materials', label: '活动资料', icon: FileTextIcon },
  { key: 'stats',     label: '数据统计', icon: ActivityIcon },
]

export default function FairsPage() {
  const [selectedFairId, setSelectedFairId] = useState(MOCK_FAIRS[1].id)
  const [activeTab, setActiveTab]           = useState<TabKey>('companies')

  const selectedFair = MOCK_FAIRS.find((f) => f.id === selectedFairId) ?? MOCK_FAIRS[0]

  return (
    <Page title="招聘会管理" subtitle="现场服务数字化 — 企业 · 展位 · 资料 · 统计">
      {/* 招聘会选择器 */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {MOCK_FAIRS.map((fair) => (
          <button
            key={fair.id}
            onClick={() => setSelectedFairId(fair.id)}
            className={`rounded-xl border p-4 text-left transition-all ${
              selectedFairId === fair.id
                ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="flex-1 text-sm font-semibold text-gray-900 leading-snug">{fair.name}</p>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${FAIR_STATUS_STYLES[fair.status]}`}>
                {FAIR_STATUS_LABELS[fair.status]}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-gray-400">{fair.venue}</p>
            <p className="mt-0.5 text-xs text-gray-400">{fair.startTime}</p>
          </button>
        ))}
      </div>

      {/* 当前招聘会标题 */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-base font-semibold text-gray-900">{selectedFair.name}</p>
          <p className="text-xs text-gray-400">{selectedFair.organizer} · {selectedFair.totalBooths} 个展位 · {selectedFair.externalId}</p>
        </div>
        <button className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
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

      {/* 面板内容 */}
      {activeTab === 'companies' && <CompaniesTab fairId={selectedFairId} />}
      {activeTab === 'booths'    && <BoothsTab fairId={selectedFairId} />}
      {activeTab === 'materials' && <MaterialsTab fairId={selectedFairId} />}
      {activeTab === 'stats'     && <StatsTab stats={MOCK_STATS} />}

      <p className="mt-6 text-xs text-gray-400">
        当前为 mock 数据。招聘会数字化模块：仅提供信息展示和现场服务，不接收简历，不参与招聘闭环。
      </p>
    </Page>
  )
}
