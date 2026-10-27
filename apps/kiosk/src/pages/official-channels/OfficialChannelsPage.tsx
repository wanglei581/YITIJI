// 本机构官方渠道（/official-channels，next-tasks 3.14）。
//
// 版式照触屏稿 official：每个渠道一张码卡，左边是大二维码，右边是名称、来源说明、目标地址和「核对还能不能扫」；
// 码卡下面是三步说明；底栏是返回、问小青、AI 求职方向探索。没有码时（没有渠道 / 读取失败）是一条说明加两张带插画的去处卡。
// 稿里的示例码不上屏：这一页只画接口返回的码。
// 一体机不打开外部网页，这一页只给二维码，不给可点的外链。
//
// 两种托管状态都渲染（路由在 RecruitmentHostingBoundary 之外）：
//   · 我们云上（托管 a）：只列本终端所属机构自己的官方渠道，默认不分组；
//   · 客户私有化部署（b）：服务端另下发原平台目录 legacyPlatforms，列在「其他来源平台」。
//     客户端再兜一层：托管没读到「打开」之前，这一段一条都不显示。
// 状态：读取中（不下结论）/ 有渠道 / 没有渠道（不说原因，给本机照常能办的事）/ 读取失败（可重试）。
// 本机没有终端身份按「没有渠道」处理（useOfficialChannels），不当成错误。

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { QxTouchCallout } from '../../components/qingxu/touch/QxTouchCallout'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { useOfficialChannels } from '../../hooks/useOfficialChannels'
import { useRecruitmentHosting } from '../../hooks/useRecruitmentHosting'
import type { OfficialChannelItem } from '../../services/api/officialChannels'
import { ArtBox, Card, K, PairCard, Well } from '../public-touch/PublicBlocks'
import { IllusChecklist, IllusReport } from '../public-touch/PublicIllus'
import { PublicTouchFrame } from '../public-touch/PublicTouchFrame'
import { useVisibleHelpLine } from '../public-touch/publicTouchHooks'
import './official-touch.css'

type View = 'loading' | 'items' | 'empty' | 'error'
type ChannelKind = 'org' | 'legacy'

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function channelKey(item: OfficialChannelItem): string {
  return `${item.url}|${item.name}`
}

function ChannelCard({
  item,
  kind,
  busy,
  onRecheck,
}: {
  item: OfficialChannelItem
  kind: ChannelKind
  busy: boolean
  onRecheck: (item: OfficialChannelItem) => void
}) {
  const host = hostOf(item.url)
  return (
    <li className="oc-card" data-testid="official-channel-card" data-channel-kind={kind}>
      <figure className="oc-qr" data-testid="official-channel-qr">
        <div className="oc-qr-code" data-testid="official-channel-qr-code">
          <SourceUrlQr value={item.url} size={200} />
        </div>
        <figcaption className="qxp-sr">手机扫码打开</figcaption>
      </figure>
      <div className="oc-card-main">
        <h2 className="oc-card-name">{item.name}</h2>
        <p className="oc-caption">{`本渠道由${item.organizationName}提供，信息以其官网为准`}</p>
        {host ? <span className="oc-card-addr">目标地址：<b className="oc-card-host">{host}</b></span> : null}
        <button
          type="button"
          className="qxp-hit oc-card-check"
          data-testid="official-channel-recheck"
          aria-label={`核对「${item.name}」还能不能扫`}
          aria-busy={busy}
          onClick={() => onRecheck(item)}
        >
          <span className="qxp-tx"><b>核对还能不能扫</b><small>点一下，看这个码现在还能不能打开</small></span>
        </button>
      </div>
    </li>
  )
}

function ChannelList({
  items,
  kind,
  busyKey,
  onRecheck,
}: {
  items: readonly OfficialChannelItem[]
  kind: ChannelKind
  busyKey: string | null
  onRecheck: (item: OfficialChannelItem) => void
}) {
  return (
    <ul className="oc-list">
      {items.map((item) => (
        <ChannelCard
          key={channelKey(item)}
          item={item}
          kind={kind}
          busy={busyKey === channelKey(item)}
          onRecheck={onRecheck}
        />
      ))}
    </ul>
  )
}

function withdrawnCopy(names: string[]): string {
  const quoted = names.map((name) => `「${name}」`).join('、')
  return `${quoted}已经撤下，不再提供二维码。`
}

const CHANNEL_ASK_DRAFT = '这个二维码怎么用？请只说明用手机打开的步骤，不要生成岗位。'

export function OfficialChannelsPage() {
  const navigate = useNavigate()
  const channels = useOfficialChannels({ fresh: true })
  const hosting = useRecruitmentHosting()
  const phoneLine = useVisibleHelpLine()
  const home = () => navigate('/')
  const [note, setNote] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const seen = useRef<OfficialChannelItem[] | null>(null)
  const checking = useRef(false)

  const items = channels.status === 'ready' ? channels.items : []
  // b 版本的原平台目录：服务端只在托管打开时下发；这里再兜一层，托管没读到「打开」就一条都不列。
  const legacy = channels.status === 'ready' && hosting.enabled ? channels.legacyPlatforms : []
  const shown = hosting.status === 'ready' ? [...items, ...legacy] : null

  const shownKey = shown?.map(channelKey).join('\n') ?? ''
  useEffect(() => {
    if (!shown) return
    const prior = seen.current
    seen.current = shown
    if (!prior) return
    const gone = prior.filter((old) => !shown.some((row) => row.url === old.url && row.name === old.name))
    if (gone.length === 0) {
      setNote((current) => (current?.includes('已经撤下') ? null : current))
      return
    }
    setNote(withdrawnCopy(gone.map((row) => row.name)))
    // shownKey 变了才比较；shown 与这一键同一轮渲染出来。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey])

  const recheckCard = (item: OfficialChannelItem) => {
    if (checking.current) return
    checking.current = true
    setBusyKey(channelKey(item))
    setNote('正在确认这条渠道还在不在')
    void channels.recheck().then((next) => {
      checking.current = false
      setBusyKey(null)
      if (!next) {
        setNote('这次没有确认这些渠道还在，请再点一次。')
        return
      }
      setNote((current) => (current === '正在确认这条渠道还在不在' ? null : current))
    })
  }
  const view: View = channels.status === 'ready' ? (items.length > 0 ? 'items' : 'empty') : channels.status
  // 卡越少、码越大（尺寸由 CSS 按 data-density 取；手机宽度统一回落）。
  const cardCount = items.length + legacy.length
  const density = cardCount <= 1 ? 'roomy' : cardCount === 2 ? 'comfortable' : cardCount === 3 ? 'compact' : 'crowded'

  const status = view === 'loading'
    ? { tone: 'unknown' as const, label: '正在读取本机构渠道' }
    : view === 'error'
      ? { tone: 'bad' as const, label: '渠道读取失败' }
      : view === 'items'
        ? { tone: 'ok' as const, label: `${items.length} 个官方渠道` }
        : { tone: 'warn' as const, label: '暂未配置官方渠道' }

  const hasCards = cardCount > 0
  // 页上没有码时不说「扫下面的码」。
  const subtitle = hasCards
    ? '扫下面的码，在自己的手机上打开本机构核验过的官方页面。'
    : view === 'empty'
      ? '没有可扫的码。可以问小青，或先看帮助。'
      : view === 'error'
        ? '渠道这次没读到。可以重新读取，或先看帮助。'
        : '读取完成前这里不下结论。'
  const title = view === 'empty'
    ? '本终端暂未配置官方渠道'
    : view === 'error'
      ? '官方渠道这次没有读取成功'
      : view === 'loading'
        ? '正在读取本终端的官方渠道'
        : '扫码，在手机上看'

  const dock = view === 'items' ? (
    <QxTouchDock
      onBack={home}
      ask={{ label: '问小青：这个码怎么用', draft: CHANNEL_ASK_DRAFT, voice: true }}
      primary={{ label: 'AI 求职方向探索', onClick: () => navigate('/assistant?intent=career_explore') }}
    />
  ) : (
    <QxTouchDock onBack={home} primary={{ label: '回首页', onClick: home }} />
  )

  return (
    <PublicTouchFrame
      page="official"
      back={{ label: '返回首页', onBack: home }}
      title={title}
      eyebrow="本机构官方渠道"
      sub={subtitle}
      status={status}
      navCurrent="home"
      dock={dock}
    >
      <div className="oc-page qxp-grow" data-kiosk-screen="official-channels" data-state={view} data-density={density}>
        {note ? <p className="oc-withdrawn" data-testid="official-channel-withdrawn" role="status">{note}</p> : null}
        {view === 'loading' ? (
          <>
            <div data-testid="official-channels-loading">
              <QxTouchCallout kind="howto" icon="qr">正在读取本终端的官方渠道。读取完成前这里不下结论。</QxTouchCallout>
            </div>
            <Card className="oc-sink">
              <ArtBox><IllusChecklist w={200} /></ArtBox>
            </Card>
          </>
        ) : null}
        {view === 'error' ? (
          <>
            <div data-testid="official-channels-error">
              <QxTouchCallout kind="howto" icon="alert">这次没有读到官方渠道。请重新读取。</QxTouchCallout>
            </div>
            <div className="qxp-pair qxp-pair-grow" data-testid="official-channels-alternatives">
              <PairCard title="重新读取" desc="先进入读取中，读完再显示" art={<IllusChecklist w={200} />} onClick={() => channels.retry()} />
              <PairCard title="帮助" desc="渠道没读到时，仍可以查常见问题" art={<IllusReport w={200} />} onClick={() => navigate('/help')} />
            </div>
            {phoneLine ? <QxTouchCallout kind="remind">{phoneLine}</QxTouchCallout> : null}
          </>
        ) : null}
        {view === 'empty' ? (
          <>
            <div data-testid="official-channels-empty">
              <QxTouchCallout kind="howto" icon="qr">本终端还没有可扫的码。</QxTouchCallout>
            </div>
            <div className="qxp-pair qxp-pair-grow" data-testid="official-channels-alternatives">
              <PairCard title="问小青" desc="渠道还没有码，仍可以问别的事" art={<IllusChecklist w={200} />} onClick={() => navigate('/assistant')} />
              <PairCard title="帮助" desc="常见问题和这一页的用法" art={<IllusReport w={200} />} onClick={() => navigate('/help')} />
            </div>
            {phoneLine ? <QxTouchCallout kind="remind">{phoneLine}</QxTouchCallout> : null}
          </>
        ) : null}
        {view === 'items' ? (
          <section className="oc-sec" data-testid="official-channels-org" aria-label="本机构官方渠道">
            <ChannelList items={items} kind="org" busyKey={busyKey} onRecheck={recheckCard} />
          </section>
        ) : null}
        {legacy.length > 0 ? (
          <section className="oc-sec" data-testid="official-channels-legacy" aria-label="其他来源平台">
            <K>其他来源平台 · 扫码后在该平台自行浏览</K>
            <ChannelList items={legacy} kind="legacy" busyKey={busyKey} onRecheck={recheckCard} />
          </section>
        ) : null}
        {hasCards ? (
          <Well className="oc-steps">
            <ol aria-label="怎么用这些二维码">
              <li>用手机对准二维码。</li>
              <li>在你自己的手机上打开，不用在这台机器上登录。</li>
              <li>页面内容以该机构页面为准。</li>
            </ol>
          </Well>
        ) : null}
      </div>
    </PublicTouchFrame>
  )
}
