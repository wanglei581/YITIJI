import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * Kiosk「忙碌态」上下文。
 *
 * 评审 bug #1(最关键):打印 / 扫描 / AI 通话 / 上传 / 关键表单等进行中时,
 * 绝不能进入待机宣传屏。这些页面通过 useBusyLock(true) 注册一把锁,
 * idle 计时器在 busy>0 时暂停。
 *
 * 用引用计数而非布尔,允许多处并发持锁(例如同时上传 + 填表)。
 */
interface KioskBusyContextValue {
  busy: boolean
  /** 取得一把锁,返回释放函数。释放幂等。 */
  lock: () => () => void
}

const KioskBusyContext = createContext<KioskBusyContextValue | null>(null)

export function KioskBusyProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0)

  const lock = useCallback(() => {
    setCount((c) => c + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      setCount((c) => Math.max(0, c - 1))
    }
  }, [])

  const value = useMemo<KioskBusyContextValue>(() => ({ busy: count > 0, lock }), [count, lock])

  return <KioskBusyContext.Provider value={value}>{children}</KioskBusyContext.Provider>
}

function useKioskBusyContext(): KioskBusyContextValue {
  const ctx = useContext(KioskBusyContext)
  // Provider 缺失时降级为"永不忙碌",避免在 Provider 之外使用直接崩溃。
  return ctx ?? { busy: false, lock: () => () => {} }
}

/** 读取当前是否处于忙碌态(供 idle 控制器使用)。 */
export function useKioskBusy(): boolean {
  return useKioskBusyContext().busy
}

/**
 * 在 active=true 期间持有一把忙碌锁。
 * 用法:在"打印中 / 扫描中 / 上传中 / 通话中"的页面或组件里 useBusyLock(true)。
 */
export function useBusyLock(active: boolean): void {
  const { lock } = useKioskBusyContext()
  useEffect(() => {
    if (!active) return
    const release = lock()
    return release
  }, [active, lock])
}
