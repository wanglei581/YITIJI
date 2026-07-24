// 首页 · prototype-v1 视觉（docs/design/kiosk-proto-2026-07/01-home.html 的 1:1 React 实现）
//
// 最高真值：shared.css 基类 + 01-home.html 局部覆写后的最终渲染结果。
// 结构按原型逐节点移植：topbar(76) → welcome + login-btn(88) → groups(统一 .tile 网格,
// c3/c2/c1/c5) → zone-row(动态专区) → notice(合规) → navbar(116)。
// 废弃旧 primary/secondary 两级模型，改用原型统一 .tile（emphasis→.tile.primary）。
//
// 保留的真实能力：真实路由(serviceGroups)、真实登录弹窗、真实设备状态、
// 百宝箱/智慧校园后台动态开关。登录态为「原型外动态状态」：复用 88px 登录框，
// 文字改「进入我的」，不显示原型没有的统计。ContinuePanel 业务逻辑已抽到
// components/ContinuePanel.tsx 保留（首页按 1:1 不渲染，未删除）。
import type { SmartCampusModuleKey } from '@ai-job-print/shared'
import { KioskPageFrame } from '@ai-job-print/ui'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useSmartCampusConfig } from '../../hooks/useSmartCampusConfig'
import { useToolboxConfig } from '../../hooks/useToolboxConfig'
import { MemberLoginDialog } from '../auth/components/MemberLoginDialog'
import { ContinuePanel } from './components/ContinuePanel'
import { getTerminalId } from '../../services/api/terminalConfig'
import { useHomeDeviceStatus } from './hooks/useHomeDeviceStatus'
import { ProtoIcon } from './prototypeIcons'
import { SERVICE_GROUPS, type Accent, type ServiceGroup, type ServiceTile } from './serviceGroups'
import '../../styles/prototype-v1.css'

/** 服务组 id → 组头图标（键为稳定 group id；图标名对应 prototypeIcons 的 P 表） */
const GROUP_ICON: Record<string, string> = {
  resume: 'group-resume',
  jobs: 'group-jobs',
  'job-fairs': 'group-fairs',
  'print-scan': 'group-print',
  interview: 'group-interview',
  policy: 'group-policy',
}

/** 磁贴标题 → 图标（interview/policy 组磁贴原型无图标，不在此表） */
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

/** 原型 01-home 每组网格布局：cols、是否 .col 竖排、磁贴是否带图标；键为稳定 group id */
const GROUP_LAYOUT: Record<string, { cols: 'c1' | 'c2' | 'c3' | 'c5'; col: boolean; icons: boolean }> = {
  resume: { cols: 'c3', col: false, icons: true },
  jobs: { cols: 'c2', col: false, icons: true },
  'job-fairs': { cols: 'c1', col: false, icons: true },
  'print-scan': { cols: 'c5', col: true, icons: true },
  interview: { cols: 'c3', col: true, icons: false },
  policy: { cols: 'c3', col: true, icons: false },
}

/** accent → 原型品类色类名 */
const ACCENT_CLASS: Record<Accent, string> = {
  teal: 'a-teal',
  clay: 'a-clay',
  slate: 'a-slate',
  wheat: 'a-wheat',
  plum: 'a-plum',
  tool: 'a-teal',
}

/* ── 顶部状态栏（真实设备状态 → status-chip；实时时钟） ── */
function KioskTopBar() {
  const deviceStatus = useHomeDeviceStatus()
  const [now, setNow] = useState(() => new Date())
  const terminalId = getTerminalId() || '01号机'

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const clock = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)

  const chipTone =
    deviceStatus.tone === 'positive' ? '' : deviceStatus.tone === 'neutral' ? 'neutral' : 'warn'

  return (
    <header className="topbar">
      <div className="brand">
        <b>就业服务大厅 · {terminalId}</b>
        <span>AI求职打印服务终端</span>
      </div>
      <div className="right">
        <span className="clock">{clock}</span>
        <span className={`status-chip ${chipTone}`.trim()} role="status" aria-live="polite">
          <span className="dot" aria-hidden="true" />
          {deviceStatus.label}
        </span>
      </div>
    </header>
  )
}
/* ── 欢迎区 + 登录/进入我的（原型 .welcome）──
 * 未登录：88px .login-btn「登录 / 注册」→ 打开真实登录弹窗（弹窗内含游客体验）。
 * 已登录：原型外动态状态——复用同一 88px 框，文字改「进入我的」→ /profile；
 *         不显示原型没有的简历/文档/订单统计。 */
function HomeWelcome() {
  const navigate = useNavigate()
  const { isLoggedIn, displayName, continueAsGuest } = useAuth()
  const [loginOpen, setLoginOpen] = useState(false)
  const loginTriggerRef = useRef<HTMLButtonElement>(null)

  return (
    <section className="welcome">
      <div>
        <h1>
          简历、打印、岗位信息<em>一趟办完</em>
        </h1>
        <p>游客可直接使用大部分功能 · 触摸下方卡片开始</p>
      </div>
      {isLoggedIn ? (
        // 原型外动态状态：登录后入口，保持 88px 登录框外观
        <button type="button" className="login-btn" onClick={() => navigate('/profile')}>
          <ProtoIcon name="user" />
          <span className="lb-text">
            进入我的
            <small>{displayName} · 查看本人简历、文档、AI记录和收藏</small>
          </span>
        </button>
      ) : (
        <button ref={loginTriggerRef} type="button" className="login-btn" onClick={() => setLoginOpen(true)}>
          <ProtoIcon name="user" />
          <span className="lb-text">
            登录 / 注册
            <small>手机号或扫码 · 记录可在「我的」查看</small>
          </span>
        </button>
      )}
      <MemberLoginDialog
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onContinueAsGuest={() => {
          continueAsGuest()
          setLoginOpen(false)
        }}
      />
    </section>
  )
}

/* ── 单个服务卡（原型统一 .tile 网格；废弃 primary/secondary 两级） ── */
function ServiceCard({ group }: { group: ServiceGroup }) {
  const navigate = useNavigate()
  const layout = GROUP_LAYOUT[group.id] ?? { cols: 'c3' as const, col: false, icons: true }
  const wide = group.layout === 'wide'

  const handleTile = (tile: ServiceTile) => {
    if (tile.disabled || !tile.to) return
    navigate(tile.to, tile.state ? { state: tile.state } : undefined)
  }

  return (
    <section className={`card ${wide ? 'wide' : ''} ${ACCENT_CLASS[group.accent]}`.trim().replace(/\s+/g, ' ')}>
      <div className="card-head">
        <span className="g-icon">
          <ProtoIcon name={GROUP_ICON[group.id] ?? 'group-resume'} />
        </span>
        <div>
          {group.titleTo ? (
            // 分组标题作为聚合页入口（消费 group.titleTo，如 print-scan → /print-scan）。
            // 复用原型已有标题为点击入口，不新增可见组件；视觉与 h2 一致，仅加箭头暗示可点。
            <h2>
              <button type="button" className="g-title-link" onClick={() => navigate(group.titleTo!)}>
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
const SMART_CAMPUS_CHIP_LABELS: Partial<Record<SmartCampusModuleKey, string>> = {
  welcome: '迎新指引',
  luggage: '行李帮运',
  panorama: 'VR校园',
}

/** 动态专区行：百宝箱(z-plum) + 智慧校园(z-teal)；后台开关驱动，
 *  未启用不渲染，仅一个启用时 :only-child 自动通栏并多露预览签。 */
function ZoneRow() {
  const navigate = useNavigate()
  const toolbox = useToolboxConfig()
  const campus = useSmartCampusConfig()

  const toolboxItems = toolbox.enabled ? [...(toolbox.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder) : []
  const campusModules = (Object.keys(SMART_CAMPUS_CHIP_LABELS) as SmartCampusModuleKey[]).filter(
    (key) => campus.modules?.[key],
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
        // 百宝箱聚合入口 → /toolbox 区页（可启动 items + 启动弹窗 + 事件上报在该页保留）
        <button type="button" className="zone-card z-plum" onClick={() => navigate('/toolbox')}>
          <span className="z-top">
            <span className="z-icon">
              <ProtoIcon name="zone-toolbox" />
            </span>
            <span className="z-text">
              <b>百宝箱</b>
              <span className="z-sub">本机扩展服务，审核后上架</span>
            </span>
            <span className="z-side">
              <span className="z-tag">已审核</span>
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
              <i className="z-empty">待配置 · 审核后上架</i>
            )}
          </span>
        </button>
      )}
      {showCampus && (
        <button type="button" className="zone-card z-teal" onClick={() => navigate('/smart-campus')}>
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

/* ── 底部导航（原型 116px 三 Tab；首页 hideBottomNav 后由本组件自绘） ── */
function HomeNavbar() {
  const navigate = useNavigate()
  return (
    <nav className="navbar">
      <button type="button" className="nav-item active" aria-current="page">
        <ProtoIcon name="nav-home" />
        首页
      </button>
      <button type="button" className="nav-item" onClick={() => navigate('/assistant')}>
        <ProtoIcon name="nav-assistant" />
        AI助手
      </button>
      <button type="button" className="nav-item" onClick={() => navigate('/profile')}>
        <ProtoIcon name="user" />
        我的
      </button>
    </nav>
  )
}

export function HomePage() {
  const groups = SERVICE_GROUPS

  return (
    <KioskPageFrame className="kpv1" header={<KioskTopBar />} footer={<HomeNavbar />}>
      <HomeWelcome />
      {/* 继续上次：原型外生产动态状态。ContinuePanel 自门控——仅登录且确有可恢复任务
          （进行中打印/已诊断未优化简历）时渲染；无任务或匿名 → 返回 null，首页与原型 1:1。 */}
      <ContinuePanel />
      <main className="groups" aria-label="当前可使用功能">
        {groups.map((group) => (
          <ServiceCard key={group.id} group={group} />
        ))}
      </main>
      <ZoneRow />
      <div className="notice">
        <ProtoIcon name="info" />
        岗位与招聘会信息均来自第三方 / 官方来源，本终端仅提供信息展示与跳转，投递、预约请前往来源平台办理。
      </div>
    </KioskPageFrame>
  )
}
