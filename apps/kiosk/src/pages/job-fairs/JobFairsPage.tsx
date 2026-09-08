import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDateTime, parseInstant, shanghaiParts, shanghaiTodayKey, type ExternalJobFairDTO } from '@ai-job-print/shared'
import {
  AlertTriangleIcon,
  Building2Icon,
  CalendarIcon,
  MapPinIcon,
  QrCodeIcon,
  SearchIcon,
  StarIcon,
} from 'lucide-react'
import { getJobFairs, getTerminalId } from '../../services/api'
import { recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { useFavorites } from '../../favorites/useFavorites'
import { FairCalendarPopover } from './components/FairCalendarPopover'
import { RegionPicker } from './components/RegionPicker'
import { matchesRegion, type RegionSelection } from '../../lib/regions'
import { evaluateJobSourceTrust } from '../jobs/utils/sourceTrust'
import {
  QxFairCta,
  QxFairQrDialog,
  QxFairShell,
  QxFairSkel,
  QxFairState,
  type QxCtaLabel,
} from './qx/qxFairChrome'

const STATUS_DOT = {
  upcoming: { label: '即将开始', tag: 'warn' as const },
  ongoing:  { label: '进行中', tag: 'teal' as const },
  ended:    { label: '已结束', tag: undefined },
}

const ALL_STATUS = ['全部', '即将开始', '进行中', '已结束'] as const
const STATUS_FILTER_MAP: Record<string, string> = { 即将开始: 'upcoming', 进行中: 'ongoing', 已结束: 'ended' }

const THEME_LABEL: Record<string, string> = {
  campus: '校园双选会', campus_corp: '校企合作专场', industry: '行业专场', general: '综合招聘会',
}

function pad(n: number) { return String(n).padStart(2, '0') }
function fmtDate(iso: string) { return formatDateTime(iso, { style: 'month-day', fallback: iso }) }
function fmtTime(iso: string) { return formatDateTime(iso, { style: 'time', fallback: iso }) }
function fmtSync(iso: string) {
  const instant = parseInstant(iso)
  if (!instant) return iso
  const parts = shanghaiParts(instant)
  if (parts.dateKey === shanghaiTodayKey()) return `今天 ${pad(parts.hour)}:${pad(parts.minute)}`
  return `${pad(parts.month)}-${pad(parts.day)}`
}
function dateKey(iso: string) {
  const instant = parseInstant(iso)
  if (!instant) return iso
  return shanghaiParts(instant).dateKey
}

const BOOK_LABEL: QxCtaLabel = '扫码预约'

function FairRow({
  fair,
  favorite,
  onToggleFavorite,
  onBook,
  onDetail,
}: {
  fair: ExternalJobFairDTO
  favorite: boolean
  onToggleFavorite: () => void
  onBook: () => void
  onDetail: () => void
}) {
  const isEnded = fair.status === 'ended'
  const themeLabel = fair.theme ? (THEME_LABEL[fair.theme] ?? '招聘会') : '招聘会'
  const sc = STATUS_DOT[fair.status]
  const companyCount = fair.hasManagedData ? fair.managedCompanyCount : (fair.boothCount ?? 0)

  return (
    <article className={`qx-fair-card${isEnded ? ' is-ended' : ''}`} data-testid={`list-fair-${fair.id}`}>
      <span className="qx-fair-card-ic" aria-hidden="true">
        <CalendarIcon size={28} />
      </span>
      <div className="qx-fair-card-main">
        <h2 className="qx-fair-card-title">
          {fair.name}
          <span className="qx-fair-tag">{themeLabel}</span>
          <span className={`qx-fair-tag${sc.tag ? ` ${sc.tag}` : ''}`}>{sc.label}</span>
        </h2>
        <div className="qx-fair-card-meta">
          <span><CalendarIcon size={19} aria-hidden />时间 {fmtDate(fair.startTime)} {fmtTime(fair.startTime)}—{fmtTime(fair.endTime)}</span>
          <span><MapPinIcon size={19} aria-hidden />地点 {fair.city ? `${fair.city} · ` : ''}{fair.venue}</span>
          {companyCount > 0 ? (
            <span><Building2Icon size={19} aria-hidden />参展数 {companyCount}{fair.jobCount != null ? ` · ${fair.jobCount} 岗` : ''}</span>
          ) : null}
        </div>
        <div className="qx-fair-card-source">
          <span>来源 {fair.sourceName}</span>
          <span>同步 {fmtSync(fair.syncTime)}</span>
          <span>外部编号 {fair.externalId}</span>
        </div>
      </div>
      <div className="qx-fair-card-actions">
        <button
          type="button"
          className="qx-fair-mini"
          aria-label={favorite ? '取消收藏' : '收藏招聘会'}
          aria-pressed={favorite}
          onClick={onToggleFavorite}
        >
          <StarIcon size={18} aria-hidden />
          收藏场次
        </button>
        {!isEnded ? (
          <button type="button" className="qx-fair-mini" data-variant="primary" onClick={onBook}>
            <QrCodeIcon size={18} aria-hidden />
            {BOOK_LABEL}
          </button>
        ) : null}
        <button type="button" className="qx-fair-mini" onClick={onDetail}>
          查看详情
        </button>
      </div>
    </article>
  )
}

export function JobFairsPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState<RegionSelection>({})
  const [statusFilter, setStatusFilter] = useState('全部')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [fairs, setFairs] = useState<ExternalJobFairDTO[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [qrFair, setQrFair] = useState<ExternalJobFairDTO | null>(null)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const { getToken } = useAuth()
  const { idsOf, toggle: toggleFavorite } = useFavorites()
  const favoriteSet = idsOf('job_fair')

  const openBookingQr = (fair: ExternalJobFairDTO) => {
    if (evaluateJobSourceTrust(fair).ok) {
      recordExternalJump(getToken(), 'job_fair', fair.id, 'external_appointment')
    }
    setQrFair(fair)
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let cancelled = false
    const terminalId = getTerminalId()
    setLoading(true); setError(false)
    getJobFairs({
      ...(terminalId ? { terminalId } : {}),
      ...(statusFilter === '全部' ? {} : { status: STATUS_FILTER_MAP[statusFilter] }),
      ...(debouncedQuery ? { keyword: debouncedQuery } : {}),
      pageSize: 100,
    })
      .then((res) => {
        if (cancelled) return
        setFairs(res.data)
        setTotal(res.pagination.total)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [retryKey, statusFilter, debouncedQuery])

  const visible = useMemo(() => {
    const statusVal = statusFilter === '全部' ? null : STATUS_FILTER_MAP[statusFilter]
    return fairs.filter((f) => {
      if (favoritesOnly && !favoriteSet.has(f.id)) return false
      if (statusVal && f.status !== statusVal) return false
      if (!matchesRegion(f, region)) return false
      if (selectedDate && dateKey(f.startTime) !== selectedDate) return false
      return true
    })
  }, [fairs, statusFilter, region, selectedDate, favoritesOnly, favoriteSet])

  const upcomingCount = useMemo(() => visible.filter((f) => f.status === 'upcoming').length, [visible])
  const ongoingCount = useMemo(() => visible.filter((f) => f.status === 'ongoing').length, [visible])

  /* 「一条都没有」和「筛选筛空」必须分开说，两边说反了都是伪造能力（CLAUDE.md §9）：
   *   - 服务端就返回 0 条时说「请调整筛选」→ 用户一个筛选都没设过，只会更懵；
   *     新机器开机时岗位/招聘会/政策三个板块都是彻底空的，这是常态不是异常。
   *   - 用户真设了筛选筛空时说「主办方还没有发布」→ 反过来在替主办方说谎，
   *     明明有场次，只是不符合这次筛选。
   * 判据：fairs 是服务端这次返回的全量，visible 是本地再筛一道之后的。 */
  const hasAnyFair = fairs.length > 0
  const viewState = loading
    ? 'loading'
    : error
      ? 'error'
      : visible.length === 0
        ? (favoritesOnly ? 'favorites-empty' : hasAnyFair ? 'filtered-empty' : 'empty')
        : 'ready'
  const pill = viewState === 'ready'
    ? { tone: 'ok' as const, label: '已返回场次；继续按真实字段展示' }
    : viewState === 'loading'
      ? { tone: 'unknown' as const, label: '正在取场次名单' }
      : viewState === 'error'
        ? { tone: 'bad' as const, label: '场次名单这次没取到' }
        : viewState === 'favorites-empty'
          ? { tone: 'unknown' as const, label: '还没有收藏的场次' }
          : viewState === 'filtered-empty'
            ? { tone: 'unknown' as const, label: '这次筛选没有匹配的场次' }
            : { tone: 'unknown' as const, label: '近期没有已发布的场次' }

  return (
    <QxFairShell
      title="招聘会"
      subtitle="只展示已审核发布、来源完整的官方与第三方场次；预约在来源平台完成。"
      status={pill}
      screen="list"
      state={viewState}
      ctabar={
        viewState === 'ready' ? (
          <>
            <p className="qx-fair-why">扫码后在来源平台预约或签到；本机不保存结果。</p>
            <QxFairCta onClick={() => navigate('/job-fairs/checkin')}>查看入场入口</QxFairCta>
            <QxFairCta variant="primary" testId="list-primary" onClick={() => navigate('/campus')}>
              看校园招聘
            </QxFairCta>
          </>
        ) : viewState === 'loading' ? (
          <QxFairCta variant="primary" testId="list-primary" onClick={() => navigate('/fairs-service')}>
            返回招聘会服务
          </QxFairCta>
        ) : viewState === 'error' ? (
          <>
            <QxFairCta onClick={() => navigate('/help')}>找工作人员</QxFairCta>
            <QxFairCta variant="primary" testId="list-primary" onClick={() => setRetryKey((k) => k + 1)}>
              重新加载
            </QxFairCta>
          </>
        ) : (
          <>
            <QxFairCta onClick={() => { setFavoritesOnly(false); setQuery(''); setRegion({}); setSelectedDate(null); setStatusFilter('全部') }}>
              查看全部场次
            </QxFairCta>
            <QxFairCta variant="primary" testId="list-primary" onClick={() => navigate('/campus')}>
              看校园招聘
            </QxFairCta>
          </>
        )
      }
    >
      {qrFair ? (
        <QxFairQrDialog
          title={BOOK_LABEL}
          subtitle={qrFair.name}
          value={qrFair.sourceUrl}
          meta={[
            { label: '来源机构', value: qrFair.sourceName },
            { label: '外部编号', value: qrFair.externalId },
          ]}
          note="请使用手机扫码前往来源平台办理预约，预约由对方平台管理，本系统不参与活动报名流程、不接收简历。"
          onClose={() => setQrFair(null)}
        />
      ) : null}

      {viewState === 'loading' ? (
        <>
          <div className="qx-sec-h"><span className="t">正在取场次名单</span><span className="hint">未返回前不显示条数</span></div>
          <QxFairSkel rows={3} />
          <p className="qx-fair-local-note">只显示整体等待，不画阶段进度，也不预估剩余时间。</p>
        </>
      ) : viewState === 'error' ? (
        <>
          <QxFairState screen="list" tone="error" icon={AlertTriangleIcon} title="场次名单这次没取到">
            请求失败了。本机<b>不显示上一次的缓存场次</b>，避免你按已经结束的时间地点白跑一趟。
          </QxFairState>
          <div className="qx-rows">
            <button type="button" className="qx-row" onClick={() => navigate('/jobs')}>
              <span className="qx-row-tx"><span className="qx-row-t">岗位信息</span><span className="qx-row-d">岗位和招聘会不是同一个接口，可以先看岗位。</span></span>
            </button>
            <button type="button" className="qx-row" onClick={() => navigate('/companies')}>
              <span className="qx-row-tx"><span className="qx-row-t">企业目录</span><span className="qx-row-d">按用人单位查看在招岗位与来源。</span></span>
            </button>
          </div>
        </>
      ) : viewState === 'favorites-empty' ? (
        <QxFairState screen="list" tone="empty" icon={StarIcon} title="还没有收藏的招聘会">
          收藏只是这台终端的浏览辅助，不代表已预约、已报名或已签到。
        </QxFairState>
      ) : viewState === 'filtered-empty' ? (
        <QxFairState screen="list" tone="empty" icon={CalendarIcon} title="这次筛选没有匹配的场次">
          本机<b>有已发布的场次</b>，只是不符合当前的搜索、地区、状态或日期条件。放宽任一条即可看到。
        </QxFairState>
      ) : viewState === 'empty' ? (
        <>
          <QxFairState screen="list" tone="empty" icon={CalendarIcon} title="近期没有已发布的招聘会">
            主办方还没有发布新的场次。本机<b>不会拿往期活动充数</b>，也不会写一个不存在的日期。
          </QxFairState>
          <div className="qx-rows">
            <button type="button" className="qx-row" onClick={() => navigate('/job-fairs/checkin')}>
              <span className="qx-row-tx"><span className="qx-row-t">到场指引</span><span className="qx-row-d">已经预约过的场次，可以先看到场当天怎么走。</span></span>
            </button>
            <button type="button" className="qx-row" onClick={() => navigate('/print-scan')}>
              <span className="qx-row-tx"><span className="qx-row-t">先把简历打印好</span><span className="qx-row-d">下次赶上招聘会，材料是现成的。</span></span>
            </button>
          </div>
        </>
      ) : (
        <>
          <form
            className="qx-fair-qbar"
            onSubmit={(event) => { event.preventDefault(); setDebouncedQuery(query.trim()) }}
          >
            <span className="qi"><SearchIcon size={28} aria-hidden /></span>
            <input
              className="qx-fair-qinput"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜场次名称、企业或地点"
              aria-label="搜索招聘会"
              maxLength={80}
            />
            <button type="submit" className="qx-fair-mini" data-variant="primary" data-testid="list-search">
              <SearchIcon size={22} aria-hidden />搜索
            </button>
          </form>
          <div className="qx-fair-chips" role="group" aria-label="场次状态筛选">
            {ALL_STATUS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className="qx-fair-chip"
                aria-pressed={statusFilter === s}
              >
                {s}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setFavoritesOnly((v) => !v)}
              aria-pressed={favoritesOnly}
              className="qx-fair-chip"
              data-testid="list-filter-favorites"
            >
              <StarIcon size={18} aria-hidden />
              只看收藏{favoriteSet.size > 0 ? ` · ${favoriteSet.size}` : ''}
            </button>
          </div>
          <div className="qx-fair-filters">
            <RegionPicker value={region} onChange={setRegion} />
            <FairCalendarPopover fairs={fairs} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
          </div>
          <p className="qx-fair-local-note">
            关键字与状态交给服务端查询；地区、日期和收藏只在本次已加载的场次集合内筛选，不代表全库结果。
          </p>
          <div className="qx-fair-count">
            服务端结果 <b>{total}</b> 场 · 当前展示 <b>{visible.length}</b> 场
            {upcomingCount > 0 ? <span> · 即将开始 {upcomingCount}</span> : null}
            {ongoingCount > 0 ? <span> · 进行中 {ongoingCount}</span> : null}
          </div>
          <div className="qx-fair-aibar off">
            <span className="qx-fair-ai-ic" aria-hidden>✦</span>
            <span>
              <span className="qx-fair-ai-t">AI 参会准备清单要先选一场</span>
              <span className="qx-fair-ai-d">打开一场招聘会后再生成。不排路线、不承诺结果，也不代预约。</span>
            </span>
          </div>
          <div className="qx-fair-list">
            {visible.map((fair) => (
              <FairRow
                key={fair.id}
                fair={fair}
                favorite={favoriteSet.has(fair.id)}
                onToggleFavorite={() => toggleFavorite({ type: 'job_fair', id: fair.id, title: fair.name })}
                onBook={() => openBookingQr(fair)}
                onDetail={() => navigate(`/job-fairs/${fair.id}`, { state: { fair } })}
              />
            ))}
          </div>
        </>
      )}
    </QxFairShell>
  )
}
