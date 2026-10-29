import { useEffect, useState } from 'react'
import type { PublicSupportContact } from '../copy/unattendedCopy'
import { CONSERVATIVE_SUPPORT_CONTACT } from '../copy/unattendedCopy'
import { loadSupportContact, peekSupportContact } from '../services/api/supportContact'

/**
 * 会话内的服务联系方式。初值读模块缓存，所以后打开的页面不会先闪成「没有号码」。
 * 请求本身在 `loadSupportContact`，不在本文件加载时发出。
 * 读不到时是最保守的一套，四个字段都在。
 */
/**
 * `enabled` 默认 true，和原来一样进页面就读。
 * 未登录的资产页要保持 0 条 /api/v1/（登录门是 fail-closed），那里传 false：
 * 只读本会话已经缓存的号码，不新发请求。读不到号码时求助句不带电话。
 */
export function useSupportContact(enabled = true): PublicSupportContact {
  const [contact, setContact] = useState<PublicSupportContact>(() => peekSupportContact())

  useEffect(() => {
    if (!enabled) return
    let active = true
    void loadSupportContact().then((value) => {
      if (active) setContact(value)
    })
    return () => {
      active = false
    }
  }, [enabled])

  return contact ?? CONSERVATIVE_SUPPORT_CONTACT
}
