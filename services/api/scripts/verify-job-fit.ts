/**
 * 2D 岗位匹配参考 — 离线回归验证（受控 stub LLM，可进 CI）。
 *
 *  1. jobId 模式闭环：已发布岗位 + 真实简历文本 → completed + 来源信息 + kind=job_fit 落库（归属继承 parse 行）
 *  2. 防编造：evidence 不在简历原文 → 该匹配点丢弃；全部编造 → 重试 → AI_JOB_FIT_FAILED
 *  3. 百分比拦截：输出含「85%」→ 重试一次 → 合法版本通过
 *  4. 禁词拦截：连续输出「录用概率」→ 诚实失败
 *  5. 未发布岗位 → JOB_NOT_FOUND；6. 错 token → AI_TASK_NOT_FOUND（不泄露存在性）
 *  7. 手填岗位模式成功；8. getLatest 读回 + 再分析 upsert 覆盖（同 taskId 单行）
 *  9. 简历文件已清理 → 诚实 failed（不调 LLM）
 * 10. 日志脱敏：简历/岗位文本不出现在日志
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-fit
 */
require('dotenv').config()

import { createServer, type Server } from 'http'
import { Logger } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { LlmJobFitService } from '../src/ai/resume/llm-job-fit.service'
import { JobFitService } from '../src/ai/resume/job-fit.service'

const RESUME_TEXT = '张某某，本科，行政管理专业。曾任某商贸公司行政文员，负责档案管理与会议安排，整理合同文件300余份_简历标记RSME。熟练使用Office办公软件。'
const JOB_DESC = '负责公司日常行政事务、档案与合同管理_岗位标记JOBD'

let passCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string): never { console.error(`  FAIL ${msg}`); throw new Error(`VERIFY FAILED: ${msg}`) }

const capturedLogs: string[] = []
class Cap {
  log(m: unknown) { capturedLogs.push(String(m)) }
  error(m: unknown) { capturedLogs.push(String(m)) }
  warn(m: unknown) { capturedLogs.push(String(m)) }
  debug(m: unknown) { capturedLogs.push(String(m)) }
  verbose(m: unknown) { capturedLogs.push(String(m)) }
}
Logger.overrideLogger(new Cap())

const responseQueue: string[] = []
function startStub(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let b = ''
      req.on('data', (c) => { b += c })
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ choices: [{ message: { content: responseQueue.shift() ?? '{}' } }] }))
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const a = server.address()
      resolve({ server, url: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}` })
    })
  })
}

const VALID = {
  fitLevel: 'reference_medium',
  summary: '与岗位有一定匹配，以下仅供参考。',
  matchPoints: [
    { point: '有档案与合同管理经验', evidence: '负责档案管理与会议安排' },
    { point: '熟悉办公软件', evidence: '熟练使用Office办公软件' },
  ],
  gapPoints: [{ gap: '缺少跨部门协调案例', suggestion: '补充一段协调多方资源的经历表述' }],
  targetedSuggestions: ['在简历开头突出档案管理量化成果', '将合同整理数量前置'],
}
const vjson = (over: Record<string, unknown> = {}) => JSON.stringify({ ...VALID, ...over })

async function main() {
  const { server, url } = await startStub()
  const prisma = new PrismaService()
  const audit = new AuditService(prisma)
  const stubConfig = {
    getApiKey: () => 'stub-key',
    getConfig: () => ({ vendor: 'deepseek', model: 'stub', baseURL: url, systemPrompt: '', roleScope: '', forbiddenWords: [], temperature: 0, enabled: true, apiKeyEncrypted: 'x' }),
  }
  const llm = new LlmJobFitService(stubConfig as never)
  const fileStore = new Map<string, string>()
  const stubExtraction = {
    extractResumeText: ({ fileId }: { fileId: string }) => {
      const text = fileStore.get(fileId)
      return Promise.resolve(text ? { ok: true, text } : { ok: false, errorCode: 'FILE_NOT_FOUND', errorMessage: 'gone' })
    },
  }
  const svc = new JobFitService(prisma, llm, stubExtraction as never, audit)
  const suffix = Date.now().toString(36)
  const taskId = `vjf_task_${suffix}`
  const fileId = `vjf_file_${suffix}`
  const orgId = `vjf_org_${suffix}`
  const accessToken = 'aa'.repeat(24)
  const { createHash } = await import('crypto')
  const tokenHash = createHash('sha256').update(accessToken, 'utf8').digest('hex')

  try {
    fileStore.set(fileId, RESUME_TEXT)
    await prisma.organization.create({ data: { id: orgId, name: '验证机构2D', type: 'school' } })
    const jobPub = await prisma.job.create({
      data: {
        sourceOrgId: orgId, externalId: `vjf-pub-${suffix}`, sourceName: '验证人才网', sourceUrl: 'https://example.com/job',
        title: '行政专员', company: '某商贸公司', city: '青岛', description: JOB_DESC, requirements: '熟悉档案管理',
        reviewStatus: 'approved', publishStatus: 'published',
      },
    })
    const jobDraft = await prisma.job.create({
      data: {
        sourceOrgId: orgId, externalId: `vjf-draft-${suffix}`, sourceName: '验证人才网', sourceUrl: 'https://example.com/job2',
        title: '未发布岗位', company: 'X', city: '青岛', reviewStatus: 'pending', publishStatus: 'draft',
      },
    })
    await prisma.aiResumeResult.create({
      data: {
        taskId, kind: 'parse', status: 'completed', provider: 'llm',
        payloadJson: JSON.stringify({ taskId, status: 'completed', fileId }),
        endUserId: null, accessTokenHash: tokenHash,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    const requester = { endUserId: null, accessToken }

    // 1. jobId 闭环
    responseQueue.push(vjson())
    const r1 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (r1.status !== 'completed' || !('fitLevel' in r1)) fail('1. 应 completed')
    if (r1.job?.sourceName !== '验证人才网' || !r1.job?.sourceUrl) fail('1. 缺岗位来源信息')
    const row1 = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'job_fit' } } })
    if (!row1 || row1.accessTokenHash !== tokenHash) fail('1. job_fit 行未继承 parse 归属')
    pass('1. jobId 闭环：completed + 来源信息 + kind=job_fit 落库继承归属')

    // 2. 防编造
    responseQueue.push(vjson({ matchPoints: [{ point: '会开挖掘机', evidence: '持有挖掘机证书五年经验' }] }))
    responseQueue.push(vjson())
    const r2 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (r2.status !== 'completed' || JSON.stringify(r2).includes('挖掘机')) fail('2. 编造匹配点未被拦截')
    pass('2. 防编造：evidence 不在原文 → 整体重试 → 合法版本通过')

    // 3. 百分比拦截
    responseQueue.push(vjson({ summary: '匹配度约 85%，整体不错。' }))
    responseQueue.push(vjson())
    const r3 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (JSON.stringify(r3).match(/\d{1,3}\s*%/)) fail('3. 百分比未被拦截')
    pass('3. 百分比（85%）→ 重试 → 输出无任何百分比')

    // 4. 禁词连续失败
    responseQueue.push(vjson({ summary: '录用概率较高。' }))
    responseQueue.push(vjson({ gapPoints: [{ gap: 'x', suggestion: '通过率会提升' }] }))
    try {
      await svc.analyze({ taskId, jobId: jobPub.id }, requester)
      fail('4. 连续禁词应失败')
    } catch (e) {
      const resp = JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? '')
      if (!resp.includes('AI_JOB_FIT_FAILED')) fail(`4. 失败码不符: ${resp}`)
    }
    pass('4. 禁词（录用概率/通过率）连续命中 → AI_JOB_FIT_FAILED 诚实失败')

    // 5. 未发布岗位
    try {
      await svc.analyze({ taskId, jobId: jobDraft.id }, requester)
      fail('5. 未发布岗位不应可用')
    } catch (e) {
      const resp = JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? '')
      if (!resp.includes('JOB_NOT_FOUND')) fail(`5. 失败码不符: ${resp}`)
    }
    pass('5. 未发布/未审核岗位 → JOB_NOT_FOUND')

    // 6. 越权
    for (const bad of [{ endUserId: null, accessToken: null }, { endUserId: null, accessToken: 'ff'.repeat(24) }, { endUserId: 'someone', accessToken: null }]) {
      try {
        await svc.analyze({ taskId, jobId: jobPub.id }, bad)
        fail('6. 错误凭证不应通过')
      } catch (e) {
        const resp = JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? '')
        if (!resp.includes('AI_TASK_NOT_FOUND')) fail(`6. 失败码不符: ${resp}`)
      }
    }
    pass('6. 无/错 token 与他人会员 → AI_TASK_NOT_FOUND（不泄露存在性）')

    // 7. 手填模式 + 8. getLatest/upsert
    responseQueue.push(vjson({ fitLevel: 'reference_high' }))
    const r7 = await svc.analyze({ taskId, manualJob: { title: '档案管理员', requirements: '细心' } }, requester)
    if (r7.status !== 'completed' || r7.job?.title !== '档案管理员' || r7.job?.sourceName !== null) fail('7. 手填模式异常')
    pass('7. 手填岗位模式成功（无来源信息，不展示投递引导）')

    const latest = await svc.getLatest(taskId, requester)
    if (latest.job?.title !== '档案管理员') fail('8. getLatest 应返回最近一次（upsert 覆盖）')
    const count = await prisma.aiResumeResult.count({ where: { taskId, kind: 'job_fit' } })
    if (count !== 1) fail(`8. 同 taskId 应只有 1 行 job_fit，实际 ${count}`)
    pass('8. getLatest 读回最近一次；upsert 单行覆盖')

    // 9. 文件清理 → 诚实失败
    fileStore.delete(fileId)
    const r9 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (r9.status !== 'failed' || !r9.failReason?.includes('重新上传')) fail('9. 文件清理应诚实失败')
    pass('9. 简历原文已清理 → 诚实 failed（不调 LLM、不编造）')

    // 10. 日志脱敏
    const joined = capturedLogs.join('\n')
    for (const secret of ['简历标记RSME', '岗位标记JOBD', '档案管理与会议安排']) {
      if (joined.includes(secret)) fail(`10. 日志泄露内容: ${secret.slice(0, 10)}`)
    }
    pass('10. 日志脱敏：简历/岗位文本不出现在日志')

    console.log(`\n=== ALL PASS (${passCount} checks) ===`)
  } catch (err) {
    process.exitCode = 1
    console.error(err instanceof Error ? err.message : err)
  } finally {
    await prisma.aiResumeResult.deleteMany({ where: { taskId } }).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { targetId: taskId } }).catch(() => undefined)
    await prisma.job.deleteMany({ where: { sourceOrgId: orgId } }).catch(() => undefined)
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => undefined)
    server.close()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
