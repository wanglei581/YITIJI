import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '../lib/cn'

const cardVariants = cva(
  'rounded-lg border border-gray-200 bg-surface shadow-sm',
  {
    variants: {
      padding: {
        none: '',
        sm:   'p-4',
        md:   'p-6',
        lg:   'p-8',
      },
    },
    defaultVariants: {
      padding: 'md',
    },
  },
)

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export function Card({ className, padding, children, ...props }: CardProps) {
  return (
    <div className={cn(cardVariants({ padding }), className)} {...props}>
      {children}
    </div>
  )
}
