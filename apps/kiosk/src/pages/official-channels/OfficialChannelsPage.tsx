// 本机构官方渠道（/official-channels，next-tasks 3.14）。
//
// 视觉按青序流光 2.0 稿 45：标题下三步说明，渠道卡给出真实二维码。稿里的示例码不上屏。
// 一体机不打开外部网页，这一页只给二维码，不给可点的外链。兜底态是状态块加一组紧凑的去处行，
// 行不吸收余量：只有三项时拉高只会变成一张张空卡。
//
// 两种托管状态都渲染（路由在 RecruitmentHostingBoundary 之外）：
//   · 我们云上（托管 a）：只列本终端所属机构自己的官方渠道；
//   · 客户私有化部署（b）：服务端另下发原平台目录 legacyPlatforms，列在「其他来源平台」。
//     客户端再兜一层：托管没读到「打开」之前，这一段一条都不显示。
// 状态：读取中（不下结论）/ 有渠道 / 没有渠道（不说原因，给本机照常能办的事）/ 读取失败（可重试）。
// 本机没有终端身份按「没有渠道」处理（useOfficialChannels），不当成错误。

import { useNavigate } from 'react-router-dom'
import { BotIcon, ChevronRightIcon, LandmarkIcon, MessageCircleIcon, PrinterIcon, QrCodeIcon, RouteIcon } from 'lucide-react'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { QxAiHelp, QxStepActions } from '../../components/qingxu/QxAiHelp'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { DirSec, DirState, DirStripItem } from '../../components/qingxu/directory/DirectoryBits'
import { useOfficialChannels } from '../../hooks/useOfficialChannels'
import { useRecruitmentHosting } from '../../hooks/useRecruitmentHosting'
import type { OfficialChannelItem } from '../../services/api/officialChannels'
import '../../components/qingxu/directory/directory-qx.css'
import './official-channels-qx.css'

type View = 'loading' | 'items' | 'empty' | 'error'
type ChannelKind = 'org' | 'legacy'

/** 没有渠道或读取失败时给出的去处：都是本机照常能办、不依赖渠道的既有入口。 */
const ALTERNATIVES = [
  { key: 'policy', icon: LandmarkIcon, title: '就业政策', desc: '政策、社保与登记指引，以官方核验为准', to: '/policy-service' },
  { key: 'ai', icon: BotIcon, title: 'AI 求职工具', desc: '简历、面试与求职方向，问小青', to: '/assistant' },
  { key: 'print', icon: PrinterIcon, title: '打印 · 扫描', desc: '简历、证明材料与照片', to: '/print-scan' },
] as const

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function ChannelCard({ item, kind }: { item: OfficialChannelItem; kind: ChannelKind }) {
  const host = hostOf(item.url)
  return (
    <li className="oc-card" data-testid="official-channel-card" data-channel-kind={kind}>
      <span className="oc-card-ic" aria-hidden="true">{Array.from(item.name)[0]}</span>
      <div className="oc-card-main">
        <span className="oc-card-kicker">{kind === 'org' ? '本机构官方渠道' : '其他来源平台'}</span>
        <h2 className="oc-card-name">{item.name}</h2>
        {host ? <span className="oc-card-host">{host}</span> : null}
        <p className="oc-caption">{`本渠道由${item.organizationName}提供，信息以其官网为准`}</p>
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
    </li>
  )
}

function ChannelList({ items, kind }: { items: readonly OfficialChannelItem[]; kind: ChannelKind }) {
  return (
    <ul className="oc-list">
      {items.map((item) => <ChannelCard key={`${item.url}|${item.name}`} item={item} kind={kind} />)}
    </ul>
  )
}

const CHANNEL_ASK_DRAFT = '这个二维码怎么用？请只说明用手机打开的步骤，不要生成岗位。'

function ChannelAsk() {
  return (
    <div className="oc-ask">
      <span className="oc-ask-ic" aria-hidden="true"><MessageCircleIcon size={26} /></span>
      <div className="oc-ask-copy">
        <QxStepActions>
          <QxAiHelp label="问小青：这个码怎么用" draft={CHANNEL_ASK_DRAFT} testId="official-channels-ask" />
        </QxStepActions>
        <span className="oc-ask-desc">带走一句用法说明，不生成岗位</span>
      </div>
    </div>
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
  // 稿另有一颗「返回全部服务」指向服务目录。运行时没有那一页，首页就是选服务的地方，
  // 两颗按钮会去同一处，所以只留「回首页」；读取失败时它让位给「重新读取」，退成次按钮。
  return (
    <div className="oc-cta">
      <div className="oc-cta-btns">
        {view === 'error' ? (
          <button type="button" className="qx-btn" data-variant="ghost" onClick={onHome}>回首页</button>
        ) : null}
        {view === 'error' ? (
          <button type="button" className="qx-btn" data-variant="primary" onClick={onRetry}>重新读取</button>
        ) : (
          <button type="button" className="qx-btn" data-variant="primary" onClick={onHome}>回首页</button>
        )}
      </div>
      <p className="oc-privacy"><b>隐私提示</b>结束这次办理或闲置超时，会清除本机登录和临时信息；文件与订单按实际保留时间管理。</p>
    </div>
  )
}

export function OfficialChannelsPage() {
  const navigate = useNavigate()
  const channels = useOfficialChannels()
  const hosting = useRecruitmentHosting()
  const home = () => navigate('/')

  const items = channels.status === 'ready' ? channels.items : []
  // b 版本的原平台目录：服务端只在托管打开时下发；这里再兜一层，托管没读到「打开」就一条都不列。
  const legacy = channels.status === 'ready' && hosting.enabled ? channels.legacyPlatforms : []
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

  const alternatives = (
    <DirSec title="可以先办这些" hint="都在这台终端上">
      <div className="qx-rows oc-alt-rows" data-testid="official-channels-alternatives">
        {ALTERNATIVES.map(({ key, icon: Icon, title, desc, to }) => (
          <button key={key} type="button" className="qx-row" data-route={to} onClick={() => navigate(to)}>
            <span className="qx-row-ic" aria-hidden="true"><Icon size={28} /></span>
            <span className="qx-row-tx">
              <span className="qx-row-t">{title}</span>
              <span className="qx-row-d">{desc}</span>
            </span>
            <ChevronRightIcon className="qx-row-go" size={26} aria-hidden="true" />
          </button>
        ))}
      </div>
    </DirSec>
  )

  return (
    <QxPageFrame
      back={{ label: '返回首页', onBack: home }}
      title="本机构官方渠道"
      subtitle="扫码后在手机上打开本机构的官网或官方公众号。"
      status={status}
      navbar={<QxAppNavbar onHome={home} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />}
      ctabar={<ChannelBar view={view} onHome={home} onRetry={channels.retry} />}
    >
      <div className="dw-page qx-grow oc-page" data-kiosk-screen="official-channels" data-state={view} data-density={density}>
        {view === 'loading' ? (
          <DirState tone="info" testId="official-channels-loading" title="正在读取本终端的官方渠道">
            读取完成前这里不下结论。
          </DirState>
        ) : null}
        {view === 'error' ? (
          <>
            <DirState tone="error" testId="official-channels-error" title="官方渠道这次没有读取成功">
              可以点下方「重新读取」再试一次，也可以先办下面这些事。
            </DirState>
            {alternatives}
          </>
        ) : null}
        {items.length + legacy.length > 0 ? (
          <ol className="oc-steps" aria-label="怎么用这些二维码">
            <li><b>1</b>用手机对准下面的二维码</li>
            <li><b>2</b>在你自己的手机上打开</li>
            <li><b>3</b>办理以该渠道页面为准</li>
          </ol>
        ) : null}
        {view === 'items' ? (
          <section className="dw-sec oc-sec" data-testid="official-channels-org" aria-label="本机构官方渠道">
            <div className="dw-sec-h">
              <span className="no">01</span>
              <span className="t">{items[0]?.organizationName}</span>
            </div>
            <ChannelList items={items} kind="org" />
          </section>
        ) : null}
        {view === 'empty' ? (
          <DirState tone="empty" testId="official-channels-empty" title="本终端暂未配置官方渠道">
            可以先办下面这些事。
          </DirState>
        ) : null}
        {legacy.length > 0 ? (
          <section className="dw-sec oc-sec" data-testid="official-channels-legacy" aria-label="其他来源平台">
            <div className="dw-sec-h">
              <span className="no">{items.length > 0 ? '02' : '01'}</span>
              <span className="t">其他来源平台</span>
              <span className="hint">扫码后在该平台自行浏览</span>
            </div>
            <ChannelList items={legacy} kind="legacy" />
          </section>
        ) : null}
        {view === 'empty' ? alternatives : null}
        {view === 'items' ? (
          <section className="dw-sec oc-assist" data-testid="official-channels-assist" aria-label="也可以问小青">
            <div className="dw-sec-h">
              <span className="no">{legacy.length > 0 ? '03' : '02'}</span>
              <span className="t">也可以问小青</span>
              <span className="hint">只说明这个码怎么用</span>
            </div>
            <ChannelAsk />
            <DirStripItem
              icon={RouteIcon}
              title="AI 求职方向探索"
              desc="说说专业和兴趣，小青帮你理出求职方向"
              onClick={() => navigate('/assistant?intent=career_explore')}
            />
          </section>
        ) : null}
      </div>
    </QxPageFrame>
  )
}
