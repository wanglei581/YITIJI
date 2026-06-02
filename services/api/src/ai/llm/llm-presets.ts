// ============================================================
// LLM 预设注册表
//
// DeepSeek / 通义千问 / Minimax 三家均兼容 OpenAI Chat Completions 接口，
// 因此统一用 { baseURL, model, apiKey } 三要素描述，单一 provider 即可对接。
//
// apiKey 只在服务端保存（加密落盘），绝不下发前端。
// ============================================================

export type LlmVendor = 'deepseek' | 'qwen' | 'minimax'

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
}

export const LLM_VENDORS = Object.keys(LLM_PRESETS) as LlmVendor[]

export function isLlmVendor(v: string): v is LlmVendor {
  return (LLM_VENDORS as string[]).includes(v)
}
