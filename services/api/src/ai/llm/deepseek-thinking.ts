// ============================================================
// DeepSeek 思考模式：统一关闭（所有 OpenAI 兼容对话接口的调用点共用）
//
// 注意：本文件（含注释）不要写出对话接口的路径字面量 —— verify:ai-content-moderation、
// verify:llm-input-pii-mask 等门禁按「文件里出现该路径」派生 LLM 调用点，写了会把
// 这个纯函数文件误判成没接审核 / 遮盖的新调用点。
//
// ── 为什么要关 ────────────────────────────────────────────────
// DeepSeek 官方（2026-09-29 访问）：
//   https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
//     思考模式默认开启、思考强度默认 high；思考模式下 temperature /
//     presence_penalty / frequency_penalty 不生效（不报错，但被忽略）。
//   https://api-docs.deepseek.com/zh-cn/api/create-chat-completion
//     thinking.type 取值 enabled / disabled，默认 enabled；
//     usage.completion_tokens_details.reasoning_tokens = 思考链 token 数。
//   https://api-docs.deepseek.com/zh-cn/quick_start/pricing
//     推荐模型名 deepseek-flash；旧名 deepseek-v4-flash 仍可调（路由到当前模型）。
// 思考 token 按输出价计费，还把等待拉长；这些功能（简历诊断、岗位解释、
// 模拟面试出题、数字人对话……）只要 content，不需要思考链。
//
// ── 为什么按「模型名前缀 deepseek」判断，而不是 deepseek-v4 ──────
// 此前 10 个调用点各自写 `model.startsWith('deepseek-v4')`，另有 3 个调用点
// 干脆没写。官方推荐名已经是 `deepseek-flash`（不带 v4），管理员一旦按官方
// 推荐改名，思考就悄悄重新打开，账单和等待一起涨，而且没有任何报错。
// 所以这里按 `deepseek` 前缀（去首尾空白、大小写不敏感）判断：凡 DeepSeek 系一律关。
//
// ── 为什么用 thinking:{type:'disabled'}，不用 reasoning_effort ──
// 官方两页说法不一致：指南页把 reasoning_effort 写成顶层字段、OpenAI 格式取值
// low/high/max（没有 none）；API 参考页把它写在 thinking 对象里、取值含 none。
// `thinking: { type: 'disabled' }` 两页一致，是唯一没有歧义的写法。
//
// ── 为什么非 DeepSeek 返回空对象 ──────────────────────────────
// 千问 qwen-plus（Qwen3 商业版）官方默认不开思考，开关字段是 enable_thinking
// （阿里云百炼「深度思考」页，2026-09-29 访问：
// https://help.aliyun.com/zh/model-studio/deep-thinking）。给别家塞 DeepSeek
// 专有字段只会多一个被上游拒收的面，所以不动。
//
// ── 为什么单独一个文件，不放进 llm-http.ts ────────────────────
// llm-http.ts 目前归 P1-3 / P1-2a 两个未合的 PR 在改，这里插一刀必然冲突；
// 而且 llm-http 管的是「怎么发」（超时、并发闸门、内容审核），不管「发什么」。
// 也不放 llm-presets.ts：那是厂商默认值表，这里是请求体规则。
//
// 门禁：verify:llm-thinking-off（运行时断言 + 全部调用点静态扫描）。
// ============================================================

/** 请求体里用来关闭 DeepSeek 思考模式的字段。 */
export interface DeepseekThinkingOffFields {
  thinking: { type: 'disabled' }
}

/** 是否 DeepSeek 系模型：按模型名前缀 `deepseek`，去首尾空白、大小写不敏感。 */
export function isDeepseekModel(model: unknown): boolean {
  return typeof model === 'string' && model.trim().toLowerCase().startsWith('deepseek')
}

/**
 * 组请求体时展开用：`{ model, messages, ...deepseekThinkingOff(model) }`。
 * DeepSeek 系返回关闭思考的字段；其它厂商返回空对象（请求体不变）。
 * 每次返回新对象，调用方展开或修改都不会互相污染。
 */
export function deepseekThinkingOff(model: unknown): DeepseekThinkingOffFields | Record<string, never> {
  return isDeepseekModel(model) ? { thinking: { type: 'disabled' } } : {}
}
