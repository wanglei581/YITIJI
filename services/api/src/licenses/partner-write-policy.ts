/**
 * 授权不可用时，合作机构后台哪些写操作要拒、哪些照常放行。
 *
 * 规矩：机构后台的接口都在 /partner/ 下；这里**默认拒绝**其中所有写方法（POST / PUT / PATCH / DELETE），
 * 只有下面登记了理由的才放行——以后新增的机构写接口不用想起来，自动被管住（宁可误拦，不可漏拦）。
 * 查看（GET）与导出不受影响：数据归机构，个人信息法下也不宜锁死。
 *
 * 放行的有三类：
 *   1. 续约联络与现场求助要用的：机构资料、报障与交付确认；
 *   2. 撤回自己已发布内容的：下架、删除、归档（让机构随时能把内容拿下来，不被授权状态卡住）；
 *   3. 只算不存的：资格试算、导入预检（不落库、不进审计）。
 * 一体机上本机构终端在授权不可用时本来就不再签发新会话，所以已发布内容不会继续在本机构终端上展示。
 */

export type PartnerWriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const WRITE_METHODS: ReadonlySet<string> = new Set<PartnerWriteMethod>(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface PartnerWriteExemption {
  /** 'ANY' = 所有写方法。 */
  method: PartnerWriteMethod | 'ANY'
  /** 规范化后的路由模板（见 normalizeRoutePath）；以 /* 结尾表示整个前缀。 */
  path: string
  reason: string
}

export const PARTNER_WRITE_EXEMPTIONS: readonly PartnerWriteExemption[] = [
  { method: 'PUT', path: '/partner/profile', reason: '机构资料（联系方式）要能在授权失效时维护，续约联络用' },
  { method: 'ANY', path: '/partner/first-order/*', reason: '现场报障与交付报告确认，不能被授权状态卡住' },
  { method: 'PATCH', path: '/partner/policies/:p/publish', reason: '政策下架：撤回自己已发布的内容' },
  { method: 'DELETE', path: '/partner/policies/:p', reason: '政策删除：撤回自己的内容' },
  { method: 'DELETE', path: '/partner/official-channels/:p', reason: '官方渠道归档：撤回自己的内容' },
  { method: 'POST', path: '/partner/policies/:p/eligibility-preview', reason: '资格试算，只算不存、不进审计' },
  { method: 'POST', path: '/partner/data-sources/preflight/jobs', reason: '导入预检（私有化部署版），只算不存' },
  { method: 'POST', path: '/partner/data-sources/preflight/fairs', reason: '导入预检（私有化部署版），只算不存' },
]

/**
 * 路由模板规范化：去掉 /api/v1 前缀与结尾斜杠，路径参数名统一成 :p。
 * 不同控制器给同一个参数起不同名（:id / :policyId），规范化后才能按位置比较。
 */
export function normalizeRoutePath(path: string): string {
  let out = path.split('?')[0] ?? ''
  out = out.replace(/^\/api\/v\d+(?=\/)/, '')
  out = out.replace(/:[A-Za-z0-9_]+/g, ':p')
  if (out.length > 1) out = out.replace(/\/+$/, '')
  return out
}

function matches(exemption: PartnerWriteExemption, method: string, normalizedPath: string): boolean {
  if (exemption.method !== 'ANY' && exemption.method !== method) return false
  if (exemption.path.endsWith('/*')) {
    const prefix = exemption.path.slice(0, -1)
    return normalizedPath.startsWith(prefix)
  }
  return exemption.path === normalizedPath
}

/** 这条路由在授权不可用时是否要拒（只看方法与路由模板）。 */
export function partnerWriteIsBlocked(method: string, routePath: string): boolean {
  const upper = method.toUpperCase()
  if (!WRITE_METHODS.has(upper)) return false
  const path = normalizeRoutePath(routePath)
  if (!path.startsWith('/partner/')) return false
  return !PARTNER_WRITE_EXEMPTIONS.some((exemption) => matches(exemption, upper, path))
}
