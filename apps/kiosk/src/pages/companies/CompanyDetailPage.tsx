// ============================================================
// 企业详情页（/companies/:id）。
//
// 合规定位（长期红线）：企业展示 = 来源企业与岗位导览，不是招聘平台。
// - 封面/宣传片/指标全部来自后端真实数据；右侧指标受 Admin 开关控制
//   （后端只下发开启且有数据的项，缺项不渲染、不补假数字）。
// - 不收简历、无平台内投递：岗位行「去来源平台投递」为二维码引导。
// - 岗位匹配参考只引导本人走既有 2D 诊断链路，不展示无依据的匹配等级。
// - P1 闭环：详情加载→BrowseLog(company_profile)；打开来源平台页→
//   ExternalJumpLog(external_open)；岗位投递入口→ExternalJumpLog(job, external_apply)。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import {
  COMPANY_INDUSTRIES,
  COMPANY_TYPES,
  type CompanyDetailDTO,
  type CompanyJobItemDTO,
} from '@ai-job-print/shared'
import {
  AwardIcon,
  BriefcaseIcon,
  Building2Icon,
  BuildingIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  EyeIcon,
  Loader2Icon,
  MapPinIcon,
  PlayIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  SparklesIcon,
  StoreIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react'
import { getCompanyById, getCompanyJobs } from '../../services/api/companies'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { isValidSourceUrl } from '../../lib/url'
import { useAuth } from '../../auth/useAuth'

const CATEGORY_LABEL: Record<string, string> = {
  fulltime: '全职', intern: '实习', campus: '校招', parttime: '兼职',
}

// ─── 二维码弹层（来源平台 / 岗位投递）────────────────────────────────────────

function QrModal({ title, subtitle, url, note, onClose }: {
  title: string
  subtitle: string
  url: string
  note: string
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-[22rem] max-w-full rounded-2xl bg-white p-7 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100"
        >
          <XIcon className="h-5 w-5" />
        </button>
        <p className="text-center text-base font-semibold text-neutral-800">{title}</p>
        <p className="mt-1 truncate text-center text-xs text-neutral-400">{subtitle}</p>
        <div className="mt-5 flex justify-center"><SourceUrlQr value={url} size={196} /></div>
        <p className="mt-3 break-all rounded-lg bg-neutral-50 px-3 py-2 text-center text-[11px] text-neutral-500">{url}</p>
        <p className="mt-4 text-xs leading-relaxed text-neutral-500">{note}</p>
      </div>
    </div>
  )
}

// ─── 指标卡（仅渲染后端下发的项）────────────────────────────────────────────

function MetricsCard({ metrics }: { metrics: CompanyDetailDTO['metrics'] }) {
  const entries: { icon: typeof BriefcaseIcon; label: string; value: string }[] = []
  if (metrics.openJobCount !== undefined) entries.push({ icon: BriefcaseIcon, label: '在招岗位', value: String(metrics.openJobCount) })
  if (metrics.city) entries.push({ icon: MapPinIcon, label: '所在城市', value: metrics.city })
  if (metrics.employeeScale) entries.push({ icon: UsersIcon, label: '员工规模', value: metrics.employeeScale })
  if (metrics.boothNo) entries.push({ icon: StoreIcon, label: '展位号', value: metrics.boothNo })
  if (entries.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-3">
      {entries.map(({ icon: Icon, label, value }) => (
        <div key={label} className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-bold leading-tight text-neutral-900">{value}</p>
            <p className="text-xs text-neutral-400">{label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── 主组件 ────────────────────────────────────────────────────────────────

type QrState =
  | { kind: 'source' }
  | { kind: 'job'; job: CompanyJobItemDTO }
  | null

export function CompanyDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const { getToken } = useAuth()

  const [company, setCompany] = useState<CompanyDetailDTO | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [qr, setQr] = useState<QrState>(null)
  const [videoOpen, setVideoOpen] = useState(false)

  const [jobs, setJobs] = useState<CompanyJobItemDTO[]>([])
  const [jobsTotal, setJobsTotal] = useState<number | null>(null)
  const [jobsCursor, setJobsCursor] = useState<string | null>(null)
  const [jobsState, setJobsState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [jobsLoadingMore, setJobsLoadingMore] = useState(false)

  const load = useCallback(() => {
    if (!id) return
    setState('loading')
    getCompanyById(id)
      .then((c) => { setCompany(c); setState('ready') })
      .catch(() => setState('error'))
  }, [id])

  const loadJobs = useCallback(() => {
    if (!id) return
    setJobsState('loading')
    getCompanyJobs(id, { pageSize: 10 })
      .then((page) => {
        setJobs(page.items)
        setJobsTotal(page.total)
        setJobsCursor(page.nextCursor)
        setJobsState('ready')
      })
      .catch(() => setJobsState('error'))
  }, [id])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadJobs() }, [loadJobs])

  // 浏览记录（P1）：企业详情真实加载后上报；fire-and-forget，失败不影响页面。
  useEffect(() => {
    if (company?.id) recordBrowse(getToken(), 'company_profile', company.id)
  }, [company?.id, getToken])

  // 「?tab=jobs」深链：加载完成后滚到岗位区
  useEffect(() => {
    if (state === 'ready' && searchParams.get('tab') === 'jobs') {
      document.getElementById('company-jobs')?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [state, searchParams])

  if (state === 'loading') return <LoadingState className="h-full" />
  if (state === 'error' || !company) {
    return (
      <ErrorState
        message="企业不存在、未发布或后端服务未连接"
        onRetry={() => navigate('/companies')}
        className="h-full"
      />
    )
  }

  const typeLabel = company.companyType ? (COMPANY_TYPES as Record<string, string>)[company.companyType] : null
  const industryLabel = company.industry ? (COMPANY_INDUSTRIES as Record<string, string>)[company.industry] : null
  const sourceCanOpen = isValidSourceUrl(company.sourceUrl ?? '')

  // 外部跳转记录（P1）：只记录「打开来源平台页」这一动作，不记录任何办理结果。
  const openSourceQr = () => {
    recordExternalJump(getToken(), 'company_profile', company.id, 'external_open')
    setQr({ kind: 'source' })
  }
  const openJobQr = (job: CompanyJobItemDTO) => {
    recordExternalJump(getToken(), 'job', job.id, 'external_apply')
    setQr({ kind: 'job', job })
  }

  return (
    <div className="flex h-full flex-col">
      {qr?.kind === 'source' && company.sourceUrl && (
        <QrModal
          title="扫码前往来源平台查看"
          subtitle={company.name}
          url={company.sourceUrl}
          note="请使用手机扫码前往来源平台查看企业信息。本系统不接收简历、不参与招聘流程。"
          onClose={() => setQr(null)}
        />
      )}
      {qr?.kind === 'job' && (
        <QrModal
          title="扫码前往来源平台投递"
          subtitle={qr.job.title}
          url={qr.job.sourceUrl}
          note="请使用手机扫码前往来源平台办理投递。投递结果以来源平台为准，本系统不接收简历、不参与招聘流程。"
          onClose={() => setQr(null)}
        />
      )}

      {/* 头部 */}
      <div className="flex items-start justify-between gap-3 px-6 pb-3 pt-6">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-neutral-900">{company.name}</h1>
          <p className="mt-0.5 text-xs text-neutral-400">信息来源：{company.sourceName}</p>
        </div>
        <Button size="sm" variant="secondary" className="shrink-0" onClick={() => navigate('/companies')}>
          返回列表
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        {/* 封面 / 宣传片（仅真实媒体；无媒体不放占位假视频） */}
        {company.promoVideoUrl ? (
          videoOpen ? (
            <video
              src={company.promoVideoUrl}
              poster={company.coverImageUrl ?? undefined}
              controls
              autoPlay
              className="max-h-72 w-full rounded-xl bg-black object-contain"
            />
          ) : (
            <button
              type="button"
              onClick={() => setVideoOpen(true)}
              className="relative flex h-48 w-full items-center justify-center overflow-hidden rounded-xl bg-neutral-900"
              aria-label="播放企业宣传片"
            >
              {company.coverImageUrl && (
                <img src={company.coverImageUrl} alt={`${company.name}封面`} className="absolute inset-0 h-full w-full object-cover opacity-70" />
              )}
              <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-neutral-900 shadow-lg">
                <PlayIcon className="ml-1 h-7 w-7" aria-hidden="true" />
              </span>
              <span className="absolute bottom-3 left-4 text-sm font-medium text-white">企业宣传片</span>
            </button>
          )
        ) : company.coverImageUrl ? (
          <img src={company.coverImageUrl} alt={`${company.name}封面`} className="max-h-56 w-full rounded-xl object-cover" />
        ) : null}

        {/* 基本信息 */}
        <Card className="p-5">
          <div className="flex items-start gap-3">
            {company.logoUrl ? (
              <img src={company.logoUrl} alt={`${company.name} logo`} className="h-14 w-14 shrink-0 rounded-xl border border-neutral-100 object-cover" />
            ) : (
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                <BuildingIcon className="h-7 w-7" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-neutral-900">{company.name}</p>
              {company.legalName && company.legalName !== company.name && (
                <p className="mt-0.5 text-xs text-neutral-400">{company.legalName}</p>
              )}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span className="rounded bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-600">信息来源：{company.sourceName}</span>
                {typeLabel && <span className="rounded bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-600">{typeLabel}</span>}
                {industryLabel && <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">{industryLabel}</span>}
                {company.fairParticipant && <span className="rounded bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning-fg">招聘会参展企业</span>}
                {company.tags.map((t) => (
                  <span key={t} className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">{t}</span>
                ))}
              </div>
            </div>
          </div>

          {company.description && (
            <p className="mt-3 text-sm leading-relaxed text-neutral-600">{company.description}</p>
          )}

          {company.honorTags.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs font-medium text-neutral-500">
                <AwardIcon className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
                企业荣誉
              </span>
              {company.honorTags.map((t) => (
                <span key={t} className="rounded border border-warning/20 bg-warning-bg/60 px-2 py-0.5 text-xs text-warning-fg">{t}</span>
              ))}
            </div>
          )}

          {company.address && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-400">
              <MapPinIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {[company.province, company.city, company.district, company.address].filter(Boolean).join(' ')}
            </p>
          )}
        </Card>

        {/* 指标卡（后台开关控制；后端只下发开启且有数据的项） */}
        <MetricsCard metrics={company.metrics} />

        {/* 合规提示条 */}
        <div className="flex items-start gap-2 rounded-lg border border-primary-100 bg-primary-50/50 px-4 py-3">
          <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-neutral-500">{company.dataSourceNote}</p>
        </div>

        {/* 在招岗位 */}
        <section id="company-jobs" aria-label="该公司在招岗位">
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-base font-semibold text-neutral-900">
              <BriefcaseIcon className="h-4 w-4 text-primary-500" aria-hidden="true" />
              该公司在招岗位
              {jobsTotal !== null && jobsTotal > 0 && <span className="text-sm font-normal text-neutral-400">（{jobsTotal}）</span>}
            </p>
          </div>

          {jobsState === 'loading' ? (
            <LoadingState className="py-10" />
          ) : jobsState === 'error' ? (
            <ErrorState message="岗位加载失败" onRetry={loadJobs} className="py-10" />
          ) : jobs.length === 0 ? (
            <EmptyState
              icon={BriefcaseIcon}
              title="暂无已发布岗位"
              description="该企业暂无关联的已发布来源岗位"
              className="py-10"
            />
          ) : (
            <div className="flex flex-col gap-3">
              {jobs.map((job) => (
                <div key={job.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold text-neutral-900">{job.title}</p>
                      <p className="mt-0.5 text-sm font-medium text-primary-600">{job.salaryDisplay}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {job.category && (
                          <span className="rounded bg-primary-50 px-1.5 py-0.5 text-[11px] font-medium text-primary-600">
                            {CATEGORY_LABEL[job.category] ?? job.category}
                          </span>
                        )}
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-500">{job.city}</span>
                        {job.tags.slice(0, 4).map((t) => (
                          <span key={t} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-500">{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/jobs/${job.id}`)}
                      className="flex min-h-[48px] flex-1 items-center justify-center gap-1 rounded-lg border border-neutral-200 text-sm font-semibold text-neutral-700 active:bg-neutral-50"
                    >
                      <EyeIcon className="h-4 w-4" aria-hidden="true" />
                      查看岗位
                    </button>
                    <button
                      type="button"
                      onClick={() => openJobQr(job)}
                      disabled={!isValidSourceUrl(job.sourceUrl)}
                      className="flex min-h-[48px] flex-1 items-center justify-center gap-1 rounded-lg bg-primary-600 text-sm font-semibold text-white active:bg-primary-700 disabled:bg-neutral-200 disabled:text-neutral-400"
                    >
                      <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
                      去来源平台投递
                    </button>
                  </div>
                </div>
              ))}
              {jobsCursor && (
                <button
                  type="button"
                  onClick={() => {
                    if (jobsLoadingMore) return
                    setJobsLoadingMore(true)
                    getCompanyJobs(company.id, { cursor: jobsCursor, pageSize: 10 })
                      .then((page) => {
                        setJobs((prev) => [...prev, ...page.items])
                        setJobsCursor(page.nextCursor)
                      })
                      .catch(() => { /* 保留游标可重点 */ })
                      .finally(() => setJobsLoadingMore(false))
                  }}
                  disabled={jobsLoadingMore}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-200 text-sm font-medium text-neutral-500 hover:bg-neutral-50 disabled:opacity-60"
                >
                  {jobsLoadingMore && <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  加载更多岗位
                </button>
              )}
            </div>
          )}
        </section>

        {/* 岗位匹配参考说明（只引导本人走既有 2D 链路，不展示无依据的匹配等级） */}
        <Card className="p-5">
          <p className="flex items-center gap-1.5 text-base font-semibold text-neutral-900">
            <SparklesIcon className="h-4 w-4 text-plum" aria-hidden="true" />
            岗位匹配参考
          </p>
          <p className="mt-2 text-sm leading-relaxed text-neutral-600">
            完成 AI 简历诊断后，可对感兴趣的岗位生成「匹配参考：较高 / 中等 / 偏低」三档参考与提升建议。
          </p>
          <p className="mt-1.5 text-xs text-neutral-400">
            仅供本人优化简历和选择岗位参考，不代表录用结果；结果不会提供给任何企业。
          </p>
          <button
            type="button"
            onClick={() => navigate('/resume/source?intent=diagnose')}
            className="mt-3 flex min-h-[48px] items-center gap-1.5 rounded-lg border border-plum/30 bg-plum-soft px-4 text-sm font-semibold text-plum active:bg-plum-soft"
          >
            去做简历诊断与岗位匹配参考
            <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </Card>

        {/* 来源信息 */}
        <Card className="p-5">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-neutral-700">
            <Building2Icon className="h-4 w-4 text-neutral-400" aria-hidden="true" />
            数据来源
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-4"><span className="text-neutral-400">来源机构</span><span className="text-right text-neutral-700">{company.sourceName}</span></div>
            <div className="flex justify-between gap-4"><span className="text-neutral-400">外部编号</span><span className="text-right font-mono text-xs text-neutral-600">{company.externalId}</span></div>
            <div className="flex justify-between gap-4"><span className="text-neutral-400">同步时间</span><span className="text-right text-neutral-700">{company.syncTime.slice(0, 10)}</span></div>
          </div>
          {sourceCanOpen && (
            <button
              type="button"
              onClick={openSourceQr}
              className="mt-3 flex min-h-[48px] items-center gap-1.5 rounded-lg border border-neutral-200 px-4 text-sm font-medium text-primary-600 hover:bg-primary-50"
            >
              <ExternalLinkIcon className="h-4 w-4" aria-hidden="true" />
              去来源平台查看
            </button>
          )}
        </Card>
      </div>
    </div>
  )
}
