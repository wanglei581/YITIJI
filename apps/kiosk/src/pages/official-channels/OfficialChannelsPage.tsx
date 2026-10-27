// 本机构官方渠道（/official-channels，next-tasks 3.14）。
//
// 视觉按青序流光 2.0 最终版稿 45：标题、说明各占一行，下面三步说明；一张渠道时是稿里的码卡——
// 左上名称与目标地址，正中 680 见方的码位里放真实二维码（看得见的码约 430），来源说明压在卡底；
// 下面「也可以问小青」一行，底部「返回全部服务」加「回首页」。余高平均分到三处（三步→码卡、
// 码卡→问小青、问小青→底部按钮），不堆在一处。稿里的示例码不上屏。
// 一体机不打开外部网页，这一页只给二维码，不给可点的外链。兜底态是状态块、一组紧凑的去处行和问小青，
// 行不吸收余量：只有三项时拉高只会变成一张张空卡。
//
// 两种托管状态都渲染（路由在 RecruitmentHostingBoundary 之外）：
//   · 我们云上（托管 a）：只列本终端所属机构自己的官方渠道；
//   · 客户私有化部署（b）：服务端另下发原平台目录 legacyPlatforms，列在「其他来源平台」。
//     客户端再兜一层：托管没读到「打开」之前，这一段一条都不显示。
// 状态：读取中（不下结论）/ 有渠道 / 没有渠道（不说原因，给本机照常能办的事）/ 读取失败（可重试）。
// 本机没有终端身份按「没有渠道」处理（useOfficialChannels），不当成错误。

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageCircleIcon, QrCodeIcon, RouteIcon } from 'lucide-react'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { QxAiHelp } from '../../components/qingxu/QxAiHelp'
import { PublicArt } from '../public-touch/PublicArt'
import { PublicTouchFrame } from '../public-touch/PublicTouchFrame'
import { DirState, DirStripItem } from '../../components/qingxu/directory/DirectoryBits'
import { useOfficialChannels } from '../../hooks/useOfficialChannels'
import { useRecruitmentHosting } from '../../hooks/useRecruitmentHosting'
import type { OfficialChannelItem } from '../../services/api/officialChannels'
import '../../components/qingxu/directory/directory-qx.css'
import './official-channels-qx.css'
import './official-touch.css'

type View = 'loading' | 'items' | 'empty' | 'error'
type ChannelKind = 'org' | 'legacy'

function PairCard({ title, desc, art, onClick }: {
  title: string
  desc: string
  art: 'list' | 'resume'
  onClick: () => void
}) {
  return (
    <button type="button" className="oc-pair-card" onClick={onClick}>
      <span className="oc-pair-k">{title}</span>
      <span className="oc-pair-d">{desc}</span>
      <span className="qxp-art" aria-hidden="true"><PublicArt kind={art} /></span>
    </button>
  )
}

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
      <span className="oc-card-ic" aria-hidden="true">{Array.from(item.name)[0]}</span>
      <div className="oc-card-main">
        <span className="oc-card-kicker">{kind === 'org' ? '本机构官方渠道' : '其他来源平台'}</span>
        <h2 className="oc-card-name">{item.name}</h2>
        {host ? <span className="oc-card-addr">目标地址：<b className="oc-card-host">{host}</b></span> : null}
      </div>
      <figure className="oc-qr" data-testid="official-channel-qr">
        <div className="oc-qr-code" data-testid="official-channel-qr-code">
          <SourceUrlQr value={item.url} size={200} />
        </div>
        <figcaption className="oc-qr-hint">
          <QrCodeIcon size={20} aria-hidden="true" />
          手机扫码打开
        </figcaption>
      </figure>
      <p className="oc-caption">{`本渠道由${item.organizationName}提供，信息以其官网为准`}</p>
      <button
        type="button"
        className="oc-card-check"
        data-testid="official-channel-recheck"
        aria-label={`核对「${item.name}」还能不能扫`}
        aria-busy={busy}
        onClick={() => onRecheck(item)}
      >
        核对还能不能扫
      </button>
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

/**
 * 「也可以问小青」（稿 45 的最后一段）：整行可点的入口行，行尾「›」。
 * 第一行问这个码怎么用；「AI 求职方向探索」是运行页原有的 AI 入口，照稿的行样子排在同一行里。
 * 页上没有码时（读取中 / 没有渠道 / 读取失败）第一行灰着写原因，两行上下排。
 */
function ChannelAssist({ no, blocked, onExplore }: { no: string | null; blocked: string | null; onExplore: () => void }) {
  return (
    <section className="dw-sec oc-assist oc-push" data-testid="official-channels-assist" aria-label="也可以问小青">
      <div className="dw-sec-h">
        {no ? <span className="no">{no}</span> : null}
        <span className="t">也可以问小青</span>
        <span className="hint">只说明这个码怎么用</span>
      </div>
      <div className={`dw-strip oc-assist-strip${blocked ? ' is-stacked' : ''}`}>
        {blocked ? (
          <div className="oc-ask" data-blocked="true">
            <span className="oc-ask-ic" aria-hidden="true"><MessageCircleIcon size={26} /></span>
            <span className="oc-ask-copy">
              <button
                type="button"
                className="qx-ai-help"
                aria-disabled="true"
                aria-describedby="official-channels-ask-why"
                onClick={(event) => event.preventDefault()}
              >
                问小青：这个码怎么用
              </button>
              <span className="oc-ask-desc" id="official-channels-ask-why">{blocked}</span>
            </span>
          </div>
        ) : (
          <div className="oc-ask">
            <span className="oc-ask-ic" aria-hidden="true"><MessageCircleIcon size={26} /></span>
            <span className="oc-ask-copy">
              <QxAiHelp label="问小青：这个码怎么用" draft={CHANNEL_ASK_DRAFT} testId="official-channels-ask" />
              <span className="oc-ask-desc">带走一句用法说明，不生成岗位</span>
            </span>
          </div>
        )}
        <DirStripItem
          icon={RouteIcon}
          title="AI 求职方向探索"
          desc="说说专业和兴趣，小青帮你理出求职方向"
          onClick={onExplore}
        />
      </div>
    </section>
  )
}

function ChannelBar({
  view,
  onHome,
  onRetry,
}: {
  view: View
  onHome: () => void
  onRetry: () => void
}) {
  // 稿 45 底部两颗：「返回全部服务」（服务目录）与「回首页」。运行时的服务目录就是首页（稿 16 的「全部服务」
  // 同样回 /），两颗按稿并排；读取失败时主按钮让给「重新读取」，「回首页」退成次按钮。
  return (
    <div className="oc-cta qxt-dock">
      <div className="oc-cta-btns">
        {view === 'error' ? (
          <>
            <button type="button" className="qxt-btn qxt-btn-sec" onClick={onHome}>回首页</button>
            <button type="button" className="qxt-btn qxt-btn-pri" onClick={onRetry}>重新读取</button>
          </>
        ) : view === 'empty' ? (
          <>
            <button type="button" className="qxt-btn qxt-btn-sec" onClick={onHome}>返回全部服务</button>
            <button type="button" className="qxt-btn qxt-btn-pri" onClick={onHome}>回首页</button>
          </>
        ) : (
          <>
            <button type="button" className="qxt-btn qxt-btn-sec" onClick={onHome}>返回</button>
            <button type="button" className="qxt-btn qxt-btn-pri" onClick={onHome}>回首页</button>
          </>
        )}
      </div>
      <p className="oc-privacy"><b>隐私提示</b>结束这次办理或闲置超时，会清除本机登录和临时信息；文件与订单按实际保留时间管理。</p>
    </div>
  )
}

export function OfficialChannelsPage() {
  const navigate = useNavigate()
  const channels = useOfficialChannels({ fresh: true })
  const hosting = useRecruitmentHosting()
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
  // 1080 舞台上卡片越少、二维码越大（尺寸由 CSS 按 data-density 取；手机宽度统一回落）。
  const cardCount = items.length + legacy.length
  const density = cardCount <= 1 ? 'roomy' : cardCount === 2 ? 'comfortable' : 'compact'

  const status = view === 'loading'
    ? { tone: 'unknown' as const, label: '正在读取本机构渠道' }
    : view === 'error'
      ? { tone: 'bad' as const, label: '渠道读取失败' }
      : view === 'items'
        ? { tone: 'ok' as const, label: `${items.length} 个官方渠道` }
        : { tone: 'warn' as const, label: '暂未配置官方渠道' }

  const alternatives = view === 'error' ? (
    <div className="oc-pair" data-testid="official-channels-alternatives">
      <PairCard title="重新读取" desc="先进入读取中，读完再显示" art="list" onClick={() => channels.retry()} />
      <PairCard title="帮助" desc="渠道没读到时，仍可以查常见问题" art="resume" onClick={() => navigate('/help')} />
    </div>
  ) : view === 'empty' ? (
    <div className="oc-pair" data-testid="official-channels-alternatives">
      <PairCard title="问小青" desc="渠道还没有码，仍可以问别的事" art="list" onClick={() => navigate('/assistant')} />
      <PairCard title="帮助" desc="常见问题和这一页的用法" art="resume" onClick={() => navigate('/help')} />
    </div>
  ) : null
  const hasCards = cardCount > 0
  // 只有一张本机构渠道时照稿 45：码卡本身就是主角，不再压一行机构名分区头（机构名在卡底的来源说明里），
  // 问小青编 01。多张或另有其他来源平台时，分区头照旧：本机构 01、其他来源平台接着编，问小青排在最后。
  const soloCard = items.length === 1 && legacy.length === 0
  const cardSections = soloCard ? 0 : (items.length > 0 ? 1 : 0) + (legacy.length > 0 ? 1 : 0)
  const legacyNo = items.length > 0 ? '02' : '01'
  const assistNo = hasCards ? `0${cardSections + 1}` : null
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

  return (
    <PublicTouchFrame
      page="official"
      back={{ label: '返回首页', onBack: home }}
      title={title}
      eyebrow="本机构官方渠道"
      sub={subtitle}
      status={status}
      dock={<ChannelBar view={view} onHome={home} onRetry={channels.retry} />}
    >
      <div className="dw-page qx-grow oc-page" data-kiosk-screen="official-channels" data-state={view} data-density={density}>
        {note ? <p className="oc-withdrawn" data-testid="official-channel-withdrawn" role="status">{note}</p> : null}
        {hasCards ? (
          <ol className="oc-steps" aria-label="怎么用这些二维码">
            <li><b>1</b>用手机对准下面的二维码。</li>
            <li><b>2</b>在你自己的手机上打开，<br />不用在这台机器上登录。</li>
            <li><b>3</b>页面内容以该机构页面为准。</li>
          </ol>
        ) : null}
        {view === 'loading' ? (
          <div className="oc-state oc-push">
            <DirState tone="info" testId="official-channels-loading" title="正在读取本终端的官方渠道">
              读取完成前这里不下结论。
            </DirState>
          </div>
        ) : null}
        {view === 'error' ? (
          <div className="oc-state oc-push">
            <DirState tone="error" testId="official-channels-error" title="官方渠道这次没有读取成功">
              可以点下方「重新读取」再试一次，也可以先办下面这些事。
            </DirState>
          </div>
        ) : null}
        {view === 'empty' ? (
          <div className="oc-state oc-push">
            <DirState tone="empty" testId="official-channels-empty" title="本终端暂未配置官方渠道">
              可以先办下面这些事。
            </DirState>
          </div>
        ) : null}
        {view === 'items' ? (
          <section className="dw-sec oc-sec oc-push" data-testid="official-channels-org" aria-label="本机构官方渠道">
            {soloCard ? null : (
              <div className="dw-sec-h">
                <span className="no">01</span>
                <span className="t">{items[0]?.organizationName}</span>
              </div>
            )}
            <ChannelList items={items} kind="org" busyKey={busyKey} onRecheck={recheckCard} />
          </section>
        ) : null}
        {legacy.length > 0 ? (
          <section className="dw-sec oc-sec" data-testid="official-channels-legacy" aria-label="其他来源平台">
            <div className="dw-sec-h">
              <span className="no">{legacyNo}</span>
              <span className="t">其他来源平台</span>
              <span className="hint">扫码后在该平台自行浏览</span>
            </div>
            <ChannelList items={legacy} kind="legacy" busyKey={busyKey} onRecheck={recheckCard} />
          </section>
        ) : null}
        {alternatives ? <div className="oc-alt oc-push">{alternatives}</div> : null}
        {view === 'items' ? (
          <ChannelAssist
            no={assistNo}
            blocked={null}
            onExplore={() => navigate('/assistant?intent=career_explore')}
          />
        ) : null}
      </div>
    </PublicTouchFrame>
  )
}
