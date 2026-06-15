import { useEffect, useState } from 'react'
import { Card, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { getSmartCampusTerminals, saveSmartCampusConfig, type PartnerSmartCampusTerminal } from '../../services/api'
import {
  ActivityIcon,
  CheckCircleIcon,
  GraduationCapIcon,
  InfoIcon,
  LockIcon,
  MonitorSmartphoneIcon,
  PartyPopperIcon,
} from 'lucide-react'

// ============================================================
// Partner 智慧校园 —— 仅「终端开关」为真实闭环（按 orgId 隔离 + 审计 + Kiosk 联动）。
//
// 迎新内容 / 使用统计：内容模型与统计回传尚未接入，故只展示「未开放」真实空态，
//   绝不再展示示例数据 / 原型假统计（避免冒充可用）。
// 校园大数据：本期严格冻结，机构端不展示入口，后端开关亦强制 false。
// 合规（compliance-boundary.md §九）：不采集学生个人明细，无招聘闭环语义。
// ============================================================

type SmartCampusTab = 'terminals' | 'orientation' | 'usage'
type SwitchState = 'on' | 'off'
type ModuleColumn = 'enabled' | 'welcome' | 'bigdata' | 'luggage' | 'panorama'

const TABS: Array<{ key: SmartCampusTab; label: string; icon: typeof GraduationCapIcon }> = [
  { key: 'terminals', label: '终端开关', icon: MonitorSmartphoneIcon },
  { key: 'orientation', label: '迎新内容', icon: PartyPopperIcon },
  { key: 'usage', label: '使用统计', icon: ActivityIcon },
]

const MODULE_HEADERS: Array<{ key: ModuleColumn; label: string; disabled?: boolean; title?: string }> = [
  { key: 'enabled', label: '智慧校园' },
  { key: 'welcome', label: '迎新' },
  { key: 'bigdata', label: '大数据', disabled: true, title: '校园大数据本期冻结，不开放机构端开启' },
  { key: 'luggage', label: '行李' },
  { key: 'panorama', label: '全景' },
]

function SwitchPill({ state, disabled = false, onClick, title }: { state: SwitchState; disabled?: boolean; onClick?: () => void; title?: string }) {
  const content = (
    <span
      className={`relative inline-flex h-[18px] w-[34px] rounded-full align-middle transition-colors ${
        state === 'on' ? 'bg-primary-600' : 'bg-slate-300'
      }`}
      aria-label={state === 'on' ? '已开启' : '已关闭'}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform ${
          state === 'on' ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </span>
  )
  if (!onClick) return content
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className="inline-flex h-8 min-w-10 items-center justify-center disabled:cursor-not-allowed disabled:opacity-60"
      aria-label={title ?? (state === 'on' ? '关闭开关' : '开启开关')}
    >
      {content}
    </button>
  )
}

function SmartCampusTabs({ active, onChange }: { active: SmartCampusTab; onChange: (tab: SmartCampusTab) => void }) {
  return (
    <Card className="p-0">
      <div className="grid gap-1 p-2 sm:grid-cols-3">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const selected = active === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onChange(tab.key)}
              className={`flex h-12 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors ${
                selected ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {tab.label}
            </button>
          )
        })}
      </div>
    </Card>
  )
}

/** 未接入后端的子区统一空态：明确「未开放」原因，不展示任何假数据。 */
function NotOpenState({ title, reason }: { title: string; reason: string }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
        <LockIcon className="h-7 w-7 text-gray-400" aria-hidden="true" />
      </div>
      <div>
        <p className="text-base font-semibold text-gray-900">{title}</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-gray-500">{reason}</p>
      </div>
    </Card>
  )
}

function getTerminalConfig(terminal: PartnerSmartCampusTerminal) {
  return terminal.config ?? {
    terminalId: terminal.terminalId,
    enabled: false,
    modules: { welcome: false, bigdata: false, luggage: false, panorama: false },
    updatedAt: null,
  }
}

function getSwitchState(terminal: PartnerSmartCampusTerminal, key: ModuleColumn): SwitchState {
  const config = getTerminalConfig(terminal)
  if (key === 'enabled') return config.enabled ? 'on' : 'off'
  return config.modules[key] ? 'on' : 'off'
}

function TerminalsPanel() {
  const [terminals, setTerminals] = useState<PartnerSmartCampusTerminal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedHint, setSavedHint] = useState(false)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    getSmartCampusTerminals()
      .then((rows) => {
        if (!mounted) return
        setTerminals(rows)
        setError(null)
      })
      .catch((err) => {
        if (!mounted) return
        setError(err instanceof Error ? err.message : '终端配置加载失败')
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => { mounted = false }
  }, [])

  async function toggle(terminal: PartnerSmartCampusTerminal, key: ModuleColumn) {
    if (key === 'bigdata') return
    const config = getTerminalConfig(terminal)
    const nextModules = { ...config.modules, bigdata: false }
    let nextEnabled = config.enabled
    if (key === 'enabled') {
      nextEnabled = !config.enabled
      if (nextEnabled && !nextModules.welcome && !nextModules.luggage && !nextModules.panorama) {
        nextModules.welcome = true
      }
    } else {
      nextModules[key] = !nextModules[key]
      nextEnabled = nextEnabled && (nextModules.welcome || nextModules.luggage || nextModules.panorama)
    }

    const id = terminal.terminalId
    const rowKey = `${id}:${key}`
    setSavingKey(rowKey)
    setSavedHint(false)
    try {
      const saved = await saveSmartCampusConfig(id, { enabled: nextEnabled, modules: nextModules })
      setTerminals((rows) => rows.map((row) => row.terminalId === id ? { ...row, config: saved } : row))
      setError(null)
      setSavedHint(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试')
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <section className="space-y-4" aria-label="终端开关">
      <div>
        <h2 className="text-lg font-bold text-gray-900">终端开关</h2>
        <p className="mt-0.5 text-sm text-gray-500">开启后该机器前端首页显示「智慧校园」模块；关闭即整张隐藏。</p>
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-blue-900">
          学校账号只能查看和配置归属本校的终端。校园大数据本期冻结，机构端不可开启；保存后 Kiosk 首页会按终端配置显示或隐藏「智慧校园」。
        </p>
      </div>
      {error ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {savedHint && !error ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          已保存，Kiosk 刷新首页或下一轮拉取（约 5 分钟）后生效。
        </div>
      ) : null}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-gray-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-medium">终端编码</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">位置</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">状态</th>
                {MODULE_HEADERS.map((h) => (
                  <th key={h.key} className="whitespace-nowrap px-4 py-3 text-center font-medium">{h.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">正在加载终端配置…</td>
                </tr>
              ) : terminals.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">暂无归属本机构的终端，请先由平台管理员完成终端归属指派。</td>
                </tr>
              ) : terminals.map((terminal) => (
                <tr key={terminal.terminalId} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">{terminal.terminalCode ?? terminal.terminalId}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{terminal.orgName ?? '本机构'}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge status={terminal.isOnline ? 'success' : 'default'} label={terminal.isOnline ? '在线' : '离线'} />
                  </td>
                  {MODULE_HEADERS.map((header) => (
                    <td key={`${terminal.terminalId}-${header.key}`} className="px-4 py-3 text-center">
                      <SwitchPill
                        state={getSwitchState(terminal, header.key)}
                        disabled={header.disabled || savingKey === `${terminal.terminalId}:${header.key}`}
                        title={header.title ?? `切换${header.label}`}
                        onClick={() => toggle(terminal, header.key)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-gray-400">提示：终端归属由平台管理员维护；机构端保存动作会写入审计日志，便于追踪配置变更。</p>
    </section>
  )
}

function OrientationPanel() {
  return (
    <section className="space-y-4" aria-label="迎新内容管理">
      <div>
        <h2 className="text-lg font-bold text-gray-900">迎新内容管理</h2>
        <p className="mt-0.5 text-sm text-gray-500">维护报到流程、办事窗口、官方链接，提交后经平台审核上终端。</p>
      </div>
      <NotOpenState
        title="迎新内容管理尚未开放"
        reason="内容模型与平台审核流尚未接入，机构端暂不能在此录入或编辑迎新内容；开放前终端不展示任何示例内容。功能上线后将在此维护报到流程、办事窗口与官方外链，并经平台审核后下发终端。"
      />
    </section>
  )
}

function UsagePanel() {
  return (
    <section className="space-y-4" aria-label="使用统计">
      <div>
        <h2 className="text-lg font-bold text-gray-900">使用统计</h2>
        <p className="mt-0.5 text-sm text-gray-500">平台生成回传，反映本校终端上智慧校园功能的使用情况，不含个人信息。</p>
      </div>
      <NotOpenState
        title="使用统计尚未开放"
        reason="平台使用统计回传管线尚未接入，暂无可展示的真实数据；开放前不展示任何示例统计。功能上线后将在此查看本校终端的智慧校园浏览与导流情况（仅聚合，不含个人信息）。"
      />
    </section>
  )
}

export default function SmartCampusPage() {
  const [activeTab, setActiveTab] = useState<SmartCampusTab>('terminals')
  const activeLabel = TABS.find((tab) => tab.key === activeTab)?.label ?? '终端开关'

  return (
    <Page
      title="智慧校园"
      subtitle="合作机构（学校）后台管理区 · 终端开关按 orgId 隔离已联动 Kiosk"
    >
      <div className="space-y-5">
        <Card className="border-blue-100 bg-blue-50/50 p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
              <GraduationCapIcon className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900">智慧校园 · 终端开关已联动</h2>
                <StatusBadge status="success" label="终端开关已联动" />
              </div>
              <p className="mt-1 text-sm leading-6 text-gray-600">
                「终端开关」已接通后端：学校账号按 orgId 隔离，只配置归属本校的终端，保存即联动 Kiosk 首页智慧校园显隐。迎新内容 / 使用统计在内容模型与统计管线接入前显示「未开放」，不展示任何示例数据；校园大数据本期严格冻结。
              </p>
            </div>
          </div>
        </Card>

        <SmartCampusTabs active={activeTab} onChange={setActiveTab} />

        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>智慧校园</span>
          <span>/</span>
          <span className="font-medium text-gray-700">{activeLabel}</span>
        </div>

        {activeTab === 'terminals' && <TerminalsPanel />}
        {activeTab === 'orientation' && <OrientationPanel />}
        {activeTab === 'usage' && <UsagePanel />}

        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
          <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-amber-900">
            「终端开关」已接通真实后端（含机构隔离与审计）。「迎新内容 / 使用统计」在内容模型与统计回传补齐前显示「未开放」真实空态，不展示任何示例数据；「校园大数据」本期严格冻结。
          </p>
        </div>
      </div>
    </Page>
  )
}
