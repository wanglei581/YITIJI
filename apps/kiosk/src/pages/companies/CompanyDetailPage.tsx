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
import { Card, EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import {
  COMPANY_INDUSTRIES,
  COMPANY_TYPES,
  type CompanyDetailDTO,
  type CompanyJobItemDTO,
} from '@ai-job-print/shared'
import {
  AwardIcon,
  BriefcaseIcon,

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
import { KioskPageFrame } from '../jobs/components/W4Presentation'

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
    <div className="grid grid-cols-4 gap-3">
      {entries.map(({ icon: Icon, label, value }) => (
        <div key={label} className="flex items-center gap-3 rounded-[14px] border border-[var(--kp-line)] bg-[var(--kp-surface)] px-5 py-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]">
            <Icon className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[25px] font-bold leading-tight text-[var(--kp-ink)]">{value}</p>
            <p className="text-base text-[var(--kp-muted)]">{label}</p>
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
    <KioskPageFrame
      tone="clay"
      title="企业详情"
      subtitle={`来源企业与岗位导览 · ${company.sourceName} · 信息以来源平台为准`}
      backLabel="返回企业列表"
      onBack={() => navigate('/companies')}
    >
    <div className="kproto kproto-clay flex h-full flex-col">
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

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-12 pb-6">
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
        <Card className="kproto-card accented">
          <div className="flex items-start gap-3">
            {company.logoUrl ? (
              <img src={company.logoUrl} alt={`${company.name} logo`} className="h-[72px] w-[72px] shrink-0 rounded-2xl border border-neutral-100 object-cover" />
            ) : (
              <span className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-2xl bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]">
                <BuildingIcon className="h-10 w-10" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-serif text-4xl font-black tracking-[1px] text-[var(--kp-ink)]">{company.name}</p>
              {company.legalName && company.legalName !== company.name && (
                <p className="mt-1 text-lg text-[var(--kp-muted)]">{company.legalName}</p>
              )}
              <div className="kproto-meta mt-3">
                <span className="kproto-chip source">信息来源 · {company.sourceName}</span>
                {typeLabel && <span className="kproto-chip">{typeLabel}</span>}
                {industryLabel && <span className="kproto-chip">{industryLabel}</span>}
                {company.fairParticipant && <span className="kproto-chip warn">招聘会参展企业</span>}
                {company.tags.map((t) => (
                  <span key={t} className="kproto-chip">{t}</span>
                ))}
              </div>
            </div>
          </div>

          {company.description && (
            <p className="mt-4 text-[20px] leading-relaxed text-[var(--kp-ink)]">{company.description}</p>
          )}

          {company.honorTags.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1 text-lg font-bold text-[var(--kp-wheat-deep)]">
                <AwardIcon className="h-5 w-5" aria-hidden="true" />
                企业荣誉
              </span>
              {company.honorTags.map((t) => (
                <span key={t} className="kproto-chip warn">{t}</span>
              ))}
            </div>
          )}

          {company.address && (
            <p className="mt-3 flex items-center gap-1.5 text-base text-[var(--kp-muted)]">
              <MapPinIcon className="h-4 w-4" aria-hidden="true" />
              {[company.province, company.city, company.district, company.address].filter(Boolean).join(' ')}
            </p>
          )}
        </Card>

        {/* 指标卡（后台开关控制；后端只下发开启且有数据的项） */}
        <MetricsCard metrics={company.metrics} />

        {/* 合规提示条 */}
        <div className="kproto-notice">
          <ShieldCheckIcon aria-hidden="true" />
          <p>{company.dataSourceNote}</p>
        </div>

        {/* 在招岗位 */}
        <section id="company-jobs" aria-label="该公司在招岗位">
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-2 text-[24px] font-bold text-[var(--kp-ink)]">
              <BriefcaseIcon className="h-6 w-6 text-[var(--kp-accent-deep)]" aria-hidden="true" />
              该公司在招岗位
              {jobsTotal !== null && jobsTotal > 0 && <span className="text-lg font-normal text-[var(--kp-muted)]">（{jobsTotal}）</span>}
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
                <div key={job.id} className="rounded-[14px] border border-[var(--kp-line)] bg-[var(--kp-paper)] px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[22px] font-bold text-[var(--kp-ink)]">{job.title}</p>
                      <p className="mt-0.5 text-[20px] font-bold text-[var(--kp-accent-deep)]">{job.salaryDisplay}</p>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {job.category && (
                          <span className="kproto-chip px-3 py-1 text-base">
                            {CATEGORY_LABEL[job.category] ?? job.category}
                          </span>
                        )}
                        <span className="kproto-chip px-3 py-1 text-base">{job.city}</span>
                        {job.tags.slice(0, 4).map((t) => (
                          <span key={t} className="kproto-chip px-3 py-1 text-base">{t}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/jobs/${job.id}`)}
                      className="kproto-btn sm"
                    >
                      <EyeIcon aria-hidden="true" />
                      查看岗位
                    </button>
                    <button
                      type="button"
                      onClick={() => openJobQr(job)}
                      disabled={!isValidSourceUrl(job.sourceUrl)}
                      className="kproto-btn sm primary disabled:opacity-45"
                    >
                      <QrCodeIcon aria-hidden="true" />
                      去来源平台投递
                    </button>
                    </div>
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
                  className="kproto-btn sm w-full border-dashed text-[var(--kp-muted)] disabled:opacity-60"
                >
                  {jobsLoadingMore && <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  加载更多岗位
                </button>
              )}
            </div>
          )}
        </section>

        {/* 岗位匹配参考说明（只引导本人走既有 2D 链路，不展示无依据的匹配等级） */}
        <Card className="kproto-card kproto-plum accented">
          <p className="flex items-center gap-2 text-[24px] font-bold text-[var(--kp-ink)]">
            <SparklesIcon className="h-6 w-6 text-[var(--kp-plum-deep)]" aria-hidden="true" />
            岗位匹配参考
          </p>
          <p className="mt-2 text-[19px] leading-relaxed text-[var(--kp-ink)]">
            完成 AI 简历诊断后，可对感兴趣的岗位生成「匹配参考：较高 / 中等 / 偏低」三档参考与提升建议。
          </p>
          <p className="mt-1.5 text-[17px] text-[var(--kp-muted)]">
            仅供本人优化简历和选择岗位参考，不代表录用结果；结果不会提供给任何企业。
          </p>
          <button
            type="button"
            onClick={() => navigate('/resume/source?intent=diagnose')}
            className="kproto-btn sm mt-3 border-[var(--kp-plum)] text-[var(--kp-plum-deep)]"
          >
            去做简历诊断与岗位匹配参考
            <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </Card>

        {/* 来源信息 + 二维码（src-zone：左侧数据来源卡 + 右侧扫码面板） */}
        <div className="grid gap-[18px]" style={{ gridTemplateColumns: '1fr 320px' }}>
          <section className="kproto-card kproto-wheat accented">
            <div className="kproto-card-head" style={{ marginBottom: 12 }}>
              <span className="kproto-icon"><ShieldCheckIcon aria-hidden="true" /></span>
              <div>
                <h2 className="font-serif text-[28px] font-bold tracking-[1px]">数据来源</h2>
                <p className="mt-1 text-[18px] text-[var(--kp-muted)]">第三方来源信息，请核对后前往查看</p>
              </div>
            </div>
            <div className="kproto-grid-3 text-[20px]">
              <div><div className="text-[18px] text-[var(--kp-muted)]">来源机构</div><div className="mt-1.5 text-[22px] font-bold">{company.sourceName}</div></div>
              <div><div className="text-[18px] text-[var(--kp-muted)]">同步时间</div><div className="mt-1.5 text-[22px] font-bold">{company.syncTime.slice(0, 10)}</div></div>
              <div><div className="text-[18px] text-[var(--kp-muted)]">外部ID</div><div className="mt-1.5 text-[22px] font-bold">{company.externalId}</div></div>
            </div>
            <div className="kproto-notice mt-3">
              <ShieldCheckIcon aria-hidden="true" />
              <p>企业与岗位信息由第三方来源同步，本终端仅提供信息导览与跳转，不参与招聘流程，内容以来源平台为准。</p>
            </div>
          </section>
          {sourceCanOpen ? (
            <div className="flex flex-col items-center gap-3 rounded-[18px] border border-[var(--kp-line)] bg-[var(--kp-surface)] p-5 shadow-sm">
              <p className="text-[22px] font-bold text-[var(--kp-ink)]">扫码查看企业主页</p>
              <div className="flex flex-1 items-center justify-center">
                <SourceUrlQr value={company.sourceUrl!} size={160} />
              </div>
              <p className="text-center text-[16px] leading-snug text-[var(--kp-muted)]">手机扫码前往来源平台查看完整企业信息与全部岗位</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-[18px] border border-dashed border-[var(--kp-line)] bg-[var(--kp-surface)] p-5">
              <QrCodeIcon className="h-12 w-12 text-[var(--kp-muted)] opacity-40" aria-hidden="true" />
              <p className="text-center text-[16px] text-[var(--kp-muted)]">暂无来源链接</p>
            </div>
          )}
        </div>
      </div>

      {/* 底部行动条 */}
      <div className="flex shrink-0 items-center gap-5 border-t border-[var(--kp-line)] bg-[var(--kp-surface)] px-12 py-6">
        <button type="button" className="kproto-btn" onClick={() => navigate('/companies')}>
          <ChevronRightIcon className="h-6 w-6 rotate-180" aria-hidden="true" />
          返回列表
        </button>
        <div className="flex-1" />
        {sourceCanOpen && (
          <button type="button" className="kproto-btn primary" onClick={openSourceQr}>
            <ExternalLinkIcon aria-hidden="true" />
            去来源平台查看
          </button>
        )}
      </div>
    </div>
    </KioskPageFrame>
  )
}
