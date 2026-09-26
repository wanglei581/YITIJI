// /job-fairs/checkin —— 到场指引（稿 28-jobfair-enhanced.html，screen=checkin / 085）。
//
// 稿的真话边界第 ①：「本机不做签到，也拿不到签到回执：checkin 只给到场指引，
// 永不显示任何签到结果类文案。」本页因此只做两件事：
// （此处不复述那几个被禁的词面——verify:jobfair-checkin 是纯文本扫描，
//   连注释一起查；把禁词写进注释会让门禁在没有真实违规时红。）
//   1. 列出**服务端真的返回了 checkinUrl** 的进行中 / 即将开始场次；
//   2. 把那个 URL 变成二维码，让用户用手机去来源平台办。
// 不查个人预约记录、不判断你是否已签到、不缓存二维码。
//
// 状态：guide | qr | empty | error（与稿同名）。

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ExternalJobFairDTO } from '@ai-job-print/shared'
import {
  BuildingIcon,
  CalendarIcon,
  FootprintsIcon,
  InfoIcon,
  MapPinIcon,
  PrinterIcon,
  QrCodeIcon,
  UsersIcon,
} from 'lucide-react'
import { getJobFairs, getTerminalId } from '../../services/api'
import { recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { SOURCE_ELEMENT_MISSING_TEXT, evaluateJobSourceTrust, sourceTrustReason } from '../jobs/utils/sourceTrust'
import { FAIR_CHECKIN_LINK_UNAVAILABLE_REASON } from '../../lib/capabilityReasons'
import { QxFairWorkbench } from './QxFairWorkbench'
import { FAIR_NOTICE_RULES } from './fairWorkbenchSpecs'
import { FairQrOverlay, FairSkeletonList } from './components/FairWorkbenchBits'
import { fmtFairDateTime } from './fairFormat'
import {
  DirKv,
  DirNote,
  DirSteps,
  DirState,
  DirStrip,
  DirStripItem,
} from '../../components/qingxu/directory/DirectoryBits'

/**
 * 入场入口卡。
 *
 * 放行判据是**来源四要素**（来源机构 / 同步时间 / 外部ID / 入场链接），不是只看链接能不能解析：
 * 一个连来源机构或同步时间都对不上的场次，本机没有能力告诉用户这个入口是不是这场的。
 * 要素不全时按钮仍在（保持版面与可发现性）但 aria-disabled 且点击不出码，缺哪几项常显在旁边。
 */
function CheckinEntryCard({
  fair,
  onOpenQr,
  onDetail,
}: {
  fair: ExternalJobFairDTO
  onOpenQr: () => void
  onDetail: () => void
}) {
  const trust = checkinTrustOf(fair)
  const blockedReason = trust.ok ? '' : sourceTrustReason(trust, FAIR_CHECKIN_LINK_UNAVAILABLE_REASON, 'job_fair')
  return (
    <article className="qxfw-fair" data-testid={`fair-checkin-card-${fair.id}`}>
      <span className="qxfw-fair-ic"><QrCodeIcon size={28} aria-hidden /></span>
      <div className="qxfw-fair-main">
        <h2 className="qxfw-fair-t">
          {fair.name}
          <span className={fair.status === 'ongoing' ? 'dw-tag' : 'dw-tag wheat'}>
            {fair.status === 'ongoing' ? '进行中' : '即将开始'}
          </span>
        </h2>
        <div className="qxfw-fair-meta">
          <span><CalendarIcon size={19} aria-hidden />{fmtFairDateTime(fair.startTime)}</span>
          <span><MapPinIcon size={19} aria-hidden />{fair.city ? `${fair.city} · ` : ''}{fair.venue}</span>
        </div>
        {/* 缺项显示「来源平台未提供」而不是留白：这几项正是签到被拦下的原因，
            按钮旁的阻断说明点名的就是它们，卡片这边要能对上号。 */}
        <div className="qxfw-fair-src">
          <span>来源 {fair.sourceName?.trim() || SOURCE_ELEMENT_MISSING_TEXT}</span>
          <span>外部编号 {fair.externalId?.trim() || SOURCE_ELEMENT_MISSING_TEXT}</span>
        </div>
        <p className="dw-why">
          请使用手机扫码前往来源平台签到。本系统不记录签到结果，请以来源平台显示为准。
        </p>
      </div>
      <div className="qxfw-fair-acts">
        <button
          type="button"
          className="qx-btn"
          data-variant="primary"
          aria-disabled={blockedReason ? true : undefined}
          aria-describedby={blockedReason ? `fair-checkin-blocked-${fair.id}` : undefined}
          onClick={onOpenQr}
        >
          <QrCodeIcon size={20} aria-hidden />
          扫码签到
        </button>
        {blockedReason ? (
          <span id={`fair-checkin-blocked-${fair.id}`} className="qxfw-blocked">{blockedReason}</span>
        ) : null}
        <button type="button" className="qx-btn" data-variant="ghost" onClick={onDetail}>
          查看详情
        </button>
      </div>
    </article>
  )
}

/** 入场入口的来源四要素：sourceUrl 这一格看的是 checkinUrl。 */
function checkinTrustOf(fair: ExternalJobFairDTO) {
  return evaluateJobSourceTrust({
    sourceName: fair.sourceName,
    syncTime: fair.syncTime,
    externalId: fair.externalId,
    sourceUrl: fair.checkinUrl,
  })
}

export function JobFairCheckinPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [fairs, setFairs] = useState<ExternalJobFairDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [qrFair, setQrFair] = useState<ExternalJobFairDTO | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)

    const terminalId = getTerminalId()
    const base = { pageSize: 100, ...(terminalId ? { terminalId } : {}) }
    Promise.all([
      getJobFairs({ ...base, status: 'ongoing' }),
      getJobFairs({ ...base, status: 'upcoming' }),
    ])
      .then(([ongoing, upcoming]) => {
        if (!alive) return
        const seen = new Set<string>()
        const merged: ExternalJobFairDTO[] = []
        for (const fair of [...ongoing.data, ...upcoming.data]) {
          if (seen.has(fair.id)) continue
          seen.add(fair.id)
          merged.push(fair)
        }
        setFairs(merged)
      })
      .catch(() => {
        if (alive) setError(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [retryKey])

  const availableFairs = useMemo(
    () => fairs.filter((fair) => (fair.status === 'ongoing' || fair.status === 'upcoming') && Boolean(fair.checkinUrl)),
    [fairs],
  )

  const openCheckinQr = (fair: ExternalJobFairDTO) => {
    // fail-closed：要素不全就不记录、也不出码。二维码出屏之后用户已经离开本机，
    // 没有任何补救手段，所以拦截必须发生在这一步而不是事后。
    if (!checkinTrustOf(fair).ok) return
    recordExternalJump(getToken(), 'job_fair', fair.id, 'external_checkin_open')
    setQrFair(fair)
  }

  const uiState = qrFair
    ? 'qr'
    : loading
      ? 'guide'
      : error
        ? 'error'
        : availableFairs.length === 0
          ? 'empty'
          : 'guide'

  const ctabar = uiState === 'error'
    ? (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/help')}>找现场工作人员</button>
        <button type="button" className="qx-btn" data-variant="primary" onClick={() => setRetryKey((v) => v + 1)}>重新加载</button>
      </>
    )
    : uiState === 'empty'
      ? (
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/help')}>询问现场工作人员</button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/job-fairs')}>查看招聘会</button>
        </>
      )
      : (
        <>
          <p className="why">来源平台负责预约、签到与凭证，本机只提供对应场次的来源入口。</p>
          <button type="button" className="qx-btn narrow" data-variant="primary" onClick={() => navigate('/job-fairs')}>
            返回场次列表
          </button>
        </>
      )

  return (
    <QxFairWorkbench screen="checkin" state={uiState} ctabar={ctabar}>
      {qrFair ? (
        <FairQrOverlay
          title="扫码前往来源平台签到"
          subtitle={qrFair.name}
          value={qrFair.checkinUrl}
          meta={[
            { label: '来源机构', value: qrFair.sourceName },
            { label: '外部编号', value: qrFair.externalId },
          ]}
          note="请使用手机扫码到来源平台办理现场签到。本系统不记录签到结果、不接收报名信息或简历。"
          onClose={() => setQrFair(null)}
        />
      ) : null}

      <DirNote warn>
        <b>本机不做签到，也拿不到签到结果。</b>
        这里只列出进行中或即将开始、且服务端已返回 checkinUrl 的场次；不查个人预约记录。
      </DirNote>

      {loading ? (
        <FairSkeletonList rows={2} />
      ) : error ? (
        <>
          <DirState tone="error" testId="fair-checkin-error" title="入场入口列表这次没取到">
            招聘会列表请求失败，所以无法判断哪些场次有可用的 checkinUrl。本机不显示缓存二维码，也不判断你的预约或签到状态。
          </DirState>
          <DirStrip>
            <DirStripItem icon={CalendarIcon} tone="wheat" title="回场次列表" desc="换一场看看时间地点和参展名单" onClick={() => navigate('/job-fairs')} />
            <DirStripItem icon={PrinterIcon} title="先去打印简历" desc="A4 黑白或彩色，参数在打印页选" onClick={() => navigate('/print-scan')} />
          </DirStrip>
        </>
      ) : availableFairs.length === 0 ? (
        <>
          <DirState tone="empty" testId="fair-checkin-empty" title="暂无可展示的来源入场入口">
            当前没有进行中或即将开始、且配置了 checkinUrl 的招聘会。<b>这不代表你未预约</b>，本机不查个人记录。
          </DirState>
          <DirStrip>
            <DirStripItem icon={CalendarIcon} tone="wheat" title="查看招聘会" desc="先看时间地点和参展名单" onClick={() => navigate('/job-fairs')} />
            <DirStripItem icon={InfoIcon} tone="slate" title="询问现场工作人员" desc="入口一般有纸质导览和指示牌" onClick={() => navigate('/help')} />
          </DirStrip>
        </>
      ) : (
        <>
          {availableFairs.map((fair) => (
            <CheckinEntryCard
              key={fair.id}
              fair={fair}
              onOpenQr={() => openCheckinQr(fair)}
              onDetail={() => navigate(`/job-fairs/${fair.id}`, { state: { fair } })}
            />
          ))}

          <section className="dw-blk">
            <div className="dw-sec-h"><span className="t"><FootprintsIcon size={22} aria-hidden /> 到场当天怎么走</span></div>
            <DirSteps items={[
              '点对应场次的「扫码签到」，用手机前往来源平台。',
              '按主办方现场指引排队登记；登记结果以主办方为准，本机查不到。',
              '带好纸质简历；忘带可以在这台机器上打印，价格以现场公示为准。',
            ]} />
          </section>

          <section className="dw-blk">
            <div className="dw-sec-h"><span className="t">去之前先知道这几件事</span></div>
            <DirSteps items={[...FAIR_NOTICE_RULES]} />
          </section>

          <DirStrip>
            <DirStripItem icon={PrinterIcon} title="现在去打印简历" desc="A4 黑白或彩色，参数在打印页选" onClick={() => navigate('/print-scan')} />
            <DirStripItem icon={UsersIcon} tone="slate" title="回场次列表" desc="换一场看看时间地点和参展名单" onClick={() => navigate('/job-fairs')} />
            <DirStripItem icon={BuildingIcon} tone="wheat" title="企业目录" desc="按用人单位查看在招岗位与来源" onClick={() => navigate('/companies')} />
          </DirStrip>

          <DirKv rows={[
            ['可用入场入口', `${availableFairs.length} 场`],
            ['判定口径', '服务端返回 checkinUrl 且状态为进行中 / 即将开始'],
          ]} />
        </>
      )}
    </QxFairWorkbench>
  )
}
