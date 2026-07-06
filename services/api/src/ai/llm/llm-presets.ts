// ============================================================
// LLM 预设注册表
//
// DeepSeek / 通义千问 / MiniMax / 鱼人 API 四家均兼容 OpenAI Chat Completions 接口，
// 因此统一用 { baseURL, model, apiKey } 三要素描述，单一 provider 即可对接。
//
// apiKey 只在服务端保存（加密落盘），绝不下发前端。
// ============================================================

export type LlmVendor = 'deepseek' | 'qwen' | 'minimax' | 'yuren'

export interface LlmPreset {
  vendor:       LlmVendor
  label:        string
  baseURL:      string   // OpenAI 兼容 base（不含 /chat/completions）
  defaultModel: string
  models:       string[] // 常用模型候选
  docsUrl:      string
}

export const LLM_PRESETS: Record<LlmVendor, LlmPreset> = {
  deepseek: {
    vendor:       'deepseek',
    label:        'DeepSeek 深度求索',
    baseURL:      'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models:       ['deepseek-chat', 'deepseek-reasoner'],
    docsUrl:      'https://platform.deepseek.com',
  },
  qwen: {
    vendor:       'qwen',
    label:        '通义千问 Qwen',
    baseURL:      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models:       ['qwen-turbo', 'qwen-plus', 'qwen-max'],
    docsUrl:      'https://help.aliyun.com/zh/model-studio',
  },
  minimax: {
    vendor:       'minimax',
    label:        'MiniMax',
    baseURL:      'https://api.minimax.chat/v1',
    defaultModel: 'abab6.5s-chat',
    models:       ['abab6.5s-chat', 'abab6.5-chat'],
    docsUrl:      'https://platform.minimaxi.com',
  },
  yuren: {
    vendor:       'yuren',
    label:        '鱼人 API（Yuren）',
    baseURL:      'https://yurenapi.cn/v1',
    defaultModel: 'gpt-5.4',
    models:       [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.5',
      'gpt-5.6',
      'gpt-5.6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
    ],
    docsUrl:      'https://yurenapi.cn',
  },
}

export const LLM_VENDORS = Object.keys(LLM_PRESETS) as LlmVendor[]

export function isLlmVendor(v: string): v is LlmVendor {
  return (LLM_VENDORS as string[]).includes(v)
}
