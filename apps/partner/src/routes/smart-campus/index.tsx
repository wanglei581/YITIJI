import { useEffect, useState } from 'react'
import { Button, Card, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { getSmartCampusTerminals, saveSmartCampusConfig, type PartnerSmartCampusTerminal } from '../../services/api'
import {
  ActivityIcon,
  AlertTriangleIcon,
  BarChart3Icon,
  BellIcon,
  CheckCircleIcon,
  GraduationCapIcon,
  InfoIcon,
  LinkIcon,
  MonitorSmartphoneIcon,
  PartyPopperIcon,
  PencilIcon,
  PlusIcon,
  QrCodeIcon,
  SearchIcon,
  ShieldCheckIcon,
} from 'lucide-react'

type SmartCampusTab = 'terminals' | 'orientation' | 'bigdata' | 'usage'
type SwitchState = 'on' | 'off'
type ModuleColumn = 'enabled' | 'welcome' | 'bigdata' | 'luggage' | 'panorama'

const TABS: Array<{ key: SmartCampusTab; label: string; icon: typeof GraduationCapIcon }> = [
  { key: 'terminals', label: '终端开关', icon: MonitorSmartphoneIcon },
  { key: 'orientation', label: '迎新内容', icon: PartyPopperIcon },
  { key: 'bigdata', label: '校园大数据', icon: BarChart3Icon },
  { key: 'usage', label: '使用统计', icon: ActivityIcon },
]

const MODULE_HEADERS: Array<{ key: ModuleColumn; label: string; disabled?: boolean; title?: string }> = [
  { key: 'enabled', label: '智慧校园' },
  { key: 'welcome', label: '迎新' },
  { key: 'bigdata', label: '大数据', disabled: true, title: '校园大数据本期冻结，不开放机构端开启' },
  { key: 'luggage', label: '行李' },
  { key: 'panorama', label: '全景' },
]

const FLOW_STEPS = [
  { step: 1, title: '线上预报到', desc: '前往学校迎新官网/公众号完成信息确认', status: '已上线', badge: 'success' as const },
  { step: 2, title: '学院报到', desc: '到所在学院迎新点核验、领取材料', status: '已上线', badge: 'success' as const },
  { step: 3, title: '宿舍入住 / 校园卡激活', desc: '领取钥匙、办理水电网', status: '待审核', badge: 'warning' as const },
]

const WINDOWS = [
  ['学生处', '行政楼 1F'],
  ['财务处', '行政楼 2F'],
  ['校医院', '东门内 50m'],
]

const STAT_ROWS = [
  { metric: '性别比例', dimension: '性别', valueName: '男', value: '3,370', visibility: '公共展示', visibilityStyle: 'bg-blue-50 text-blue-600', review: '已通过', reviewBadge: 'success' as const },
  { metric: '性别比例', dimension: '性别', valueName: '女', value: '2,870', visibility: '公共展示', visibilityStyle: 'bg-blue-50 text-blue-600', review: '已通过', reviewBadge: 'success' as const },
  { metric: '专业规模', dimension: '专业', valueName: '高分子材料', value: '620', visibility: '公共展示', visibilityStyle: 'bg-blue-50 text-blue-600', review: '已通过', reviewBadge: 'success' as const },
  { metric: '专业规模', dimension: '专业', valueName: '中外合作小专业', value: '<10 已合并', visibility: '隐藏', visibilityStyle: 'bg-gray-100 text-gray-500', review: 'k-匿名', reviewBadge: 'default' as const, muted: true },
  { metric: '报到率', dimension: '全校', valueName: '—', value: '94%', visibility: '仅后台', visibilityStyle: 'bg-neutral-100 text-gray-600', review: '待审核', reviewBadge: 'warning' as const },
]

const USAGE_METRICS = [
  { value: '12,480', label: '智慧校园浏览' },
  { value: '8,920', label: '待机唤醒' },
  { value: '3,140', label: '迎新点击' },
  { value: '1,260', label: '导流到打印/简历' },
]

const TREND = [55, 48, 70, 62, 100, 88, 82]
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const MODULE_USAGE = [
  ['迎新系统', 42],
  ['导流求职打印主业', 28],
  ['行李帮运', 18],
  ['校园全景', 12],
] as const

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

function DisabledIconButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      title="写入端点未接入，当前仅按原型恢复展示"
      className="text-gray-300"
      aria-label={label}
    >
      <PencilIcon className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

function TopToolbar() {
  return (
    <div className="flex items-center gap-1 text-gray-400">
      <button type="button" disabled className="flex h-8 w-8 items-center justify-center rounded-md text-gray-300" title="搜索端点未接入">
        <SearchIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" disabled className="flex h-8 w-8 items-center justify-center rounded-md text-gray-300" title="通知端点未接入">
        <BellIcon className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

function SmartCampusTabs({ active, onChange }: { active: SmartCampusTab; onChange: (tab: SmartCampusTab) => void }) {
  return (
    <Card className="p-0">
      <div className="grid gap-1 p-2 sm:grid-cols-4">
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
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">迎新内容管理</h2>
          <p className="mt-0.5 text-sm text-gray-500">维护报到流程、办事窗口、官方链接，提交后经平台审核上终端。</p>
        </div>
        <Button size="sm" disabled title="OrientationContent 写入端点未接入">
          <PlusIcon className="mr-1 h-4 w-4" aria-hidden="true" />
          新增内容
        </Button>
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-4 py-3">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-emerald-900">
          仅信息展示 + 官方外链，不在终端采集任何学生个人信息。报到登记请引导至学校官方系统。
        </p>
      </div>

      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold text-gray-700">报到流程</p>
        <div className="space-y-2">
          {FLOW_STEPS.map((step) => (
            <div key={step.step} className="flex items-center gap-3 rounded-lg border border-neutral-100 bg-neutral-50 px-4 py-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-600">{step.step}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-800">{step.title}</p>
                <p className="text-xs text-gray-400">{step.desc}</p>
              </div>
              <StatusBadge status={step.badge} label={step.status} />
              <DisabledIconButton label={`编辑${step.title}`} />
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <p className="mb-3 text-sm font-semibold text-gray-700">办事窗口</p>
          <div className="space-y-1.5 text-sm text-gray-700">
            {WINDOWS.map(([name, location]) => (
              <div key={name} className="flex justify-between rounded-md bg-neutral-50 px-3 py-2">
                <span>{name}</span>
                <span className="text-gray-400">{location}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <p className="mb-3 text-sm font-semibold text-gray-700">官方链接（外链/二维码）</p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 rounded-md bg-neutral-50 px-3 py-2">
              <LinkIcon className="h-4 w-4 text-gray-400" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-gray-700">迎新官网 yingxin.qust.edu.cn</span>
              <StatusBadge status="success" label="已上线" />
            </div>
            <div className="flex items-center gap-2 rounded-md bg-neutral-50 px-3 py-2">
              <QrCodeIcon className="h-4 w-4 text-gray-400" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-gray-700">迎新服务号（二维码）</span>
              <StatusBadge status="success" label="已上线" />
            </div>
          </div>
        </Card>
      </div>
    </section>
  )
}

function BigDataPanel() {
  return (
    <section className="space-y-4" aria-label="校园大数据录入">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">校园大数据录入</h2>
          <p className="mt-0.5 text-sm text-gray-500">只录入聚合统计数字；提交后经平台审核与脱敏校验上终端。</p>
        </div>
        <Button size="sm" disabled title="CampusStatistic 写入端点未接入">
          <PlusIcon className="mr-1 h-4 w-4" aria-hidden="true" />
          新增指标
        </Button>
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-amber-900">
          <span className="font-semibold">合规要求：</span>只接收已聚合脱敏的统计数字，禁止录入学生个人明细；样本量低于阈值的分组自动合并。
        </p>
      </div>
      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold text-gray-700">数据接入方式</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-lg border-2 border-primary-500 bg-primary-50 px-4 py-2 text-sm font-medium text-primary-700">手工录入</button>
          <button type="button" disabled title="汇总 Excel 端点未接入" className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-gray-400">汇总 Excel 上传</button>
          <button type="button" disabled title="校园聚合 API worker 未接入" className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-gray-400">API 对接学校系统</button>
        </div>
        <p className="mt-2 text-xs text-gray-400">手工录入最安全，适合绝大多数学校；API 仅适合接口只返回聚合数字的学校。</p>
      </Card>
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-gray-500">
              <tr>
                {['指标', '维度', '取值', '数值', '可见范围', '审核'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 font-medium last:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 text-gray-700">
              {STAT_ROWS.map((row) => (
                <tr key={`${row.metric}-${row.valueName}`} className={row.muted ? 'bg-amber-50/40 text-gray-400' : ''}>
                  <td className="whitespace-nowrap px-4 py-3">{row.metric}</td>
                  <td className="whitespace-nowrap px-4 py-3">{row.dimension}</td>
                  <td className="whitespace-nowrap px-4 py-3">{row.valueName}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{row.value}</td>
                  <td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${row.visibilityStyle}`}>{row.visibility}</span></td>
                  <td className="whitespace-nowrap px-4 py-3"><StatusBadge status={row.reviewBadge} label={row.review} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-gray-400">「公共展示」= 可在一体机前端给新生/家长看；「仅后台」= 只给校领导/运营看，不进公共终端。</p>
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {USAGE_METRICS.map((m) => (
          <Card key={m.label} className="p-4">
            <p className="text-2xl font-bold text-gray-900">{m.value}</p>
            <p className="mt-1 text-xs text-gray-500">{m.label}</p>
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <p className="mb-4 text-sm font-semibold text-gray-700">近 7 天浏览趋势</p>
        <div className="flex h-36 items-end justify-between gap-3">
          {TREND.map((height, index) => (
            <div key={DAYS[index]} className="flex flex-1 flex-col items-center justify-end gap-1">
              <div className={`w-full rounded-t ${height === 100 ? 'bg-primary-600' : height > 80 ? 'bg-primary-400' : 'bg-primary-500'}`} style={{ height: `${height}%` }} />
              <span className="text-[11px] text-gray-400">{DAYS[index]}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold text-gray-700">分功能使用占比</p>
        <div className="space-y-2.5 text-sm">
          {MODULE_USAGE.map(([name, percent]) => (
            <div key={name}>
              <div className="mb-1 flex justify-between text-gray-700">
                <span>{name}</span>
                <span className="tabular-nums text-gray-400">{percent}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-neutral-100"><div className="h-2.5 rounded-full bg-indigo-500" style={{ width: `${percent}%` }} /></div>
            </div>
          ))}
        </div>
      </Card>
    </section>
  )
}

export default function SmartCampusPage() {
  const [activeTab, setActiveTab] = useState<SmartCampusTab>('terminals')
  const activeLabel = TABS.find((tab) => tab.key === activeTab)?.label ?? '终端开关'

  return (
    <Page
      title="智慧校园"
      subtitle="合作机构（学校）后台管理区 · 终端开关按 orgId 隔离已联动 Kiosk，其余子区为原型"
      actions={<TopToolbar />}
    >
      <div className="space-y-5">
        <Card className="border-blue-100 bg-blue-50/50 p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
              <GraduationCapIcon className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900">青岛科技大学就业中心 · 智慧校园</h2>
                <StatusBadge status="success" label="终端开关已联动" />
              </div>
              <p className="mt-1 text-sm leading-6 text-gray-600">
                「终端开关」已接通后端：学校账号按 orgId 隔离，只配置归属本校的终端，保存即联动 Kiosk 首页智慧校园显隐。迎新内容 / 校园大数据 / 使用统计仍为原型，待内容模型与审核流补齐后开放。
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
        {activeTab === 'bigdata' && <BigDataPanel />}
        {activeTab === 'usage' && <UsagePanel />}

        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
          <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-amber-900">
            「终端开关」已接通真实后端（含机构隔离与审计）。「迎新内容 / 校园大数据 / 使用统计」仍为原型展示，相关新增 / 编辑动作在内容模型与合规审核补齐前保持禁用。
          </p>
        </div>
      </div>
    </Page>
  )
}
