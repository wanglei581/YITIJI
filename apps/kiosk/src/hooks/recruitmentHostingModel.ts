// 招聘内容托管开关（next-tasks 3.13）的纯逻辑：判定、招聘类路由表，以及「按本机终端身份读一次配置」的加载器。
//
// 不 import React，也不 import 服务层：hook 把真实的取身份、读配置注进来；用例可以直接驱动
// 浏览器里造不出来的竞态（请求在途时终端身份变了）。

export interface RecruitmentHostingState {
  /** loading = 还没读到本机配置。渲染上按关闭处理，但不说「未开放」这类结论。 */
  status: 'loading' | 'ready'
  enabled: boolean
}

export const RECRUITMENT_HOSTING_LOADING: RecruitmentHostingState = { status: 'loading', enabled: false }
const READY_CLOSED: RecruitmentHostingState = { status: 'ready', enabled: false }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 纯判定：这份终端配置有没有打开招聘内容托管。 */
export function recruitmentHostingOpen(config: unknown): boolean {
  if (!isRecord(config)) return false
  if ('recruitmentHosting' in config) {
    const hosting = config['recruitmentHosting']
    return isRecord(hosting) && hosting['enabled'] === true
  }
  const jobBoard = config['jobBoard']
  return isRecord(jobBoard) && jobBoard['enabled'] === true
}

/**
 * 招聘类路由：岗位、招聘会、企业、校园招聘、线下机构，以及两个服务台。
 * `/smart-campus` 不在其中（它是智慧校园，不是校招）。
 */
const RECRUITMENT_ROUTE_PREFIXES = [
  '/jobs',
  '/jobs-service',
  '/job-fairs',
  '/fairs-service',
  '/companies',
  '/offline-agencies',
  '/campus',
] as const

export function isRecruitmentRoute(route: string): boolean {
  const path = route.split(/[?#]/)[0] ?? ''
  return RECRUITMENT_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

export interface RecruitmentHostingLoaderDeps {
  getTerminalId: () => string
  fetchConfig: (terminalId: string) => Promise<unknown>
  onSettle: (state: RecruitmentHostingState) => void
}

/**
 * 每次 load() 按当时的终端身份读一次配置，读完回报 ready。没有身份、读失败、字段畸形一律按关闭。
 * 请求在途时终端身份变了（重新绑定）：旧身份的答复不记到新终端头上，按新身份重读一次。
 * 更晚发起的 load() 会让更早那次作废；dispose() 之后不再回报。
 */
export function createRecruitmentHostingLoader(deps: RecruitmentHostingLoaderDeps) {
  let active = true
  let generation = 0

  const load = async (): Promise<void> => {
    generation += 1
    const run = generation
    const terminalId = deps.getTerminalId()
    let next = READY_CLOSED
    if (terminalId) {
      try {
        next = { status: 'ready', enabled: recruitmentHostingOpen(await deps.fetchConfig(terminalId)) }
      } catch {
        next = READY_CLOSED
      }
    }
    if (!active || run !== generation) return
    if (deps.getTerminalId() !== terminalId) {
      await load()
      return
    }
    deps.onSettle(next)
  }

  return {
    load,
    dispose: () => {
      active = false
      generation += 1
    },
  }
}
