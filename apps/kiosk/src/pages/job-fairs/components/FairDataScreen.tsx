// ============================================================
// FairDataScreen — 招聘会「数据大屏」Tab
//
// 合规：我们是第三方信息入口，无真实时数据。
//   - 求职意向分布 / 行业分布 / 预计参会 = 机构录入预计值或按已录企业聚合，
//     页面统一标注「预计 / 来源数据 · 非实时」，禁止写「实时」。
//   - 另设「系统真实服务数据」区，展示我们真实拥有的服务行为（浏览/扫码/打印），
//     明确不含求职者个人信息。
// ============================================================

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from '@ai-job-print/ui'
import type { FairLiveStatsDTO } from '@ai-job-print/shared'
import { InfoIcon, PieChartIcon, PrinterIcon, QrCodeIcon, ScanIcon } from 'lucide-react'

const PIE_COLORS = ['#2563eb', '#f97316', '#10b981', '#8b5cf6', '#06b6d4', '#f43f5e']

function MetricTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-3 text-center">
      <p className="text-xl font-bold text-neutral-900">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-neutral-500">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] text-neutral-400">{hint}</p>}
    </div>
  )
}

export function FairDataScreen({ stats }: { stats: FairLiveStatsDTO }) {
  const intent = stats.seekerIntent ?? []
  const industry = stats.industryDistribution ?? []

  return (
    <div className="flex flex-col gap-4">
      {/* 数据来源标注（合规） */}
      <div className="flex items-start gap-2 rounded-lg bg-warning-bg px-4 py-2.5">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-xs leading-relaxed text-warning-fg">
          下列参会规模与分布为{stats.dataSourceLabel}，由来源机构提供或按已录入企业聚合，仅供参考，不代表现场实时人数。
        </p>
      </div>

      {/* 预计规模指标 */}
      <Card className="p-5">
        <p className="mb-3 text-sm font-medium text-neutral-700">活动规模（预计 / 来源）</p>
        <div className="grid grid-cols-2 gap-3">
          <MetricTile
            label="预计参会人数"
            value={stats.expectedAttendance != null ? stats.expectedAttendance.toLocaleString() : '—'}
            hint="来源机构预计"
          />
          <MetricTile label="参展企业" value={String(stats.totalCompanies)} hint="已录入" />
          <MetricTile label="招聘岗位" value={String(stats.totalPositions)} hint="已录入" />
          <MetricTile label="招聘人次" value={stats.totalHeadcount.toLocaleString()} hint="岗位合计" />
        </div>
      </Card>

      {/* 求职意向分布（饼图） */}
      <Card className="p-5">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-neutral-700">
          <PieChartIcon className="h-4 w-4 text-primary-500" />
          求职意向分布
        </p>
        <p className="mb-3 text-xs text-neutral-400">预计数据 · 来源机构提供</p>
        {intent.length > 0 ? (
          <div className="flex flex-col items-center gap-4">
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={intent}
                    dataKey="percent"
                    nameKey="label"
                    innerRadius={48}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {intent.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value, name) => [`${value}%`, String(name)]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5">
              {intent.map((s, i) => (
                <div key={s.label} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                  />
                  <span className="min-w-0 flex-1 truncate text-neutral-600">{s.label}</span>
                  <span className="font-semibold text-neutral-900">{s.percent}%</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-neutral-400">来源机构暂未提供意向分布数据</p>
        )}
      </Card>

      {/* 参展企业行业分布（柱状图） */}
      <Card className="p-5">
        <p className="mb-1 text-sm font-medium text-neutral-700">参展企业行业分布</p>
        <p className="mb-3 text-xs text-neutral-400">按已录入参展企业聚合 · 共 {stats.totalCompanies} 家</p>
        {industry.length > 0 ? (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={industry} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  interval={0}
                  height={48}
                  angle={-20}
                  textAnchor="end"
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip formatter={(value) => [`${value} 家`, '企业数']} cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-neutral-400">暂无已录入参展企业</p>
        )}
      </Card>

      {/* 系统真实服务数据（合规：我们真实拥有的，不含求职者个人信息） */}
      <Card className="p-5">
        <p className="text-sm font-medium text-neutral-700">系统真实服务数据</p>
        <p className="mb-3 text-xs text-neutral-400">本终端服务行为统计 · 不含求职者个人信息</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-neutral-50 p-3 text-center">
            <ScanIcon className="mx-auto h-5 w-5 text-neutral-400" />
            <p className="mt-1.5 text-lg font-bold text-neutral-900">{stats.browseCount}</p>
            <p className="text-xs text-neutral-500">信息浏览</p>
          </div>
          <div className="rounded-xl bg-neutral-50 p-3 text-center">
            <QrCodeIcon className="mx-auto h-5 w-5 text-neutral-400" />
            <p className="mt-1.5 text-lg font-bold text-neutral-900">{stats.scanCount}</p>
            <p className="text-xs text-neutral-500">二维码展示</p>
          </div>
          <div className="rounded-xl bg-neutral-50 p-3 text-center">
            <PrinterIcon className="mx-auto h-5 w-5 text-neutral-400" />
            <p className="mt-1.5 text-lg font-bold text-neutral-900">{stats.printCount}</p>
            <p className="text-xs text-neutral-500">资料打印</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
