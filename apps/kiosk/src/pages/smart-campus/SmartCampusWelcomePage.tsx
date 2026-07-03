// ============================================================
// SmartCampusWelcomePage — 迎新系统（/smart-campus/welcome）
//
// 本期（Phase 1）为静态只读信息 + 官方指引 + 导回求职打印主业。
// 合规（compliance-boundary.md §九 9.4）：仅信息展示，不在本终端采集任何
// 学生身份 / 报到信息；报到登记一律引导至学校官方系统。
// ============================================================

import { Button, Card } from '@ai-job-print/ui'
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
  to: string
}

// 把迎新流量导回求职打印主业（均为真实可达页面）。
const PREP_ENTRIES: PrepEntry[] = [
  { icon: UserSquareIcon, label: '证件照拍摄 / 打印', to: '/print-scan' },
  { icon: FileTextIcon, label: '入学材料 / 表格打印', to: '/print/upload' },
  { icon: FileSearchIcon, label: '第一份简历 · AI 诊断', to: '/resume' },
]

export function SmartCampusWelcomePage() {
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">迎新系统</h1>
          <p className="mt-0.5 text-sm text-neutral-500">报到指引与入学准备</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => navigate('/smart-campus')}>
          返回
        </Button>
      </div>

      {/* 合规来源条 */}
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-success-bg bg-success-bg/60 px-4 py-3">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success-fg" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-success-fg">
          校方官方信息入口，仅展示与指引，<span className="font-semibold">不在本终端采集任何个人信息</span>；
          报到登记请前往学校官方系统办理。
        </p>
      </div>

      {/* 报到流程 */}
      <Card className="mb-4 p-5">
        <p className="mb-3 text-sm font-semibold text-neutral-700">报到流程</p>
        <ol className="space-y-3">
          {FLOW_STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-plum-soft text-sm font-bold text-plum">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-neutral-900">{step.title}</p>
                <p className="mt-0.5 text-xs text-neutral-500">{step.sub}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {/* 办事窗口 */}
      <Card className="mb-4 p-5">
        <p className="mb-3 text-sm font-semibold text-neutral-700">办事窗口</p>
        <div className="grid grid-cols-2 gap-2">
          {SERVICE_WINDOWS.map((w) => (
            <div key={w.name} className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2">
              <MapPinIcon className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
              <div>
                <p className="text-sm text-neutral-800">{w.name}</p>
                <p className="text-[11px] text-neutral-400">{w.loc}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 入学 & 求职准备：导回求职打印主业 */}
      <Card className="mb-2 border-primary-200 bg-primary-50/40 p-5">
        <div className="mb-3 flex items-center gap-2">
          <SparklesIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
          <p className="text-sm font-semibold text-primary-700">入学 & 求职准备（本机即可办）</p>
        </div>
        <div className="space-y-2">
          {PREP_ENTRIES.map((entry) => {
            const Icon = entry.icon
            return (
              <button
                key={entry.label}
                type="button"
                onClick={() => navigate(entry.to)}
                className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-primary-200 active:bg-primary-50"
              >
                <Icon className="h-5 w-5 shrink-0 text-primary-600" aria-hidden="true" />
                <span className="flex-1 text-sm font-medium text-neutral-800">{entry.label}</span>
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </Card>

      <p className="px-1 pt-1 text-[11px] text-neutral-400">
        报到登记、缴费等请以学校官方系统为准；本终端仅提供信息指引与求职打印服务。
      </p>

      <div className="h-2" />
    </div>
  )
}
