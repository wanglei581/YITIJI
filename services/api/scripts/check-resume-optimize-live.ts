// 服务器只读真模型探针：在 services/api 目录，与 API 进程同一环境运行。
// import dotenv/config 与线上加载一致；只读 LlmConfigService 的 resume_optimize
// 槽位 getApiKey/getConfig，回退顺序完全交给该服务，不复制解密/环境取密钥逻辑。
// 直接优化，不初始化应用或用量落账服务；回调只累计内存元数据，不写数据库。
// 最多 8 次上游请求（含重试），第 9 次在 fetch 前拒绝。只输出统计，绝不输出正文/密钥。
// 用法：pnpm run probe:resume-optimize-live；离线门禁 verify:resume-optimize-live-gate。
// contentBlocks 按四份虚构原文手写事实行，再走诊断同一 sanitizeContentBlocks 回配函数；
// 不额外调用诊断模型，避免把诊断调用计入这次优化探针。
import 'dotenv/config'
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { LlmConfigService } from '../src/ai/llm/llm-config.service'
import { LlmResumeOptimizeService, type OptimizeResult } from '../src/ai/resume/llm-resume-optimize.service'
import { sanitizeContentBlocks } from '../src/ai/resume/llm-resume-evidence'
import { buildOriginalCoverage } from '../src/ai/resume/resume-optimize-coverage'
import { normalizeResumeStructureText } from '../src/ai/resume/resume-structure'
import { priceTokens } from '../src/ai/usage/ai-pricing'
import type { ResumeReport } from '../src/ai/interfaces/ai-provider.interface'

export const MAX_LLM_CALLS = 8
export interface LiveSample {
  text: string
  blocks: Array<{ key: string; lines: string[] }>
}
const school = '明川虚构大学 信息管理 本科 2016.09-2020.06'
const workA = '晨岚虚构科技有限公司 2020.07 - 2022.12'
const workB = '云汀虚构物流有限公司 2023.01 - 2025.08'
const columnA = workA.replace(' 2020', '                 2020')
const columnB = workB.replace(' 2023', '                 2023')
const project = '虚构档案整理项目 2024.03 - 2024.06'
export const PRIVATE_SENTENCE = '逐项核对入库材料的分类标识和登记顺序，整理交接记录并回访内部同事，依据反馈更新操作说明，确保每批资料的目录与存放位置一致。'
const contact = '电话：已隐去 邮箱：fiction@example.com'
const longParts = [workA, workB, '清禾虚构商贸有限公司 2025.09 - 至今'].map((line) =>
  `${line}\n${PRIVATE_SENTENCE.repeat(26)}`,
)
export const LIVE_SAMPLES: LiveSample[] = [
  { text: ['苏虚宁', contact, workA, '负责材料登记和交接。', '工作经历', '照片见附件。', '教育经历', school].join('\n'),
    blocks: [{ key: 'experience', lines: [workA] }, { key: 'education', lines: [school] }] },
  { text: ['叶虚舟', contact, '教育经历', school, `${columnA} 仓储助理`, `${columnB} 资料管理员`,
    '工作经历', '负责仓储资料登记。', '项目经历', project, '整理档案目录。', '专业技能', 'Excel 资料整理'].join('\n'),
    blocks: [{ key: 'experience', lines: [columnA + ' 仓储助理', columnB + ' 资料管理员'] },
      { key: 'education', lines: [school] }, { key: 'project', lines: [project] }, { key: 'skill', lines: ['Excel 资料整理'] }] },
  { text: ['沈虚禾', contact, '工作经历', workA, '整理入库资料。', workB, '维护交接记录。', '证书',
    '虚构资料整理培训证书', '教育经历', school].join('\n'),
    blocks: [{ key: 'experience', lines: [workA, workB] }, { key: 'education', lines: [school] }] },
  { text: ['陆虚白', contact, '教育经历', school, '工作经历', ...longParts, '项目经历', project, '整理档案目录。',
    '专业技能', 'Excel 资料整理', '证书', '虚构资料整理培训证书'].join('\n'),
    blocks: [{ key: 'education', lines: [school] }, { key: 'experience', lines: longParts.map((part) => part.split('\n')[0]!) },
      { key: 'project', lines: [project] }, { key: 'skill', lines: ['Excel 资料整理'] }] },
]
const KEYS = ['education', 'experience', 'projects', 'skills', 'certificates'] as const
const LABELS = { education: '教育', experience: '经历', projects: '项目', skills: '技能', certificates: '证书', summary: '原文补充' }
export function sampleReport(sample: LiveSample): ResumeReport {
  return { sections: [], suggestions: [], contentBlocks: sanitizeContentBlocks(sample.blocks, sample.text) }
}

/** 计数发生在传输前，不能用事后 onLlmCall 阻止第九次已发出的请求。 */
export function createCallBudget() {
  return {
    calls: 0, rejected: false,
    beforeCall() {
      if (this.calls >= MAX_LLM_CALLS) {
        this.rejected = true
        throw new Error('PROBE_CALL_LIMIT')
      }
      this.calls++
    },
  }
}
type ProbeConfig = Pick<LlmConfigService, 'getApiKey' | 'getConfig'>
export interface ProbeOptions {
  config?: ProbeConfig
  fetch?: typeof globalThis.fetch
  write?: (line: string) => void
  budget?: ReturnType<typeof createCallBudget>
}
function errorCode(error: unknown): string {
  const response = (error as { getResponse?: () => { error?: { code?: string } } })?.getResponse?.()
  const code = response?.error?.code
  // 未知异常可能含上游正文或凭证，不输出异常 message。
  return typeof code === 'string' && /^AI_[A-Z_]+$/.test(code) ? code : 'PROBE_FAILED'
}
function truncationCount(result: OptimizeResult, baseline: ReturnType<typeof buildOriginalCoverage>): number {
  const norm = normalizeResumeStructureText
  return ['education', 'experience', 'projects'].reduce((count, key) => count +
    result.optimizedResume[key as 'education' | 'experience' | 'projects'].filter((item) => {
      const description = norm(item.description ?? '')
      return !!description && baseline.some((entry) => entry.key === key &&
        norm(entry.lines.slice(1).join('\n')).startsWith(description) &&
        norm(entry.lines.slice(1).join('\n')).length > description.length)
    }).length, 0)
}

export async function main(options: ProbeOptions = {}): Promise<number> {
  Logger.overrideLogger(false)
  const write = options.write ?? ((line: string) => console.log(line))
  const config = options.config ?? new LlmConfigService()
  if (!config.getApiKey('resume_optimize')?.trim()) {
    write('未验证：缺少 resume_optimize 密钥')
    return 1
  }
  config.getConfig('resume_optimize')
  const service = new LlmResumeOptimizeService(config as LlmConfigService)
  const budget = options.budget ?? createCallBudget()
  const previousFetch = globalThis.fetch
  const transport = options.fetch ?? previousFetch
  globalThis.fetch = async (...args) => { budget.beforeCall(); return transport(...args) }
  let cost = 0
  let measured = true
  let allPassed = true
  try {
    for (const [index, sample] of LIVE_SAMPLES.entries()) {
      const report = sampleReport(sample)
      const baseline = buildOriginalCoverage(sample.text, report, sample.text.length, (v) => v)
      const originalCounts = Object.fromEntries(KEYS.map((key) => [key, baseline.filter((e) => e.key === key)
        .reduce((n, e) => n + (key === 'skills' || key === 'certificates' ? e.lines.length : 1), 0)]))
      const beforeCalls = budget.calls
      let input = 0, output = 0, callbacks = 0, usageKnown = true
      let result: OptimizeResult | undefined
      let status = '通过'
      try {
        result = await service.optimize(sample.text, report, undefined, (meta) => {
          callbacks++
          if (!meta.tokenUsage) { usageKnown = false; measured = false; return }
          input += meta.tokenUsage.promptTokens
          output += meta.tokenUsage.completionTokens
          const price = priceTokens(meta.provider, meta.tokenUsage)
          if (price === undefined) measured = false
          else cost += price
        })
        if (KEYS.some((key) => result!.optimizedResume[key].length < originalCounts[key]!)) status = '丢内容'
      } catch (error) {
        status = `失败(${budget.rejected ? 'PROBE_CALL_LIMIT' : errorCode(error)})`
        if (budget.calls > beforeCalls && input + output === 0) { measured = false; usageKnown = false }
      }
      if (callbacks < budget.calls - beforeCalls) { usageKnown = false; measured = false }
      allPassed &&= status === '通过'
      const kept = result?.modules.filter((m) => /^(教育经历|工作经历|项目经历|技能|证书|原文补充)（保持原文）$/u.test(m.title)) ?? []
      const originals = KEYS.map((key) => `${LABELS[key]}=${originalCounts[key]}`).join(',')
      const optimized = KEYS.map((key) => `${LABELS[key]}=${result?.optimizedResume[key].length ?? 0}`).join(',')
      const restored = kept.map((m) => m.title.replace('（保持原文）', '')).join(',') || '无'
      write(`样例${index + 1} 原件段:${originals} 优化版:${optimized} 补回:${restored} 截断:${result ? truncationCount(result, baseline) : 0} 清单:${result?.modules.length ?? 0}(保持原文 ${kept.length}) 调用:${budget.calls - beforeCalls} tokens:${usageKnown ? input : '未知'}/${usageKnown ? output : '未知'} 结果:${status}`)
    }
    write(`合计 调用:${budget.calls}/8 估算花费:${measured ? cost.toFixed(4) : '未估算'}元 结论:${allPassed ? '全部保留' : '有丢失'}`)
    return allPassed ? 0 : 1
  } finally {
    globalThis.fetch = previousFetch
  }
}
if (require.main === module) {
  main().then((code) => { process.exitCode = code }).catch(() => {
    console.log('未验证：PROBE_FAILED')
    process.exitCode = 1
  })
}
