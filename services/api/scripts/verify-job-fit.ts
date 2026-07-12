/**
 * 2D 岗位匹配参考 — 离线回归验证（受控 stub LLM，可进 CI）。
 *
 *  1. jobId 模式闭环：已发布岗位 + 真实简历文本 → completed + 来源信息 + kind=job_fit 落库（归属继承 parse 行）
 *  2. 防编造：evidence 不在简历原文 → 该匹配点丢弃；全部编造 → 重试 → AI_JOB_FIT_FAILED
 *  3. 百分比拦截：输出含「85%」→ 重试一次 → 合法版本通过
 *  4. 禁词拦截：连续输出「录用概率」→ 诚实失败
 *  5. 未发布岗位 → JOB_NOT_FOUND；6. 错 token → AI_TASK_NOT_FOUND（不泄露存在性）
 *  7. 手填岗位模式成功；8. getLatest 读回 + 再分析 upsert 覆盖（同 taskId 单行）
 *  9. 诱导编造/无依据示例数字/学历自相矛盾 → 重试或诚实失败
 * 10. 简历文件已清理 → 诚实 failed（不调 LLM）
 * 11. 日志脱敏：简历/岗位文本不出现在日志
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
const JOB_DESC = '负责公司日常行政事务、档案与合同管理、跨部门协调_岗位标记JOBD'

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
        res.end(JSON.stringify({
          choices: [{ message: { content: responseQueue.shift() ?? '{}' } }],
          usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 },
        }))
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
const M1_5_DECISION_SUPPORT = {
  analysisVersion: 'job_fit_m1_5',
  keywordCoverage: { matched: ['档案管理'], missing: ['跨部门协调'] },
} as const
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
  const fileStore = new Map<string, { text: string; endUserId: string | null }>()
  const stubExtraction = {
    extractResumeText: ({ fileId, endUserId }: { fileId: string; endUserId?: string | null }) => {
      const record = fileStore.get(fileId)
      if (!record || record.endUserId !== (endUserId ?? null)) {
        return Promise.resolve({ ok: false, errorCode: 'FILE_NOT_FOUND', errorMessage: 'gone' })
      }
      return Promise.resolve({ ok: true, fileId, text: record.text, textSource: 'docx', confidence: 'high', charCount: record.text.length })
    },
  }
  const svc = new JobFitService(prisma, llm, stubExtraction as never, audit)
  const suffix = Date.now().toString(36)
  const taskId = `vjf_task_${suffix}`
  const memberTaskId = `vjf_member_task_${suffix}`
  const fileId = `vjf_file_${suffix}`
  const memberFileId = `vjf_member_file_${suffix}`
  const endUserA = `vjf_member_${suffix}`
  const orgId = `vjf_org_${suffix}`
  const accessToken = 'aa'.repeat(24)
  const { createHash } = await import('crypto')
  const tokenHash = createHash('sha256').update(accessToken, 'utf8').digest('hex')

  try {
    fileStore.set(fileId, { text: RESUME_TEXT, endUserId: null })
    fileStore.set(memberFileId, { text: RESUME_TEXT, endUserId: endUserA })
    await prisma.endUser.create({ data: { id: endUserA, phoneHash: `h_${endUserA}`, phoneEnc: `e_${endUserA}` } })
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
    await prisma.aiResumeResult.create({
      data: {
        taskId: memberTaskId, kind: 'parse', status: 'completed', provider: 'llm',
        payloadJson: JSON.stringify({ taskId: memberTaskId, status: 'completed', fileId: memberFileId }),
        endUserId: endUserA, accessTokenHash: null,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    const requester = { endUserId: null, accessToken }
    const memberRequester = { endUserId: endUserA, accessToken: null }

    // 1. jobId 闭环
    responseQueue.push(vjson({ decisionSupport: M1_5_DECISION_SUPPORT }))
    const r1WithUsage = await svc.analyzeWithUsage({ taskId, jobId: jobPub.id }, requester)
    const r1 = r1WithUsage.response
    if (r1.status !== 'completed' || !('fitLevel' in r1)) fail('1. 应 completed')
    if (r1.job?.sourceName !== '验证人才网' || !r1.job?.sourceUrl) fail('1. 缺岗位来源信息')
    if (r1WithUsage.provider !== 'llm:deepseek:stub' || r1WithUsage.tokenUsage?.totalTokens !== 1500) {
      fail('1. analyzeWithUsage 应返回 provider 与 tokenUsage 元数据')
    }
    const row1 = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'job_fit' } } })
    if (!row1 || row1.accessTokenHash !== tokenHash) fail('1. job_fit 行未继承 parse 归属')
    const r1Latest = await svc.getLatest(taskId, requester)
    const r1LatestRuntime = r1Latest as unknown as { job?: { id?: unknown } }
    if (r1LatestRuntime.job?.id !== jobPub.id) fail('1. jobId 模式 getLatest 应读回 job.id')
    // M1.5 是可选增量：只在受控运行时返回中窄化读取，不收紧既有 JobFitResponse 的静态类型。
    const r1M15 = r1 as unknown as {
      job?: { id?: unknown }
      decisionSupport?: {
        analysisVersion?: unknown
        keywordCoverage?: { matched?: unknown; missing?: unknown }
      }
    }
    const m15Violations: string[] = []
    if (r1M15.job?.id !== jobPub.id) m15Violations.push('response.job.id 未保留所选岗位 id')
    if (r1M15.decisionSupport?.analysisVersion !== 'job_fit_m1_5') {
      m15Violations.push('decisionSupport.analysisVersion 未保留 job_fit_m1_5')
    }
    const matchedKeywords = r1M15.decisionSupport?.keywordCoverage?.matched
    if (!Array.isArray(matchedKeywords) || !matchedKeywords.includes('档案管理')) {
      m15Violations.push('decisionSupport.keywordCoverage.matched 未保留 M1.5 决策字段')
    }
    const missingKeywords = r1M15.decisionSupport?.keywordCoverage?.missing
    if (!Array.isArray(missingKeywords) || !missingKeywords.includes('跨部门协调')) {
      m15Violations.push('decisionSupport.keywordCoverage.missing 未保留 M1.5 决策字段')
    }
    if (row1.provider !== 'llm:deepseek:stub') {
      m15Violations.push(`job_fit.provider 应保留实际 provider llm:deepseek:stub，实际为 ${row1.provider}`)
    }
    if (m15Violations.length > 0) fail(`1. M1.5 运行时契约缺失：${m15Violations.join('；')}`)
    pass('1. jobId 闭环：completed + M1.5 可选增量 + kind=job_fit 落库继承归属与实际 provider + usage 元数据')

    responseQueue.push(vjson())
    const r1b = await svc.analyze({ taskId: memberTaskId, jobId: jobPub.id }, memberRequester)
    const r1bLegacy = r1b as unknown as {
      taskId?: unknown
      job?: {
        title?: unknown
        company?: unknown
        sourceName?: unknown
        sourceUrl?: unknown
        externalId?: unknown
      }
      fitLevel?: unknown
      summary?: unknown
      matchPoints?: unknown
      gapPoints?: unknown
      targetedSuggestions?: unknown
      providerName?: unknown
      decisionSupport?: unknown
    }
    if (r1b.status !== 'completed') fail('1b. 会员岗位匹配应 completed')
    if (
      r1bLegacy.taskId !== memberTaskId ||
      typeof r1bLegacy.job?.title !== 'string' ||
      typeof r1bLegacy.job?.company !== 'string' ||
      typeof r1bLegacy.job?.sourceName !== 'string' ||
      typeof r1bLegacy.job?.sourceUrl !== 'string' ||
      typeof r1bLegacy.job?.externalId !== 'string' ||
      typeof r1bLegacy.fitLevel !== 'string' ||
      typeof r1bLegacy.summary !== 'string' ||
      !Array.isArray(r1bLegacy.matchPoints) ||
      !Array.isArray(r1bLegacy.gapPoints) ||
      !Array.isArray(r1bLegacy.targetedSuggestions) ||
      typeof r1bLegacy.providerName !== 'string'
    ) fail('1b. 无 M1.5 增量时既有 completed 响应字段异常')
    if (r1bLegacy.decisionSupport !== undefined) fail('1b. decisionSupport 为可选增量，旧响应不应被强制填充')
    pass('1b. 会员路径保留既有 completed 字段，decisionSupport 缺失时兼容降级')

    // 1c. M1.5 关键词命中必须有简历/岗位依据；可安全过滤或重试，绝不能原样回传编造词。
    responseQueue.push(vjson({
      decisionSupport: {
        analysisVersion: 'job_fit_m1_5',
        keywordCoverage: { matched: ['注册会计师'], missing: ['跨部门协调'] },
      },
    }))
    responseQueue.push(vjson({ decisionSupport: M1_5_DECISION_SUPPORT }))
    const r1c = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    const r1cM15 = r1c as unknown as { decisionSupport?: { keywordCoverage?: { matched?: unknown } } }
    const unsafeMatchedKeywords = r1cM15.decisionSupport?.keywordCoverage?.matched
    if (r1c.status !== 'completed' || (Array.isArray(unsafeMatchedKeywords) && unsafeMatchedKeywords.includes('注册会计师'))) {
      fail('1c. 无依据的 decisionSupport.keywordCoverage.matched 应被过滤或安全重试，不能原样保留')
    }
    responseQueue.length = 0
    pass('1c. M1.5 keywordCoverage.matched 无简历/岗位依据 → 过滤或安全重试，不原样回传')

    // 1d. keywordCoverage 来源必须双向成立：matched 同时出自简历与岗位，missing 只保留岗位词且尚未出现在简历。
    responseQueue.push(vjson({
      decisionSupport: {
        analysisVersion: 'job_fit_m1_5',
        keywordCoverage: {
          matched: ['Office办公软件', '日常行政事务', '档案管理'],
          missing: ['注册会计师', '档案管理'],
        },
      },
    }))
    responseQueue.push(vjson({ decisionSupport: M1_5_DECISION_SUPPORT }))
    const r1d = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    const r1dM15 = r1d as unknown as {
      decisionSupport?: { keywordCoverage?: { matched?: unknown; missing?: unknown } }
    }
    const r1dMatchedKeywords = r1dM15.decisionSupport?.keywordCoverage?.matched
    const r1dMissingKeywords = r1dM15.decisionSupport?.keywordCoverage?.missing
    const keywordProvenanceViolations: string[] = []
    if (r1d.status !== 'completed') keywordProvenanceViolations.push('非法关键词应过滤或安全重试后 completed')
    if (Array.isArray(r1dMatchedKeywords) && r1dMatchedKeywords.includes('Office办公软件')) {
      keywordProvenanceViolations.push('仅出现在简历的 matched 未被剔除')
    }
    if (Array.isArray(r1dMatchedKeywords) && r1dMatchedKeywords.includes('日常行政事务')) {
      keywordProvenanceViolations.push('仅出现在岗位的 matched 未被剔除')
    }
    if (Array.isArray(r1dMissingKeywords) && r1dMissingKeywords.includes('注册会计师')) {
      keywordProvenanceViolations.push('不在岗位文本的 missing 未被剔除')
    }
    if (Array.isArray(r1dMissingKeywords) && r1dMissingKeywords.includes('档案管理')) {
      keywordProvenanceViolations.push('已出现在简历的岗位词仍留在 missing')
    }
    if (keywordProvenanceViolations.length > 0) {
      fail(`1d. M1.5 keywordCoverage 来源校验缺失：${keywordProvenanceViolations.join('；')}`)
    }
    responseQueue.length = 0
    pass('1d. M1.5 keywordCoverage matched 双来源、missing 岗位未具备来源均已校验')

    // 2. 防编造
    responseQueue.push(vjson({ matchPoints: [{ point: '会开挖掘机', evidence: '持有挖掘机证书五年经验' }] }))
    responseQueue.push(vjson())
    const r2 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (r2.status !== 'completed' || JSON.stringify(r2).includes('挖掘机')) fail('2. 编造匹配点未被拦截')
    const row2 = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'job_fit' } } })
    if (row2?.provider !== 'llm:deepseek:stub') fail('2. 同 taskId 再分析 upsert update 应保留实际 provider')
    pass('2. 防编造：evidence 不在原文 → 整体重试 → 合法版本通过，upsert update 保留实际 provider')

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

    // 9. 内容质量与合规：诱导编造 / 无依据数字 / 自相矛盾学历判断
    responseQueue.length = 0
    responseQueue.push(vjson({ targetedSuggestions: ['删除行政经历，替换为 2-3 个前端项目经历'] }))
    const r9a = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (r9a.status !== 'completed' || JSON.stringify(r9a).includes('替换为')) fail('9a. 诱导编造经历未被拦截')

    responseQueue.length = 0
    responseQueue.push(vjson({ targetedSuggestions: ['补充如每月归档100份文件、每周组织3次会议等数字'] }))
    const r9b = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (r9b.status !== 'completed' || JSON.stringify(r9b).match(/(?:如|例如|比如)[^。；;，,]{0,40}\d/)) fail('9b. 无依据示例数字未被拦截')

    responseQueue.length = 0
    responseQueue.push(vjson({ matchPoints: [{ point: '学历符合本科要求（但为大专，差距较大）', evidence: '本科，行政管理专业' }] }))
    responseQueue.push(vjson({ matchPoints: [{ point: '学历符合本科要求（但为大专，差距较大）', evidence: '本科，行政管理专业' }] }))
    try {
      await svc.analyze({ taskId, jobId: jobPub.id }, requester)
      fail('9c. 自相矛盾学历判断应失败')
    } catch (e) {
      const resp = JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? '')
      if (!resp.includes('AI_JOB_FIT_FAILED')) fail(`9c. 失败码不符: ${resp}`)
    }
    pass('9. 诱导编造/无依据示例数字/学历自相矛盾 → 重试或诚实失败')

    // 10. 文件清理 → 诚实失败
    fileStore.delete(fileId)
    const r10 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (r10.status !== 'failed' || !r10.failReason?.includes('重新上传')) fail('10. 文件清理应诚实失败')
    pass('10. 简历原文已清理 → 诚实 failed（不调 LLM、不编造）')

    // 11. 日志脱敏
    const joined = capturedLogs.join('\n')
    for (const secret of ['简历标记RSME', '岗位标记JOBD', '档案管理与会议安排']) {
      if (joined.includes(secret)) fail(`11. 日志泄露内容: ${secret.slice(0, 10)}`)
    }
    pass('11. 日志脱敏：简历/岗位文本不出现在日志')

    console.log(`\n=== ALL PASS (${passCount} checks) ===`)
  } catch (err) {
    process.exitCode = 1
    console.error(err instanceof Error ? err.message : err)
  } finally {
    await prisma.aiResumeResult.deleteMany({ where: { taskId: { in: [taskId, memberTaskId] } } }).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [taskId, memberTaskId] } } }).catch(() => undefined)
    await prisma.job.deleteMany({ where: { sourceOrgId: orgId } }).catch(() => undefined)
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: endUserA } }).catch(() => undefined)
    server.close()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
