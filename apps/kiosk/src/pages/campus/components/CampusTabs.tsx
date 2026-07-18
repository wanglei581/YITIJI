import React, { useMemo, useState } from 'react'
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
const AVATAR_COLORS = ['bg-primary-500', 'bg-plum', 'bg-warning', 'bg-error', 'bg-success', 'bg-info', 'bg-plum', 'bg-neutral-700']
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
    <div className="flex flex-col gap-[18px] px-12 py-[22px]">
      {/* 数据 band — 4格 wheat-soft */}
      <div className="kproto-grid-4">
        {[
          { v: String(companyCount), l: '参展企业' },
          { v: `${jobCount}+`, l: '招聘岗位' },
          { v: THEME_STAT_LABELS[fair.theme ?? ''] ?? '综合', l: '活动类型' },
          { v: industryCount > 0 ? `${industryCount}+` : '—', l: '行业覆盖' },
        ].map(({ v, l }) => (
          <div key={l} className="rounded-[14px] border border-[rgba(169,120,31,.3)] bg-[var(--kp-wheat-soft)] p-[18px] text-center">
            <b className="block font-serif text-[34px] font-black text-[var(--kp-wheat-deep)] tabular-nums">{v}</b>
            <span className="mt-1 block text-[17px] text-[var(--kp-muted)]">{l}</span>
          </div>
        ))}
      </div>

      {/* 活动信息 */}
      <section className="kproto-card accented" style={{ '--kp-accent': 'var(--kp-wheat)', '--kp-accent-deep': 'var(--kp-wheat-deep)', '--kp-accent-soft': 'var(--kp-wheat-soft)' } as React.CSSProperties}>
        <div className="kproto-card-head" style={{ marginBottom: 14 }}>
          <span className="kproto-icon"><CalendarIcon aria-hidden="true" /></span>
          <div>
            <h2>活动信息</h2>
            <div className="mt-1 text-[19px] text-[var(--kp-muted)]">信息由主办方提供，以来源平台为准</div>
          </div>
          {fair.status !== 'ended' && (
            <button
              type="button"
              onClick={onBook}
              className="kproto-btn sm primary ml-auto"
              style={{ '--kp-accent': 'var(--kp-wheat)', '--kp-accent-deep': 'var(--kp-wheat-deep)', '--kp-accent-soft': 'var(--kp-wheat-soft)' } as React.CSSProperties}
            >
              <QrCodeIcon aria-hidden="true" />扫码预约 · 去来源平台办理
            </button>
          )}
        </div>
        <div className="flex flex-col gap-3 text-[20px]">
          <div className="flex gap-4"><span className="w-[112px] shrink-0 text-[var(--kp-muted)]">举办时间</span><span className="flex-1 font-semibold">{fmtHeldTime(fair.startTime, fair.endTime)}</span></div>
          <div className="flex gap-4"><span className="w-[112px] shrink-0 text-[var(--kp-muted)]">举办地点</span><span className="flex-1 font-semibold">{fair.address || fair.venue}</span></div>
          {fair.onsiteServices && fair.onsiteServices.length > 0 && (
            <div className="flex gap-4"><span className="w-[112px] shrink-0 text-[var(--kp-muted)]">现场服务</span><span className="flex-1 font-semibold">{fair.onsiteServices.join(' · ')}</span></div>
          )}
          {fair.admissionMethod && (
            <div className="flex gap-4"><span className="w-[112px] shrink-0 text-[var(--kp-muted)]">入场方式</span><span className="flex-1 font-semibold">{fair.admissionMethod}</span></div>
          )}
        </div>
      </section>

      {/* 现场服务快捷入口 */}
      <section className="kproto-card" style={{ '--kp-accent': 'var(--kp-wheat)', '--kp-accent-deep': 'var(--kp-wheat-deep)', '--kp-accent-soft': 'var(--kp-wheat-soft)' } as React.CSSProperties}>
        <div className="kproto-card-head" style={{ marginBottom: 14 }}>
          <span className="kproto-icon"><LayersIcon aria-hidden="true" /></span>
          <div><h2>现场服务快捷入口</h2></div>
        </div>
        <div className="kproto-grid-4">
          {[
            { icon: BuildingIcon, title: '参展企业查询', sub: `${companyCount} 家企业`, tab: 'companies' as TabKey },
            { icon: NavigationIcon, title: '招聘会导览图', sub: '展位地图 / 日程', tab: 'map' as TabKey },
            { icon: BriefcaseIcon, title: 'AI智能求职', sub: '简历 / 面试 / 准备单', tab: 'ai' as TabKey },
            { icon: PrinterIcon, title: '自助打印服务', sub: '简历 / 活动资料', tab: 'print' as TabKey },
          ].map(({ icon: _icon, title, sub, tab }) => (
            <button
              key={tab}
              type="button"
              onClick={() => onGoTab(tab)}
              className="kproto-tile flex flex-col items-start justify-center gap-2"
              style={{ background: 'var(--kp-wheat-soft)', borderColor: 'rgba(169,120,31,.3)', minHeight: 112 }}
            >
              <b className="text-[23px] font-semibold">{title}</b>
              <span className="text-[17px] text-[var(--kp-muted)]">{sub}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 热门企业 */}
      {hotCompanies.length > 0 && (
        <section className="kproto-card" style={{ '--kp-accent': 'var(--kp-wheat)', '--kp-accent-deep': 'var(--kp-wheat-deep)', '--kp-accent-soft': 'var(--kp-wheat-soft)' } as React.CSSProperties}>
          <div className="kproto-card-head" style={{ marginBottom: 14 }}>
            <span className="kproto-icon"><BuildingIcon aria-hidden="true" /></span>
            <div><h2>热门企业</h2><div className="mt-1 text-[19px] text-[var(--kp-muted)]">按在招岗位数排序</div></div>
            <button type="button" onClick={() => onGoTab('companies')} className="kproto-badge ml-auto">
              查看全部 {companyCount} 家
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {hotCompanies.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`/job-fairs/${fair.id}/companies/${c.id}`)}
                className="flex min-h-[92px] items-center gap-4 rounded-[14px] border border-[var(--kp-line)] bg-[var(--kp-paper)] px-5 py-3.5 text-left"
              >
                <span className="grid h-[58px] w-[58px] shrink-0 place-items-center rounded-[12px] bg-[var(--kp-wheat-soft)] font-serif text-[26px] font-bold text-[var(--kp-wheat-deep)]">
                  {c.companyName.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <b className="block text-[22px] font-bold">{c.companyName}</b>
                  <span className="mt-1 block truncate text-[17px] text-[var(--kp-muted)]">
                    {c.positions.slice(0, 3).map((p) => p.title).join(' · ') || industryLabel(c.industry)}
                  </span>
                </div>
                <span className="shrink-0 text-[18px] font-bold text-[var(--kp-wheat-deep)] tabular-nums">{c.positions.length} 个岗位</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 数据来源 + 合规提示（合规必展示） */}
      <div className="flex flex-wrap gap-3">
        <span className="kproto-chip source">来源机构 <b>{fair.sourceName}</b></span>
        <span className="kproto-chip">同步时间 <b>{fmtSync(fair.syncTime)}</b></span>
        <span className="kproto-chip">外部编号 <b>{fair.externalId}</b></span>
      </div>
      <div className="kproto-notice">
        <MicIcon aria-hidden="true" />
        <p>{fair.dataSourceNote ?? '本专区为第三方 / 官方校招信息入口，预约与投递一律前往来源平台办理，本系统不接收简历。'}</p>
      </div>
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
        <p className="mb-3 flex items-center gap-1.5 text-base font-semibold text-neutral-800">
          <BuildingIcon className="h-5 w-5 text-primary-500" />
          参展企业汇编
          <span className="ml-auto text-xs font-normal text-neutral-400">{companies.length} 家</span>
        </p>
        <div className="space-y-3">
          {companies.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/job-fairs/${fairId}/companies/${c.id}`)}
              className="flex w-full items-start gap-3 rounded-xl border border-neutral-100 bg-white p-3 text-left transition-colors hover:border-primary-200 hover:bg-primary-50/30"
            >
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-base font-bold text-white ${avatarColor(c.companyName)}`}>
                {c.companyName.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-neutral-900">{c.companyName}</p>
                <span className="mt-1 inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">{industryLabel(c.industry)}</span>
                {c.description && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-neutral-400">{c.description}</p>}
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* 招聘岗位 */}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-base font-semibold text-neutral-800">
            <BriefcaseIcon className="h-5 w-5 text-success" />
            招聘岗位
            <span className="ml-1 text-xs font-normal text-neutral-400">{visiblePositions.length} 个</span>
          </p>
          {/* 全部分类 下拉 */}
          <div className="relative">
            <button
              onClick={() => setCatOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              <FilterIcon className="h-3.5 w-3.5 text-neutral-400" />
              {category}
              <ChevronDownIcon className="h-4 w-4 text-neutral-400" />
            </button>
            {catOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setCatOpen(false)} />
                <div className="absolute right-0 z-40 mt-1 w-32 overflow-hidden rounded-lg border border-neutral-100 bg-white py-1 shadow-lg">
                  {categories.map((c) => (
                    <button
                      key={c}
                      onClick={() => { setCategory(c); setCatOpen(false) }}
                      className={[
                        'block w-full px-3 py-2 text-left text-sm',
                        category === c ? 'bg-primary-50 font-medium text-primary-700' : 'text-neutral-600 hover:bg-neutral-50',
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
            <div key={`${p.companyId}-${p.id}`} className="rounded-xl border border-neutral-100 bg-white p-4 transition-shadow hover:shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-neutral-900">{p.title}</p>
                {p.salary && <span className="shrink-0 text-sm font-bold text-error-fg">{p.salary}</span>}
              </div>
              <p className="mt-1.5 flex items-center gap-1 text-xs text-neutral-500">
                <BuildingIcon className="h-3.5 w-3.5 text-neutral-400" />
                {p.companyName}
              </p>
              <div className="mt-3 flex items-center justify-between">
                <span className="rounded bg-success-bg px-2 py-0.5 text-xs font-medium text-success-fg">{p.category}</span>
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
          <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-700">
            <MapPinIcon className="h-4 w-4 text-warning-fg" />{fair.address || fair.venue}
          </p>
          {fair.trafficInfo && <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">{fair.trafficInfo}</p>}
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
          <p className="mb-3 flex items-center gap-1.5 text-base font-semibold text-neutral-900">
            <LayersIcon className="h-4 w-4 text-primary-500" />展位平面图
          </p>
          <div className="space-y-2.5">
            {boothZones.map((z) => (
              <div key={z.id} className={`rounded-xl p-4 ${z.color ?? 'bg-neutral-50'}`}>
                <p className="text-sm font-semibold text-neutral-900">{z.zoneName}</p>
                {z.description && <p className="mt-1 text-xs leading-relaxed text-neutral-500">{z.description}</p>}
                <p className="mt-2 text-xs text-neutral-400">展位 {z.boothCount} 个</p>
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
      <p className="mt-3 text-base font-semibold text-neutral-900">{title}</p>
      <p className="mt-1 flex-1 text-sm leading-relaxed text-neutral-500">{desc}</p>
      <Button size="md" className="mt-4 w-full" onClick={onClick}>{cta}</Button>
    </Card>
  )
}

export function AiJobTab() {
  const navigate = useNavigate()
  return (
    <div className="space-y-4 px-5 py-4">
      <div className="rounded-2xl bg-gradient-to-br from-plum to-plum p-5 text-white">
        <p className="text-lg font-bold">AI智能求职助手</p>
        <p className="mt-1 text-sm text-white/80">四大 AI 功能，全方位助力你的求职之路</p>
      </div>
      <div className="grid grid-cols-1 gap-3">
        <AiFeatureCard icon={FileTextIcon} iconBg="bg-primary-50" iconColor="text-primary-600" title="AI简历诊断" desc="简历分析与诊断，提供专业修改建议（仅供本人参考）。" cta="开始诊断" onClick={() => navigate('/resume/source?intent=diagnose')} />
        <AiFeatureCard icon={MicIcon} iconBg="bg-plum-soft" iconColor="text-plum" title="AI模拟面试" desc="仿真面试场景与点评，迅速提升面试实战能力。" cta="开始模拟" onClick={() => navigate('/assistant')} />
        <AiFeatureCard icon={PenToolIcon} iconBg="bg-success-bg" iconColor="text-success-fg" title="AI简历优化" desc="基于你的简历原文优化表达，生成可编辑的优化版简历（不补充虚构信息）。" cta="开始优化" onClick={() => navigate('/resume/source?intent=optimize')} />
        <AiFeatureCard icon={AwardIcon} iconBg="bg-warning-bg" iconColor="text-warning-fg" title="岗位信息参考" desc="浏览第三方来源岗位信息，投递请前往来源平台办理。" cta="查看岗位" onClick={() => navigate('/jobs')} />
      </div>
    </div>
  )
}

// ─── Tab⑤ 打印服务（基础版）────────────────────────────────────────────────────

export function PrintTab({ onPrintMaterial }: { onPrintMaterial: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="space-y-4 px-5 py-4">
      <div className="rounded-2xl bg-gradient-to-br from-success-fg to-success p-5 text-white">
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
      className={`flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-neutral-50 ${last ? '' : 'border-b border-neutral-100'}`}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50">
        <Icon className="h-5 w-5 text-primary-600" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-neutral-900">{title}</p>
        <p className="mt-0.5 truncate text-xs text-neutral-400">{subtitle}</p>
      </div>
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-neutral-300" />
    </button>
  )
}
