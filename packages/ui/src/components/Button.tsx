import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
    'disabled:pointer-events-none disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        primary:   'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800',
        secondary: 'bg-neutral-100 text-neutral-900 hover:bg-neutral-200 active:bg-neutral-300',
        ghost:     'text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200',
        danger:    'bg-error text-white hover:bg-error/80 active:bg-error/70',
        outline:   'border border-neutral-300 text-neutral-700 hover:bg-neutral-50 active:bg-neutral-100',
      },
      size: {
        sm: 'h-12 px-3 text-sm rounded-md min-w-[48px]',
        md: 'h-12 px-4 text-base rounded-md min-w-[48px]',
        lg: 'h-14 px-6 text-lg rounded-lg min-w-[56px]',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
)

Button.displayName = 'Button'

export { buttonVariants }
