import { type ReactNode } from 'react'
import { PageHeader } from '@ai-job-print/ui'
import { API_MODE } from '../services/api/client'

const DEMO_NOTICE = '当前是演示数据，没有连上真实后台。页面上的内容和操作不会保存。'

interface PageProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  children?: ReactNode
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
