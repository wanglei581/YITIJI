import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { usesKioskFluidViewport } from '../hooks/useKioskStageFit'
import { dismissSystemKeyboard, startSystemKeyboard } from './controller.ts'

/** 非视觉运行时根：document 捕获监听涵盖独立舞台和 body portal。 */
export function SystemKeyboardHost() {
  const { pathname } = useLocation()
  const previousPath = useRef(pathname)
  useEffect(() => startSystemKeyboard(usesKioskFluidViewport), [])
  useEffect(() => {
    if (previousPath.current !== pathname) dismissSystemKeyboard()
    previousPath.current = pathname
  }, [pathname])
  return null
}
