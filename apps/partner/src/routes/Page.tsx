import { type ReactNode } from 'react'
import { ConsolePager, PageHeader } from '@ai-job-print/ui'
import { API_MODE } from '../services/api/client'

const DEMO_NOTICE = '当前是演示数据，没有连上真实后台。页面上的内容和操作不会保存。'

interface PageProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  children?: ReactNode
}

export const FRONTEND_HINT = {
  jobs: '对应一体机「岗位信息」/ 小程序「求职」',
  fairs: '对应一体机「招聘会信息」',
  policy: '对应一体机「政策服务」',
  smartCampus: '对应 Kiosk 首页「智慧校园」',
  profile: '对应一体机「本机构官方渠道」与政策的来源机构',
  /** 招聘内容托管打开（私有化部署 b）时机构资料还对应找企业与岗位详情 */
  profileHosted: '对应一体机「本机构官方渠道」「找企业」与岗位、政策的来源机构',
  companies: '对应一体机「找企业」与岗位详情来源机构',
  screen: '汇总本机构在一体机与小程序上的可见内容与终端状态',
  terminals: '对应本机构一体机的打印扫描服务与设备运行',
  /** 这一档没有给运营看的页面对应关系，副标题只保留业务句本身。 */
  none: '',
} as const

export function withFrontendHint(subtitle: string, hint: string): string {
  if (!hint) return subtitle
  return `${subtitle} · ${hint}`
}

export function ListPagination({
  page,
  totalPages,
  total,
  onPageChange,
  pageSize,
  onPageSizeChange,
}: {
  page: number
  totalPages: number
  total: number
  onPageChange: (page: number) => void
  pageSize?: number
  onPageSizeChange?: (size: number) => void
}) {
  const pages = Math.max(1, totalPages)
  const size = pageSize ?? Math.max(1, pages > 0 && total > 0 ? Math.ceil(total / pages) : 20)
  return (
    <ConsolePager
      page={page}
      pageSize={size}
      total={total}
      totalPages={pages}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      className="mt-3"
    />
  )
}

export function Page({ title, subtitle, actions, children }: PageProps) {
  return (
    <div className="min-w-0">
      <PageHeader className="min-w-0 flex-wrap items-start gap-3" title={title} subtitle={subtitle} actions={actions} />
      {API_MODE !== 'http' && (
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning-fg">
          {DEMO_NOTICE}
        </div>
      )}
      <div className="mt-6">{children}</div>
    </div>
  )
}
