import type { ElementType } from 'react'
import { BriefcaseIcon, PrinterIcon } from 'lucide-react'

// ============================================================
// 工作台上与招聘类内容有关的两处：第二张指标卡、待办事项里的一行。
//
// 3.15 起管理员不审核、不发布岗位 / 招聘会（信息源页只留查看与紧急下架），工作台不再出现
// 「待审核数据 / 待办审核 / 去审核」。按招聘内容托管开关分两种说法（读取中 / 读取失败按关闭处理）：
//   - 托管关闭（我们云上默认）：有存量才出现，写「招聘类存量 N 条（托管关闭，不再审核）」，
//     链到能紧急下架的信息源页；没有存量，指标卡换成打印机就绪数，待办里不出现这一行。
//   - 托管打开（私有化部署 b）：写「招聘类内容 N 条」，说明由发布机构自审自发，不把管理员写成审核人。
// 抽成独立文件是为了不再往 897 行的 dashboard/index.tsx 里加逻辑。
// ============================================================

export interface StockKpi {
  label: string
  value: string
  unit?: string
  sub: string
  icon: ElementType
  warn?: boolean
  failed?: boolean
  /** 失败时重试哪几块 */
  retryKeys: Array<'jobSources' | 'fairSources' | 'printers'>
}

export interface StockTodo {
  key: string
  icon: ElementType
  title: string
  sub: string
  href: string
  actionLabel: string
}

interface StockInput {
  hostingOpen: boolean
  jobs: number | null
  fairs: number | null
  printers: { ready: number; total: number } | null
}

function stockSub(jobs: number, fairs: number, tail: string): string {
  return `岗位 ${jobs} · 招聘会 ${fairs} · ${tail}`
}

/** 岗位有存量就去岗位信息源，否则去招聘会信息源；两页都能逐条紧急下架。 */
function takedownHref(jobs: number): string {
  return jobs > 0 ? '/job-sources' : '/fair-sources'
}

export function recruitmentStockKpi({ hostingOpen, jobs, fairs, printers }: StockInput): StockKpi {
  const label = hostingOpen ? '招聘类内容' : '招聘类存量'
  if (jobs === null || fairs === null) {
    return { label, value: '0', unit: '条', sub: '', icon: BriefcaseIcon, failed: true, retryKeys: ['jobSources', 'fairSources'] }
  }
  const total = jobs + fairs
  if (hostingOpen) {
    return { label, value: String(total), unit: '条', sub: stockSub(jobs, fairs, '由发布机构自审自发'), icon: BriefcaseIcon, retryKeys: [] }
  }
  if (total > 0) {
    return { label, value: String(total), unit: '条', sub: stockSub(jobs, fairs, '托管关闭，不再审核'), icon: BriefcaseIcon, retryKeys: [] }
  }
  // 托管关闭且没有存量：这一格不再讲招聘，换成打印机就绪数（同一页已加载的真实数据）。
  if (printers === null) {
    return { label: '打印机就绪', value: '0', unit: '台', sub: '', icon: PrinterIcon, failed: true, retryKeys: ['printers'] }
  }
  return {
    label: '打印机就绪',
    value: String(printers.ready),
    unit: `/ ${printers.total} 台`,
    sub: printers.total === 0 ? '打印机尚无心跳上报' : printers.ready < printers.total ? `${printers.total - printers.ready} 台未就绪` : '全部就绪',
    icon: PrinterIcon,
    warn: printers.total > 0 && printers.ready < printers.total,
    retryKeys: [],
  }
}

export function recruitmentStockTodo({ hostingOpen, jobs, fairs }: Omit<StockInput, 'printers'>): StockTodo | null {
  const j = jobs ?? 0
  const f = fairs ?? 0
  const total = j + f
  if (total === 0) return null
  return hostingOpen
    ? {
        key: 'recruitment-content',
        icon: BriefcaseIcon,
        title: `招聘类内容 ${total} 条（由发布机构自审自发）`,
        sub: stockSub(j, f, '如有违法违规内容可紧急下架'),
        href: takedownHref(j),
        actionLabel: '去查看',
      }
    : {
        key: 'recruitment-stock',
        icon: BriefcaseIcon,
        title: `招聘类存量 ${total} 条（托管关闭，不再审核）`,
        sub: stockSub(j, f, '如有违法违规内容可紧急下架'),
        href: takedownHref(j),
        actionLabel: '去查看',
      }
}
