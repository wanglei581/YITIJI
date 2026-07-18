import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ErrorState, LoadingState } from '@ai-job-print/ui'
import { ArrowLeftIcon, BuildingIcon, ClockIcon, MapPinIcon, PhoneIcon } from 'lucide-react'
import {
  getOfflineJobDetail,
  type OfflineJobDetailDTO,
} from '../../services/api/offlineAgencies'
import { ProtoPage, ProtoNotice } from '../jobs-fairs-prototype'

export default function OfflineJobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [job, setJob] = useState<OfflineJobDetailDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    getOfflineJobDetail(id)
      .then(setJob)
      .catch(() => setError('岗位信息加载失败，请重试'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <LoadingState />
  if (error || !job) return <ErrorState message={error ?? '岗位不存在'} onRetry={() => navigate(-1)} />

  const services = Array.isArray(job.agencyServices)
    ? job.agencyServices.join('、')
    : (job.agencyServices as string) || '综合人力资源服务'

  const jobTypeLabel = job.jobType === 'fulltime' ? '全职' : job.jobType === 'parttime' ? '兼职' : '实习'

  return (
    <ProtoPage
      tone="clay"
      title="线下机构岗位"
      subtitle={job.agencyName}
      onBack={() => navigate(-1)}
    >
      {/* 岗位基本信息 */}
      <div className="card" style={{ padding: '24px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 22 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontFamily: 'var(--serif)', fontSize: 36, fontWeight: 900 }}>{job.title}</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 26px', marginTop: 12, fontSize: 21, color: 'var(--muted)' }}>
              {job.location && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <MapPinIcon size={20} style={{ opacity: .7 }} /> {job.location}
                </span>
              )}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <BuildingIcon size={20} style={{ opacity: .7 }} /> {job.agencyName}
              </span>
            </div>
          </div>
          <span style={{
            padding: '4px 18px', borderRadius: 999, fontSize: 18, fontWeight: 600,
            background: 'var(--clay-soft)', color: 'var(--clay-deep)', border: '1px solid rgba(180,100,40,.2)'
          }}>
            {jobTypeLabel}
          </span>
        </div>

        {/* 薪资等关键指标 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginTop: 20 }}>
          {[
            { k: '薪资待遇', v: job.salary || '薪资面议', highlight: true },
            { k: '工作地点', v: job.location || '以机构公示为准' },
          ].map(({ k, v, highlight }) => (
            <div key={k} style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: '14px 18px' }}>
              <div style={{ fontSize: 17, color: 'var(--muted)' }}>{k}</div>
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: highlight ? 'var(--clay-deep)' : 'inherit' }}>{v}</div>
            </div>
          ))}
        </div>

        {/* 标签 */}
        {job.tags && job.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
            {job.tags.map(tag => (
              <span key={tag} style={{ padding: '3px 12px', borderRadius: 999, fontSize: 17, background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink)' }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* 任职要求 */}
        {job.requirements && job.requirements.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12, color: 'var(--clay-deep)' }}>任职要求</h3>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {job.requirements.map((req, i) => (
                <li key={i} style={{ fontSize: 20, lineHeight: 1.5, color: 'var(--ink)', display: 'flex', gap: 10 }}>
                  <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: 'var(--clay)', marginTop: 11 }} />
                  {req}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 职责说明 */}
        {job.responsibilities && job.responsibilities.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12, color: 'var(--clay-deep)' }}>工作职责</h3>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {job.responsibilities.map((r, i) => (
                <li key={i} style={{ fontSize: 20, lineHeight: 1.5, color: 'var(--ink)', display: 'flex', gap: 10 }}>
                  <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: 'var(--clay)', marginTop: 11 }} />
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 发布机构 */}
      <div className="card" style={{ padding: 28 }}>
        <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20, color: 'var(--clay-deep)' }}>发布机构</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20, alignItems: 'stretch' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { k: '机构名称', v: job.agencyName },
              { k: '机构类型', v: job.agencyType },
              { k: '服务项目', v: services },
              { k: '营业时间', v: job.agencyHours || '请来电咨询' },
              { k: '联系电话', v: job.agencyPhone || '请至前台咨询' },
              { k: '机构地址', v: job.agencyAddress },
            ].map(({ k, v }) => (
              <div key={k} style={{ display: 'flex', gap: 14, fontSize: 21, alignItems: 'baseline' }}>
                <span style={{ flex: 'none', width: 128, color: 'var(--muted)', fontSize: 19 }}>{k}</span>
                <span style={{ fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>

          {/* 到店指引面板 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: '24px 26px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <MapPinIcon size={22} style={{ color: 'var(--clay-deep)' }} />
              <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--clay-deep)' }}>到店指引</span>
            </div>
            <p style={{ fontSize: 19, lineHeight: 1.6, color: 'var(--ink)' }}>{job.agencyAddress}</p>
            {job.agencyPhone && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 19, color: 'var(--muted)', marginTop: 8 }}>
                <PhoneIcon size={17} style={{ opacity: .7 }} />
                <span>致电预约：<strong style={{ color: 'var(--ink)' }}>{job.agencyPhone}</strong></span>
              </div>
            )}
            {job.agencyHours && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 19, color: 'var(--muted)' }}>
                <ClockIcon size={17} style={{ opacity: .7 }} />
                <span>营业时间：{job.agencyHours}</span>
              </div>
            )}
            <ProtoNotice>到店咨询，服务费用以现场公示为准</ProtoNotice>
          </div>
        </div>
      </div>

      {/* 合规说明 */}
      <ProtoNotice>
        本页面仅展示来源机构发布的岗位信息与到店指引，本系统不代收简历、不代投递。
        如需了解岗位详情，请直接前往该机构咨询。
      </ProtoNotice>

      {/* 底部操作栏 */}
      <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
        <button
          onClick={() => navigate(-1)}
          style={{ minHeight: 64, padding: '0 32px', fontSize: 21, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', cursor: 'pointer' }}
        >
          <ArrowLeftIcon size={22} /> 返回
        </button>
        <button
          style={{ flex: 1, minHeight: 64, background: 'var(--clay)', color: '#fff', border: 'none', borderRadius: 'var(--r-md)', fontSize: 24, fontWeight: 700, cursor: 'pointer' }}
          onClick={() => alert('打印功能即将上线')}
        >
          打印岗位信息带走
        </button>
      </div>
    </ProtoPage>
  )
}
