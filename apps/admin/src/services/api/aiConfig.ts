// 管理员后台 — AI 大模型配置 API
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type LlmVendor = 'deepseek' | 'qwen' | 'minimax' | 'yuren'
export type AiModelFeatureKey =
  | 'assistant_chat'
  | 'mock_interview'
  | 'resume_diagnosis'
  | 'resume_generate'
  | 'resume_optimize'
  | 'job_fit'
  | 'career_plan'
  | 'fair_visit_plan'
  | 'self_assessment'
  | 'job_recommend'
  | 'job_explain'
  | 'advisor_work'
  | 'print_param_prefill'
  | 'digital_human'
  | 'poster_generation'

export interface AiModelFeatureMeta {
  key: AiModelFeatureKey
  label: string
  status: 'active' | 'planned'
  description: string
  runtimeNote: string
  allowCustomSystemPrompt: boolean
  inheritsFrom?: AiModelFeatureKey
}

export interface LlmPreset {
  vendor:       LlmVendor
  label:        string
  baseURL:      string
  defaultModel: string
  models:       string[]
  docsUrl:      string
}

export interface AiConfigView {
  featureKey?:       AiModelFeatureKey
  vendor:           LlmVendor
  model:            string
  baseURL:          string
  systemPrompt:     string
  roleScope:        string
  forbiddenWords:   string[]
  temperature:      number
  enabled:          boolean
  apiKeyConfigured: boolean
  inheritedFrom:   AiModelFeatureKey | null
}

export interface AiConfigResponse {
  config:   AiConfigView
  configs:  Record<AiModelFeatureKey, AiConfigView>
  features: AiModelFeatureMeta[]
  presets:  LlmPreset[]
}

export interface UpdateAiConfigBody {
  feature?:      AiModelFeatureKey
  vendor?:       LlmVendor
  model?:        string
  baseURL?:      string
  systemPrompt?: string
  roleScope?:    string
  forbiddenWords?: string[]
  temperature?:  number
  enabled?:      boolean
  apiKey?:       string
}

const DEMO_FEATURES: AiModelFeatureMeta[] = [
  { key: 'assistant_chat', label: 'AI 顾问对话', status: 'active', description: '一体机文字顾问', runtimeNote: '运行时消费', allowCustomSystemPrompt: true },
  { key: 'mock_interview', label: '模拟面试', status: 'active', description: '面试问答', runtimeNote: '运行时消费', allowCustomSystemPrompt: true },
  { key: 'resume_diagnosis', label: '简历诊断', status: 'active', description: '简历诊断', runtimeNote: '运行时消费', allowCustomSystemPrompt: true },
  { key: 'resume_generate', label: '简历生成', status: 'active', description: '简历生成', runtimeNote: '运行时消费', allowCustomSystemPrompt: true },
  { key: 'resume_optimize', label: '简历优化', status: 'active', description: '简历优化', runtimeNote: '运行时消费', allowCustomSystemPrompt: true },
  { key: 'job_fit', label: '岗位匹配', status: 'active', description: '岗位匹配参考', runtimeNote: '运行时消费', allowCustomSystemPrompt: false, inheritsFrom: 'assistant_chat' },
  { key: 'career_plan', label: '职业规划', status: 'active', description: '职业规划建议', runtimeNote: '运行时消费', allowCustomSystemPrompt: true },
  { key: 'fair_visit_plan', label: '招聘会行程', status: 'planned', description: '招聘会行程建议', runtimeNote: '后续接入', allowCustomSystemPrompt: false, inheritsFrom: 'assistant_chat' },
  { key: 'self_assessment', label: '自我评估', status: 'active', description: '职业自我评估', runtimeNote: '运行时消费', allowCustomSystemPrompt: true },
  { key: 'job_recommend', label: '岗位推荐', status: 'planned', description: '岗位推荐说明', runtimeNote: '后续接入', allowCustomSystemPrompt: false, inheritsFrom: 'assistant_chat' },
  { key: 'job_explain', label: '岗位解读', status: 'planned', description: '岗位解读', runtimeNote: '后续接入', allowCustomSystemPrompt: false, inheritsFrom: 'assistant_chat' },
  { key: 'advisor_work', label: '顾问工作台', status: 'planned', description: '顾问工作台', runtimeNote: '后续接入', allowCustomSystemPrompt: false, inheritsFrom: 'assistant_chat' },
  { key: 'print_param_prefill', label: '打印参数预填', status: 'planned', description: '打印参数建议', runtimeNote: '后续接入', allowCustomSystemPrompt: false, inheritsFrom: 'assistant_chat' },
  { key: 'digital_human', label: '数字人', status: 'planned', description: '数字人台词', runtimeNote: '后续接入', allowCustomSystemPrompt: false, inheritsFrom: 'assistant_chat' },
  { key: 'poster_generation', label: '海报生成', status: 'planned', description: '宣传海报文生图', runtimeNote: '后续接入', allowCustomSystemPrompt: false },
]

const DEMO_PRESETS: LlmPreset[] = [
  { vendor: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', models: ['deepseek-chat'], docsUrl: 'https://api-docs.deepseek.com' },
  { vendor: 'qwen', label: '通义千问', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus', models: ['qwen-plus'], docsUrl: 'https://help.aliyun.com' },
  { vendor: 'minimax', label: 'MiniMax', baseURL: 'https://api.minimax.chat/v1', defaultModel: 'MiniMax-Text-01', models: ['MiniMax-Text-01'], docsUrl: 'https://platform.minimaxi.com' },
  { vendor: 'yuren', label: '雨人', baseURL: 'https://api.yuren.example/v1', defaultModel: 'yuren-chat', models: ['yuren-chat'], docsUrl: 'https://example.com' },
]

function demoConfig(featureKey: AiModelFeatureKey, inheritedFrom: AiModelFeatureKey | null = null): AiConfigView {
  return {
    featureKey,
    vendor: 'deepseek',
    model: 'deepseek-chat',
    baseURL: 'https://api.deepseek.com',
    systemPrompt: '你是求职打印一体机的顾问。',
    roleScope: '求职咨询、简历与打印帮助',
    forbiddenWords: [],
    temperature: 0.7,
    enabled: featureKey === 'assistant_chat',
    apiKeyConfigured: false,
    inheritedFrom,
  }
}

let demoConfigs: Record<AiModelFeatureKey, AiConfigView> = Object.fromEntries(
  DEMO_FEATURES.map((feature) => [feature.key, demoConfig(feature.key, feature.inheritsFrom ?? null)]),
) as Record<AiModelFeatureKey, AiConfigView>

function demoGet(): AiConfigResponse {
  return {
    config: demoConfigs.assistant_chat,
    configs: { ...demoConfigs },
    features: DEMO_FEATURES,
    presets: DEMO_PRESETS,
  }
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  if (API_MODE !== 'http') {
    if (method === 'GET') return demoGet() as T
    if (method === 'POST' && path.endsWith('/test')) {
      return {
        ok: false,
        error: '当前为 mock 模式，连通性测试需要连接真实后端',
      } as T
    }
    if (method === 'PUT') {
      const feature = path.split('/').filter(Boolean).at(-1) as AiModelFeatureKey
      const patch = (body ?? {}) as UpdateAiConfigBody
      const current = demoConfigs[feature] ?? demoConfig(feature)
      const next: AiConfigView = {
        ...current,
        featureKey: feature,
        vendor: patch.vendor ?? current.vendor,
        model: patch.model ?? current.model,
        baseURL: patch.baseURL ?? current.baseURL,
        systemPrompt: patch.systemPrompt ?? current.systemPrompt,
        roleScope: patch.roleScope ?? current.roleScope,
        forbiddenWords: patch.forbiddenWords ?? current.forbiddenWords,
        temperature: patch.temperature ?? current.temperature,
        enabled: patch.enabled ?? current.enabled,
        apiKeyConfigured: patch.apiKey ? true : current.apiKeyConfigured,
        inheritedFrom: null,
      }
      demoConfigs = { ...demoConfigs, [feature]: next }
      return next as T
    }
    throw new ApiHttpError('DEMO_MODE_READONLY', '当前为 mock 模式，该操作需要连接真实后端', 501)
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeader(),
    },
    credentials: 'include',
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const b = await res.json() as { error?: { code?: string; message?: string }; message?: string }
      if (b.error?.code)    code = b.error.code
      if (b.error?.message) message = b.error.message
      else if (b.message)   message = b.message
    } catch { /* keep defaults */ }
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

export const aiConfigApi = {
  get:    (): Promise<AiConfigResponse> => request('/admin/ai-configs', 'GET'),
  update: (body: UpdateAiConfigBody): Promise<AiConfigView> => {
    const { feature = 'assistant_chat', ...rest } = body
    return request(`/admin/ai-configs/${feature}`, 'PUT', rest)
  },
  test:   (feature: AiModelFeatureKey): Promise<{ ok: boolean; reply?: string; error?: string }> =>
            request(`/admin/ai-configs/${feature}/test`, 'POST', {}),
}
