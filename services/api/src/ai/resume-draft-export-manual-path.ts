import type { AiManualPath } from '../ai-access/ai-access.decorator'

/**
 * 简历「按原样导出」（POST resume/generate/export，draft=true）是 AI 挂掉时的手动退路：
 * 逐字导出用户自己填的内容，不送模型、不带 AI 标识，所以不经过 AI 闸门（暂停 / 未开通 / 额度 / 声明 / 登录档位），
 * 控制器里也不查简历 AI 授权（resume_ai）。只认请求体里严格的布尔 true；其它一律照常过闸（失败关闭）。
 * 单独成文件：ai.controller.ts 已超 800 行，不再往里加逻辑。
 */
export const RESUME_DRAFT_EXPORT_MANUAL_PATH: AiManualPath = {
  when: (req) => (req.body as { draft?: unknown } | undefined)?.draft === true,
  reason: '按原样导出（draft=true）逐字导出用户自己填的内容，不送模型、不带 AI 标识，是 AI 挂掉时的手动退路',
}
