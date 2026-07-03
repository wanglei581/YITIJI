import { type ReactNode } from 'react'
import { PageHeader } from '@ai-job-print/ui'
import { API_MODE } from '../services/api/client'

interface PageProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  children?: ReactNode
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
