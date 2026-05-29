import { cn } from '../lib/cn'
import { Spinner } from './Spinner'

export interface LoadingStateProps {
  text?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

export function LoadingState({ text = '加载中…', size = 'lg', className }: LoadingStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 py-16', className)}>
      <Spinner size={size} />
      {text && <p className="text-sm text-neutral-500">{text}</p>}
    </div>
  )
}
