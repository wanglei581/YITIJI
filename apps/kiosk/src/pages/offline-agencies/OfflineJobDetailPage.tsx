import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, ErrorState, LoadingState } from '@ai-job-print/ui'
import { BuildingIcon, MapPinIcon, PrinterIcon } from 'lucide-react'
import {
  getOfflineJobDetail,
  type OfflineJobDetailDTO,
} from '../../services/api/offlineAgencies'
import { FusionNotice, FusionSourceMeta, KioskPageFrame } from '../jobs/components/W4Presentation'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { isValidSourceUrl } from '../../lib/url'
import { SOURCE_ELEMENT_MISSING_TEXT } from '../jobs/utils/sourceTrust'

export default function OfflineJobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [job, setJob] = useState<OfflineJobDetailDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (!id) {
      setError('岗位不存在')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    getOfflineJobDetail(id)
      .then((result) => { if (!cancelled) setJob(result) })
      .catch(() => { if (!cancelled) setError('岗位信息加载失败，请重试') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, retryKey])

  if (loading) return <LoadingState />
  if (error || !job) {
    return <ErrorState message={error ?? '岗位不存在'} onRetry={() => setRetryKey((key) => key + 1)} />
  }

  const services = '以机构公示为准'
  const sourceUrlOk = isValidSourceUrl(job.sourceUrl)

  const jobTypeLabel = job.jobType === 'fulltime'
    ? '全职'
    : job.jobType === 'parttime'
      ? '兼职'
      : job.jobType === 'internship' || job.jobType === 'intern'
        ? '实习'
        : '以机构公示为准'

  return (
    <KioskPageFrame
      tone="clay"
      title="线下机构岗位"
      subtitle="来源机构发布的岗位信息与到店指引 · 本系统不代收简历"
      backLabel="返回"
      onBack={() => navigate(-1)}
      actionBar={(
        <>
          <Button size="lg" variant="secondary" onClick={() => navigate('/offline-agencies')}>
            <BuildingIcon aria-hidden="true" />
            查看来源机构门店
          </Button>
          <Button size="lg" onClick={() => navigate('/print/upload')}>
            <PrinterIcon aria-hidden="true" />
            上传自备材料打印
          </Button>
        </>
      )}
    >
      <section className="oa-job-sum" aria-label="岗位概要">
        <div className="oa-job-sum-head">
          <div className="min-w-0 flex-1">
            <h2>{job.title}</h2>
            <div className="oa-job-sum-meta">
              {job.location && (
                <span><MapPinIcon aria-hidden="true" size={20} />{job.location}</span>
              )}
              <span><BuildingIcon aria-hidden="true" size={20} />{job.agencyName}</span>
            </div>
          </div>
          <span className="oa-job-type">{jobTypeLabel}</span>
        </div>

        <div className="oa-metrics" aria-label="岗位指标">
          <div className="is-accent"><span>薪资待遇</span><b>{job.salary || '薪资面议'}</b></div>
          <div><span>工作地点</span><b>{job.location || '以机构公示为准'}</b></div>
          <div><span>岗位类型</span><b>{jobTypeLabel}</b></div>
          <div><span>来源机构</span><b>{job.agencyName}</b></div>
        </div>

        {job.tags && job.tags.length > 0 && (
          <div className="jf-row-sub">
            {job.tags.map((tag) => (
              <span key={tag} className="jf-chip">{tag}</span>
            ))}
          </div>
        )}
      </section>

      <section className="jf-card accented compact" aria-label="数据来源">
        <h3>数据来源</h3>
        <FusionSourceMeta
          sourceName={job.agencyName || SOURCE_ELEMENT_MISSING_TEXT}
          syncTime={job.syncTime}
          externalId={job.externalId || SOURCE_ELEMENT_MISSING_TEXT}
        />
        <p className="mt-3 text-[18px] leading-relaxed text-[var(--muted)]">
          外部投递链接 <b className="break-all text-[var(--ink)]">{sourceUrlOk ? job.sourceUrl : SOURCE_ELEMENT_MISSING_TEXT}</b>
        </p>
        {sourceUrlOk ? (
          <div className="mt-4 flex justify-center">
            <SourceUrlQr value={job.sourceUrl} size={160} />
          </div>
        ) : null}
        <FusionNotice>
          岗位信息由来源机构提供。本系统仅作展示与到店指引，不代收简历、不代投递；办理请以来源机构或来源平台为准。
        </FusionNotice>
      </section>

      <div className="oa-desc-grid">
        <section className="oa-desc-card" aria-label="任职要求">
          <h3>任职要求</h3>
          {job.requirements && job.requirements.length > 0 ? (
            <ul>
              {job.requirements.map((req) => (
                <li key={req}>{req}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[color:var(--muted)]">暂无任职要求说明，请来源机构门店咨询。</p>
          )}
        </section>
        <section className="oa-desc-card" aria-label="工作职责">
          <h3>工作职责</h3>
          {job.responsibilities && job.responsibilities.length > 0 ? (
            <ul>
              {job.responsibilities.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[color:var(--muted)]">暂无职责说明，请来源机构门店咨询。</p>
          )}
        </section>
      </div>

      <section className="oa-agency-zone" aria-label="发布机构">
        <div>
          <h3>发布机构</h3>
          <div className="oa-kv">
            {[
              ['机构名称', job.agencyName],
              ['机构类型', job.agencyType],
              ['服务项目', services],
              ['营业时间', job.agencyHours || '以机构公示为准'],
              ['联系电话', job.agencyPhone || '请至前台咨询'],
              ['机构地址', job.agencyAddress],
            ].map(([k, v]) => (
              <div key={k}><span>{k}</span><b>{v}</b></div>
            ))}
          </div>
        </div>
        <aside className="oa-guide">
          <h3>到店指引</h3>
          <p>{job.agencyAddress}</p>
          <ol className="oa-guide-steps">
            <li><span>1</span>确认机构营业时间与联系电话</li>
            <li><span>2</span>携带本人材料前往门店咨询岗位</li>
            <li><span>3</span>服务费用以门店依法公示为准</li>
          </ol>
          <FusionNotice>到店咨询，服务费用以现场公示为准</FusionNotice>
        </aside>
      </section>

      <FusionNotice>
        本页面仅展示来源机构发布的岗位信息与到店指引，本系统不代收简历、不代投递。
        如需了解岗位详情，请直接前往该机构咨询。
      </FusionNotice>
    </KioskPageFrame>
  )
}
