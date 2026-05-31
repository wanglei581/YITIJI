import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '../lib/cn'

/**
 * 趋势折线图。
 *
 * Partner 工作台 / Admin 工作台 7 天 / 30 天趋势用。
 * 支持多系列(浏览量 vs 跳转量、AI 服务次数 vs 打印次数等)。
 *
 * 设计:横坐标统一为字符串(由调用方格式化为 '10-01' 等),
 * 不做日期格式化,避免组件耦合时区。
 */
export interface TrendSeries {
  /** 图例显示名,例 '岗位浏览'。 */
  label: string
  /** 数据值数组,长度必须与 labels 一致。 */
  values: number[]
  /** 可选颜色,例 '#2563eb'。 */
  color?: string
}

export interface TrendLineChartProps {
  /** 横坐标标签,例 ['10-01', '10-02', ...]。 */
  labels: string[]
  series: TrendSeries[]
  /** 高度,默认 240。 */
  height?: number
  /** 是否显示图例,默认 true。 */
  showLegend?: boolean
  className?: string
}

const DEFAULT_COLORS = ['#2563eb', '#ea580c', '#16a34a', '#7c3aed', '#dc2626']

export function TrendLineChart({
  labels,
  series,
  height = 240,
  showLegend = true,
  className,
}: TrendLineChartProps): React.ReactElement {
  if (series.length === 0 || labels.length === 0) {
    return <div className={cn('text-sm text-neutral-400', className)}>暂无趋势数据</div>
  }

  const data = labels.map((label, idx) => {
    const row: Record<string, number | string> = { label }
    for (const s of series) row[s.label] = s.values[idx] ?? 0
    return row
  })

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#525252' }} axisLine={{ stroke: '#e5e7eb' }} />
          <YAxis tick={{ fontSize: 12, fill: '#525252' }} axisLine={{ stroke: '#e5e7eb' }} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
          {showLegend && <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />}
          {series.map((s, i) => (
            <Line
              key={s.label}
              type="monotone"
              dataKey={s.label}
              stroke={s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
