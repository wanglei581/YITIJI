import { useEffect, useState } from 'react'
import { loadServicePhone, peekServicePhone } from '../services/api/serviceContact'

/**
 * 会话内的服务电话。初值读模块缓存，所以后打开的页面不会先闪成「没有号码」。
 * 请求本身在 `loadServicePhone`，不在本文件加载时发出。
 */
export function useServicePhone(): string | null {
  const [phone, setPhone] = useState<string | null>(() => peekServicePhone())

  useEffect(() => {
    let active = true
    void loadServicePhone().then((value) => {
      if (active) setPhone(value)
    })
    return () => {
      active = false
    }
  }, [])

  return phone
}
