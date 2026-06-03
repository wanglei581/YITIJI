// ============================================================
// 校园招聘专区（/campus）— 纯前端聚合页（P0）
//
// 合规定位：第三方/官方校招信息入口 + 求职材料服务，不是平台自营校招。
//   - 校招岗位：复用 /jobs 能力，只取 category=campus
//   - 校园招聘会：复用 /job-fairs 能力，前端按关键词轻量过滤（DTO 暂无 theme 字段）
//   - AI 简历 / 打印材料：跳现有服务中心
//
// 红线：不接收/保存/转发简历给企业；无企业端候选人/面试/Offer/推荐；
//       投递/预约一律跳来源平台（按钮文案见 docs/compliance/compliance-boundary.md）。
// 详见 docs/product/campus-recruitment-design.md。
// ============================================================

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Card,
  ComplianceBanner,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '@ai-job-print/ui'
import type { ExternalJobDTO, ExternalJobFairDTO } from '@ai-job-print/shared'
import {
  BriefcaseIcon,
  Building2Icon,
  CalendarIcon,
  ChevronRightIcon,
  GraduationCapIcon,
  MapPinIcon,
  PrinterIcon,
  SparklesIcon,
} from 'lucide-react'
import { getJobFairs, getJobs } from '../../services/api'

const MAX_JOBS = 4
const MAX_FAIRS = 3

const FAIR_STATUS = {
  upcoming: { label: '未开始', text: 'text-blue-600',  bg: 'bg-blue-50' },
  ongoing:  { label: '进行中', text: 'text-green-700', bg: 'bg-green-50' },
  ended:    { label: '已结束', text: 'text-gray-400',  bg: 'bg-gray-100' },
} as const

// DTO 暂无 theme 字段，P0 用关键词在名称/主办方/简介/来源上做轻量过滤识别校招会
const CAMPUS_FAIR_RE = /校园|校招|高校|大学|学院|应届|毕业生|双选|研究生|校企/

function isCampusFair(fair: ExternalJobFairDTO) {
  return CAMPUS_FAIR_RE.test(
    `${fair.name} ${fair.organizer} ${fair.description ?? ''} ${fair.sourceName}`,
  )
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

// ── ① 季节横幅卡（设计区块①）─────────────────────────────────────
// 校招强季节性,给"为什么现在来"。按当前月份给出阶段提示,纯展示、不外发。
// 横向交互式时间线(设计②)与精确届别(audienceType)留待 P1。
function getCampusSeason(now: Date): { phase: string; hint: string } {
  const m = now.getMonth() + 1
  const y = now.getFullYear()
  if (m >= 9 && m <= 11) return { phase: `${y} 秋招进行中`, hint: '网申、宣讲会、双选会高峰，建议备好多份简历' }
  if (m === 12) return { phase: `${y} 秋招收尾 · 补录期`, hint: '关注补录岗位、签约与三方协议办理' }
  if (m === 1) return { phase: `${y - 1} 秋招收尾 · 补录期`, hint: '关注补录岗位、签约与三方协议办理' }
  if (m === 2) return { phase: `${y} 春招启动`, hint: '春招岗位陆续放出，及时更新简历' }
  if (m >= 3 && m <= 4) return { phase: `${y} 春招进行中`, hint: '春招双选会密集，备好简历与三方材料' }
  if (m === 5) return { phase: `${y} 春招收尾`, hint: '把握末班车，关注签约与报到材料' }
  return { phase: `${y} 暑期实习 · 秋招准备季`, hint: '提前打磨简历、备齐求职材料，秋招约 9 月启动' }
}

function SeasonBanner() {
  const { phase, hint } = getCampusSeason(new Date())
  return (
    <Card className="flex items-start gap-4 border-l-4 border-l-cyan-500 p-5">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cyan-50">
        <CalendarIcon className="h-6 w-6 text-cyan-700" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-gray-900">{phase}</h2>
        <p className="mt-1 text-sm text-gray-600">{hint}</p>
        <p className="mt-2 text-xs text-gray-400">校招节点：网申 · 宣讲会 · 双选会 · 签约 · 三方协议 · 报到</p>
      </div>
    </Card>
  )
}

// ── 区块标题 ───────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  subtitle,
  onMore,
}: {
  icon: typeof BriefcaseIcon
  iconBg: string
  iconColor: string
  title: string
  subtitle: string
  onMore?: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className={`h-5 w-5 ${iconColor}`} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-400">{subtitle}</p>
        </div>
      </div>
      {onMore && (
        <button
          type="button"
          onClick={onMore}
          className="flex min-h-[44px] items-center gap-0.5 px-1 text-sm font-medium text-primary-600"
        >
          查看全部
          <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

// ── 校招岗位卡 ─────────────────────────────────────────────────

function CampusJobCard({ job, onView }: { job: ExternalJobDTO; onView: () => void }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-gray-900">{job.title}</h3>
            <span className="shrink-0 rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700">
              校招
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-gray-600">{job.company}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
            <span className="font-semibold text-orange-600">{job.salaryDisplay}</span>
            {job.city && (
              <span className="flex items-center gap-0.5">
                <MapPinIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {job.city}
              </span>
            )}
            <span>来源：{job.sourceName}</span>
          </div>
        </div>
      </div>
      <Button size="sm" variant="secondary" className="mt-3 w-full gap-1" onClick={onView}>
        查看岗位
        <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
      </Button>
    </Card>
  )
}

// ── 校园招聘会卡 ───────────────────────────────────────────────

function CampusFairCard({ fair, onView }: { fair: ExternalJobFairDTO; onView: () => void }) {
  const sc = FAIR_STATUS[fair.status]
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 flex-1 text-base font-semibold text-gray-900">{fair.name}</h3>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${sc.bg} ${sc.text}`}>
          {sc.label}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
          <span>{formatDate(fair.startTime)}–{formatDate(fair.endTime)}</span>
        </div>
        <div className="flex items-start gap-1.5">
          <MapPinIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
          <span className="line-clamp-1">{fair.venue}</span>
        </div>
        {typeof fair.boothCount === 'number' && (
          <div className="flex items-center gap-1.5">
            <Building2Icon className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
            <span>{fair.boothCount} 家单位参展</span>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-gray-400">来源：{fair.sourceName}</span>
        <Button size="sm" variant="secondary" className="shrink-0 gap-1" onClick={onView}>
          查看招聘会
          <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </Card>
  )
}

// ── 服务入口卡（AI 简历 / 打印材料） ───────────────────────────

function ServiceEntryCard({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: typeof SparklesIcon
  iconBg: string
  iconColor: string
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <button
      type="button"
      onClick={onAction}
      className="flex min-h-[160px] flex-col rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-colors hover:bg-gray-50 active:bg-gray-100"
    >
      <span className={`flex h-12 w-12 items-center justify-center rounded-lg ${iconBg}`}>
        <Icon className={`h-6 w-6 ${iconColor}`} aria-hidden="true" />
      </span>
      <h3 className="mt-3 text-lg font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 flex-1 text-sm leading-relaxed text-gray-500">{description}</p>
      <span className="mt-3 flex min-h-[44px] items-center gap-0.5 text-base font-semibold text-primary-600">
        {actionLabel}
        <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
      </span>
    </button>
  )
}

// ── 页面 ───────────────────────────────────────────────────────

export function CampusPage() {
  const navigate = useNavigate()
  const [jobs,    setJobs]    = useState<ExternalJobDTO[]>([])
  const [fairs,   setFairs]   = useState<ExternalJobFairDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    Promise.all([getJobs({ category: 'campus', pageSize: 20 }), getJobFairs()])
      .then(([jobRes, fairRes]) => {
        if (cancelled) return
        setJobs(jobRes.data.slice(0, MAX_JOBS))
        setFairs(fairRes.data.filter(isCampusFair).slice(0, MAX_FAIRS))
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [retryKey])

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          title="校园招聘专区"
          subtitle="来源：第三方平台 · 官方机构"
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
              返回首页
            </Button>
          }
        />
        <ComplianceBanner tone="warning" className="mt-4">
          本专区仅展示第三方平台 / 官方机构的校招岗位与招聘会信息，不参与投递与报名流程。
          投递与预约请前往来源平台办理，简历不会提交给企业。
        </ComplianceBanner>
      </div>

      <div className="mt-5 flex flex-1 flex-col gap-7 overflow-y-auto px-6 pb-8">
        {/* ① 季节横幅卡 */}
        <SeasonBanner />

        {/* 校招岗位 */}
        <section className="space-y-3">
          <SectionHeader
            icon={BriefcaseIcon}
            iconBg="bg-blue-50"
            iconColor="text-blue-600"
            title="校招岗位"
            subtitle="面向应届毕业生 · 第三方来源"
            onMore={() => navigate('/jobs')}
          />
          {loading ? (
            <LoadingState className="py-10" />
          ) : error ? (
            <ErrorState message="加载失败，请稍后重试" onRetry={() => setRetryKey((k) => k + 1)} className="py-10" />
          ) : jobs.length === 0 ? (
            <Card className="flex items-center justify-between gap-3 border-dashed p-4 shadow-none">
              <p className="text-sm text-gray-500">暂无校招岗位，可查看全部岗位信息</p>
              <Button size="sm" variant="secondary" className="shrink-0 gap-1" onClick={() => navigate('/jobs')}>
                查看岗位
                <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {jobs.map((job) => (
                <CampusJobCard
                  key={job.id}
                  job={job}
                  onView={() => navigate(`/jobs/${job.id}`, { state: { job } })}
                />
              ))}
            </div>
          )}
        </section>

        {/* ② 校园招聘会 */}
        <section className="space-y-3">
          <SectionHeader
            icon={GraduationCapIcon}
            iconBg="bg-cyan-50"
            iconColor="text-cyan-700"
            title="校园招聘会"
            subtitle="高校双选会 · 校企专场"
            onMore={() => navigate('/job-fairs')}
          />
          {loading ? (
            <LoadingState className="py-10" />
          ) : error ? (
            <ErrorState message="加载失败，请稍后重试" onRetry={() => setRetryKey((k) => k + 1)} className="py-10" />
          ) : fairs.length === 0 ? (
            <Card className="flex items-center justify-between gap-3 border-dashed p-4 shadow-none">
              <p className="text-sm text-gray-500">暂无校园招聘会，可查看全部招聘会</p>
              <Button size="sm" variant="secondary" className="shrink-0 gap-1" onClick={() => navigate('/job-fairs')}>
                查看招聘会
                <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {fairs.map((fair) => (
                <CampusFairCard
                  key={fair.id}
                  fair={fair}
                  onView={() => navigate(`/job-fairs/${fair.id}`, { state: { fair } })}
                />
              ))}
            </div>
          )}
        </section>

        {/* ③④ 求职材料服务 */}
        <section className="space-y-3">
          <SectionHeader
            icon={SparklesIcon}
            iconBg="bg-primary-50"
            iconColor="text-primary-600"
            title="求职材料服务"
            subtitle="备齐校招材料，就地完成"
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ServiceEntryCard
              icon={SparklesIcon}
              iconBg="bg-primary-50"
              iconColor="text-primary-600"
              title="AI 简历"
              description="应届简历诊断与优化，上传或扫描简历获取 AI 建议"
              actionLabel="进入简历服务"
              onAction={() => navigate('/resume')}
            />
            <ServiceEntryCard
              icon={PrinterIcon}
              iconBg="bg-gray-100"
              iconColor="text-gray-700"
              title="打印材料"
              description="简历、成绩单、证件照等求职材料打印与扫描"
              actionLabel="进入打印扫描"
              onAction={() => navigate('/print-scan')}
            />
          </div>
        </section>

        <EmptyState
          icon={GraduationCapIcon}
          title="数据来自第三方来源"
          description="本系统仅记录浏览、收藏、跳转、打印与 AI 服务调用，不记录投递结果，不向企业提供简历。"
          className="border border-dashed border-gray-200 bg-gray-50/60 py-6"
        />
      </div>
    </div>
  )
}
