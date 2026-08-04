// 首页 · prototype-v1 内容区（docs/design/kiosk-proto-2026-07/01-home.html）
//
// 顶栏(76) + 底栏(116) 由共享 KioskLayout 提供；本页只渲染欢迎区 / 磁贴组 /
// 动态专区 / 合规提示。最高真值仍是原型 shared.css + 01-home 内容节点。
//
// 保留的真实能力：真实路由(serviceGroups)、真实登录弹窗、百宝箱/智慧校园
// 后台动态开关。登录态为「原型外动态状态」：复用 88px 登录框，文字改「进入我的」。
import type { SmartCampusModuleKey } from '@ai-job-print/shared'
import { KioskPageFrame } from '@ai-job-print/ui'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useSmartCampusConfig } from '../../hooks/useSmartCampusConfig'
import { useToolboxConfig } from '../../hooks/useToolboxConfig'
import { MemberLoginDialog } from '../auth/components/MemberLoginDialog'
import { ContinuePanel } from './components/ContinuePanel'
import { ProtoIcon } from './prototypeIcons'
import { type Accent, type ServiceGroup, type ServiceTile } from './serviceGroups'
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
          简历、岗位、打印，<em>一趟办完</em>
        </h1>
        <p>现场准备材料、了解机会，并在本机完成打印扫描</p>
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

/** AI 接待区（原型 design-d .reception + .ar-card + .device-card）
 * 作用：让小青主动引导用户描述需求 → 进入 AI 顾问（/assistant）。
 * 设备状态静态展示就绪状态（无真实 hook 时保持静态）。
 */
function HomeReception() {
  const navigate = useNavigate()

  return (
    <section className="reception">
      {/* 左：AI 接待台卡片 */}
      <div className="ar-card">
        <div className="ar-top">
          <span className="ar-badge">
            <span className="dot" />AI接待台 · 等待目标
          </span>
        </div>
        <p className="ar-h">不知道从哪开始？说出你想办的事</p>
        <div className="ar-input-row">
          <div className="ar-input-placeholder">例如：我周五参加招聘会，需要准备简历并打印</div>
          <button
            type="button"
            className="ar-mic"
            aria-label="语音输入"
            onClick={() => navigate('/assistant')}
          >
            {/* mic 图标不在 ProtoIcon P 表，直接内联 */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <path d="M12 2a3 3 0 013 3v6a3 3 0 01-6 0V5a3 3 0 013-3z" />
              <path d="M19 11a7 7 0 01-14 0M12 18v4M8 22h8" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          className="ar-cta"
          onClick={() => navigate('/assistant')}
        >
          让小青安排
        </button>
        <p className="ar-hint">将进入 AI 顾问，由你确认办理方案</p>
        <div className="ar-chips">
          <button type="button" className="ar-chip" onClick={() => navigate('/assistant', { state: { topic: 'resume' } })}>
            <ProtoIcon name="diagnose" />优化简历并打印
          </button>
          <button type="button" className="ar-chip" onClick={() => navigate('/assistant', { state: { topic: 'jobfair' } })}>
            <ProtoIcon name="fair-social" />准备招聘会材料
          </button>
          <button type="button" className="ar-chip" onClick={() => navigate('/print/upload')}>
            <ProtoIcon name="printer" />打印手机里的文件
          </button>
        </div>
      </div>
      {/* 右：本机能力卡片 */}
      <div className="device-card">
        <h3>本机办结能力</h3>
        <p className="dc-sub">AI 调用设备，现场完成</p>
        <div className="dc-items">
          <div className="dc-item">
            <div className="dc-left">
              <ProtoIcon name="printer" /><span>文档打印就绪</span>
            </div>
            <span className="dc-dot" />
          </div>
          <div className="dc-item">
            <div className="dc-left">
              <ProtoIcon name="scan" /><span>材料扫描就绪</span>
            </div>
            <span className="dc-dot" />
          </div>
          <div className="dc-item">
            <div className="dc-left">
              <ProtoIcon name="id-copy" /><span>自动双面可用</span>
            </div>
            <span className="dc-dot" />
          </div>
        </div>
        <div className="dc-footer">
          <ProtoIcon name="info" />设备状态实时检测
        </div>
      </div>
    </section>
  )
}

/** AI 能力调度分隔条（原型 design-d .dispatch） */
function HomeDispatch() {
  return (
    <div className="dispatch">
      <div className="d-line" />
      <span className="d-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path d="M12 2l2.4 2.4L17 3l.6 2.8 2.8.6-1.4 2.6 1.4 2.6-2.8.6L17 15l-2.6-1.4L12 15l-2.4-1.4L7 15l-.6-2.8-2.8-.6 1.4-2.6L3.6 6.4l2.8-.6L7 3z" />
        </svg>
        AI 能力调度
      </span>
      <div className="d-line" />
    </div>
  )
}

/* ── 单个服务卡（原型统一 .tile 网格；废弃 primary/secondary 两级） ── */
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
      className={`card ${wide ? 'wide' : ''} ${ACCENT_CLASS[group.accent]}`.trim().replace(/\s+/g, ' ')}
      data-group-id={group.id}
    >
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
export function ZoneRow() {
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

/** 继续办理横幅 — 未登录时显示登录引导 */
function HomeContinueBar() {
  const navigate = useNavigate()
  const { isLoggedIn } = useAuth()
  if (isLoggedIn) return null
  return (
    <div className="continue-bar">
      <div className="cb-body">
        <b>继续办理</b>
        <span>登录后可查看并继续本人未完成事项</span>
      </div>
      <button type="button" className="cb-btn" onClick={() => navigate('/login')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" />
        </svg>
        登录后查看
      </button>
    </div>
  )
}

/** 8个扁平服务磁贴网格 */
function SvcGrid() {
  const navigate = useNavigate()
  const tiles = [
    { to: '/print-scan',       accent: 'a-slate', icon: 'group-print',     title: '打印扫描',   sub: '上传、扫描与本机出纸',   aiChip: 'AI文件预检' },
    { to: '/resume-service',   accent: 'a-teal',  icon: 'group-resume',    title: 'AI简历服务', sub: '诊断、优化、生成与打印', aiChip: 'AI诊断优化' },
    { to: '/jobs-service',     accent: 'a-clay',  icon: 'group-jobs',      title: '岗位信息',   sub: '查看第三方来源岗位',     aiChip: 'AI岗位研判' },
    { to: '/fairs-service',    accent: 'a-wheat', icon: 'group-fairs',     title: '招聘会',     sub: '场次、企业与现场导览',   aiChip: 'AI材料清单' },
    { to: '/interview-service',accent: 'a-plum',  icon: 'group-interview', title: 'AI面试训练', sub: '模拟问答与训练报告',     aiChip: 'AI模拟反馈' },
    { to: '/policy-service',   accent: 'a-wheat', icon: 'group-policy',    title: '政策服务',   sub: '政策查询与材料指引',     aiChip: 'AI来源解读' },
    { to: '/toolbox',          accent: 'a-plum',  icon: 'zone-toolbox',    title: '百宝箱',     sub: '证件照、文档与实用工具', aiChip: 'AI受控工具' },
    { to: '/smart-campus',     accent: 'a-teal',  icon: 'zone-campus',     title: '智慧校园',   sub: '校园服务与信息展示',     aiChip: 'AI场景引导' },
  ]
  return (
    <div className="svc-grid" role="navigation" aria-label="服务入口">
      {tiles.map((t) => (
        <button key={t.to} type="button" className={`svc-tile ${t.accent}`} onClick={() => navigate(t.to)}>
          <span className="st-icon">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <ProtoIcon name={t.icon as any} />
          </span>
          <span className="st-body">
            <b>{t.title}</b>
            <span className="st-sub">{t.sub}</span>
            <span className="ai-chip">{t.aiChip}</span>
          </span>
          <svg className="st-arr" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      ))}
    </div>
  )
}

export function HomePage() {
  return (
    <KioskPageFrame className="kpv1 kpv1--content-only">
      <HomeWelcome />
      <ContinuePanel />
      <HomeReception />
      <HomeDispatch />
      <HomeContinueBar />
      <div className="svc-header">
        <span className="svc-title">核心服务</span>
        <span className="svc-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} style={{ width: 16, height: 16 }}>
            <path d="M12 2l2.4 2.4L17 3l.6 2.8 2.8.6-1.4 2.6 1.4 2.6-2.8.6L17 15l-2.6-1.4L12 15l-2.4-1.4L7 15l-.6-2.8-2.8-.6 1.4-2.6L3.6 6.4l2.8-.6L7 3z" />
          </svg>
          AI增强服务
        </span>
        <span className="svc-hint">知道要办什么，也可以直接进入</span>
      </div>
      <SvcGrid />
      <div className="notice">
        <ProtoIcon name="info" />
        岗位与招聘会信息均来自第三方 / 官方来源，本终端仅提供信息展示与跳转，投递、预约请前往来源平台办理。
      </div>
      <footer className="filing-info" aria-label="网站备案信息">
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
          鲁ICP备2026023517号-2
        </a>
        <span aria-hidden="true">·</span>
        <a
          href="https://beian.mps.gov.cn/#/query/webSearch?code=37021402007308"
          target="_blank"
          rel="noreferrer"
        >
          鲁公网安备37021402007308号
        </a>
        <span aria-hidden="true">·</span>
        <span className="filing-brand">职易达AI</span>
      </footer>
    </KioskPageFrame>
  )
}
