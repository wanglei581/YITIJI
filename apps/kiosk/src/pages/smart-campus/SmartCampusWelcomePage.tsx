// ============================================================
// SmartCampusWelcomePage — 迎新系统（/smart-campus/welcome）
//
// 本期（Phase 1）为静态只读信息 + 官方指引 + 导回求职打印主业。
// 合规（compliance-boundary.md §九 9.4）：仅信息展示，不在本终端采集任何
// 学生身份 / 报到信息；报到登记一律引导至学校官方系统。
// ============================================================

import { useNavigate } from 'react-router-dom'
import {
  ChevronRightIcon,
  FileSearchIcon,
  FileTextIcon,
  MapPinIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserSquareIcon,
  type LucideIcon,
} from 'lucide-react'
import '../prototype/kiosk-prototype.css'

const FLOW_STEPS = [
  { title: '线上预报到', sub: '前往学校迎新官网 / 公众号完成信息确认' },
  { title: '学院报到', sub: '到所在学院迎新点核验、领取材料' },
  { title: '宿舍入住', sub: '领取钥匙 / 校园卡，办理水电网' },
  { title: '校园卡激活', sub: '食堂 / 门禁 / 图书馆通用' },
]

const SERVICE_WINDOWS = [
  { name: '学生处', loc: '行政楼 1F' },
  { name: '财务处', loc: '行政楼 2F' },
  { name: '后勤服务', loc: '综合楼 1F' },
  { name: '校医院', loc: '东门内 50m' },
]

interface PrepEntry {
  icon: LucideIcon
  label: string
  sub: string
  to: string
  /** 功能尚未上线，仅展示"即将上线"状态，不可点击 */
  comingSoon?: boolean
}

// 把迎新流量导回求职打印主业。
// 证件照排版打印功能尚未上线，以 disabled + "即将上线" 标签展示。
const PREP_ENTRIES: PrepEntry[] = [
  { icon: UserSquareIcon, label: '证件照排版打印', sub: '即将上线；当前可用手机照片自助打印', to: '/print-scan', comingSoon: true },
  { icon: FileTextIcon, label: '入学材料 / 表格打印', sub: '报到表、承诺书等自助打印', to: '/print/upload' },
  { icon: FileSearchIcon, label: '第一份简历 · AI 诊断', sub: '实习求职从这里开始', to: '/resume' },
]

export function SmartCampusWelcomePage() {
  const navigate = useNavigate()

  return (
    <div className="kproto kproto-teal">
      <div className="kproto-shell">
        <div className="kproto-pagehead">
          <button type="button" className="kproto-back" onClick={() => navigate('/smart-campus')}>返回</button>
          <div className="kproto-title">
            <h1>迎新系统</h1>
            <p>报到指引与入学准备 · 校方官方信息入口</p>
          </div>
          <div className="kproto-aside"><span className="kproto-badge">校方官方指引</span></div>
        </div>

        <main className="kproto-content">
          <div className="kproto-auth">
            <ShieldCheckIcon aria-hidden="true" />
            <p>校方官方信息入口，仅展示与指引，不在本终端采集任何个人信息；报到登记请前往学校官方系统办理。</p>
          </div>

          <div className="kproto-grid-2">
            <section className="kproto-card accented">
              <div className="kproto-card-head">
                <span className="kproto-icon"><FileTextIcon aria-hidden="true" /></span>
                <div><h2>报到流程</h2><div className="sub">四步完成入学报到</div></div>
              </div>
              <ol className="grid gap-0">
                {FLOW_STEPS.map((step, i) => (
                  <li key={step.title}>
                    <div className="flex items-start gap-5">
                      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[var(--kp-accent-soft)] font-serif text-[26px] font-bold text-[var(--kp-accent-deep)]">
                        {i + 1}
                      </span>
                      <div>
                        <b className="block pt-1 text-2xl">{step.title}</b>
                        <span className="mt-1.5 block text-lg leading-normal text-[var(--kp-muted)]">{step.sub}</span>
                      </div>
                    </div>
                    {i < FLOW_STEPS.length - 1 && (
                      <div className="ml-[27px] h-6 w-0.5 bg-[var(--kp-line)]" aria-hidden="true" />
                    )}
                  </li>
                ))}
              </ol>
            </section>

            <section className="kproto-card">
              <div className="kproto-card-head">
                <span className="kproto-icon"><SparklesIcon aria-hidden="true" /></span>
                <div><h2>入学 &amp; 求职准备</h2><div className="sub">本机即可办理</div></div>
              </div>
              <div className="grid gap-3">
                {PREP_ENTRIES.map((entry) => {
                  const Icon = entry.icon
                  if (entry.comingSoon) {
                    return (
                      <div key={entry.label} className="kproto-tile disabled" aria-disabled="true">
                        <span className="tile-icon"><Icon aria-hidden="true" /></span>
                        <span><b>{entry.label}</b><span>{entry.sub}</span></span>
                        <span className="ml-auto shrink-0 rounded-full border border-[var(--kp-line)] bg-[var(--kp-paper)] px-3 py-1 text-sm text-[var(--kp-muted)]">即将上线</span>
                      </div>
                    )
                  }
                  return (
                    <button key={entry.label} type="button" className="kproto-tile primary" onClick={() => navigate(entry.to)}>
                      <span className="tile-icon"><Icon aria-hidden="true" /></span>
                      <span><b>{entry.label}</b><span>{entry.sub}</span></span>
                      <ChevronRightIcon className="ml-auto h-6 w-6 shrink-0" aria-hidden="true" />
                    </button>
                  )
                })}
              </div>
            </section>
          </div>

          <section className="kproto-card">
            <div className="kproto-card-head">
              <span className="kproto-icon"><MapPinIcon aria-hidden="true" /></span>
              <div><h2>办事窗口</h2><div className="sub">现场办理与咨询点位</div></div>
            </div>
            <div className="kproto-grid-2">
              {SERVICE_WINDOWS.map((w) => (
                <div key={w.name} className="flex min-h-[86px] items-center gap-4 rounded-[14px] border border-[var(--kp-line)] bg-[var(--kp-paper)] px-6 py-4">
                  <MapPinIcon className="h-7 w-7 text-[var(--kp-muted)]" aria-hidden="true" />
                  <div><b className="block text-[21px]">{w.name}</b><span className="text-[17px] text-[var(--kp-muted)]">{w.loc}</span></div>
                </div>
              ))}
            </div>
          </section>

          <div className="kproto-notice mt-auto">
            <ShieldCheckIcon aria-hidden="true" />
            <p>报到登记、缴费等请以学校官方系统为准；本终端仅提供信息指引与求职打印服务。</p>
          </div>

          <div className="kproto-actionbar">
            <button type="button" className="kproto-btn" onClick={() => navigate('/smart-campus')}>返回智慧校园</button>
            <div className="kproto-spacer" />
            <button type="button" className="kproto-btn dark" onClick={() => navigate('/smart-campus/service/campus-card')}>校园卡办理指引</button>
          </div>
        </main>
      </div>
    </div>
  )
}
