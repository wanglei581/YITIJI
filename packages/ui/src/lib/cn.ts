import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merges class names safely, resolving Tailwind conflicts.
 * Use instead of bare string concatenation in all components.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
