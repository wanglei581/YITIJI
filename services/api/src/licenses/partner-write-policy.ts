/**
 * 授权不可用时，合作机构后台哪些写操作要拒、哪些照常放行。
 *
 * 规矩：机构后台的接口都在 /partner/ 下；这里**默认拒绝**其中所有写方法（POST / PUT / PATCH / DELETE），
 * 只有下面**逐条**登记了的才放行——以后新增的机构写接口不用想起来，自动被管住（宁可误拦，不可漏拦）。
 * 没有前缀通配、没有「所有方法」：登记的是「哪个方法 + 哪条路由 + 哪个处理函数」，三者一起对上才放行。
 * 路由被改到别的处理函数上，豁免立刻失效；门禁（verify:license）逐条核对登记表与真实路由的装饰器一致。
 * 查看（GET）与导出不受影响：数据归机构，个人信息法下也不宜锁死。
 *
 * 放行的有三类（kind）：
 *   maintain  续约联络与现场求助要用的：机构资料、报障、交付报告生成与确认；
 *   withdraw  撤回自己已发布内容 / 停止自己已开的数据通路的：下架、删除、归档、取消未确认的导入（让机构随时能把内容拿下来，不被授权状态卡住）；
 *             只收「只会减少、不会新增或重新上架」的路由——取消归档、启停数据源这类可能重新打开的不在其中；
 *   compute   只算不存的：资格试算、导入预检（不落库、不进审计）。
 * 一体机上本机构终端在授权不可用时本来就不再签发新会话，所以已发布内容不会继续在本机构终端上展示。
 */

export type PartnerWriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type PartnerWriteExemptionKind = 'maintain' | 'withdraw' | 'compute'

const WRITE_METHODS: ReadonlySet<string> = new Set<PartnerWriteMethod>(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface PartnerWriteExemption {
  method: PartnerWriteMethod
  /** 规范化后的路由模板（见 normalizeRoutePath），精确匹配。 */
  path: string
  /** 「控制器类名.处理函数名」。只有这个处理函数享受豁免。 */
  handler: string
  kind: PartnerWriteExemptionKind
  reason: string
}

export const PARTNER_WRITE_EXEMPTIONS: readonly PartnerWriteExemption[] = [
  {
    method: 'PUT', path: '/partner/profile', handler: 'PartnerOrgController.updateProfile', kind: 'maintain',
    reason: '机构资料（联系方式）要能在授权失效时维护，续约联络用',
  },
  {
    method: 'POST', path: '/partner/first-order/incidents', handler: 'PartnerFirstOrderIncidentsController.create', kind: 'maintain',
    reason: '现场报障：设备出了问题要能报，不能被授权状态卡住',
  },
  {
    method: 'PATCH', path: '/partner/first-order/incidents/:p', handler: 'PartnerFirstOrderIncidentsController.update', kind: 'maintain',
    reason: '更新自己提交的报障（补充说明）',
  },
  {
    method: 'POST', path: '/partner/first-order/projects/:p/reports', handler: 'PartnerFirstOrderController.createReport', kind: 'maintain',
    reason: '生成月度交付报告：只汇总平台已有的设备与服务数据，不新增机构内容',
  },
  {
    method: 'POST', path: '/partner/first-order/reports/:p/acknowledge', handler: 'PartnerFirstOrderController.acknowledge', kind: 'maintain',
    reason: '确认交付报告：验收与结算依据，不能被授权状态卡住',
  },
  {
    method: 'PATCH', path: '/partner/policies/:p/publish', handler: 'PoliciesController.unpublishPartnerPolicy', kind: 'withdraw',
    reason: '政策下架：这条路由只会把状态改成 unpublished；发布走 /release，授权不可用时被拦',
  },
  {
    method: 'DELETE', path: '/partner/policies/:p', handler: 'PoliciesController.deletePartnerPolicy', kind: 'withdraw',
    reason: '政策删除：撤回自己的内容',
  },
  {
    method: 'DELETE', path: '/partner/official-channels/:p', handler: 'OfficialChannelsController.archive', kind: 'withdraw',
    reason: '官方渠道归档：撤回自己的内容',
  },
  {
    method: 'PATCH', path: '/partner/jobs/:p/publish', handler: 'JobsController.unpublishPartnerJob', kind: 'withdraw',
    reason: '岗位下架（私有化部署版）：服务只会把状态写成 unpublished；撤回必须始终可做',
  },
  {
    method: 'PATCH', path: '/partner/fairs/:p/publish', handler: 'JobsController.unpublishPartnerFair', kind: 'withdraw',
    reason: '招聘会下架（私有化部署版）：服务只会把状态写成 unpublished；撤回必须始终可做',
  },
  {
    method: 'PATCH', path: '/partner/companies/:p/publish', handler: 'CompaniesController.partnerUnpublish', kind: 'withdraw',
    reason: '企业资料下架（私有化部署版）：只下架，DTO 直接拒掉 action:publish；撤回必须始终可做',
  },
  {
    method: 'PATCH', path: '/partner/data-sources/:p/archive', handler: 'JobsController.archivePartnerDataSource', kind: 'withdraw',
    reason: '数据源归档（私有化部署版）：只置 archivedAt 并停用，停止接收与拉取；取消归档（unarchive）与启停（toggle）不放行',
  },
  {
    method: 'DELETE', path: '/partner/excel/:p', handler: 'JobsController.cancelExcelImport', kind: 'withdraw',
    reason: '取消还没确认的导入批次（私有化部署版）：只把 pending 批次置为 cancelled，不导入任何数据',
  },
  {
    method: 'POST', path: '/partner/policies/:p/eligibility-preview', handler: 'PoliciesController.previewPartnerEligibility', kind: 'compute',
    reason: '资格试算，只算不存、不进审计',
  },
  {
    method: 'POST', path: '/partner/data-sources/preflight/jobs', handler: 'RecruitmentIntegrationController.preflightJobs', kind: 'compute',
    reason: '导入预检（私有化部署版），只算不存',
  },
  {
    method: 'POST', path: '/partner/data-sources/preflight/fairs', handler: 'RecruitmentIntegrationController.preflightFairs', kind: 'compute',
    reason: '导入预检（私有化部署版），只算不存',
  },
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

/** 这条路由（方法 + 模板 + 处理函数）有没有逐条登记过。 */
export function findPartnerWriteExemption(method: string, routePath: string, handler: string): PartnerWriteExemption | undefined {
  const upper = method.toUpperCase()
  const path = normalizeRoutePath(routePath)
  return PARTNER_WRITE_EXEMPTIONS.find((item) => item.method === upper && item.path === path && item.handler === handler)
}

/**
 * 这条路由在授权不可用时是否要拒。handler 是「控制器类名.处理函数名」：
 * 登记过的 (方法, 路由, 处理函数) 三者全对上才放行，对不上一律当作要拒。
 */
export function partnerWriteIsBlocked(method: string, routePath: string, handler: string): boolean {
  const upper = method.toUpperCase()
  if (!WRITE_METHODS.has(upper)) return false
  if (!normalizeRoutePath(routePath).startsWith('/partner/')) return false
  return findPartnerWriteExemption(upper, routePath, handler) === undefined
}
