// 首页 · V3 意图台试点（设计基线：docs/design/kiosk-ai-os-v3-2026-08/，main #568 入库后直接引用）
//
// 顶栏(76) + 底栏(116) 由共享 KioskLayout 提供；本页只渲染 V5「鲜彩玻璃 warm」
// 内容区：暖色域版头 + 指令胶囊（明确导航按钮，不伪装输入框）+ 六服务身份色
// 干净磁贴 + 门控动态专区 + 本机状态仪表 + 合规提示。
// 用户 2026-08-09 拍板口径：首页卡片不放子功能小按钮；磁贴点击进入服务中心页，
// 子功能选择由 /print-scan 等六个服务中心页承担。
// 批准偏差与延期项清单：见 verify-home-prototype-v1.mjs 的基线覆盖清单。
//
// 保留的真实能力（重排视觉不改语义）：
// - 登录入口：未登录 → 统一全屏 /login；已登录 → /profile（真实 displayName）
// - ContinuePanel 会员可恢复任务（自门控）
// - AI 接待台：导航按钮/麦克风/CTA → /assistant，chips 携带 state.topic
// - 本机能力：共享壳 useTerminalDeviceStatus 真实检测，未检测项不写「正常」
// - 百宝箱/智慧校园：useToolboxConfig / useSmartCampusConfig enabled 门控渲染
//   （修复旧 SvcGrid 无条件渲染两磁贴的盘点缺陷）
import type { SmartCampusModuleKey } from '@ai-job-print/shared'
import { KioskPageFrame } from '@ai-job-print/ui'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useSmartCampusConfig } from '../../hooks/useSmartCampusConfig'
import type { TerminalDeviceStatusView } from '../../hooks/useTerminalDeviceStatus'
import { useToolboxConfig } from '../../hooks/useToolboxConfig'
import { ContinuePanel } from './components/ContinuePanel'
import { ProtoIcon } from './prototypeIcons'
import {
  HOME_SERVICE_CARDS,
  type Accent,
  type HomeServiceCardDef,
  type ServiceGroup,
  type ServiceTile,
} from './serviceGroups'
import '../../styles/prototype-v1.css'
import './home-v3.css'

/** 服务身份色 cat → hv3 卡片类（vivid.css --cat-*；身份色 ≠ 状态语义色）。 */
const CAT_CLASS: Record<HomeServiceCardDef['cat'], string> = {
  print: 'hv3-cat-print',
  resume: 'hv3-cat-resume',
  job: 'hv3-cat-job',
  fair: 'hv3-cat-fair',
  interview: 'hv3-cat-interview',
  policy: 'hv3-cat-policy',
}

/* ── 版头（V5 .vhero）：暖色域 + 主标题 + 登录/进入我的 ──
 * 主/副标题文案沿用已定稿口径（浏览器合同锚点，1:1 保留）。
 * 未登录：.login-btn → 统一全屏登录页；已登录：同一按钮改「进入我的」→ /profile。 */
function HomeHero({ onOpenLogin }: { onOpenLogin: () => void }) {
  const navigate = useNavigate()
  const { isLoggedIn, displayName } = useAuth()

  return (
    <section className="hv3-hero">
      <div className="hv3-hero-field" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="hv3-hero-inner">
        <div className="hv3-hero-copy">
          <span className="hv3-kicker">就业服务终端</span>
          <h1>
            简历、岗位、打印，<em>一趟办完</em>
          </h1>
          <p>现场准备材料、了解机会，并在本机完成打印扫描</p>
        </div>
        {isLoggedIn ? (
          <button type="button" className="login-btn" onClick={() => navigate('/profile')}>
            <ProtoIcon name="user" />
            <span className="lb-text">
              进入我的
              <small>{displayName} · 查看本人简历、文档、AI记录和收藏</small>
            </span>
          </button>
        ) : (
          <button type="button" className="login-btn" onClick={onOpenLogin}>
            <ProtoIcon name="user" />
            <span className="lb-text">
              登录 / 注册
              <small>手机号或扫码 · 记录可在「我的」查看</small>
            </span>
          </button>
        )}
      </div>
    </section>
  )
}

/* ── 指令胶囊 + 场景快捷（V5 .vcommand / .vscenes 的批准偏差落地）──
 * V5 原型此处是真实文本输入框；本机首页不提供文本输入闭环，故按 Codex 审查
 * 结论改为「明确的导航按钮」：可见主文案直说去 AI 顾问描述处境，示例句降级
 * 为按钮内提示行，不再伪装可输入。麦克风与 CTA「让小青安排」→ /assistant，
 * chips 携带 state.topic / 直达打印上传（承接旧 HomeReception 真实行为）。 */
function HomeCommand() {
  const navigate = useNavigate()

  return (
    <section className="hv3-command-wrap">
      <div className="hv3-command">
        <span className="hv3-cmd-ic" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <path d="M12 2l2.4 2.4L17 3l.6 2.8 2.8.6-1.4 2.6 1.4 2.6-2.8.6L17 15l-2.6-1.4L12 15l-2.4-1.4L7 15l-.6-2.8-2.8-.6 1.4-2.6L3.6 6.4l2.8-.6L7 3z" />
          </svg>
        </span>
        <button type="button" className="hv3-cmd-ask" onClick={() => navigate('/assistant')}>
          <span className="hv3-cmd-ask-label">打开 AI 顾问，描述你的处境</span>
          <span className="hv3-cmd-ask-eg">例如：周五要参加招聘会，简历还没准备好</span>
        </button>
        <button
          type="button"
          className="hv3-cmd-mic"
          aria-label="语音输入"
          onClick={() => navigate('/assistant')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <path d="M12 2a3 3 0 013 3v6a3 3 0 01-6 0V5a3 3 0 013-3z" />
            <path d="M19 11a7 7 0 01-14 0M12 18v4M8 22h8" />
          </svg>
        </button>
        <button type="button" className="hv3-cmd-go" onClick={() => navigate('/assistant')}>
          让小青安排
          <ProtoIcon name="arrow" />
        </button>
      </div>
      <p className="hv3-cmd-hint">将进入 AI 顾问，由你确认办理方案</p>
      <div className="hv3-scenes">
        <button
          type="button"
          className="hv3-scene"
          onClick={() => navigate('/assistant', { state: { topic: 'resume' } })}
        >
          <ProtoIcon name="diagnose" />
          优化简历并打印
        </button>
        <button
          type="button"
          className="hv3-scene"
          onClick={() => navigate('/assistant', { state: { topic: 'jobfair' } })}
        >
          <ProtoIcon name="fair-social" />
          准备招聘会材料
        </button>
        <button
          type="button"
          className="hv3-scene hv3-scene--key"
          onClick={() => navigate('/print/upload')}
        >
          <ProtoIcon name="printer" />
          打印手机里的文件
        </button>
      </div>
    </section>
  )
}

/* ── 六服务身份色干净磁贴（V5 .vgrid-a / .vgrid-b）──
 * 用户 2026-08-09 拍板：首页卡片不放子功能小按钮。每张磁贴 = 图标 + 名称 +
 * 一行真实描述，整卡一个按钮（≥56px）点击进入服务中心页；子功能选择在
 * 各服务中心页完成（V5 原型的子功能直点行按此口径不落地）。 */
function HomeServiceNav() {
  const navigate = useNavigate()

  const renderCard = (card: HomeServiceCardDef) => (
    <article key={card.id} className={`hv3-card ${CAT_CLASS[card.cat]}`} data-card-id={card.id}>
      <button type="button" className="hv3-card-main svc-tile" onClick={() => navigate(card.to)}>
        <span className="hv3-card-ic">
          <ProtoIcon name={card.icon} />
        </span>
        <span className="hv3-card-text">
          <b>{card.title}</b>
          <span>{card.desc}</span>
        </span>
        <span className="hv3-card-go">
          <ProtoIcon name="arrow" />
        </span>
      </button>
    </article>
  )

  return (
    <nav className="hv3-services" aria-label="服务入口">
      <div className="hv3-grid-a">
        {HOME_SERVICE_CARDS.filter((card) => card.size === 'lg').map(renderCard)}
      </div>
      <div className="hv3-grid-b">
        {HOME_SERVICE_CARDS.filter((card) => card.size === 'sm').map(renderCard)}
      </div>
    </nav>
  )
}

const SMART_CAMPUS_CHIP_LABELS: Partial<Record<SmartCampusModuleKey, string>> = {
  welcome: '迎新指引',
  luggage: '行李帮运',
  panorama: 'VR校园',
}

/** 动态专区行：百宝箱(z-plum) + 智慧校园(z-teal)；后台开关驱动，
 *  未启用不渲染，仅一个启用时 :only-child 自动通栏并多露预览签。 */
export function ZoneRow() {
  const navigate = useNavigate()
  const toolbox = useToolboxConfig()
  const campus = useSmartCampusConfig()

  const toolboxItems = toolbox.enabled
    ? [...(toolbox.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)
    : []
  const campusModules = (Object.keys(SMART_CAMPUS_CHIP_LABELS) as SmartCampusModuleKey[]).filter(
    (key) => campus.modules?.[key]
  )
  const campusItems = [...(campus.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)
  const showToolbox = toolbox.enabled
  // 门控与 /smart-campus 对齐：校园开启即恒有校园卡/一卡通/校园网三项基础服务，
  // 故只要 enabled 就必须给出首页入口（此前额外要求 modules/items 非空会漏掉纯基础服务态）。
  const showCampus = campus.enabled

  if (!showToolbox && !showCampus) return null

  // chips 用 {key,label} 携带稳定 key，杜绝重复 title 作 React key 的错误复用。
  const toolboxChips = toolboxItems.map((item) => ({ key: item.key, label: item.title }))
  const campusChips = [
    ...campusModules.map((key) => ({ key: `m:${key}`, label: SMART_CAMPUS_CHIP_LABELS[key]! })),
    ...campusItems.map((item) => ({ key: `i:${item.key}`, label: item.title })),
  ]

  return (
    <div className="zone-row">
      {showToolbox && (
        // 百宝箱聚合入口 → /toolbox 区页（可启动 items + 启动弹窗 + 事件上报在该页保留）。
        // 状态标签只说有数据支撑的事实：items 数量（已上架 N 项）或空配置（待配置）；
        // 审核类结论无后端字段支撑，按 CLAUDE.md §9 不伪造状态原则不使用。
        <button type="button" className="zone-card z-plum" onClick={() => navigate('/toolbox')}>
          <span className="z-top">
            <span className="z-icon">
              <ProtoIcon name="zone-toolbox" />
            </span>
            <span className="z-text">
              <b>百宝箱</b>
              <span className="z-sub">本机扩展服务，由后台上架控制</span>
            </span>
            <span className="z-side">
              <span className="z-tag">
                {toolboxChips.length > 0 ? `已上架 ${toolboxChips.length} 项` : '待配置'}
              </span>
              <span className="arrow">
                <ProtoIcon name="arrow" />
              </span>
            </span>
          </span>
          <span className="z-chips">
            {toolboxChips.length > 0 ? (
              <>
                {toolboxChips.slice(0, 5).map((chip, index) => (
                  <i key={chip.key} className={index >= 2 ? 'more' : undefined}>
                    {chip.label}
                  </i>
                ))}
                {toolboxChips.length > 5 && <i>更多上架中</i>}
              </>
            ) : (
              <i className="z-empty">服务待后台配置上架</i>
            )}
          </span>
        </button>
      )}
      {showCampus && (
        <button
          type="button"
          className="zone-card z-teal"
          onClick={() => navigate('/smart-campus')}
        >
          <span className="z-top">
            <span className="z-icon">
              <ProtoIcon name="zone-campus" />
            </span>
            <span className="z-text">
              <b>智慧校园</b>
              <span className="z-sub">校园终端由校方开启后显示</span>
            </span>
            <span className="z-side">
              <span className="z-tag">校方已开启</span>
              <span className="arrow">
                <ProtoIcon name="arrow" />
              </span>
            </span>
          </span>
          <span className="z-chips">
            {campusChips.length > 0 ? (
              campusChips.slice(0, 5).map((chip, index) => (
                <i key={chip.key} className={index >= 3 ? 'more' : undefined}>
                  {chip.label}
                </i>
              ))
            ) : (
              <i className="z-empty">校园卡 · 一卡通 · 校园网</i>
            )}
          </span>
        </button>
      )}
    </div>
  )
}

/* ── 本机状态仪表（V5 .vpanel）──
 * 真实检测：共享壳 useTerminalDeviceStatus 经 Outlet context 下发；
 * 扫描/双面未做实时检测，如实标注「进入后检测 / 提交前确认」，不写「正常」。 */
function HomeDevicePanel() {
  const device = useOutletContext<TerminalDeviceStatusView>()
  const printerState = device.loading
    ? 'checking'
    : device.printerReady
      ? 'ready'
      : device.kind === 'offline' || device.kind === 'error'
        ? 'unavailable'
        : 'unknown'
  const printerLabel = device.loading ? '打印机状态检测中' : device.printerLabel

  return (
    <aside className="hv3-panel" aria-label="本机状态">
      <div className="hv3-panel-hd">
        本机办结能力<span>仅展示本机实时检测到的状态</span>
      </div>
      <div className="hv3-panel-row" role="status" aria-live="polite">
        <span className="k">
          <ProtoIcon name="printer" />
          {printerLabel}
        </span>
        <span className="dc-dot" data-state={printerState} aria-hidden="true" />
      </div>
      <div className="hv3-panel-row">
        <span className="k">
          <ProtoIcon name="scan" />
          材料扫描进入后检测
        </span>
        <span className="dc-dot" data-state="unknown" aria-hidden="true" />
      </div>
      <div className="hv3-panel-row">
        <span className="k">
          <ProtoIcon name="id-copy" />
          双面能力提交前确认
        </span>
        <span className="dc-dot" data-state="unknown" aria-hidden="true" />
      </div>
      <div className="hv3-panel-ft">
        <ProtoIcon name="info" />
        扫描、纸张与双面能力以办理时检查为准
      </div>
    </aside>
  )
}

/* ── legacy ServiceCard（当前不渲染）──
 * SvcGrid 时代起即为死代码（closed-loop-map §七），但 verify-home-narrow-visual-balance
 * 以其 AST（section.card + data-group-id + tag-soon 条件渲染）为合同锚点。
 * 按「不许删门禁」原则保留，物理清理随既立项的死代码清收任务执行。 */
const GROUP_ICON: Record<string, string> = {
  resume: 'group-resume',
  jobs: 'group-jobs',
  'job-fairs': 'group-fairs',
  'print-scan': 'group-print',
  interview: 'group-interview',
  policy: 'group-policy',
}

const TILE_ICON: Record<string, string> = {
  AI简历诊断: 'diagnose',
  AI简历优化: 'optimize',
  简历素材库: 'materials-book',
  职业规划: 'compass',
  简历打印: 'printer',
  求职材料: 'briefcase',
  全职岗位: 'job-fulltime',
  实习岗位: 'cap',
  兼职信息: 'clock',
  全部岗位: 'grid',
  找企业: 'company',
  岗位大师: 'star',
  社会招聘会: 'fair-social',
  校园招聘会: 'cap',
  扫码签到: 'qr',
  文档打印: 'printer',
  证件复印: 'id-copy',
  纸质扫描: 'scan',
  格式转换: 'convert',
  证件照打印: 'id-photo',
}

const GROUP_LAYOUT: Record<
  string,
  { cols: 'c1' | 'c2' | 'c3' | 'c5'; col: boolean; icons: boolean }
> = {
  resume: { cols: 'c3', col: false, icons: true },
  jobs: { cols: 'c2', col: false, icons: true },
  'job-fairs': { cols: 'c1', col: false, icons: true },
  'print-scan': { cols: 'c5', col: true, icons: true },
  interview: { cols: 'c3', col: true, icons: false },
  policy: { cols: 'c3', col: true, icons: false },
}

const ACCENT_CLASS: Record<Accent, string> = {
  teal: 'a-teal',
  clay: 'a-clay',
  slate: 'a-slate',
  wheat: 'a-wheat',
  plum: 'a-plum',
  tool: 'a-teal',
}

export function ServiceCard({ group }: { group: ServiceGroup }) {
  const navigate = useNavigate()
  const layout = GROUP_LAYOUT[group.id] ?? { cols: 'c3' as const, col: false, icons: true }
  const wide = group.layout === 'wide'

  const handleTile = (tile: ServiceTile) => {
    if (tile.disabled || !tile.to) return
    navigate(tile.to, tile.state ? { state: tile.state } : undefined)
  }

  return (
    <section
      className={`card ${wide ? 'wide' : ''} ${ACCENT_CLASS[group.accent]}`
        .trim()
        .replace(/\s+/g, ' ')}
      data-group-id={group.id}
    >
      <div className="card-head">
        <span className="g-icon">
          <ProtoIcon name={GROUP_ICON[group.id] ?? 'group-resume'} />
        </span>
        <div>
          {group.titleTo ? (
            <h2>
              <button
                type="button"
                className="g-title-link"
                onClick={() => navigate(group.titleTo!)}
              >
                {group.title}
                <ProtoIcon name="arrow" />
              </button>
            </h2>
          ) : (
            <h2>{group.title}</h2>
          )}
          <div className="sub">{group.subtitle}</div>
        </div>
        {group.badge && (
          <span className="badge">
            <ProtoIcon name="star" />
            {group.badge.label}
          </span>
        )}
      </div>
      <div className={`tiles ${layout.cols}`}>
        {group.tiles.map((tile) => {
          const disabled = tile.disabled || !tile.to
          const iconName = TILE_ICON[tile.title]
          return (
            <button
              key={tile.title}
              type="button"
              disabled={disabled}
              onClick={() => handleTile(tile)}
              className={`tile ${tile.emphasis === 'primary' ? 'primary' : ''} ${tile.disabled ? 'disabled' : ''} ${layout.col ? 'col' : ''}`
                .trim()
                .replace(/\s+/g, ' ')}
            >
              {layout.icons && iconName && (
                <span className="t-icon">
                  <ProtoIcon name={iconName} />
                </span>
              )}
              <span className="t-text">
                <b>{tile.title}</b>
                {tile.description && <span>{tile.description}</span>}
              </span>
              {tile.disabled && <span className="tag-soon">即将上线</span>}
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function HomePage() {
  const navigate = useNavigate()
  const openLogin = () => navigate('/login', { state: { from: '/' } })

  return (
    <KioskPageFrame className="kpv1 kpv1--content-only hv3">
      <HomeHero onOpenLogin={openLogin} />
      <HomeCommand />
      <ContinuePanel />
      <HomeServiceNav />
      <ZoneRow />
      <section className="hv3-foot">
        <div className="notice">
          <ProtoIcon name="info" />
          岗位与招聘会信息均来自第三方 /
          官方来源，本终端仅提供信息展示与跳转，投递、预约请前往来源平台办理。
        </div>
        <HomeDevicePanel />
      </section>
    </KioskPageFrame>
  )
}
