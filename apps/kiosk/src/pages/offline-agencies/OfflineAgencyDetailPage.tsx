import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BuildingIcon, BriefcaseIcon, ClockIcon, MapPinIcon, PhoneIcon } from 'lucide-react'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import {
  DirAiAssist,
  DirExitList,
  DirKv,
  DirNote,
  DirSec,
  DirState,
  DirSteps,
  DirStripItem,
  isHttpErrorStatus,
} from '../../components/qingxu/directory/DirectoryBits'
import '../../components/qingxu/directory/directory-qx.css'
import { getTerminalCode } from '../../services/api/terminalConfig'
import {
  getOfflineAgencyById,
  type OfflineAgencyDetailDTO,
} from '../../services/api/offlineAgencies'

const BOUNDARY = '本机只做机构信息展示、门店指引和材料打印：不代收简历、不代投递，也不记录你到店后的结果。'

function offlineJobTypeLabel(jobType?: string): string {
  if (jobType === 'parttime') return '兼职'
  if (jobType === 'internship' || jobType === 'intern') return '实习'
  if (jobType === 'fulltime') return '全职'
  return '以机构公示为准'
}

function salaryText(job: OfflineAgencyDetailDTO['jobs'][number]): string {
  if (job.salaryMin != null && job.salaryMax != null) return `${job.salaryMin}-${job.salaryMax} 元/月`
  if (job.salaryMin != null) return `${job.salaryMin} 元起/月`
  return '薪资面议'
}

export default function OfflineAgencyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [agency, setAgency] = useState<OfflineAgencyDetailDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) {
      setError('机构不存在或未发布')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    getOfflineAgencyById(id)
      .then((res) => { if (!cancelled) setAgency(res) })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '机构详情加载失败，请稍后重试')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  const notFound = !loading && (isHttpErrorStatus(error, 404) || (!error && !agency) || error === '机构不存在或未发布')
  const failed = !loading && Boolean(error) && !notFound
  const jobs = agency && Array.isArray(agency.jobs) ? agency.jobs : []
  const jobsEmpty = Boolean(agency) && jobs.length === 0
  const uiState = loading ? 'agency-loading' : failed ? 'agency-error' : notFound ? 'agency-not-found' : jobsEmpty ? 'agency-jobs-empty' : 'agency-ready'
  const pill = loading
    ? { tone: 'unknown' as const, label: '正在读取机构详情' }
    : failed
      ? { tone: 'bad' as const, label: '机构详情读取失败' }
      : notFound
        ? { tone: 'warn' as const, label: '机构未发布或链接已失效' }
        : jobsEmpty
          ? { tone: 'warn' as const, label: '机构已发布 · 当前岗位为 0' }
          : { tone: 'ok' as const, label: '机构资料 · 以门店公示为准' }

  const reload = () => {
    if (!id) return
    setLoading(true)
    setError(null)
    getOfflineAgencyById(id)
      .then(setAgency)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '机构详情加载失败，请稍后重试'))
      .finally(() => setLoading(false))
  }

  return (
    <QxPageFrame
      // 稿 42 的目录页返回「岗位服务」；本页是它的详情段，返回落到目录本身。
      back={{ label: '返回机构列表', onBack: () => navigate('/offline-agencies') }}
      title={agency?.name ?? '机构详情'}
      subtitle={
        loading ? '正在读取机构资料和岗位清单。'
          : failed ? '详情请求失败，不用缓存或示例内容顶替。'
            : notFound ? '未发布、已下架或链接过期，回目录重选一次。'
              : jobsEmpty ? '机构资料可用，但当前没有已发布岗位。到店咨询办理。'
                : '地址、营业时间和服务项目以机构依法公示为准。到店咨询办理。'
      }
      status={pill}
      terminalLabel={getTerminalCode() || '设备未绑定'}
      ctabar={
        failed ? (
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/jobs-service')}>返回岗位服务</button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={reload}>重新加载</button>
          </>
        ) : notFound ? (
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/jobs-service')}>返回岗位服务</button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/offline-agencies')}>回机构目录重选</button>
          </>
        ) : jobsEmpty ? (
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/offline-agencies')}>返回机构目录</button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/jobs')}>去看岗位信息</button>
          </>
        ) : (
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/offline-agencies')}>返回机构目录</button>
            <button
              type="button"
              className="qx-btn"
              data-variant="primary"
              onClick={() => { if (jobs[0]) navigate(`/jobs/${jobs[0].id}/offline`) }}
            >
              查看该机构岗位
            </button>
          </>
        )
      }
      navbar={<QxAppNavbar onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />}
    >
      <div className="dw-page qx-grow" data-state={uiState} data-testid={`offline-agency-state-${uiState}`}>
        {loading ? (
          <DirState tone="info" testId="offline-agency-agency-loading" title="正在读取机构详情">取到之前不显示机构名称、岗位数量或收录状态。</DirState>
        ) : failed ? (
          <>
            <DirState tone="error" testId="offline-agency-agency-error" title="机构详情读取失败">
              这次没有取到机构资料和岗位清单，本机不会显示上一次缓存冒充当前结果。可以重试；目录仍可继续使用。
            </DirState>
            <DirExitList>
              <DirStripItem icon={BuildingIcon} title="重新加载机构详情" desc="再次请求当前机构" onClick={reload} />
              <DirStripItem icon={BuildingIcon} tone="slate" title="返回机构目录" desc="保留目录主任务" onClick={() => navigate('/offline-agencies')} />
              <DirStripItem icon={BuildingIcon} tone="wheat" title="联系工作人员" desc="现场核对纸质名单" onClick={() => navigate('/help')} />
            </DirExitList>
          </>
        ) : notFound ? (
          <>
            <DirState tone="empty" testId="offline-agency-agency-missing" title="机构详情不可用">
              这家机构可能未发布、已下架，或这条链接已经过期。本机不会用同名或附近的机构顶替。
            </DirState>
            <DirExitList>
              <DirStripItem icon={BuildingIcon} title="回机构目录" desc="重新检索已发布机构" onClick={() => navigate('/offline-agencies')} />
              <DirStripItem icon={BriefcaseIcon} tone="wheat" title="看岗位信息" desc="第三方来源岗位，带来源与同步时间" onClick={() => navigate('/jobs')} />
              <DirStripItem icon={BuildingIcon} tone="slate" title="联系工作人员" desc="现场按纸质名单帮你确认门店" onClick={() => navigate('/help')} />
            </DirExitList>
            <DirNote>{BOUNDARY}</DirNote>
          </>
        ) : agency ? (
          <>
            <DirSec no="01" title="机构资料" hint="以门店依法公示为准">
              <div className="dw-blk">
                <div className="dw-row-t dw-title-lg">{agency.name}</div>
                <div className="dw-row-sub dw-row-sub-gap">
                  <span><MapPinIcon size={20} aria-hidden />{agency.address}</span>
                  <span><ClockIcon size={20} aria-hidden />{agency.hours || '服务时间以机构公示为准'}</span>
                  {agency.phone ? <span><PhoneIcon size={20} aria-hidden />{agency.phone}</span> : null}
                </div>
                <DirKv rows={[
                  ['机构类型', agency.type],
                  ['服务项目', (Array.isArray(agency.services) ? agency.services : []).join('、') || '以门店公示为准'],
                  ['营业时间', agency.hours || '服务时间以机构公示为准'],
                  ['联系电话', agency.phone || '请至前台咨询'],
                  ['机构地址', agency.address],
                  ['来源编号', agency.orgCode || '来源平台未提供'],
                  ['收录状态', '机构信息已审核'],
                ]} />
                <div className="dw-reason">没有可核对的资质字段时，这里不展示资质核验或收录状态结论。</div>
              </div>
            </DirSec>
            <DirSec no="02" title="该机构的岗位" hint={jobsEmpty ? '真实返回 0 条' : '只列已发布岗位'} grow>
              {jobsEmpty ? (
                <div className="dw-rbox">
                  <DirState tone="empty" testId="offline-agency-agency-jobs-empty" title="该机构当前没有已发布岗位">
                    这是岗位列表真实返回为空，不代表机构详情失效。可以到店咨询服务项目，或回岗位信息查看其他来源。
                  </DirState>
                </div>
              ) : (
                <div className="dw-rbox">
                  <div className="dw-rhead">
                    <span className="rn">已发布岗位</span>
                    <span>共 {jobs.length} 条</span>
                    <span className="rsp">岗位由机构发布，本机不代投递</span>
                  </div>
                  <div className="dw-rlist">
                    {jobs.map((job) => (
                      <button key={job.id} type="button" className="dw-row solid" onClick={() => navigate(`/jobs/${job.id}/offline`)} aria-label={`查看岗位 ${job.title}`}>
                        <span className="dw-row-ic" aria-hidden><BriefcaseIcon size={30} /></span>
                        <span className="dw-row-main">
                          <span className="dw-row-t">{job.title}</span>
                          <span className="dw-row-sub">
                            <span><MapPinIcon size={20} aria-hidden />{job.location || agency.address}</span>
                            <span>{offlineJobTypeLabel(job.jobType)}</span>
                            <span>{salaryText(job)}</span>
                          </span>
                        </span>
                        <span className="dw-row-go" aria-hidden>›</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </DirSec>
            <DirSec no="03" title="到店咨询" hint="费用以门店公示为准">
              <div className="dw-blk">
                <DirSteps items={[
                  '看清门店地址与营业时间，营业时间以机构公示为准。',
                  '带上本人材料，自行前往门店咨询岗位。',
                  '服务收费以门店依法公示为准，本机不代收任何费用。',
                ]} />
                <div className="dw-reason">{BOUNDARY}</div>
              </div>
              {jobsEmpty ? <DirNote>{BOUNDARY}</DirNote> : (
                <DirAiAssist screen="offline-agency" onProfile={() => navigate('/profile')} onAssistant={() => navigate('/assistant')} />
              )}
            </DirSec>
          </>
        ) : null}
      </div>
    </QxPageFrame>
  )
}
