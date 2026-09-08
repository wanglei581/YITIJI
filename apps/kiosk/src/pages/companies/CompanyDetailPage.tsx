// 企业详情页（/companies/:id）。来源企业与岗位导览，不是招聘平台。
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  COMPANY_INDUSTRIES,
  COMPANY_TYPES,
  type CompanyDetailDTO,
  type CompanyJobItemDTO,
} from '@ai-job-print/shared'
import { BriefcaseIcon, BuildingIcon, MapPinIcon, PlayIcon } from 'lucide-react'
import { getCompanyById, getCompanyJobs } from '../../services/api/companies'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { SOURCE_APPLY_UNAVAILABLE_REASON } from '../../lib/capabilityReasons'
import { isValidSourceUrl } from '../../lib/url'
import { useAuth } from '../../auth/useAuth'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import {
  DirAiAssist,
  DirExitList,
  DirKv,
  DirNote,
  DirQrHero,
  DirSec,
  DirState,
  DirStripItem,
  isHttpErrorStatus,
} from '../../components/qingxu/directory/DirectoryBits'
import '../../components/qingxu/directory/directory-qx.css'
import { evaluateJobSourceTrust, SOURCE_ELEMENT_MISSING_TEXT, sourceTrustReason } from '../jobs/utils/sourceTrust'
import { getTerminalCode } from '../../services/api/terminalConfig'

const BOUNDARY = '本机只做来源企业与岗位导览：不收简历、不做筛选、不安排面试，投递在来源平台完成。'
const CATEGORY_LABEL: Record<string, string> = { fulltime: '全职', intern: '实习', campus: '校招', parttime: '兼职' }

type QrState = { kind: 'source' } | { kind: 'job'; job: CompanyJobItemDTO } | null

export function CompanyDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const { getToken } = useAuth()
  const [company, setCompany] = useState<CompanyDetailDTO | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [qr, setQr] = useState<QrState>(null)
  const [videoOpen, setVideoOpen] = useState(false)
  const [jobs, setJobs] = useState<CompanyJobItemDTO[]>([])
  const [jobsTotal, setJobsTotal] = useState<number | null>(null)
  const [jobsCursor, setJobsCursor] = useState<string | null>(null)
  const [jobsState, setJobsState] = useState<'loading' | 'error' | 'ready'>('loading')

  const load = useCallback(() => {
    if (!id) return
    setState('loading')
    getCompanyById(id)
      .then((c) => { setCompany(c); setState('ready') })
      .catch((err: unknown) => {
        setErrorMessage(err instanceof Error ? err.message : '加载失败')
        setState('error')
      })
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
  useEffect(() => {
    if (company?.id) recordBrowse(getToken(), 'company_profile', company.id)
  }, [company?.id, getToken])
  useEffect(() => {
    if (state === 'ready' && searchParams.get('tab') === 'jobs') {
      document.getElementById('company-jobs')?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [state, searchParams])

  const notFound = state === 'error' && isHttpErrorStatus(errorMessage, 404)
  const sparse = state === 'ready' && jobsState === 'ready' && jobs.length === 0
  const uiState = qr ? 'company-qr' : state === 'loading' ? 'company-loading' : notFound ? 'company-not-found' : state === 'error' ? 'company-error' : sparse ? 'company-sparse' : 'company-ready'
  const pill = state === 'loading'
    ? { tone: 'unknown' as const, label: '正在读取企业详情' }
    : state === 'error'
      ? { tone: notFound ? 'warn' as const : 'bad' as const, label: notFound ? '企业未发布或链接已失效' : '企业详情读取失败' }
      : sparse
        ? { tone: 'warn' as const, label: '该企业当前没有在招岗位' }
        : { tone: 'ok' as const, label: '企业资料 · 以来源同步为准' }

  const typeLabel = company?.companyType ? (COMPANY_TYPES as Record<string, string>)[company.companyType] : null
  const industryLabel = company?.industry ? (COMPANY_INDUSTRIES as Record<string, string>)[company.industry] : null
  const sourceCanOpen = company ? isValidSourceUrl(company.sourceUrl ?? '') : false
  const companyTrust = company
    ? evaluateJobSourceTrust({ sourceName: company.sourceName, syncTime: company.syncTime, externalId: company.externalId, sourceUrl: company.sourceUrl })
    : null

  const openSourceQr = () => {
    if (!company || !sourceCanOpen) return
    recordExternalJump(getToken(), 'company_profile', company.id, 'external_open')
    setQr({ kind: 'source' })
  }
  const openJobQr = (job: CompanyJobItemDTO) => {
    if (!isValidSourceUrl(job.sourceUrl)) return
    recordExternalJump(getToken(), 'job', job.id, 'external_apply')
    setQr({ kind: 'job', job })
  }

  const firstJob = jobs[0]
  return (
    <QxPageFrame
      // 稿 43 的目录页返回「岗位服务」；本页是详情段，返回落到目录本身。
      back={{ label: '返回找企业', onBack: () => navigate('/companies') }}
      title={company?.name ?? '企业详情'}
      subtitle="来源企业与岗位导览 · 资料、岗位与来源主页缺哪项就不显示哪项。"
      status={pill}
      terminalLabel={getTerminalCode() || '设备未绑定'}
      ctabar={
        state === 'error' ? (
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/jobs-service')}>返回岗位服务</button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={notFound ? () => navigate('/companies') : load}>
              {notFound ? '回企业目录重选' : '重新加载'}
            </button>
          </>
        ) : sparse ? (
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/companies')}>返回企业目录</button>
            <span id="company-jobs-bar-reason" className="why">该企业当前没有在招岗位</span>
            <button type="button" className="qx-btn" data-variant="primary" aria-disabled={true} aria-describedby="company-jobs-bar-reason" onClick={() => { if (jobs.length === 0) return }}>查看在招岗位</button>
          </>
        ) : (
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/companies')}>返回企业目录</button>
            <button
              type="button"
              className="qx-btn"
              data-variant="primary"
              onClick={() => { if (firstJob) navigate(`/jobs/${firstJob.id}`) }}
            >
              查看在招岗位
            </button>
          </>
        )
      }
      navbar={<QxAppNavbar onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />}
    >
      <div className="dw-page qx-grow" data-state={uiState} data-testid={`company-directory-state-${uiState}`}>
        {qr?.kind === 'source' && company?.sourceUrl ? (
          <DirQrHero
            title="用手机扫码，在来源平台查看企业资料"
            address={<b>{company.sourceUrl}</b>}
            url={company.sourceUrl}
            steps={['手机扫码打开来源平台的企业页。', '浏览、登录都在该平台完成，简历不经过这台机器。', '离开前请关掉二维码，不把账号留在公共终端。']}
            reason="本机不接收简历、不代投递，也拿不到你的浏览结果。"
          />
        ) : null}
        {qr?.kind === 'job' ? (
          <DirQrHero
            title="用手机扫码，在来源平台完成投递"
            address={<b>{qr.job.sourceUrl}</b>}
            url={qr.job.sourceUrl}
            steps={['手机扫码打开来源平台的岗位页。', '在来源平台登录并投递，简历不经过这台机器。', '面试与结果由来源平台和企业通知你。']}
            reason="本机不接收简历、不代投递；二维码按该岗位的来源链接生成。"
          />
        ) : null}
        {qr ? (
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => setQr(null)}>关闭二维码</button>
        ) : state === 'loading' ? (
          <DirState tone="info" testId="company-directory-loading" title="正在读取企业资料">企业名称、在招岗位数取到之前不显示任何数字。</DirState>
        ) : state === 'error' || !company ? (
          <>
            <DirState tone={notFound ? 'empty' : 'error'} testId={notFound ? 'company-directory-company-missing' : 'company-directory-company-error'} title={notFound ? '企业详情不可用' : '企业详情读取失败'}>
              {notFound ? '这家企业可能未发布、已下架，或这条链接已经失效。本机不会拿同名企业或相似企业顶上来。' : '企业资料和在招岗位这次没有取回，本机不会用缓存或相似企业顶替。'}
            </DirState>
            <DirExitList>
              <DirStripItem icon={BuildingIcon} title="回企业目录" desc="按行业和地区重新筛" onClick={() => navigate('/companies')} />
              <DirStripItem icon={BriefcaseIcon} tone="wheat" title="看岗位信息" desc="直接按岗位找，不按企业找" onClick={() => navigate('/jobs')} />
            </DirExitList>
            <DirNote>{BOUNDARY}</DirNote>
          </>
        ) : (
          <>
            {company.promoVideoUrl ? (
              videoOpen ? (
                <video src={company.promoVideoUrl} poster={company.coverImageUrl ?? undefined} controls autoPlay className="dw-media" />
              ) : (
                <button type="button" className="dw-video-btn" onClick={() => setVideoOpen(true)} aria-label="播放企业宣传片">
                  {company.coverImageUrl ? <img src={company.coverImageUrl} alt="" className="dw-media" /> : null}
                  <span className="dw-play"><PlayIcon aria-hidden /></span>
                </button>
              )
            ) : company.coverImageUrl ? (
              <img src={company.coverImageUrl} alt={`${company.name}封面`} className="dw-media" />
            ) : null}

            <DirSec no="01" title="企业资料" hint="缺哪项就不显示哪项">
              <div className="dw-blk">
                <div className="dw-row-t">{company.name}</div>
                <div className="dw-row-sub">
                  <span><MapPinIcon size={20} aria-hidden />{[company.province, company.city, company.district].filter(Boolean).join(' · ') || '地区未提供'}</span>
                  <span>来源 {company.sourceName || SOURCE_ELEMENT_MISSING_TEXT}</span>
                </div>
                <DirKv rows={[
                  ['企业类型', typeLabel],
                  ['所属行业', industryLabel],
                  ['企业地址', company.address],
                  ['来源机构', company.sourceName || SOURCE_ELEMENT_MISSING_TEXT],
                  ['同步时间', company.syncTime ? company.syncTime.slice(0, 10) : SOURCE_ELEMENT_MISSING_TEXT],
                  ['外部ID', company.externalId || SOURCE_ELEMENT_MISSING_TEXT],
                  ['外部投递链接', sourceCanOpen ? company.sourceUrl : SOURCE_ELEMENT_MISSING_TEXT],
                ]} />
                <div className="dw-reason">{company.dataSourceNote || '数据来源说明：来源名称、外部ID 与同步时间随企业记录一起返回；缺哪项就空着，不写默认值，也不写「最新」。'}</div>
                <div className="dw-filter-actions">
                  <button
                    type="button"
                    className="dw-chip"
                    aria-disabled={!sourceCanOpen || undefined}
                    aria-describedby={!sourceCanOpen ? 'company-source-home-reason' : undefined}
                    onClick={openSourceQr}
                  >
                    去来源平台查看
                  </button>
                  {sourceCanOpen ? null : <span id="company-source-home-reason" className="dw-chip warn">该来源未提供可用的链接，请到来源平台查询该企业</span>}
                </div>
              </div>
            </DirSec>

            <DirSec no="02" title="在招岗位" hint={sparse ? '确实为 0，不是查不到' : '只列已发布岗位'} grow>
              <div className="dw-rbox" id="company-jobs">
                {jobsState === 'loading' ? (
                  <DirState tone="info" testId="company-jobs-loading" title="正在读取在招岗位">取到之前不显示岗位名称。</DirState>
                ) : jobsState === 'error' ? (
                  <DirState tone="error" testId="company-jobs-error" title="岗位加载失败">
                    <button type="button" className="dw-chip" onClick={loadJobs}>重试</button>
                  </DirState>
                ) : sparse ? (
                  <DirState tone="empty" testId="company-directory-jobs-empty" title="该企业当前没有在招岗位">
                    这是确实为 0，不是没查到。没有岗位就不放「查看在招岗位」的入口。
                  </DirState>
                ) : (
                  <>
                    <div className="dw-rhead">
                      <span className="rn">在招岗位</span>
                      <span>共 {jobsTotal ?? jobs.length} 条</span>
                      <span className="rsp">{BOUNDARY}</span>
                    </div>
                    <div className="dw-rlist">
                      {jobs.map((job) => {
                        const jobOk = isValidSourceUrl(job.sourceUrl)
                        const jobTrust = evaluateJobSourceTrust({
                          sourceName: job.sourceName,
                          syncTime: company.syncTime,
                          externalId: job.externalId,
                          sourceUrl: job.sourceUrl,
                        })
                        const reason = sourceTrustReason(jobTrust, SOURCE_APPLY_UNAVAILABLE_REASON)
                        return (
                          <div key={job.id} className="dw-row solid">
                            <span className="dw-row-ic"><BriefcaseIcon size={30} aria-hidden /></span>
                            <span className="dw-row-main">
                              <span className="dw-row-t">{job.title}</span>
                              <span className="dw-row-sub">
                                <span><MapPinIcon size={18} aria-hidden />{job.city}</span>
                                <span>{job.salaryDisplay}</span>
                                {job.category ? <span>{CATEGORY_LABEL[job.category] ?? job.category}</span> : null}
                              </span>
                            </span>
                            <span className="dw-job-actions">
                              <button type="button" className="qx-btn" onClick={() => navigate(`/jobs/${job.id}`)}>查看岗位</button>
                              <button
                                type="button"
                                className="qx-btn"
                                data-variant="primary"
                                aria-disabled={!jobOk || undefined}
                                aria-describedby={jobOk ? undefined : `company-job-apply-blocked-${job.id}`}
                                onClick={() => openJobQr(job)}
                              >
                                去来源平台投递
                              </button>
                              {jobOk ? null : <span id={`company-job-apply-blocked-${job.id}`} className="dw-why">{reason}</span>}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    {jobsCursor ? (
                      <button
                        type="button"
                        className="dw-pbtn"
                        onClick={() => {
                          getCompanyJobs(company.id, { cursor: jobsCursor, pageSize: 10 })
                            .then((page) => {
                              setJobs((prev) => [...prev, ...page.items])
                              setJobsCursor(page.nextCursor)
                            })
                            .catch(() => { /* 保留游标可重点 */ })
                        }}
                      >
                        加载更多岗位
                      </button>
                    ) : null}
                    <div className="dw-reason">「去来源平台投递」在岗位详情页按该岗位的来源链接单独放行，链接不合法就置灰。本页不放「投递企业」总入口。</div>
                  </>
                )}
              </div>
            </DirSec>
            {sparse ? <DirNote>{BOUNDARY}</DirNote> : (
              <DirAiAssist screen="company-directory" onProfile={() => navigate('/profile')} onAssistant={() => navigate('/assistant')} />
            )}
            {companyTrust && !companyTrust.ok ? <div className="dw-reason">{sourceTrustReason(companyTrust, SOURCE_APPLY_UNAVAILABLE_REASON)}</div> : null}
          </>
        )}
      </div>
    </QxPageFrame>
  )
}
