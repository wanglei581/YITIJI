import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState } from '@ai-job-print/ui'
import type { ExternalJobFairDTO, FairCompanyDTO, FairZoneDTO } from '@ai-job-print/shared'
import {
  AwardIcon,
  BriefcaseIcon,
  BuildingIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FilterIcon,
  LayersIcon,
  MapIcon,
  MapPinIcon,
  MicIcon,
  NavigationIcon,
  PenToolIcon,
  PrinterIcon,
  QrCodeIcon,
  SparklesIcon,
  TicketIcon,
} from 'lucide-react'
import { MapBlock } from '../../job-fairs/components/MapBlock'

type TabKey = 'overview' | 'companies' | 'map' | 'ai' | 'print'

// 活动类型展示映射(真实 theme 字段;替代已移除的推荐分指标)
const THEME_STAT_LABELS: Record<string, string> = {
  campus: '校园双选',
  campus_corp: '校企合作',
  industry: '行业专场',
  general: '综合',
}

// 参展企业头像配色（按企业名 hash）
const AVATAR_COLORS = ['bg-blue-500', 'bg-violet-500', 'bg-orange-500', 'bg-rose-500', 'bg-emerald-500', 'bg-cyan-600', 'bg-indigo-500', 'bg-slate-700']
function avatarColor(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

// 行业键 → 中文标签（http 端为键，mock 端本就是中文）
const INDUSTRY_LABEL: Record<string, string> = {
  internet: '互联网', ai: '人工智能', finance: '金融', manufacturing: '智能制造',
  consumer: '消费电子', service: '生活服务', education: '教育', medical: '医疗健康',
}
function industryLabel(s: string) {
  return INDUSTRY_LABEL[s] ?? s
}

// 由岗位标题派生分类（参考图的研发类/产品类/设计类… 标签 + 筛选）
const CAT_RULES: [RegExp, string][] = [
  [/(测试|QA)/, '测试类'],
  [/(硬件|电路)/, '硬件类'],
  [/(产品经理|产品)/, '产品类'],
  [/(设计|UI|视觉|动画|三维)/, '设计类'],
  [/(运营|市场|销售|商务|推广|客户经理|柜)/, '运营类'],
  [/(算法|开发|工程师|研发|架构|技术|数据|师)/, '研发类'],
]
function categoryOf(title: string) {
  for (const [re, c] of CAT_RULES) if (re.test(title)) return c
  return '职能类'
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fmtSync(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
/** 活动信息「举办时间」：同日显示「日期 起–止」，跨日显示「起日期 – 止日期」。 */
function fmtHeldTime(start: string, end: string) {
  const a = new Date(start)
  const b = new Date(end)
  const sameDay = a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  return sameDay
    ? `${fmtDate(start)} ${fmtTime(start)}–${fmtTime(end)}`
    : `${fmtDate(start)} – ${fmtDate(end)}`
}

// ─── Tab① 企业速览 ──────────────────────────────────────────────────────────────

function StatCell({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <div className="text-center">
      <p className={`text-2xl font-bold tabular-nums ${accent ?? 'text-white'}`}>{value}</p>
      <p className="mt-0.5 text-xs text-white/80">{label}</p>
    </div>
  )
}

function QuickEntry({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  subtitle,
  onClick,
}: {
  icon: typeof BuildingIcon
  iconBg: string
  iconColor: string
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-white p-4 text-center transition-shadow hover:shadow-md active:scale-[0.99]"
    >
      <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconBg}`}>
        <Icon className={`h-6 w-6 ${iconColor}`} />
      </span>
      <span className="text-sm font-semibold text-gray-900">{title}</span>
      <span className="text-xs text-gray-400">{subtitle}</span>
    </button>
  )
}

export function OverviewTab({
  fair,
  companies,
  companyCount,
  jobCount,
  onGoTab,
  onBook,
}: {
  fair: ExternalJobFairDTO
  companies: FairCompanyDTO[]
  companyCount: number
  jobCount: number
  onGoTab: (t: TabKey) => void
  onBook: () => void
}) {
  const navigate = useNavigate()

  const industryCount = fair.industryDistribution?.length ?? new Set(companies.map((c) => c.industry)).size

  const hotCompanies = useMemo(
    () => [...companies].sort((a, b) => b.positions.length - a.positions.length).slice(0, 5),
    [companies],
  )

  return (
    <div className="space-y-4 px-5 py-4">
      {/* 实时数据 band */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-blue-500 p-5 text-white shadow-sm">
        <p className="flex items-center gap-1.5 text-sm font-medium text-white/90">
          <SparklesIcon className="h-4 w-4" />实时数据
        </p>
        <div className="mt-4 grid grid-cols-2 gap-y-5">
          <StatCell value={String(companyCount)} label="参展企业" />
          <StatCell value={`${jobCount}+`} label="招聘岗位" />
          <StatCell value={THEME_STAT_LABELS[fair.theme ?? ''] ?? '综合'} label="活动类型" accent="text-emerald-300" />
          <StatCell value={industryCount > 0 ? `${industryCount}+` : '—'} label="行业覆盖" accent="text-amber-300" />
        </div>
      </div>

      {/* 活动信息 */}
      <Card className="p-5">
        <p className="flex items-center gap-1.5 text-base font-semibold text-gray-900">
          <CalendarIcon className="h-4 w-4 text-primary-500" />活动信息
        </p>
        <div className="mt-3 space-y-3 text-sm">
          <InfoRow icon={ClockIcon} label="举办时间" value={fmtHeldTime(fair.startTime, fair.endTime)} />
          <InfoRow icon={MapPinIcon} label="举办地点" value={fair.address || fair.venue} />
          {fair.onsiteServices && fair.onsiteServices.length > 0 && (
            <InfoRow icon={SparklesIcon} label="现场服务" value={fair.onsiteServices.join(' · ')} />
          )}
          {fair.admissionMethod && (
            <InfoRow icon={TicketIcon} label="入场方式" value={fair.admissionMethod} />
          )}
        </div>
        {fair.status !== 'ended' && (
          <Button size="md" variant="outline" className="mt-4 flex w-full items-center justify-center gap-2" onClick={onBook}>
            <QrCodeIcon className="h-4 w-4" />扫码预约 · 去来源平台办理
          </Button>
        )}
      </Card>

      {/* 现场服务快捷入口 */}
      <div>
        <p className="mb-3 text-base font-semibold text-gray-900">现场服务快捷入口</p>
        <div className="grid grid-cols-2 gap-3">
          <QuickEntry icon={BuildingIcon} iconBg="bg-blue-50" iconColor="text-blue-600" title="参展企业查询" subtitle={`${companyCount} 家企业`} onClick={() => onGoTab('companies')} />
          <QuickEntry icon={NavigationIcon} iconBg="bg-orange-50" iconColor="text-orange-500" title="招聘会导览图" subtitle="展位地图 / 日程" onClick={() => onGoTab('map')} />
          <QuickEntry icon={BriefcaseIcon} iconBg="bg-violet-50" iconColor="text-violet-600" title="AI智能求职" subtitle="简历 / 面试 / 求职准备" onClick={() => onGoTab('ai')} />
          <QuickEntry icon={PrinterIcon} iconBg="bg-emerald-50" iconColor="text-emerald-600" title="自助打印服务" subtitle="简历 / 通知单" onClick={() => onGoTab('print')} />
        </div>
      </div>

      {/* 热门企业 */}
      {hotCompanies.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-base font-semibold text-gray-900">热门企业</p>
            <button onClick={() => onGoTab('companies')} className="flex items-center gap-0.5 text-sm font-medium text-primary-600">
              查看全部 <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2.5">
            {hotCompanies.map((c) => (
              <button
                key={c.id}
                onClick={() => navigate(`/job-fairs/${fair.id}/companies/${c.id}`)}
                className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3.5 text-left transition-colors hover:border-primary-200 hover:bg-primary-50/30"
              >
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white ${avatarColor(c.companyName)}`}>
                  {c.companyName.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">{c.companyName}</p>
                  <p className="mt-0.5 truncate text-xs text-gray-400">
                    {c.positions.slice(0, 3).map((p) => p.title).join(' · ') || industryLabel(c.industry)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="mt-0.5 text-xs text-gray-400">{c.positions.length} 个岗位</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 数据来源（合规必展示） */}
      <Card className="p-5">
        <p className="mb-3 text-sm font-medium text-gray-700">数据来源</p>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex justify-between">
            <span className="text-gray-400">来源机构</span>
            <span>{fair.sourceName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">同步时间</span>
            <span>{fmtSync(fair.syncTime)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">外部编号</span>
            <span className="font-mono text-xs">{fair.externalId}</span>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-400">{fair.dataSourceNote}</p>
      </Card>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof ClockIcon; label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex w-16 shrink-0 items-center gap-1.5 text-gray-400">
        <Icon className="h-4 w-4" />{label}
      </span>
      <span className="flex-1 text-gray-700">{value}</span>
    </div>
  )
}

// ─── Tab② 参展企业 ──────────────────────────────────────────────────────────────

export function CompaniesTab({ fairId, companies }: { fairId: string; companies: FairCompanyDTO[] }) {
  const navigate = useNavigate()
  const [category, setCategory] = useState('全部分类')
  const [catOpen, setCatOpen] = useState(false)

  const positions = useMemo(
    () =>
      companies.flatMap((c) =>
        c.positions.map((p) => ({
          ...p,
          companyName: c.companyName,
          companyId: c.id,
          category: categoryOf(p.title),
        })),
      ),
    [companies],
  )

  const categories = useMemo(() => {
    const set: string[] = []
    for (const p of positions) if (!set.includes(p.category)) set.push(p.category)
    return ['全部分类', ...set]
  }, [positions])

  const visiblePositions = useMemo(
    () => (category === '全部分类' ? positions : positions.filter((p) => p.category === category)),
    [positions, category],
  )

  if (companies.length === 0) {
    return <EmptyState icon={BuildingIcon} title="暂无参展企业" description="该招聘会暂未录入参展企业明细" className="py-12" />
  }

  return (
    <div className="space-y-4">
      {/* 参展企业汇编 */}
      <Card className="p-5">
        <p className="mb-3 flex items-center gap-1.5 text-base font-semibold text-gray-800">
          <BuildingIcon className="h-5 w-5 text-primary-500" />
          参展企业汇编
          <span className="ml-auto text-xs font-normal text-gray-400">{companies.length} 家</span>
        </p>
        <div className="space-y-3">
          {companies.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/job-fairs/${fairId}/companies/${c.id}`)}
              className="flex w-full items-start gap-3 rounded-xl border border-gray-100 bg-white p-3 text-left transition-colors hover:border-primary-200 hover:bg-primary-50/30"
            >
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-base font-bold text-white ${avatarColor(c.companyName)}`}>
                {c.companyName.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{c.companyName}</p>
                <span className="mt-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{industryLabel(c.industry)}</span>
                {c.description && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-gray-400">{c.description}</p>}
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* 招聘岗位 */}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-base font-semibold text-gray-800">
            <BriefcaseIcon className="h-5 w-5 text-emerald-500" />
            招聘岗位
            <span className="ml-1 text-xs font-normal text-gray-400">{visiblePositions.length} 个</span>
          </p>
          {/* 全部分类 下拉 */}
          <div className="relative">
            <button
              onClick={() => setCatOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              <FilterIcon className="h-3.5 w-3.5 text-gray-400" />
              {category}
              <ChevronDownIcon className="h-4 w-4 text-gray-400" />
            </button>
            {catOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setCatOpen(false)} />
                <div className="absolute right-0 z-40 mt-1 w-32 overflow-hidden rounded-lg border border-gray-100 bg-white py-1 shadow-lg">
                  {categories.map((c) => (
                    <button
                      key={c}
                      onClick={() => { setCategory(c); setCatOpen(false) }}
                      className={[
                        'block w-full px-3 py-2 text-left text-sm',
                        category === c ? 'bg-primary-50 font-medium text-primary-700' : 'text-gray-600 hover:bg-gray-50',
                      ].join(' ')}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {visiblePositions.map((p) => (
            <div key={`${p.companyId}-${p.id}`} className="rounded-xl border border-gray-100 bg-white p-4 transition-shadow hover:shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">{p.title}</p>
                {p.salary && <span className="shrink-0 text-sm font-bold text-rose-500">{p.salary}</span>}
              </div>
              <p className="mt-1.5 flex items-center gap-1 text-xs text-gray-500">
                <BuildingIcon className="h-3.5 w-3.5 text-gray-400" />
                {p.companyName}
              </p>
              <div className="mt-3 flex items-center justify-between">
                <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{p.category}</span>
                <button
                  onClick={() => navigate(`/job-fairs/${fairId}/companies/${p.companyId}`)}
                  className="flex items-center gap-0.5 text-xs font-medium text-primary-600"
                >
                  查看详情
                  <ExternalLinkIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ─── Tab③ 导览图（基础版，后续细化为 A/B/C/D 平面图 + 日程）─────────────────────

export function MapTab({
  fair,
  zones,
  navUrl,
  onNav,
}: {
  fair: ExternalJobFairDTO
  zones: FairZoneDTO[]
  navUrl: string | null
  onNav: () => void
}) {
  const navigate = useNavigate()
  const boothZones = zones.filter((z) => z.category !== 'innovation')

  return (
    <div className="space-y-4 px-5 py-4">
      {/* 场馆地图 */}
      <Card className="overflow-hidden p-0">
        <div className="h-48 w-full">
          <MapBlock lat={fair.latitude} lng={fair.longitude} mapImageUrl={fair.mapImageUrl} venue={fair.venue} />
        </div>
        <div className="p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <MapPinIcon className="h-4 w-4 text-orange-500" />{fair.address || fair.venue}
          </p>
          {fair.trafficInfo && <p className="mt-1.5 text-sm leading-relaxed text-gray-500">{fair.trafficInfo}</p>}
          {navUrl && (
            <Button size="md" variant="outline" className="mt-3 flex w-full items-center justify-center gap-2" onClick={onNav}>
              <NavigationIcon className="h-4 w-4" />扫码在手机上导航
            </Button>
          )}
        </div>
      </Card>

      {/* 展位分区 */}
      {boothZones.length > 0 && (
        <Card className="p-5">
          <p className="mb-3 flex items-center gap-1.5 text-base font-semibold text-gray-900">
            <LayersIcon className="h-4 w-4 text-primary-500" />展位平面图
          </p>
          <div className="space-y-2.5">
            {boothZones.map((z) => (
              <div key={z.id} className={`rounded-xl p-4 ${z.color ?? 'bg-gray-50'}`}>
                <p className="text-sm font-semibold text-gray-900">{z.zoneName}</p>
                {z.description && <p className="mt-1 text-xs leading-relaxed text-gray-500">{z.description}</p>}
                <p className="mt-2 text-xs text-gray-400">展位 {z.boothCount} 个</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Button
        size="lg"
        variant="secondary"
        className="flex w-full items-center justify-center gap-2"
        onClick={() => navigate(`/job-fairs/${fair.id}/map`)}
      >
        <MapIcon className="h-5 w-5" />查看完整导览图
      </Button>
    </div>
  )
}

// ─── Tab④ AI求职（基础版，后续细化为参考图四大卡）─────────────────────────────

function AiFeatureCard({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  desc,
  cta,
  onClick,
}: {
  icon: typeof FileTextIcon
  iconBg: string
  iconColor: string
  title: string
  desc: string
  cta: string
  onClick: () => void
}) {
  return (
    <Card className="flex flex-col p-5">
      <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${iconBg}`}>
        <Icon className={`h-6 w-6 ${iconColor}`} />
      </span>
      <p className="mt-3 text-base font-semibold text-gray-900">{title}</p>
      <p className="mt-1 flex-1 text-sm leading-relaxed text-gray-500">{desc}</p>
      <Button size="md" className="mt-4 w-full" onClick={onClick}>{cta}</Button>
    </Card>
  )
}

export function AiJobTab() {
  const navigate = useNavigate()
  return (
    <div className="space-y-4 px-5 py-4">
      <div className="rounded-2xl bg-gradient-to-br from-violet-600 to-violet-500 p-5 text-white">
        <p className="text-lg font-bold">AI智能求职助手</p>
        <p className="mt-1 text-sm text-white/80">四大 AI 功能，全方位助力你的求职之路</p>
      </div>
      <div className="grid grid-cols-1 gap-3">
        <AiFeatureCard icon={FileTextIcon} iconBg="bg-blue-50" iconColor="text-blue-600" title="AI简历诊断" desc="简历分析与诊断，提供专业修改建议（仅供本人参考）。" cta="开始诊断" onClick={() => navigate('/resume/source?intent=diagnose')} />
        <AiFeatureCard icon={MicIcon} iconBg="bg-violet-50" iconColor="text-violet-600" title="AI模拟面试" desc="仿真面试场景与点评，迅速提升面试实战能力。" cta="开始模拟" onClick={() => navigate('/assistant')} />
        <AiFeatureCard icon={PenToolIcon} iconBg="bg-emerald-50" iconColor="text-emerald-600" title="AI简历优化" desc="基于你的简历原文优化表达，生成可编辑的优化版简历（不补充虚构信息）。" cta="开始优化" onClick={() => navigate('/resume/source?intent=optimize')} />
        <AiFeatureCard icon={AwardIcon} iconBg="bg-amber-50" iconColor="text-amber-600" title="岗位信息参考" desc="浏览第三方来源岗位信息，投递请前往来源平台办理。" cta="查看岗位" onClick={() => navigate('/jobs')} />
      </div>
    </div>
  )
}

// ─── Tab⑤ 打印服务（基础版）────────────────────────────────────────────────────

export function PrintTab({ onPrintMaterial }: { onPrintMaterial: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="space-y-4 px-5 py-4">
      <div className="rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-500 p-5 text-white">
        <p className="text-lg font-bold">自助打印服务</p>
        <p className="mt-1 text-sm text-white/80">简历、通知单、活动资料，现场快速打印。</p>
      </div>
      <Card className="p-2">
        <PrintRow icon={FileTextIcon} title="上传文件打印" subtitle="简历 / 证件 / 通知单 · 支持扫码上传" onClick={() => navigate('/print/upload')} />
        <PrintRow icon={SparklesIcon} title="AI简历服务" subtitle="解析 / 诊断 / 优化 / 打印" onClick={() => navigate('/resume/source')} />
        {/* 合规:活动资料打印只基于机构上传的真实 FairMaterial,跳资料列表逐份打印,不构造示例文件 */}
        <PrintRow icon={LayersIcon} title="活动资料打印" subtitle="招聘会日程 / 企业名册 / 导览图" onClick={onPrintMaterial} last />
      </Card>
    </div>
  )
}

function PrintRow({
  icon: Icon,
  title,
  subtitle,
  onClick,
  last,
}: {
  icon: typeof FileTextIcon
  title: string
  subtitle: string
  onClick: () => void
  last?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-gray-50 ${last ? '' : 'border-b border-gray-100'}`}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50">
        <Icon className="h-5 w-5 text-primary-600" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="mt-0.5 truncate text-xs text-gray-400">{subtitle}</p>
      </div>
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-300" />
    </button>
  )
}
