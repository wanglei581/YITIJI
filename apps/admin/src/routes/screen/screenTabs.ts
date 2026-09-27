/**
 * 管理员数据大屏的页签与地址。
 *
 * 每个页签一个独立地址（/screen/gov、/screen/usage、/screen/ops、/screen/terminal），
 * 切换即卸载上一个页签的 3D 场景。筛选条件写进地址，复制链接就能把同一画面发给同事；
 * 新窗口展示也只是在同一地址上加 display=1。
 */

export type AdminScreenTab = 'gov' | 'usage' | 'ops' | 'terminal'

export const ADMIN_SCREEN_TABS: ReadonlyArray<{ key: AdminScreenTab; label: string }> = [
  { key: 'gov', label: '政务总览' },
  { key: 'usage', label: '服务调用' },
  { key: 'ops', label: '运营看板' },
  { key: 'terminal', label: '终端孪生' },
]

/** 地址上会保留到下一个页签的参数：展示模式与轻量模式跟着人走，筛选跟着页签走。 */
const CARRY_PARAMS = ['display', 'lite'] as const

/**
 * 地址 → 页签。旧地址 /screen?profile=ops 仍然落到运营看板，其余一律回政务总览。
 * 非法值在前端纠正，绝不把非法值发给服务端。
 */
export function normalizeAdminTab(raw: string | undefined, legacyProfile: string | null): AdminScreenTab {
  if (raw === 'gov' || raw === 'usage' || raw === 'ops' || raw === 'terminal') return raw
  return legacyProfile === 'ops' ? 'ops' : 'gov'
}

export function screenHref(
  tab: AdminScreenTab,
  current: URLSearchParams,
  overrides: Record<string, string | null> = {},
  keepFilters = false,
): string {
  const next = new URLSearchParams()
  if (keepFilters) {
    current.forEach((value, key) => {
      if (key !== 'profile') next.set(key, value)
    })
  } else {
    for (const key of CARRY_PARAMS) {
      const value = current.get(key)
      if (value !== null) next.set(key, value)
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) next.delete(key)
    else next.set(key, value)
  }
  const query = next.toString()
  return `/screen/${tab}${query ? `?${query}` : ''}`
}
