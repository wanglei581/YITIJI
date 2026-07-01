/**
 * AI 简历诊断上下文闭环验证。
 *
 * 覆盖:
 *   1. ResumeParseRequestDto 在全局 whitelist/forbidNonWhitelisted 口径下接收 selectedDimensions / targetContext。
 *   2. 非法维度、超长 targetJob 明确拒绝。
 *   3. LlmResumeService prompt 消费诊断重点与目标方向，但仍返回固定 6 维。
 *   4. AiController 审计只记录脱敏字段，不记录目标岗位自由文本。
 *
 * 运行: pnpm --filter @ai-job-print/api verify:resume-diagnosis-context
 */
import 'dotenv/config'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { Logger } from '@nestjs/common'
import { ResumeParseRequestDto } from '../src/ai/dto/resume-parse.dto'
import { LlmResumeService } from '../src/ai/resume/llm-resume.service'
import {
  RESUME_SCORING_DIMENSIONS,
  type ResumeReport,
} from '../src/ai/interfaces/ai-provider.interface'

function pass(message: string) {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function assert(cond: unknown, message: string): void {
  if (cond) pass(message)
  else fail(message)
}

const VALID_SECTIONS = [
  { key: 'basic', label: '基础信息完整度', score: 8, maxScore: 10 },
  { key: 'objective', label: '求职目标清晰度', score: 6, maxScore: 10 },
  { key: 'experience', label: '经历表达清晰度', score: 6, maxScore: 10 },
  { key: 'quantification', label: '成果量化程度', score: 5, maxScore: 10 },
  { key: 'keyword', label: '岗位关键词覆盖', score: 5, maxScore: 10 },
  { key: 'readability', label: '版式与可读性', score: 7, maxScore: 10 },
]

function validReportJson(): string {
  return JSON.stringify({
    sections: VALID_SECTIONS,
    suggestions: ['围绕目标岗位补充关键词', '将项目成果改为量化表达', '联系方式与求职意向保持清晰'],
    riskNotes: ['部分经历缺少量化成果描述'],
    priorities: [
      { focus: '补充成果量化', reason: '目标方向需要更清楚展示可验证结果' },
      { focus: '补齐岗位关键词', reason: '前端工程师方向需要体现技术栈与项目职责' },
    ],
  })
}

async function validateDto(input: Record<string, unknown>) {
  const dto = plainToInstance(ResumeParseRequestDto, input)
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true })
}

function extractSharedDimensionKeys(): string[] {
  const source = readFileSync(new URL('../../../packages/shared/src/types/ai.ts', import.meta.url), 'utf8')
  const block = source.match(/RESUME_SCORING_DIMENSIONS = \[([\s\S]*?)\] as const/)
  if (!block) return []
  return [...block[1].matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1])
}

async function main(): Promise<void> {
  console.log('\n=== AI 简历诊断上下文闭环验证 ===')
  Logger.overrideLogger({ log: () => {}, error: () => {}, warn: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} })

  assert(
    JSON.stringify(extractSharedDimensionKeys()) === JSON.stringify(RESUME_SCORING_DIMENSIONS.map((d) => d.key)),
    '0. shared/API 诊断维度 key 集合保持一致',
  )

  const validRequest = {
    fileId: 'file_diag_context',
    fileName: 'resume.docx',
    fileFormat: 'docx',
    source: 'upload',
    selectedDimensions: ['keyword', 'quantification'],
    targetContext: {
      industry: '互联网/科技',
      targetJob: '前端工程师',
      experience: '应届',
      scene: '校招',
      skipped: false,
    },
  }

  assert((await validateDto(validRequest)).length === 0, '1a. DTO 接收 selectedDimensions / targetContext')
  assert((await validateDto({
    ...validRequest,
    selectedDimensions: ['keyword', 'salary'],
  })).length > 0, '1b. DTO 拒绝非法诊断维度')
  assert((await validateDto({
    ...validRequest,
    targetContext: { ...validRequest.targetContext, targetJob: '前端工程师'.repeat(30) },
  })).length > 0, '1c. DTO 拒绝超长 targetJob')
  assert((await validateDto({
    fileId: 'file_old_client',
    fileName: 'resume.pdf',
    fileFormat: 'pdf',
    source: 'upload',
  })).length === 0, '1d. 旧 4 字段请求仍兼容')

  let capturedPrompt = ''
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        messages?: Array<{ content?: string }>
      }
      capturedPrompt = (body.messages ?? []).map((m) => m.content ?? '').join('\n')
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: validReportJson() } }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const config = {
    getApiKey: (feature?: string) => feature === 'resume_diagnosis' ? 'stub-key' : null,
    getConfig: () => ({
      vendor: 'deepseek',
      model: 'stub-model',
      baseURL,
      systemPrompt: '',
      roleScope: '',
      forbiddenWords: [] as string[],
      temperature: 0.2,
      enabled: true,
    }),
  }
  const llm = new LlmResumeService(config as never) as {
    diagnose: (text: string, context?: unknown) => Promise<ResumeReport>
  }
  const report = await llm.diagnose('姓名 王同学\n项目 React 招聘会导览页面\n技能 React TypeScript', {
    selectedDimensions: validRequest.selectedDimensions,
    targetContext: validRequest.targetContext,
  })
  server.close()
  assert(report.sections.length === 6, '2a. 传部分重点维度仍返回完整 6 维')
  assert(capturedPrompt.includes('前端工程师') && capturedPrompt.includes('互联网/科技'), '2b. LLM prompt 包含目标方向上下文')
  assert(capturedPrompt.includes('岗位关键词覆盖') && capturedPrompt.includes('成果量化程度'), '2c. LLM prompt 包含重点诊断维度')
  assert(capturedPrompt.includes('不裁剪') || capturedPrompt.includes('完整 6'), '2d. LLM prompt 明确不裁剪固定 6 维结构')

  const controllerSource = readFileSync(new URL('../src/ai/ai.controller.ts', import.meta.url), 'utf8')
  assert(controllerSource.includes('selectedDimensionCount'), '3a. 审计记录 selectedDimensionCount')
  assert(controllerSource.includes('targetContextProvided'), '3b. 审计记录 targetContextProvided')
  assert(!controllerSource.includes('targetJob: dto.targetContext') && !controllerSource.includes('targetContext: dto.targetContext'), '3c. 审计不记录目标岗位自由文本')

  console.log('PASS resume diagnosis context verification')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
