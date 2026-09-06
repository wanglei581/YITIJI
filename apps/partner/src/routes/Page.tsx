import { type ReactNode } from 'react'
import { PageHeader } from '@ai-job-print/ui'
import { API_MODE } from '../services/api/client'

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
  profile: '对应一体机「找企业」与岗位详情来源机构',
  companies: '对应一体机「找企业」与岗位详情来源机构',
  none: '不直接对应前端页面',
} as const

export function withFrontendHint(subtitle: string, hint: string): string {
  return `${subtitle} · ${hint}`
}

export function ListPagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number
  totalPages: number
  total: number
  onPageChange: (page: number) => void
}) {
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
      <p>共 {total} 条 · 第 {page} / {totalPages} 页</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="rounded border border-neutral-200 px-3 py-1.5 disabled:opacity-40"
        >
          上一页
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded border border-neutral-200 px-3 py-1.5 disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </div>
  )
}

export function Page({ title, subtitle, actions, children }: PageProps) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      {API_MODE !== 'http' && (
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning-fg">
          当前为 mock 模式（VITE_API_MODE 不等于 http），页面数据和未接后端的操作不会写入数据库。联调真实后端请配置 VITE_API_MODE=http 与 VITE_API_BASE_URL。
        </div>
      )}
      <div className="mt-6">{children}</div>
    </div>
  )
}
