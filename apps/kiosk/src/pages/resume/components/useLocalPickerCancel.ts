import { useEffect, useRef, type RefObject } from 'react'
export type { LocalChannelPhase } from './ResumeLocalScreen'

/** 系统文件框关掉且没选文件时会发 cancel。React 的 input 类型没有 onCancel。 */
export function useLocalPickerCancel(
  input: RefObject<HTMLInputElement | null>,
  enabled: boolean,
  onCancel: () => void,
): void {
  const enabledRef = useRef(enabled)
  const onCancelRef = useRef(onCancel)
  enabledRef.current = enabled
  onCancelRef.current = onCancel
  useEffect(() => {
    const node = input.current
    if (!node) return undefined
    const listener: EventListener = () => {
      if (enabledRef.current) onCancelRef.current()
    }
    node.addEventListener('cancel', listener)
    return () => node.removeEventListener('cancel', listener)
  }, [input])
}
