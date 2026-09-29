// ============================================================
// AI 服务开关（D6 一键暂停与全机维护 + C6 使用声明 + C7 登录档位）
//
// API_MODE=http → 真实后端（只有 admin 角色，见 services/api/src/ai-access/）：
//   GET /admin/ai-access  → { success: true, data: { loginGate, declarationEnforced, paused, maintenance } }
//   PUT /admin/ai-access  body { loginGate? | declarationEnforced? | paused? | maintenance?, reason }
//                         → 同上；data 是切换后服务端重新读出来的状态
//   事由去空白后为空 → 400 REASON_REQUIRED；非管理员 → 403；每次切换服务端先写审计再生效。
// API_MODE=mock → 演示数据：localStorage['mock:ai-access'] 存四项（默认全关），只在本浏览器生效；
//   localStorage['mock:ai-access-simulate'] = 'forbidden' 时按非管理员 403 演示，
//   = 'error' 时模拟网络失败。只在 mock 下读。
//
// 页面只能按服务端返回的状态说话：切换后以响应里的 data 为准，不拿提交值拼出新状态。
// ============================================================

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type AiLoginGate = 'off' | 'before_export' | 'before_generate'

export interface AiAccessConfig {
  /** 登录档位：off 不要求；before_export 导出、打印 AI 材料前；before_generate AI 生成、语音、导出打印前。 */
  loginGate: AiLoginGate
  /** AI 生成与语音缺少声明（且会员没有留存的同意）时拒绝。 */
  declarationEnforced: boolean
  /** AI 生成、语音、导出类接口一律暂停；读取类不受影响。 */
  paused: boolean
  /** 全机维护：AI（读取类除外）与标了 @MaintenanceBlocked() 的下单、打印、扫描、上传、转换接口暂停。 */
  maintenance: boolean
}

/** 一次只切一项；页面每次只提交一个字段。 */
export type AiAccessPatch = Partial<AiAccessConfig>

/** 与服务端 UpdateAiAccessDto 的 @IsIn 取值一致，按从宽到严排列。 */
export const AI_LOGIN_GATES: readonly AiLoginGate[] = ['off', 'before_export', 'before_generate']

/** 与服务端 UpdateAiAccessDto 的 @MaxLength(200) 一致。 */
export const AI_ACCESS_REASON_MAX = 200

/** mock 模式下页面要标明「演示数据」。 */
export const AI_ACCESS_DEMO: boolean = API_MODE !== 'http'

export const MOCK_AI_ACCESS_KEY = 'mock:ai-access'
export const MOCK_AI_ACCESS_SIMULATE_KEY = 'mock:ai-access-simulate'

const AI_ACCESS_PATH = '/admin/ai-access'

export interface AiAccessReasonProblem {
  code: 'REASON_REQUIRED' | 'REASON_TOO_LONG'
  message: string
}

/**
 * 事由按去空白后的字数算，1–200 字；合格返回 null。
 * 按码点计数：服务端 @MaxLength 也按码点计（还会少算变体选择符），这里只会比服务端更严，不会更松。
 */
export function aiAccessReasonProblem(reason: string): AiAccessReasonProblem | null {
  const length = Array.from(reason.trim()).length
  if (length === 0) return { code: 'REASON_REQUIRED', message: '请填写切换事由' }
  if (length > AI_ACCESS_REASON_MAX) {
    return { code: 'REASON_TOO_LONG', message: `切换事由不能超过 ${AI_ACCESS_REASON_MAX} 字` }
  }
  return null
}

function readConfig(value: unknown): AiAccessConfig | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!AI_LOGIN_GATES.includes(v.loginGate as AiLoginGate)) return null
  if (typeof v.declarationEnforced !== 'boolean' || typeof v.paused !== 'boolean' || typeof v.maintenance !== 'boolean') {
    return null
  }
  return {
    loginGate: v.loginGate as AiLoginGate,
    declarationEnforced: v.declarationEnforced,
    paused: v.paused,
    maintenance: v.maintenance,
  }
}

/** 只留本次要切的字段；一个都没有就不发请求。 */
function patchFields(patch: AiAccessPatch): AiAccessPatch {
  const fields: AiAccessPatch = {}
  if (patch.loginGate !== undefined) fields.loginGate = patch.loginGate
  if (patch.declarationEnforced !== undefined) fields.declarationEnforced = patch.declarationEnforced
  if (patch.paused !== undefined) fields.paused = patch.paused
  if (patch.maintenance !== undefined) fields.maintenance = patch.maintenance
  if (Object.keys(fields).length === 0) throw new ApiHttpError('NOTHING_TO_CHANGE', '没有要切换的开关', 400)
  return fields
}

function assertReason(reason: string): void {
  const problem = aiAccessReasonProblem(reason)
  if (problem) throw new ApiHttpError(problem.code, problem.message, 400)
}

interface AiAccessServiceInterface {
  get(): Promise<AiAccessConfig>
  update(patch: AiAccessPatch, reason: string): Promise<AiAccessConfig>
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

async function request(method: 'GET' | 'PUT', body?: unknown): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${AI_ACCESS_PATH}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请检查网络后重试', 0)
  }
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = `请求失败（${res.status}）`
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } }
      if (data.error?.code) code = data.error.code
      if (data.error?.message) message = data.error.message
    } catch { /* 非 JSON，保留默认值 */ }
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', 401)
    }
    throw new ApiHttpError(code, message, res.status)
  }
  try {
    return await res.json()
  } catch {
    throw new ApiHttpError('UNEXPECTED_RESPONSE', '服务端返回的开关状态无法识别，请点“重新读取”核对', res.status)
  }
}

/** 响应外壳是 { success: true, data }；四项缺一或取值不对都不认，免得页面拿半截数据说话。 */
function configFromResponse(body: unknown): AiAccessConfig {
  const data = body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined
  const config = readConfig(data)
  if (!config) throw new ApiHttpError('UNEXPECTED_RESPONSE', '服务端返回的开关状态无法识别，请点“重新读取”核对', 200)
  return config
}

const httpAdapter: AiAccessServiceInterface = {
  async get() {
    return configFromResponse(await request('GET'))
  },
  async update(patch, reason) {
    assertReason(reason)
    return configFromResponse(await request('PUT', { ...patchFields(patch), reason: reason.trim() }))
  },
}

// ─── Mock adapter ─────────────────────────────────────────────────────────────

const MOCK_DEFAULT: AiAccessConfig = { loginGate: 'off', declarationEnforced: false, paused: false, maintenance: false }

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function simulateMockFailure(): void {
  const mode = readLocal(MOCK_AI_ACCESS_SIMULATE_KEY)
  if (mode === 'forbidden') throw new ApiHttpError('AUTH_ROLE_FORBIDDEN', '当前角色无权访问 (需要: admin)', 403)
  if (mode === 'error') throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请检查网络后重试', 0)
}

function readMockConfig(): AiAccessConfig {
  const raw = readLocal(MOCK_AI_ACCESS_KEY)
  if (!raw) return { ...MOCK_DEFAULT }
  try {
    return readConfig(JSON.parse(raw)) ?? { ...MOCK_DEFAULT }
  } catch {
    return { ...MOCK_DEFAULT }
  }
}

const mockAdapter: AiAccessServiceInterface = {
  async get() {
    simulateMockFailure()
    return readMockConfig()
  },
  async update(patch, reason) {
    simulateMockFailure()
    assertReason(reason)
    const changes = patchFields(patch)
    try {
      window.localStorage.setItem(MOCK_AI_ACCESS_KEY, JSON.stringify({ ...readMockConfig(), ...changes }))
    } catch { /* 写不进就不改；下面照实读回，页面会提示与提交不一致 */ }
    // 与服务端一致：写完重新读一遍再返回，而不是把提交值当结果。
    return readMockConfig()
  },
}

const adapter: AiAccessServiceInterface = API_MODE === 'http' ? httpAdapter : mockAdapter

/** 读取四项当前状态（以服务端为准）。 */
export function getAiAccessConfig(): Promise<AiAccessConfig> {
  return adapter.get()
}

/** 切换一项。reason 去空白后 1–200 字，否则不发请求直接报错。返回服务端切换后重新读出的四项状态。 */
export function updateAiAccessConfig(patch: AiAccessPatch, reason: string): Promise<AiAccessConfig> {
  return adapter.update(patch, reason)
}
