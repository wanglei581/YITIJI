/**
 * Wave 2 — AI 简历排版/内容一键调整验证。
 *
 * 覆盖：
 *   1. DTO 只接受 action=reformat|condense，且请求体只含 resume/action/layout。
 *   2. 未配置 resume_optimize 时明确失败，不 fallback mock。
 *   3. 新增学校/公司/证书/数字会被拒绝。
 *   4. 承诺类表述会被拒绝。
 *   5. condense 只精简描述，不增加条目、不新增事实。
 *   6. 事实基线只取简历字段值，不把 JSON key 当事实。
 *   7. AiService 路由实现必须重新提取原文，提取失败硬失败，不退化为仅用 currentResume。
 *   8. 响应只包含 resume/warnings，不泄漏 token、signedUrl、密钥或原文。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:resume-layout-adjust
 */
import 'dotenv/config'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { readFileSync } from 'fs'
import { join } from 'path'
import { validateSync } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { Logger } from '@nestjs/common'
import { LlmResumeOptimizeService } from '../src/ai/resume/llm-resume-optimize.service'
import { ResumeLayoutAdjustDto } from '../src/ai/dto/resume-generate.dto'
import type { GeneratedResume } from '../src/ai/interfaces/ai-provider.interface'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exitCode = 1; throw new Error(m) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

const jw = (...parts: string[]) => parts.join('')

const ORIGINAL_TEXT = [
  '姓名 Alex Chen  电话 13800000000  邮箱 alex@example.com',
  '求职意向 前端开发工程师',
  '教育经历 Sample University Computer Science Bachelor 2020-2024',
  '工作经历 Acme Cloud Frontend Intern 2024 负责组件库维护 将首屏加载时间从4秒降到1.8秒',
  '项目经历 Hiring Dashboard Developer 负责岗位看板性能优化',
  '技能 React TypeScript',
  '证书 CET-6',
].join('\n')

const baseResume: GeneratedResume = {
  basic: { name: 'Alex Chen', phone: '13800000000', email: 'alex@example.com' },
  intention: { position: '前端开发工程师' },
  summary: '具备前端开发实习经验，熟悉 React 与 TypeScript，关注页面性能。',
  education: [
    {
      school: 'Sample University',
      major: 'Computer Science',
      degree: 'Bachelor',
      period: '2020-2024',
      description: '完成计算机核心课程学习。',
    },
  ],
  experience: [
    {
      company: 'Acme Cloud',
      role: 'Frontend Intern',
      period: '2024',
      description: '负责组件库维护与页面性能优化，将首屏加载时间从4秒降到1.8秒。',
    },
  ],
  projects: [
    {
      name: 'Hiring Dashboard',
      role: 'Developer',
      description: '负责岗位看板性能优化。',
    },
  ],
  skills: ['React', 'TypeScript'],
  certificates: ['CET-6'],
}

type StubResponse = { status: number; content?: string }
let responseQueue: StubResponse[] = []
let llmCallCount = 0
const setResponses = (arr: StubResponse[]) => { responseQueue = arr.slice(); llmCallCount = 0 }

function adjustedResume(mut?: (resume: GeneratedResume) => void): string {
  const resume: GeneratedResume = {
    ...baseResume,
    summary: '前端开发实习背景，熟悉 React 与 TypeScript，能围绕页面性能持续优化。',
    education: baseResume.education.map((item) => ({ ...item })),
    experience: baseResume.experience.map((item) => ({
      ...item,
      description: '维护组件库并优化页面性能，首屏加载时间从4秒降到1.8秒。',
    })),
    projects: baseResume.projects.map((item) => ({ ...item, description: '优化岗位看板性能。' })),
    skills: [...baseResume.skills],
    certificates: [...baseResume.certificates],
  }
  mut?.(resume)
  return JSON.stringify({ resume, warnings: ['已精简经历描述，未新增事实。'] })
}

function configured(baseURL: string, enabled = true) {
  return {
    getApiKey: (feature?: string) => (enabled && feature === 'resume_optimize' ? 'stub-key' : null),
    getConfig: (feature?: string) => ({
      vendor: 'deepseek',
      model: 'stub',
      baseURL,
      systemPrompt: '',
      roleScope: '',
      forbiddenWords: [] as string[],
      temperature: 0.3,
      enabled: enabled && feature === 'resume_optimize',
    }),
    isReady: (feature?: string) => enabled && feature === 'resume_optimize',
  }
}

async function main(): Promise<void> {
  console.log('\n=== Wave 2 AI 简历排版/内容一键调整验证 ===')
  Logger.overrideLogger({ log: () => {}, error: () => {}, warn: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} })

  const server = createServer((req, res) => {
    req.on('data', () => undefined)
    req.on('end', () => {
      llmCallCount++
      const next = responseQueue.shift() ?? { status: 200, content: adjustedResume() }
      res.statusCode = next.status
      res.setHeader('Content-Type', 'application/json')
      res.end(next.status === 200 ? JSON.stringify({ choices: [{ message: { content: next.content } }] }) : '{"error":"stub"}')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`

  try {
    const invalidAction = plainToInstance(ResumeLayoutAdjustDto, { action: 'rewrite', resume: baseResume })
    if (validateSync(invalidAction).length === 0) fail('1. action 应只允许 reformat|condense')
    const exportOnlyField = plainToInstance(ResumeLayoutAdjustDto, { action: 'condense', resume: baseResume, format: 'pdf' })
    if (validateSync(exportOnlyField, { whitelist: true, forbidNonWhitelisted: true }).length === 0) {
      fail('1. layout-adjust DTO 不应接受导出专用 format 字段')
    }
    pass('1. DTO action 与字段白名单收紧')

    const off = new LlmResumeOptimizeService(configured(baseURL, false) as never)
    try {
      await off.adjustLayoutDraft({ currentResume: baseResume, originalText: ORIGINAL_TEXT, action: 'condense' })
      fail('2. 未配置时不应成功')
    } catch (e) {
      if (errCode(e) !== 'AI_PROVIDER_NOT_CONFIGURED') fail(`2. 期望 AI_PROVIDER_NOT_CONFIGURED，实际 ${errCode(e)}`)
    }
    pass('2. 未配置 resume_optimize → 明确失败，不 fallback mock')

    const svc = new LlmResumeOptimizeService(configured(baseURL) as never)

    setResponses([{
      status: 200,
      content: adjustedResume((resume) => {
        resume.education[0] = { ...resume.education[0], school: 'Fabricated University' }
      }),
    }, {
      status: 200,
      content: adjustedResume((resume) => {
        resume.education[0] = { ...resume.education[0], school: 'Fabricated University' }
      }),
    }])
    try {
      await svc.adjustLayoutDraft({ currentResume: baseResume, originalText: ORIGINAL_TEXT, action: 'reformat' })
      fail('3. 新增学校应被拒绝')
    } catch (e) {
      if (errCode(e) !== 'AI_LAYOUT_ADJUST_INVALID_OUTPUT') fail(`3. 期望 AI_LAYOUT_ADJUST_INVALID_OUTPUT，实际 ${errCode(e)}`)
    }
    pass('3a. 新增学校/事实串 → 拒绝')

    const keyAsFact = adjustedResume((resume) => { resume.certificates = ['summary'] })
    setResponses([{ status: 200, content: keyAsFact }, { status: 200, content: keyAsFact }])
    try {
      await svc.adjustLayoutDraft({ currentResume: baseResume, originalText: ORIGINAL_TEXT, action: 'reformat' })
      fail('3/6. JSON key 被当作事实时会误通过，此处必须拒绝')
    } catch (e) {
      if (errCode(e) !== 'AI_LAYOUT_ADJUST_INVALID_OUTPUT') fail(`6. 期望 AI_LAYOUT_ADJUST_INVALID_OUTPUT，实际 ${errCode(e)}`)
    }
    pass('3b+6. 事实基线只取字段值，JSON key 不可作为事实')

    const promising = adjustedResume((resume) => { resume.summary = `优秀候选人，${jw('保', '录用')}` })
    setResponses([{ status: 200, content: promising }, { status: 200, content: promising }])
    try {
      await svc.adjustLayoutDraft({ currentResume: baseResume, originalText: ORIGINAL_TEXT, action: 'reformat' })
      fail('4. 承诺词应被拒绝')
    } catch (e) {
      if (errCode(e) !== 'AI_LAYOUT_ADJUST_INVALID_OUTPUT') fail(`4. 期望 AI_LAYOUT_ADJUST_INVALID_OUTPUT，实际 ${errCode(e)}`)
    }
    pass('4. 承诺类表述 → 拒绝')

    const newNumber = adjustedResume((resume) => {
      resume.experience[0] = { ...resume.experience[0], description: '新增覆盖 9 个业务模块。' }
    })
    setResponses([{ status: 200, content: newNumber }, { status: 200, content: newNumber }])
    try {
      await svc.adjustLayoutDraft({ currentResume: baseResume, originalText: ORIGINAL_TEXT, action: 'condense' })
      fail('3. 新增数字应被拒绝')
    } catch (e) {
      if (errCode(e) !== 'AI_LAYOUT_ADJUST_INVALID_OUTPUT') fail(`3. 期望 AI_LAYOUT_ADJUST_INVALID_OUTPUT，实际 ${errCode(e)}`)
    }
    pass('3c. 新增数字 → 拒绝')

    setResponses([{ status: 200, content: adjustedResume() }])
    const result = await svc.adjustLayoutDraft({
      currentResume: baseResume,
      originalText: ORIGINAL_TEXT,
      action: 'condense',
      layout: { columns: 2, fontScale: 'compact', lineSpacing: 'compact', margin: 'narrow', accent: 'slate' },
    })
    if (result.resume.experience.length !== baseResume.experience.length) fail('5. condense 不应增加经历条目')
    if (result.resume.experience[0].description.length >= baseResume.experience[0].description.length) fail('5. condense 应精简经历描述')
    const keys = Object.keys(result).sort().join(',')
    if (keys !== 'resume,warnings') fail(`8. 响应字段应仅 resume,warnings，实际 ${keys}`)
    const responseText = JSON.stringify(result)
    for (const leak of ['accessToken', 'signedUrl', 'stub-key', ORIGINAL_TEXT]) {
      if (responseText.includes(leak)) fail(`8. 响应泄漏 ${leak}`)
    }
    pass('5+8. condense 精简成功，响应只含 resume/warnings 且无敏感泄漏')

    const aiServiceSource = readFileSync(join(process.cwd(), 'src/ai/ai.service.ts'), 'utf-8')
    if (!aiServiceSource.includes('adjustResumeLayout')) fail('7. AiService 缺少 adjustResumeLayout')
    if (!aiServiceSource.includes('resumeExtraction.extractResumeText')) fail('7. layout-adjust 必须重新提取原文')
    if (!aiServiceSource.includes('AI_RESUME_SOURCE_UNAVAILABLE')) fail('7. 提取失败必须硬失败并返回明确错误码')
    pass('7. AiService layout-adjust 重新提取原文，提取失败不 fallback currentResume')

    console.log('\n=== ALL PASS ===')
  } finally {
    server.close()
  }
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e.message)
  process.exit(1)
})
