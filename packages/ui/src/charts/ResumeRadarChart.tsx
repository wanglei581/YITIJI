import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts'
import { cn } from '../lib/cn'

/**
 * 简历诊断雷达图(W2 K2c 用)。
 *
 * 5 维度:格式规范 / 内容完整 / 经历量化 / 技能关联 / 关键词
 * 与秒哒 kiosk/13 截图布局一致。
 *
 * 一根 Radar(默认),颜色用 primary。可传 multiSeries 用于 K2d 优化前后对比
 * (优化前灰色虚线 + 优化后蓝色实线)。
 */
export interface ResumeRadarDimension {
  /** 维度名,例 '格式规范'。 */
  name: string
  /** 0-100 分。 */
  score: number
}

export interface ResumeRadarSeries {
  /** 例 '优化前' / '优化后'。 */
  label: string
  values: ResumeRadarDimension[]
  /** Tailwind 颜色变量名,例 'neutral-400' / 'primary-600'。 */
  colorToken?: string
}

export interface ResumeRadarChartProps {
  /** 单系列(K2c)直接传 dimensions。 */
  dimensions?: ResumeRadarDimension[]
  /** 多系列(K2d 对比)传 series,优先级高于 dimensions。 */
  series?: ResumeRadarSeries[]
  /** 高度,默认 320。 */
  height?: number
  className?: string
}

const DEFAULT_COLORS = ['#2563eb', '#94a3b8', '#16a34a', '#ea580c']

export function ResumeRadarChart({
  dimensions,
  series,
  height = 320,
  className,
}: ResumeRadarChartProps): React.ReactElement {
  // 多系列模式:按维度合并 data。
  const allSeries = series ?? (dimensions ? [{ label: '当前', values: dimensions }] : [])
  if (allSeries.length === 0) {
    return <div className={cn('text-sm text-neutral-400', className)}>暂无诊断数据</div>
  }

  const dimensionNames = allSeries[0]!.values.map((v) => v.name)
  const data = dimensionNames.map((name, idx) => {
    const row: Record<string, number | string> = { dimension: name }
    for (const s of allSeries) {
      row[s.label] = s.values[idx]?.score ?? 0
    }
    return row
  })

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer>
        <RadarChart data={data} margin={{ top: 16, right: 16, bottom: 16, left: 16 }}>
          <PolarGrid stroke="#e5e7eb" />
          <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 12, fill: '#525252' }} />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10, fill: '#a3a3a3' }} />
          {allSeries.map((s, i) => (
            <Radar
              key={s.label}
              name={s.label}
              dataKey={s.label}
              stroke={DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              fill={DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              fillOpacity={0.15}
              strokeWidth={2}
            />
          ))}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
