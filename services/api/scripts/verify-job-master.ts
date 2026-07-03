/**
 * 岗位大师 M1 —— 离线回归验证（受控 stub LLM，可进 CI）。
 *
 *  1. jobId 闭环：已发布岗位 + 真实简历 → completed + 来源信息 + 薪资透传来源方文本
 *     + kind=job_master 落库继承 parse 归属
 *  1b. 会员路径 completed + kind=job_master 进「我的」AI服务记录
 *  2. 防编造：matchedSkills evidence 不在原文 → 丢弃 → 整体重试 → 合法版本通过
 *  3. 百分比拦截：输出含「85%」→ 重试 → 无任何百分比
 *  4. 禁词连续命中（录用概率/通过率）→ AI_JOB_MASTER_FAILED 诚实失败
 *  5. 未发布岗位 → JOB_NOT_FOUND
 *  6. 越权（无/错 token、他人会员）→ AI_TASK_NOT_FOUND（不泄露存在性）
 *  7. 手填岗位成功（无来源信息 + 薪资 sourceText=null + note「来源平台未提供」）
 *  8. getLatest 读回 + upsert 单行覆盖
 *  9. careerPath.current evidence 不在原文 → 连续无效 → 诚实失败（路径依据防编造）
 * 10. 薪资承诺 / 学历自相矛盾 → 重试或诚实失败
 * 11. 建议级过滤：诱导编造/无依据示例数字 → 安全兜底（completed 不失败）
 * 12. 简历文件已清理 → 诚实 failed（不调 LLM）
 * 13. 日志脱敏 + 合规禁词：简历/岗位文本不入日志；输出无投递越界词
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-master
 */
require('dotenv').config()

import { createServer, type Server } from 'http'
import { Logger } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { LlmJobMasterService } from '../src/ai/resume/llm-job-master.service'
import { JobMasterService } from '../src/ai/resume/job-master.service'
import { JobMasterPdfService } from '../src/ai/resume/job-master-pdf.service'
import { MemberAssetsService } from '../src/member-assets/member-assets.service'

const RESUME_TEXT =
  '张某某，本科，行政管理专业。曾任某商贸公司行政文员，负责档案管理与会议安排，整理合同文件300余份_简历标记JMRS。熟练使用Office办公软件。'
const JOB_DESC = '负责公司日常行政事务、档案与合同管理_岗位标记JMJD'

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
  fit: {
    level: 'reference_medium',
    summary: '与岗位有一定匹配，以下仅供参考。',
    matchedSkills: [
      { skill: '有档案与合同管理经验', evidence: '负责档案管理与会议安排' },
      { skill: '熟悉办公软件', evidence: '熟练使用Office办公软件' },
    ],
    // M1.5：gap 增补 learningDirection/firstStep
    gapSkills: [{ skill: '跨部门协调', suggestion: '补充一段协调多方资源的经历表述', learningDirection: '了解需求评审与排期协作流程', firstStep: '在简历补一条跨团队协调的量化描述' }],
    // M1.5：关键词覆盖（matched 必须出自简历原文「档案管理」「会议安排」；missing 为岗位词但简历没有）
    keywordCoverage: { matched: ['档案管理', '会议安排'], missing: ['预算管理', '招投标'] },
  },
  careerPath: {
    current: { title: '行政文员', evidence: '曾任某商贸公司行政文员' },
    next: { title: '行政主管', skillsToBuild: ['团队管理', '预算管理'], firstStep: '牵头一次跨部门会议筹备', rationale: '现有档案与会议经验是直接基础' },
    target: { title: '行政经理', skillsToBuild: ['组织流程设计', '供应商管理'], rationale: '行政与运营在企业内高度协同', firstStep: '学习一个运营协同模块' },
  },
  risks: [{ level: 'low', title: '岗位信息完整度', reason: '岗位要求描述较简略', basis: '来源岗位未提供完整任职要求' }],
  // M1.5：顶层面试预判 + 简历改写要点
  interviewPrep: [{ question: '讲一个你主导的流程优化', whyAsked: '岗位强调流程管理', prepHint: '准备背景、你的职责与结果' }],
  resumeRewrite: [{ area: '项目描述', suggestion: '用「负责/主导/整理」开头并量化合同数量' }],
}
type Payload = typeof VALID
const v = (over: Partial<Record<keyof Payload, unknown>> = {}) => JSON.stringify({ ...VALID, ...over })
const vfit = (fitOver: Record<string, unknown>) => v({ fit: { ...VALID.fit, ...fitOver } })
const vpath = (pathOver: Record<string, unknown>) => v({ careerPath: { ...VALID.careerPath, ...pathOver } })

async function main() {
  const { server, url } = await startStub()
  const prisma = new PrismaService()
  const audit = new AuditService(prisma)
  const stubConfig = {
    getApiKey: () => 'stub-key',
    getConfig: () => ({ vendor: 'deepseek', model: 'stub', baseURL: url, systemPrompt: '', roleScope: '', forbiddenWords: [], temperature: 0, enabled: true, apiKeyEncrypted: 'x' }),
  }
  const llm = new LlmJobMasterService(stubConfig as never)
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
  const pdf = new JobMasterPdfService()
  const stubFiles = {
    upload: (args: { buffer: Buffer; filename: string }) => Promise.resolve({
      fileId: `vjm_file_out`, filename: args.filename, sizeBytes: args.buffer.length,
      signedUrl: 'http://localhost/test', signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    }),
  }
  const svc = new JobMasterService(prisma, llm, stubExtraction as never, stubFiles as never, pdf, audit)
  const assets = new MemberAssetsService(prisma)

  const suffix = Date.now().toString(36)
  const taskId = `vjm_task_${suffix}`
  const memberTaskId = `vjm_member_task_${suffix}`
  const fileId = `vjm_file_${suffix}`
  const memberFileId = `vjm_member_file_${suffix}`
  const endUserA = `vjm_member_${suffix}`
  const orgId = `vjm_org_${suffix}`
  const accessToken = 'aa'.repeat(24)
  const { createHash } = await import('crypto')
  const tokenHash = createHash('sha256').update(accessToken, 'utf8').digest('hex')

  try {
    fileStore.set(fileId, { text: RESUME_TEXT, endUserId: null })
    fileStore.set(memberFileId, { text: RESUME_TEXT, endUserId: endUserA })
    await prisma.endUser.create({ data: { id: endUserA, phoneHash: `h_${endUserA}`, phoneEnc: `e_${endUserA}` } })
    await prisma.organization.create({ data: { id: orgId, name: '验证机构JM', type: 'school' } })
    const jobPub = await prisma.job.create({
      data: {
        sourceOrgId: orgId, externalId: `vjm-pub-${suffix}`, sourceName: '验证人才网', sourceUrl: 'https://example.com/job',
        title: '行政专员', company: '某商贸公司', city: '青岛', description: JOB_DESC, requirements: '熟悉档案管理', salary: '6k-9k',
        reviewStatus: 'approved', publishStatus: 'published',
      },
    })
    const jobDraft = await prisma.job.create({
      data: {
        sourceOrgId: orgId, externalId: `vjm-draft-${suffix}`, sourceName: '验证人才网', sourceUrl: 'https://example.com/job2',
        title: '未发布岗位', company: 'X', city: '青岛', reviewStatus: 'pending', publishStatus: 'draft',
      },
    })
    await prisma.aiResumeResult.create({
      data: {
        taskId, kind: 'parse', status: 'completed', provider: 'llm',
        payloadJson: JSON.stringify({ taskId, status: 'completed', fileId }),
        endUserId: null, accessTokenHash: tokenHash, expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    await prisma.aiResumeResult.create({
      data: {
        taskId: memberTaskId, kind: 'parse', status: 'completed', provider: 'llm',
        payloadJson: JSON.stringify({ taskId: memberTaskId, status: 'completed', fileId: memberFileId }),
        endUserId: endUserA, accessTokenHash: null, expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    const requester = { endUserId: null, accessToken }
    const memberRequester = { endUserId: endUserA, accessToken: null }

    // 1. jobId 闭环 + 薪资透传
    responseQueue.push(v())
    const r1 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (r1.status !== 'completed' || !('fit' in r1) || !r1.fit) fail('1. 应 completed 且含 fit')
    if (r1.job?.sourceName !== '验证人才网' || !r1.job?.sourceUrl) fail('1. 缺岗位来源信息')
    if (r1.salary?.sourceText !== '6k-9k' || !r1.salary?.note.includes('来源方')) fail('1. 薪资未透传来源方文本')
    if (!r1.careerPath?.current || !r1.careerPath.next || !r1.careerPath.target) fail('1. 缺晋升路径三节点')
    if (!Array.isArray(r1.risks)) fail('1. 缺风险数组')
    const row1 = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'job_master' } } })
    if (!row1 || row1.accessTokenHash !== tokenHash) fail('1. job_master 行未继承 parse 归属')
    pass('1. jobId 闭环：completed + 来源信息 + 薪资透传 + kind=job_master 落库继承归属')

    // 1b. 会员路径 + AI 服务记录可见
    responseQueue.push(v())
    const r1b = await svc.analyze({ taskId: memberTaskId, jobId: jobPub.id }, memberRequester)
    if (r1b.status !== 'completed') fail('1b. 会员路径应 completed')
    const records = await assets.listAiRecords(endUserA, { cursor: null, pageSize: 20 })
    if (!records.items.some((i) => i.taskId === memberTaskId && i.kind === 'job_master')) fail('1b. 会员 AI 服务记录缺 job_master')
    pass('1b. 会员路径按 endUserId 提取；kind=job_master 进「我的」AI服务记录')

    // 2. 防编造（evidence 不在原文）
    responseQueue.push(vfit({ matchedSkills: [{ skill: '会开挖掘机', evidence: '持有挖掘机证书五年经验' }] }))
    responseQueue.push(v())
    const r2 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (r2.status !== 'completed' || JSON.stringify(r2).includes('挖掘机')) fail('2. 编造匹配点未被拦截')
    pass('2. 防编造：evidence 不在原文 → 整体重试 → 合法版本通过')

    // 3. 百分比拦截
    responseQueue.push(vfit({ summary: '匹配度约 85%，整体不错。' }))
    responseQueue.push(v())
    const r3 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (JSON.stringify(r3).match(/\d{1,3}\s*%/)) fail('3. 百分比未被拦截')
    pass('3. 百分比（85%）→ 重试 → 输出无任何百分比')

    // 4. 禁词连续失败
    responseQueue.push(vfit({ summary: '录用概率较高。' }))
    responseQueue.push(vfit({ gapSkills: [{ skill: 'x', suggestion: '通过率会提升' }] }))
    try {
      await svc.analyze({ taskId, jobId: jobPub.id }, requester)
      fail('4. 连续禁词应失败')
    } catch (e) {
      const resp = JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? '')
      if (!resp.includes('AI_JOB_MASTER_FAILED')) fail(`4. 失败码不符: ${resp}`)
    }
    pass('4. 禁词（录用概率/通过率）连续命中 → AI_JOB_MASTER_FAILED 诚实失败')

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

    // 7. 手填模式（无来源信息 + 薪资未提供）+ 8. getLatest/upsert
    responseQueue.push(vfit({ level: 'reference_high' }))
    const r7 = await svc.analyze({ taskId, manualJob: { title: '档案管理员', requirements: '细心' } }, requester)
    if (r7.status !== 'completed' || r7.job?.title !== '档案管理员' || r7.job?.sourceName !== null) fail('7. 手填模式异常')
    if (r7.salary?.sourceText !== null || !r7.salary?.note.includes('来源平台未提供')) fail('7. 手填薪资应为「来源平台未提供」')
    pass('7. 手填岗位成功（无来源信息 + 薪资 sourceText=null + note 来源平台未提供）')

    const latest = await svc.getLatest(taskId, requester)
    if (latest.job?.title !== '档案管理员') fail('8. getLatest 应返回最近一次（upsert 覆盖）')
    const count = await prisma.aiResumeResult.count({ where: { taskId, kind: 'job_master' } })
    if (count !== 1) fail(`8. 同 taskId 应只有 1 行 job_master，实际 ${count}`)
    pass('8. getLatest 读回最近一次；upsert 单行覆盖')

    // 9. careerPath.current evidence 防编造（连续无效 → 诚实失败）
    responseQueue.length = 0
    responseQueue.push(vpath({ current: { title: '董事长', evidence: '曾任集团董事长十年' } }))
    responseQueue.push(vpath({ current: { title: '董事长', evidence: '曾任集团董事长十年' } }))
    try {
      await svc.analyze({ taskId, jobId: jobPub.id }, requester)
      fail('9. current 编造依据应失败')
    } catch (e) {
      const resp = JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? '')
      if (!resp.includes('AI_JOB_MASTER_FAILED')) fail(`9. 失败码不符: ${resp}`)
    }
    pass('9. careerPath.current evidence 不在原文 → 无效重试 → 诚实失败')

    // 10. 薪资承诺 / 学历自相矛盾
    responseQueue.length = 0
    responseQueue.push(vfit({ summary: '转型后月薪可达 15k。' }))
    responseQueue.push(v())
    const r10 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (/月薪[^。]{0,12}可达/.test(JSON.stringify(r10))) fail('10a. 薪资承诺未被拦截')
    responseQueue.length = 0
    responseQueue.push(vfit({ matchedSkills: [{ skill: '学历符合本科要求（实为大专）', evidence: '本科，行政管理专业' }] }))
    responseQueue.push(vfit({ matchedSkills: [{ skill: '学历符合本科要求（实为大专）', evidence: '本科，行政管理专业' }] }))
    try {
      await svc.analyze({ taskId, jobId: jobPub.id }, requester)
      fail('10b. 学历自相矛盾应失败')
    } catch (e) {
      const resp = JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? '')
      if (!resp.includes('AI_JOB_MASTER_FAILED')) fail(`10b. 失败码不符: ${resp}`)
    }
    pass('10. 薪资承诺 → 重试；学历自相矛盾 → 诚实失败')

    // 11. 建议级过滤（诱导编造/示例数字 → 安全兜底，completed 不失败）
    responseQueue.length = 0
    responseQueue.push(vfit({ gapSkills: [{ skill: 'x', suggestion: '删除行政经历，替换为 2-3 个前端项目经历' }] }))
    const r11 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    const r11s = JSON.stringify(r11)
    if (r11.status !== 'completed' || r11s.includes('替换为') || !r11s.includes('不要虚构经历或数字')) fail('11. 高风险建议未过滤/缺安全兜底')
    pass('11. 诱导编造建议 → 建议级过滤 + 安全兜底（completed 不失败）')

    // 12. 文件清理 → 诚实失败
    fileStore.delete(fileId)
    const r12 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (r12.status !== 'failed' || !r12.failReason?.includes('重新上传')) fail('12. 文件清理应诚实失败')
    pass('12. 简历原文已清理 → 诚实 failed（不调 LLM、不编造）')

    // 13. 日志脱敏 + 合规禁词
    const joined = capturedLogs.join('\n')
    for (const secret of ['简历标记JMRS', '岗位标记JMJD', '档案管理与会议安排']) {
      if (joined.includes(secret)) fail(`13. 日志泄露内容: ${secret.slice(0, 10)}`)
    }
    fileStore.set(fileId, { text: RESUME_TEXT, endUserId: null })
    responseQueue.length = 0
    responseQueue.push(v())
    const r13 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    for (const banned of ['一键投递', '立即投递', '平台投递', '录用概率', '通过率']) {
      if (JSON.stringify(r13).includes(banned)) fail(`13. 输出含越界词: ${banned}`)
    }
    pass('13. 日志脱敏：简历/岗位文本不入日志；输出无投递/概率越界词')

    // 14. 决策报告 PDF 真实渲染 + 打印链路（r13 已在 taskId 落一行 job_master）
    const printed = await svc.printReport(taskId, requester)
    if (printed.pageCount < 1 || printed.filename !== '岗位决策参考报告.pdf') fail('14. PDF 元数据不符')
    const { buffer, pageCount } = await pdf.render(
      { date: '2026-07-02' },
      { job: { title: '行政专员', company: '某商贸公司' }, salary: { sourceText: '6k-9k', note: '薪资由来源方提供，仅供参考' }, payload: VALID as never },
    )
    if (buffer.slice(0, 4).toString() !== '%PDF' || pageCount < 1) fail('14. 输出不是 PDF')
    pass(`14. 决策报告 PDF 真实渲染（${buffer.length} bytes, ${pageCount} 页）+ 打印链路返回 FileObject 元数据`)

    // ── M1.5 新断言（先红：LlmJobMasterService 尚未产出/校验新字段，转绿在 Task 3–4） ──

    // 15. 新字段贯通 + M1 旧形状非破坏兼容
    responseQueue.length = 0
    responseQueue.push(v())
    const r15 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (!r15.fit?.keywordCoverage || !Array.isArray(r15.interviewPrep) || !Array.isArray(r15.resumeRewrite)) fail('15. 新字段(keywordCoverage/interviewPrep/resumeRewrite)未贯通')
    if (!r15.fit?.gapSkills?.[0]?.learningDirection || !r15.fit?.gapSkills?.[0]?.firstStep) fail('15. gap learningDirection/firstStep 未贯通')
    if (!r15.careerPath?.next?.rationale || !r15.careerPath?.target?.firstStep) fail('15. careerPath rationale/firstStep 未贯通')
    const M1SHAPE = JSON.parse(JSON.stringify(VALID))
    delete M1SHAPE.fit.keywordCoverage
    delete M1SHAPE.fit.gapSkills[0].learningDirection
    delete M1SHAPE.fit.gapSkills[0].firstStep
    delete M1SHAPE.careerPath.next.rationale
    delete M1SHAPE.careerPath.target.rationale
    delete M1SHAPE.careerPath.target.firstStep
    delete M1SHAPE.interviewPrep
    delete M1SHAPE.resumeRewrite
    responseQueue.length = 0
    responseQueue.push(JSON.stringify(M1SHAPE))
    const r15b = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (r15b.status !== 'completed' || !r15b.fit) fail('15. M1 旧形状应仍 completed(非破坏)')
    pass('15. 新字段贯通 + M1 旧形状非破坏兼容')

    // 16. 关键词 matched 防编造：不在简历原文的词被剔除
    responseQueue.length = 0
    responseQueue.push(vfit({ keywordCoverage: { matched: ['注册会计师'], missing: ['预算管理'] } }))
    const r16 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if ((r16.fit?.keywordCoverage?.matched ?? []).includes('注册会计师')) fail('16. 编造 matched(非原文)未被剔除')
    pass('16. 关键词 matched 防编造(不在简历原文即剔除)')

    // 17. 无百分比(新字段也扫)
    responseQueue.length = 0
    responseQueue.push(v({ interviewPrep: [{ question: 'x', whyAsked: '匹配度 85%', prepHint: 'y' }] }))
    responseQueue.push(v())
    const r17 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (JSON.stringify(r17).match(/\d{1,3}\s*%/)) fail('17. 新字段含百分比未拦截')
    pass('17. 新字段百分比 → 重试 → 输出无百分比')

    // 18. 面试预判承诺词(保过/通过率)连续命中 → 诚实失败
    responseQueue.length = 0
    responseQueue.push(v({ interviewPrep: [{ question: 'x', whyAsked: 'y', prepHint: '保过没问题' }] }))
    responseQueue.push(v({ interviewPrep: [{ question: 'x', whyAsked: 'y', prepHint: '通过率很高' }] }))
    try {
      await svc.analyze({ taskId, jobId: jobPub.id }, requester)
      fail('18. 面试预判承诺词应失败')
    } catch (e) {
      const resp = JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? '')
      if (!resp.includes('AI_JOB_MASTER_FAILED')) fail(`18. 失败码不符: ${resp}`)
    }
    pass('18. 面试预判承诺词(保过/通过率)连续命中 → AI_JOB_MASTER_FAILED')

    // 19. 简历改写诱导编造 → 建议级安全兜底(completed 不失败)
    responseQueue.length = 0
    responseQueue.push(v({ resumeRewrite: [{ area: '项目', suggestion: '删除行政经历，替换为 3 个前端项目' }] }))
    const r19 = await svc.analyze({ taskId, jobId: jobPub.id }, requester)
    if (r19.status !== 'completed' || JSON.stringify(r19.resumeRewrite).includes('替换为')) fail('19. 简历改写诱导编造未过滤')
    pass('19. 简历改写诱导编造 → 安全兜底(completed 不失败)')

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
