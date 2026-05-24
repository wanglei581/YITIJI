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
        secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200 active:bg-gray-300',
        ghost:     'text-gray-700 hover:bg-gray-100 active:bg-gray-200',
        danger:    'bg-error text-white hover:bg-red-700 active:bg-red-800',
        outline:   'border border-gray-300 text-gray-700 hover:bg-gray-50 active:bg-gray-100',
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
