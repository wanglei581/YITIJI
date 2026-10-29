import { useEffect, useSyncExternalStore } from 'react'
import type { PublicSupportContact } from '../copy/unattendedCopy'
import { loadSupportContact, peekSupportContact, subscribeSupportContact } from '../services/api/supportContact'

/**
 * 只读订阅会话里的服务联系方式，自己不发请求（请求由运行时根的守卫发，见 supportContact.ts）。
 * 初值读模块缓存，所以后打开的页面不会先闪成「没有号码」；
 * 号码晚到、续上换了值、终端号换了，都会重渲染。读不到时是最保守的一套，四个字段都在。
 * 设备状态 hook 用这个：它在页面停用时承诺不发请求。
 */
export function useSupportContactSnapshot(): PublicSupportContact {
  return useSyncExternalStore(subscribeSupportContact, peekSupportContact, peekSupportContact)
}

/**
 * 页面用的服务联系方式：进页时保证已经在读（5 分钟内用缓存、并发共用一次请求），之后跟着订阅走。
 * 请求本身在 `loadSupportContact`，不在本文件加载时发出。
 * `enabled` 默认 true，进页就保证已经在读。
 * 未登录的资产页要保持登录门 fail-closed（页面自己不新发 /api/v1/ 请求），那里传 false：
 * 只订阅本会话里已经有的号码（运行时根读到后会跟着更新），不由页面去读。读不到号码时求助句不带电话。
 */
export function useSupportContact(enabled = true): PublicSupportContact {
  useEffect(() => {
    if (!enabled) return
    void loadSupportContact()
  }, [enabled])
  return useSupportContactSnapshot()
}
