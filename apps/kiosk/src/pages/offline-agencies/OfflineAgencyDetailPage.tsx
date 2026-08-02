import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ErrorState, LoadingState } from '@ai-job-print/ui'
import { BuildingIcon, ClockIcon, MapPinIcon, PhoneIcon } from 'lucide-react'
import {
  getOfflineAgencyById,
  type OfflineAgencyDetailDTO,
} from '../../services/api/offlineAgencies'
import { FusionNotice, KioskPageFrame } from '../jobs/components/W4Presentation'

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
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getOfflineAgencyById(id)
      .then((res) => { if (!cancelled) setAgency(res) })
      .catch(() => { if (!cancelled) setError('机构详情加载失败，请稍后重试') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  if (loading) return <LoadingState className="flex-1" />
  if (error || !agency) {
    return <ErrorState message={error ?? '机构不存在或未发布'} onRetry={() => navigate('/offline-agencies')} />
  }

  const services = Array.isArray(agency.services) ? agency.services : []
  const jobs = Array.isArray(agency.jobs) ? agency.jobs : []
  const isOpen = agency.status === 'open'

  return (
    <KioskPageFrame
      tone="clay"
      title={agency.name}
      subtitle={`${agency.district || '本地'} · 到店咨询办理`}
      backLabel="返回机构列表"
      onBack={() => navigate('/offline-agencies')}
    >
      <div className="jf-row oa-agency-row" style={{ cursor: 'default' }}>
        <span className="oa-ag-logo" aria-hidden="true"><BuildingIcon /></span>
        <div className="jf-row-main">
          <div className="jf-row-title">
            <span className="oa-ag-type">{agency.district || '本地机构'}</span>
            <span className={`oa-st ${isOpen ? 'open' : 'rest'}`}>
              <i className="oa-dot" aria-hidden="true" />
              {agency.statusLabel || (isOpen ? '服务中' : '暂停服务')}
            </span>
          </div>
          <div className="jf-row-info">
            <span><MapPinIcon aria-hidden="true" />{agency.address}</span>
            <span><ClockIcon aria-hidden="true" />{agency.hours || '以门店公告为准'}</span>
            {agency.phone ? <span><PhoneIcon aria-hidden="true" />{agency.phone}</span> : null}
          </div>
          <div className="jf-row-sub">
            {services.map((svc) => <span key={svc} className="jf-chip">{svc}</span>)}
            <span className="jf-chip src">来源编号 {agency.orgCode}</span>
            <span className="jf-chip ok">资质核验已通过</span>
          </div>
        </div>
        <div className="oa-r-aside">
          <div className="oa-jobs-n">{agency.jobCount ?? jobs.length}</div>
          <div className="oa-jobs-t">岗位</div>
        </div>
      </div>

      {agency.description ? (
        <div className="jf-notice" style={{ alignItems: 'flex-start' }}>
          <span style={{ fontSize: 20, lineHeight: 1.55 }}>{agency.description}</span>
        </div>
      ) : null}

      <div className="jf-list-meta">
        <span>门店岗位 <b>{jobs.length}</b> 个 · 请到店咨询，本终端不代收简历</span>
      </div>

      <div className="jf-list">
        {jobs.length === 0 ? (
          <div className="oa-empty">
            <BuildingIcon aria-hidden="true" />
            <b>暂无岗位信息</b>
            <span>可稍后回来查看，或直接到店咨询最新岗位。</span>
          </div>
        ) : jobs.map((job) => (
          <button
            key={job.id}
            type="button"
            className="jf-row"
            onClick={() => navigate(`/jobs/${job.id}/offline`)}
            aria-label={`查看岗位 ${job.title}`}
          >
            <div className="jf-row-main">
              <div className="jf-row-title">
                <b>{job.title}</b>
                <span className="jf-kind">{job.jobType === 'parttime' ? '兼职' : job.jobType === 'intern' ? '实习' : '全职'}</span>
              </div>
              <div className="jf-row-info">
                <span>{job.location || agency.address}</span>
                <span className="jf-salary">{salaryText(job)}</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <FusionNotice>
        岗位咨询与应聘请前往机构门店办理；本终端只提供信息展示与到店指引，不代收简历、不代收费用。
      </FusionNotice>
    </KioskPageFrame>
  )
}
