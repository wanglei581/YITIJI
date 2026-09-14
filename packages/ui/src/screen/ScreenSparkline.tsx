import { screenCount } from './ScreenPrimitives'

/**
 * 逐日趋势折线。
 *
 * 用裸 SVG 而不是 recharts：这块卡在舞台档只有 266px 定高行里的一格，
 * recharts 的 ResponsiveContainer + 坐标轴 + 图例在这个高度里必然溢出，
 * 而大屏这块要的是形状不是可交互坐标 —— 峰值数写在脚注里，比坐标轴更准。
 *
 * 全为 0 的 14 天是**真实**的（真的没人打印），照画平线，不当未接入。
 * 峰值为空时脚注说「无打印记录」，不写「峰值 0 页」。
 */

export interface ScreenSparkDay {
  date: string
  pages: number
}

export interface ScreenSparklineProps {
  days: ScreenSparkDay[]
  /** 无障碍描述里的指标名，例「每日打印页数」。 */
  seriesLabel: string
}

const VIEW_W = 300
const VIEW_H = 120
const PAD = 6

export function ScreenSparkline({ days, seriesLabel }: ScreenSparklineProps) {
  if (days.length === 0) {
    return <p className="ops-empty">窗口内没有可用于绘制趋势的数据点</p>
  }
  const max = days.reduce((best, day) => (day.pages > best ? day.pages : best), 0)
  const stepX = days.length > 1 ? (VIEW_W - PAD * 2) / (days.length - 1) : 0
  const points = days.map((day, index) => {
    const x = PAD + index * stepX
    // max=0（整段真实为零）时全部贴底，画出一条真实的平线，不做视觉抬高。
    const ratio = max > 0 ? day.pages / max : 0
    const y = VIEW_H - PAD - ratio * (VIEW_H - PAD * 2)
    return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
  })
  const line = points.join(' ')
  const area = `${line} ${Math.round((PAD + (days.length - 1) * stepX) * 10) / 10},${VIEW_H} ${PAD},${VIEW_H}`
  const describe = `${seriesLabel}：${days.length} 天，区间 ${days[0].date} 至 ${days[days.length - 1].date}，最高 ${screenCount(max)}`
  return (
    <svg
      className="ops-spark"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={describe}
    >
      <polyline fill="rgba(53, 171, 142, 0.13)" stroke="none" points={area} />
      <polyline
        fill="none"
        stroke="var(--ops-p-500)"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={line}
      />
    </svg>
  )
}
