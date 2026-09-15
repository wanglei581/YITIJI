import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDateTime, type ExternalJobFairDTO } from '@ai-job-print/shared'
import { AlertTriangleIcon, CalendarIcon, InfoIcon, QrCodeIcon } from 'lucide-react'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { getJobFairs, getTerminalId } from '../../services/api'
import { recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { isValidSourceUrl } from '../../lib/url'
import {
  QxFairCta,
  QxFairNavRow,
  QxFairNotice,
  QxFairQrDialog,
  QxFairShell,
  QxFairSkel,
  QxFairState,
} from './qx/qxFairChrome'

function formatFairDateTime(iso: string): string {
  return formatDateTime(iso, { fallback: iso })
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
    recordExternalJump(getToken(), 'job_fair', fair.id, 'external_checkin_open')
    setQrFair(fair)
  }

  const viewState = loading ? 'loading' : error ? 'error' : qrFair ? 'qr' : availableFairs.length === 0 ? 'empty' : 'guide'
  const pill = viewState === 'qr'
    ? { tone: 'ok' as const, label: '来源入场码已就绪' }
    : viewState === 'guide'
      ? { tone: 'warn' as const, label: '本机不做签到，只给到场指引' }
      : viewState === 'error'
        ? { tone: 'bad' as const, label: '入场入口列表这次没取到' }
        : viewState === 'empty'
          ? { tone: 'unknown' as const, label: '暂无配置 checkinUrl 的可用场次' }
          : { tone: 'unknown' as const, label: '正在取入场入口' }

  return (
    <QxFairShell
      title="到场指引"
      subtitle="本机不做签到，也拿不到签到结果；这一页只帮你找凭证、讲清路线。"
      status={pill}
      screen="checkin"
      state={viewState}
      ctabar={
        viewState === 'qr' ? (
          <>
            <QxFairCta onClick={() => setQrFair(null)}>选择其他场次</QxFairCta>
            <QxFairCta variant="primary" testId="checkin-primary" onClick={() => navigate('/job-fairs')}>
              返回场次列表
            </QxFairCta>
          </>
        ) : viewState === 'error' ? (
          <>
            <QxFairCta onClick={() => navigate('/help')}>找现场工作人员</QxFairCta>
            <QxFairCta variant="primary" testId="checkin-primary" onClick={() => setRetryKey((value) => value + 1)}>
              重新加载
            </QxFairCta>
          </>
        ) : (
          <QxFairCta variant="primary" testId="checkin-primary" onClick={() => navigate('/job-fairs')}>
            {viewState === 'empty' ? '查看招聘会' : '返回场次列表'}
          </QxFairCta>
        )
      }
    >
      {viewState === 'loading' ? (
        <QxFairSkel rows={2} />
      ) : viewState === 'error' ? (
        <QxFairState screen="checkin" tone="error" icon={AlertTriangleIcon} title="入场入口列表这次没取到">
          招聘会列表请求失败，所以无法判断哪些场次有可用的 checkinUrl。本机不显示缓存二维码，也不判断你的预约或签到状态。
        </QxFairState>
      ) : viewState === 'empty' ? (
        <QxFairState screen="checkin" tone="empty" icon={QrCodeIcon} title="暂无可展示的来源入场入口">
          当前没有进行中或即将开始、且配置了 checkinUrl 的招聘会。<b>这不代表你未预约</b>，本机不查个人记录。
        </QxFairState>
      ) : viewState === 'qr' && qrFair ? (
        <>
          <section className="qx-card">
            <div className="qx-fair-blk-h">
              <QrCodeIcon size={24} aria-hidden />
              来源平台入场码
              <span className="hint">仅在 checkinUrl 合法时生成</span>
            </div>
            <div className="qx-fair-qr-slot">
              <SourceUrlQr value={qrFair.checkinUrl} size={220} />
            </div>
          </section>
          <section className="qx-card qx-fair-src">
            <div className="qx-fair-blk-h">场次与来源</div>
            <dl className="qx-fair-kv">
              <div className="qx-fair-kv-row"><dt>招聘会</dt><dd>{qrFair.name}</dd></div>
              <div className="qx-fair-kv-row"><dt>来源机构</dt><dd>{qrFair.sourceName}</dd></div>
              <div className="qx-fair-kv-row"><dt>外部编号</dt><dd>{qrFair.externalId}</dd></div>
            </dl>
          </section>
          <QxFairNotice />
        </>
      ) : (
        <>
          <div className="qx-fair-aibar off">
            <span className="qx-fair-ai-ic"><InfoIcon size={26} aria-hidden /></span>
            <span>
              <span className="qx-fair-ai-t">本机不做签到，也拿不到签到结果</span>
              <span className="qx-fair-ai-d">这里只列出进行中或即将开始、且服务端已返回 checkinUrl 的场次；不查个人预约记录。</span>
            </span>
          </div>
          {availableFairs.map((fair) => {
            const sourceUrlAvailable = isValidSourceUrl(fair.checkinUrl ?? '')
            return (
              <article key={fair.id} className="qx-fair-card">
                <span className="qx-fair-card-ic" aria-hidden><QrCodeIcon size={28} /></span>
                <div className="qx-fair-card-main">
                  <h2 className="qx-fair-card-title">
                    {fair.name}
                    <span className={`qx-fair-tag ${fair.status === 'ongoing' ? 'teal' : 'warn'}`}>
                      {fair.status === 'ongoing' ? '进行中' : '即将开始'}
                    </span>
                  </h2>
                  <div className="qx-fair-card-meta">
                    <span><CalendarIcon size={19} aria-hidden />{formatFairDateTime(fair.startTime)}</span>
                    <span>来源 · {fair.sourceName}</span>
                    <span>外部ID {fair.externalId}</span>
                  </div>
                  <p className="qx-fair-local-note">
                    请使用手机扫码前往来源平台签到。本系统不记录签到结果，请以来源平台显示为准。
                  </p>
                </div>
                <div className="qx-fair-card-actions">
                  {sourceUrlAvailable ? (
                    <button type="button" className="qx-fair-mini" data-variant="primary" onClick={() => openCheckinQr(fair)}>
                      来源平台签到码
                    </button>
                  ) : (
                    <span className="qx-fair-blocked">来源链接暂不可用</span>
                  )}
                  <button type="button" className="qx-fair-mini" onClick={() => navigate(`/job-fairs/${fair.id}`, { state: { fair } })}>
                    查看详情
                  </button>
                </div>
              </article>
            )
          })}
          <section className="qx-card">
            <div className="qx-fair-blk-h">到场当天怎么走</div>
            <div className="qx-fair-rules">
              <p className="qx-fair-rule"><i>1</i><span>点对应场次的来源签到码，用手机前往来源平台。</span></p>
              <p className="qx-fair-rule"><i>2</i><span>按主办方现场指引排队登记；<b>登记结果以主办方为准</b>，本机查不到。</span></p>
              <p className="qx-fair-rule"><i>3</i><span>带好纸质简历；忘带可以在这台机器上打印，价格以现场公示为准。</span></p>
            </div>
          </section>
          <QxFairNotice />
          <div className="qx-rows">
            <QxFairNavRow icon={QrCodeIcon} title="现在去打印简历" description="A4 黑白或彩色，参数在打印页选。" onClick={() => navigate('/print-scan')} testId="checkin-print" />
            <QxFairNavRow icon={CalendarIcon} title="回场次列表" description="换一场看看时间地点和参展名单。" onClick={() => navigate('/job-fairs')} testId="checkin-back" />
          </div>
        </>
      )}
      {qrFair && viewState !== 'qr' ? (
        <QxFairQrDialog
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
    </QxFairShell>
  )
}
