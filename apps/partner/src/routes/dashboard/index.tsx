import { Card } from '@ai-job-print/ui'
import { Page } from '../Page'
import {
  BriefcaseIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  ExternalLinkIcon,
  MonitorIcon,
  PrinterIcon,
  RefreshCwIcon,
} from 'lucide-react'

// ─── Types & mock ─────────────────────────────────────────────────────────────

interface MetricCard {
  label: string
  value: string | number
  icon: React.ElementType
  colorClass: string
  note?: string
}

interface SyncRecord {
  source: string
  type: '岗位' | '招聘会' | '政策'
  result: '成功' | '失败' | '部分失败'
  count: number
  time: string
}

const METRICS: MetricCard[] = [
  { label: '已上传岗位',   value: 28,    icon: BriefcaseIcon,    colorClass: 'bg-blue-50 text-blue-600',     note: '已发布 24 条' },
  { label: '已上传招聘会', value: 5,     icon: CalendarIcon,     colorClass: 'bg-purple-50 text-purple-600', note: '进行中 1 场' },
  { label: '已发布数据',   value: 29,    icon: CheckCircleIcon,  colorClass: 'bg-green-50 text-green-600',   note: '岗位 24 + 招聘会 5' },
  { label: '待审核数据',   value: 4,     icon: ClockIcon,        colorClass: 'bg-orange-50 text-orange-500', note: '请及时关注' },
  { label: '外部跳转次数', value: 156,   icon: ExternalLinkIcon, colorClass: 'bg-cyan-50 text-cyan-600',     note: '近 7 天' },
  { label: '终端展示次数', value: 842,   icon: MonitorIcon,      colorClass: 'bg-indigo-50 text-indigo-600', note: '近 7 天' },
  { label: '打印资料次数', value: 37,    icon: PrinterIcon,      colorClass: 'bg-teal-50 text-teal-600',     note: '近 7 天' },
  { label: '最近同步',     value: '正常', icon: RefreshCwIcon,   colorClass: 'bg-green-50 text-green-600',   note: '1 小时前' },
]

const RECENT_SYNCS: SyncRecord[] = [
  { source: '市人才网 API',     type: '岗位',   result: '成功',    count: 12, time: '2026-05-25 08:00' },
  { source: '市人才网 API',     type: '招聘会', result: '成功',    count: 2,  time: '2026-05-25 08:00' },
  { source: '高校就业 Excel',   type: '岗位',   result: '部分失败', count: 8,  time: '2026-05-24 18:00' },
  { source: '市人社局 Webhook', type: '招聘会', result: '成功',    count: 1,  time: '2026-05-24 12:00' },
]

const RESULT_STYLES: Record<SyncRecord['result'], string> = {
  '成功':    'text-green-600',
  '失败':    'text-red-500',
  '部分失败': 'text-orange-500',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  return (
    <Page title="工作台" subtitle="合作机构数据概览">
      {/* 指标卡片 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {METRICS.map((m) => {
          const Icon = m.icon
          return (
            <Card key={m.label} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-500">{m.label}</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{m.value}</p>
                  {m.note && <p className="mt-1 text-xs text-gray-400">{m.note}</p>}
                </div>
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${m.colorClass}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* 最近同步记录 */}
      <div className="mt-6">
        <h2 className="mb-3 text-sm font-medium text-gray-700">最近同步记录</h2>
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['数据源', '类型', '本次同步数', '结果', '同步时间'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {RECENT_SYNCS.map((s, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700">{s.source}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{s.type}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{s.count} 条</td>
                  <td className={`px-4 py-3 text-xs font-medium ${RESULT_STYLES[s.result]}`}>{s.result}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{s.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <p className="mt-3 text-xs text-gray-400">当前为 mock 数据，接入后端后实时展示</p>
    </Page>
  )
}
