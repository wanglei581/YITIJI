import { type ReactNode } from 'react'
import { PageHeader } from '@ai-job-print/ui'

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
      <div className="mt-6">{children}</div>
    </div>
  )
}
