import { useEffect, useState } from 'react'
import type { PublicSupportContact } from '../copy/unattendedCopy'
import { CONSERVATIVE_SUPPORT_CONTACT } from '../copy/unattendedCopy'
import { loadSupportContact, peekSupportContact } from '../services/api/supportContact'

/**
 * 会话内的服务联系方式。初值读模块缓存，所以后打开的页面不会先闪成「没有号码」。
 * 请求本身在 `loadSupportContact`，不在本文件加载时发出。
 * 读不到时是最保守的一套，四个字段都在。
 */
export function useSupportContact(): PublicSupportContact {
  const [contact, setContact] = useState<PublicSupportContact>(() => peekSupportContact())

  useEffect(() => {
    let active = true
    void loadSupportContact().then((value) => {
      if (active) setContact(value)
    })
    return () => {
      active = false
    }
  }, [])

  return contact ?? CONSERVATIVE_SUPPORT_CONTACT
}
