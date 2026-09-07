import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BuildingIcon, MapPinIcon, PrinterIcon } from 'lucide-react'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import {
  DirAiAssist,
  DirKv,
  DirMiss,
  DirNote,
  DirSec,
  DirState,
  DirSteps,
  DirStrip,
  DirStripItem,
  DirTiles,
} from '../../components/qingxu/directory/DirectoryBits'
import '../../components/qingxu/directory/directory-qx.css'
import { JobAntiFraudNotice } from '../jobs/components/JobAntiFraudNotice'
import { evaluateJobSourceTrust, SOURCE_ELEMENT_MISSING_TEXT, sourceTrustReason } from '../jobs/utils/sourceTrust'
import { SOURCE_APPLY_UNAVAILABLE_REASON } from '../../lib/capabilityReasons'
import { getTerminalCode } from '../../services/api/terminalConfig'
import {
  getOfflineJobDetail,
  type OfflineJobDetailDTO,
} from '../../services/api/offlineAgencies'

const BOUNDARY = '本机只做机构信息展示、门店指引和材料打印：不代收简历、不代投递，也不记录你到店后的结果。'

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

  const trust = job
    ? evaluateJobSourceTrust({
      sourceName: job.agencyName,
      syncTime: job.syncTime,
      externalId: job.externalId,
      sourceUrl: job.sourceUrl,
    })
    : null
  const storeReady = Boolean(job?.agencyAddress && (job.agencyId || job.externalId))
  const incomplete = Boolean(job && trust && !trust.ok)
  const uiState = loading ? 'job-loading' : error || !job ? 'job-error' : incomplete ? 'job-source-incomplete' : 'job-ready'
  const pill = incomplete
    ? { tone: 'bad' as const, label: '来源要素不完整 · 已停用外跳' }
    : error
      ? { tone: 'bad' as const, label: '岗位信息读取失败' }
      : loading
        ? { tone: 'unknown' as const, label: '正在读取线下岗位' }
        : { tone: 'ok' as const, label: '线下岗位 · 自行到店咨询' }

  const jobTypeLabel = job?.jobType === 'fulltime' ? '全职'
    : job?.jobType === 'parttime' ? '兼职'
      : job?.jobType === 'internship' || job?.jobType === 'intern' ? '实习'
        : '以机构公示为准'

  const blockedReasonId = 'offline-job-store-blocked'
  const applyReason = trust ? sourceTrustReason(trust, SOURCE_APPLY_UNAVAILABLE_REASON) : SOURCE_APPLY_UNAVAILABLE_REASON

  return (
    <QxPageFrame
      title="线下机构岗位"
      subtitle={incomplete ? '缺少可核对的来源要素，外跳和到店指引一律不给。' : '先看岗位信息，再决定要不要自行到店咨询。'}
      status={pill}
      terminalLabel={getTerminalCode() || '设备未绑定'}
      ctabar={
        incomplete ? (
          <>
            <button
              type="button"
              className="qx-btn"
              data-variant="ghost"
              aria-disabled={!storeReady || undefined}
              aria-describedby={!storeReady ? blockedReasonId : undefined}
              onClick={() => { if (storeReady && job) navigate(`/offline-agencies/${job.agencyId}`) }}
            >
              查看来源机构门店
            </button>
            {!storeReady ? <span id={blockedReasonId} className="why">缺少门店地址与来源编号，无法给出到店指引</span> : null}
            <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/offline-agencies')}>回机构目录</button>
          </>
        ) : (
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => job && navigate(`/offline-agencies/${job.agencyId}`)}>
              <BuildingIcon aria-hidden size={22} />
              查看来源机构门店
            </button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/print/upload')}>
              <PrinterIcon aria-hidden size={22} />
              上传自备材料打印
            </button>
          </>
        )
      }
      navbar={<QxAppNavbar onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />}
    >
      <div className="dw-page qx-grow" data-state={uiState} data-testid={`offline-agency-state-${uiState}`}>
        {loading ? (
          <DirState tone="info" testId="offline-job-loading" title="正在读取线下岗位">取到之前不显示岗位名称或来源编号。</DirState>
        ) : error || !job || !trust ? (
          <DirState tone="error" testId="offline-job-error" title="岗位信息加载失败">
            <button type="button" className="dw-chip" onClick={() => setRetryKey((key) => key + 1)}>重试</button>
          </DirState>
        ) : (
          <>
            <JobAntiFraudNotice />
            <DirSec no="01" title="岗位概要" hint={incomplete ? '只显示已返回的字段' : '字段以来源机构发布为准'}>
              <div className="dw-blk">
                <div className="dw-row-t">
                  <h2>{job.title}</h2>
                  <span className={`dw-tag${incomplete ? ' wheat' : ''}`}>{incomplete ? '来源要素不足' : '线下岗位'}</span>
                </div>
                <div className="dw-row-sub">
                  {job.location ? <span><MapPinIcon size={20} aria-hidden />{job.location}</span> : null}
                  <span><BuildingIcon size={20} aria-hidden />{job.agencyName || '来源机构 未返回'}</span>
                </div>
                <DirTiles items={[
                  { label: '薪资待遇', value: job.salary || '薪资面议', accent: true },
                  { label: '岗位类型', value: jobTypeLabel },
                  { label: '学历要求', value: job.tags.find((tag) => tag.startsWith('学历'))?.replace('学历：', '') || '到门店咨询' },
                  { label: '来源机构', value: job.agencyName || SOURCE_ELEMENT_MISSING_TEXT },
                ]} />
                <p className="dw-reason">到店咨询，服务项目<span>以机构公示为准</span></p>
              </div>
            </DirSec>

            <DirSec no="02" title="岗位要求" hint="来源机构没发布就写「到门店咨询」">
                  <div className="dw-grid2">
                    <div className="dw-blk">
                      <div className="qx-state-t">任职要求</div>
                      {job.requirements.length > 0 ? (
                        <ul>{job.requirements.map((req) => <li key={req}>{req}</li>)}</ul>
                      ) : (
                        <p className="dw-reason">暂无任职要求说明，请到门店咨询。</p>
                      )}
                    </div>
                    <div className="dw-blk">
                      <div className="qx-state-t">工作职责</div>
                      {job.responsibilities.length > 0 ? (
                        <ul>{job.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul>
                      ) : (
                        <p className="dw-reason">暂无职责说明，请到门店咨询。</p>
                      )}
                    </div>
                  </div>
            </DirSec>
            {incomplete ? (
              <DirSec title="来源核对" hint="缺一项就不给外跳" grow>
                <DirState tone="error" testId="offline-agency-source-incomplete" title="来源信息不完整 · 已停用外跳">
                  这条线下岗位没有凑齐可核对的来源要素，本机不提供外跳、扫码或到店指引。
                </DirState>
                <div className="dw-blk">
                  <DirMiss items={trust.missingLabels.map((label) => `${label} —— 未返回`)} />
                  <div className="dw-reason">{applyReason} 线下岗位没有代收简历这条路：本机既不代收简历也不代投递。</div>
                </div>
              </DirSec>
            ) : (
              <DirSec no="03" title="发布机构与到店指引" hint="来源三要素齐了才给到店指引">
                  <div className="dw-grid2">
                    <div className="dw-blk">
                      <DirKv rows={[
                        ['机构名称', job.agencyName],
                        ['机构类型', job.agencyType],
                        ['营业时间', job.agencyHours || '以机构公示为准'],
                        ['联系电话', job.agencyPhone || '请至前台咨询'],
                        ['服务项目', '以机构公示为准'],
                        ['机构地址', job.agencyAddress],
                        ['来源编号', job.externalId || SOURCE_ELEMENT_MISSING_TEXT],
                        ['来源机构', job.agencyName || SOURCE_ELEMENT_MISSING_TEXT],
                        ['同步时间', job.syncTime || SOURCE_ELEMENT_MISSING_TEXT],
                        ['外部ID', job.externalId || SOURCE_ELEMENT_MISSING_TEXT],
                        ['外部投递链接', job.sourceUrl || SOURCE_ELEMENT_MISSING_TEXT],
                      ]} />
                      <div className="dw-reason">数据来源说明：岗位与机构字段由来源机构发布并经管理员审核，本机只做展示，不改写、不补写。</div>
                    </div>
                    <div className="dw-blk">
                      <DirSteps items={[
                        '先核对地址、营业时间和收费公示。',
                        '带上本人材料，自行前往门店咨询。',
                        '岗位要求没发布时，先向门店确认再准备材料。',
                      ]} />
                      <div className="dw-reason">{BOUNDARY}</div>
                    </div>
                  </div>
              </DirSec>
            )}

            {incomplete ? (
              <DirSec no="03" title="现在可以怎么办" hint="两条真的能走的路">
                <DirStrip>
                  <DirStripItem icon={BuildingIcon} title="回机构目录重新找" desc="目录里的机构带地址与来源编号" onClick={() => navigate('/offline-agencies')} />
                  <DirStripItem icon={PrinterIcon} tone="wheat" title="先把材料打好" desc="不依赖这条岗位信息" onClick={() => navigate('/print/upload')} />
                </DirStrip>
              </DirSec>
            ) : (
              <DirAiAssist screen="offline-agency" onProfile={() => navigate('/profile')} onAssistant={() => navigate('/assistant')} />
            )}
            <DirNote>{BOUNDARY}</DirNote>
          </>
        )}
      </div>
    </QxPageFrame>
  )
}
