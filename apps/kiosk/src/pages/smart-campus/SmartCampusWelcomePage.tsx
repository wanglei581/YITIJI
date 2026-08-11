// ============================================================
// SmartCampusWelcomePage — 迎新指引（/smart-campus/welcome）
//
// 本期（Phase 1）为通用流程参考 + 导回求职打印主业。
// 合规（compliance-boundary.md §九 9.4）：仅信息展示，不在本终端采集任何
// 学生身份 / 报到信息；报到登记一律引导至学校官方系统。
//
// ⚠️ 2026-08-11 修正（CLAUDE.md §9 不伪造能力）：
// 本页此前把硬编码的四个办事窗口（含「行政楼 1F」「东门内 50m」等具体楼栋位置）
// 与「校方官方指引 / 校方官方信息入口」徽标一起展示，构成**编造校方信息 + 不实接入暗示**。
// 现已：① 删除编造的窗口位置，改为诚实空态；② 全部「校方官方」字样改为中性表述；
// ③ 报到流程明确标注为「通用参考」，不声称来自任何学校。
// 校方真实内容需等 CampusInfoEdition / CampusServiceWindow 模型落地后由学校配置下发，
// 在那之前**不得**再以任何形式声称本页内容来自校方。
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
import { FusionBadge, KioskPageFrame } from '../jobs/components/W4Presentation'

// 通用报到流程参考——**不针对任何具体学校**，仅描述高校迎新的普遍环节。
// 各校实际安排以学校官方通知为准，页面已就此明确标注。
const FLOW_STEPS = [
  { title: '线上预报到', sub: '前往学校迎新官网 / 公众号完成信息确认' },
  { title: '学院报到', sub: '到所在学院迎新点核验、领取材料' },
  { title: '宿舍入住', sub: '领取钥匙 / 校园卡，办理水电网' },
  { title: '校园卡激活', sub: '食堂 / 门禁 / 图书馆通用' },
]

// ⚠️ 原 SERVICE_WINDOWS 硬编码了「行政楼 1F」「东门内 50m」等具体楼栋位置。
// 这些位置**不来自任何学校**，属编造信息，已于 2026-08-11 删除（CLAUDE.md §9）。
// 恢复展示的前提：CampusServiceWindow 模型落地 + 学校在 Partner 后台配置 + 审核发布。

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
    <KioskPageFrame
      tone="wheat"
      title="迎新指引"
      subtitle="通用报到流程参考与入学准备"
      backLabel="返回智慧校园"
      onBack={() => navigate('/smart-campus')}
      badge={<FusionBadge>通用参考</FusionBadge>}
    >
        <div className="kproto kproto-teal kproto-content">
          <div className="kproto-auth">
            <ShieldCheckIcon aria-hidden="true" />
            <p>本页为通用流程参考，<b>不代表任何具体学校的安排</b>；实际报到流程、时间与地点请以学校官方通知为准。本终端不采集任何个人信息，报到登记请前往学校官方系统办理。</p>
          </div>

          <div className="kproto-grid-2">
            <section className="kproto-card accented">
              <div className="kproto-card-head">
                <span className="kproto-icon"><FileTextIcon aria-hidden="true" /></span>
                <div><h2>报到流程</h2><div className="sub">通用参考 · 以学校官方通知为准</div></div>
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

          {/* 办事窗口：本机尚未接入学校数据，展示诚实空态而非编造点位 */}
          <section className="kproto-card">
            <div className="kproto-card-head">
              <span className="kproto-icon"><MapPinIcon aria-hidden="true" /></span>
              <div><h2>办事窗口</h2><div className="sub">需学校配置后展示</div></div>
            </div>
            <div className="flex min-h-[120px] flex-col items-center justify-center gap-3 rounded-[14px] border border-dashed border-[var(--kp-line)] bg-[var(--kp-paper)] px-6 py-8 text-center">
              <MapPinIcon className="h-9 w-9 text-[var(--kp-muted)]" aria-hidden="true" />
              <p className="text-[19px] leading-relaxed text-[var(--kp-muted)]">
                本机尚未接入学校办事窗口信息<br />
                <span className="text-[17px]">请以学校迎新指南或官方公众号为准</span>
              </p>
            </div>
          </section>

          <div className="kproto-notice mt-auto">
            <ShieldCheckIcon aria-hidden="true" />
            <p>报到登记、缴费、宿舍分配等请以学校官方系统为准；本终端仅提供通用信息参考与求职打印服务。</p>
          </div>

          <div className="kproto-actionbar">
            <button type="button" className="kproto-btn" onClick={() => navigate('/smart-campus')}>返回智慧校园</button>
            <div className="kproto-spacer" />
            <button type="button" className="kproto-btn dark" onClick={() => navigate('/smart-campus/service/campus-card')}>校园卡办理指引</button>
          </div>
        </div>
    </KioskPageFrame>
  )
}
