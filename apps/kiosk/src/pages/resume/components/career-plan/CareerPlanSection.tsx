import type { ElementType, ReactNode } from 'react'
import { Card } from '@ai-job-print/ui'

export function CareerPlanSection({
  title,
  Icon,
  column,
  children,
}: {
  title: string
  Icon: ElementType
  column?: string
  children: ReactNode
}) {
  return (
    <Card className="career-plan-lightflow__section" data-career-plan-column={column}>
      <div className="career-plan-lightflow__section-heading">
        <span className="career-plan-lightflow__section-icon" aria-hidden="true"><Icon /></span>
        <h2>{title}</h2>
      </div>
      {children}
    </Card>
  )
}
