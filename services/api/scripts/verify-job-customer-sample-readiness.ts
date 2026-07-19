/**
 * 客户真实岗位样本导入 readiness 门禁。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-customer-sample-readiness
 *
 * 该脚本只做源码 / DTO / 文档静态验收和 Webhook DTO 本地校验，不连接
 * 预生产 PostgreSQL、Redis、COS、LLM、OCR，也不写入真实客户数据。
 */
import 'reflect-metadata'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { JOB_STANDARD_FIELDS, isSensitiveColumn } from '../src/jobs/dto/excel-import.dto'
import { ImportJobsDto } from '../src/jobs/dto/import-jobs.dto'
import { WebhookPayloadDto } from '../src/sync/dto/webhook-payload.dto'

const apiRoot = join(__dirname, '..')
const repoRoot = join(apiRoot, '../..')

const readinessFields = [
  'externalId',
  'title',
  'company',
  'city',
  'sourceUrl',
  'salary',
  'description',
  'requirements',
  'industry',
  'workType',
  'educationRequirement',
  'experienceRequirement',
  'skills',
  'benefits',
  'salaryMin',
  'salaryMax',
  'salaryUnit',
  'validThrough',
] as const

const forbiddenJobSampleFields = [
  'candidateName',
  'candidatePhone',
  'candidateEmail',
  'resumeUrl',
  'resumeText',
  'applicationStatus',
  'interviewInvite',
  'offerStatus',
] as const

let failed = 0

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failed += 1
  console.error(`  FAIL ${message}`)
}

function readApi(rel: string): string {
  const abs = join(apiRoot, rel)
  if (!existsSync(abs)) {
    fail(`文件缺失: ${rel}`)
    return ''
  }
  return readFileSync(abs, 'utf8')
}

function readRepo(rel: string): string {
  const abs = join(repoRoot, rel)
  if (!existsSync(abs)) {
    fail(`文件缺失: ${rel}`)
    return ''
  }
  return readFileSync(abs, 'utf8')
}

function mustContain(source: string, markers: readonly string[], label: string): void {
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length > 0) fail(`${label} — 缺少: ${missing.join(' | ')}`)
  else pass(label)
}

function mustNotContain(source: string, markers: readonly string[], label: string): void {
  const found = markers.filter((marker) => source.includes(marker))
  if (found.length > 0) fail(`${label} — 不应包含: ${found.join(' | ')}`)
  else pass(label)
}

function mustContainAtLeast(source: string, marker: string, expected: number, label: string): void {
  const count = source.split(marker).length - 1
  if (count < expected) fail(`${label} — ${marker} 出现 ${count} 次，期望至少 ${expected} 次`)
  else pass(label)
}

function extractClassFields(source: string, className: string): Set<string> {
  const start = source.indexOf(`export class ${className}`)
  if (start < 0) {
    fail(`${className} 未找到`)
    return new Set()
  }
  const open = source.indexOf('{', start)
  if (open < 0) {
    fail(`${className} 缺少类体`)
    return new Set()
  }

  let depth = 0
  let end = open
  for (; end < source.length; end += 1) {
    const char = source[end]
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }

  const body = source.slice(open + 1, end)
  const fields = new Set<string>()
  for (const line of body.split('\n')) {
    const match = line.match(/^\s+([a-zA-Z][a-zA-Z0-9_]*)[!?]?:/)
    if (match?.[1]) fields.add(match[1])
  }
  return fields
}

function assertFieldCoverage(fields: Set<string>, expected: readonly string[], label: string): void {
  const missing = expected.filter((field) => !fields.has(field))
  if (missing.length > 0) fail(`${label} — 缺少字段: ${missing.join(', ')}`)
  else pass(label)
}

function assertNoForbiddenFields(fields: Set<string>, label: string): void {
  const found = forbiddenJobSampleFields.filter((field) => fields.has(field))
  if (found.length > 0) fail(`${label} — 含禁止字段: ${found.join(', ')}`)
  else pass(label)
}

function verifyWebhookValidation(): void {
  const validPayload = plainToInstance(WebhookPayloadDto, {
    items: [{
      externalId: 'cust-job-001',
      title: '客户成功经理',
      company: '真实客户科技有限公司',
      city: '上海',
      sourceUrl: 'https://jobs.example.com/cust-job-001',
      salary: '15000-22000',
      description: '负责客户上线、续约和产品使用反馈闭环。',
      requirements: '熟悉 B 端客户服务和项目推进。',
      industry: '企业服务',
      workType: 'full_time',
      tags: ['企业服务'],
      educationRequirement: '本科及以上',
      experienceRequirement: '3 年以上',
      skills: ['客户沟通', '项目推进'],
      benefits: ['五险一金'],
      salaryMin: 15000,
      salaryMax: 22000,
      salaryUnit: 'monthly',
      validThrough: '2099-12-31T00:00:00.000Z',
    }],
  })
  const validErrors = validateSync(validPayload, { whitelist: true, forbidNonWhitelisted: true })
  if (validErrors.length === 0) pass('Webhook DTO 接收完整客户 AI-ready 岗位样本')
  else fail(`Webhook DTO 不应拒收完整客户样本: ${JSON.stringify(validErrors)}`)

  const normalizedPayload = plainToInstance(WebhookPayloadDto, {
    items: [{
      externalId: 'cust-job-001-alias',
      title: '客户实施实习生',
      company: '真实客户科技有限公司',
      city: '上海',
      sourceUrl: 'https://jobs.example.com/cust-job-001-alias',
      workType: '实习',
    }],
  })
  const normalizedErrors = validateSync(normalizedPayload, { whitelist: true, forbidNonWhitelisted: true })
  if (normalizedErrors.length === 0 && normalizedPayload.items[0]?.workType === 'internship') {
    pass('Webhook DTO 将客户常见 workType 别名归一化为标准枚举')
  } else {
    fail(`Webhook DTO 应归一化常见 workType 别名: ${JSON.stringify(normalizedErrors)}`)
  }

  const campusPayload = plainToInstance(WebhookPayloadDto, {
    items: [{
      externalId: 'cust-job-001-campus',
      title: '校园招聘管培生',
      company: '真实客户科技有限公司',
      city: '上海',
      sourceUrl: 'https://jobs.example.com/cust-job-001-campus',
      workType: '校园招聘',
    }],
  })
  const campusErrors = validateSync(campusPayload, { whitelist: true, forbidNonWhitelisted: true })
  if (campusErrors.length === 0 && campusPayload.items[0]?.workType === 'campus') {
    pass('Webhook DTO 将校招 / 校园别名归一化为 campus')
  } else {
    fail(`Webhook DTO 应将校招 / 校园别名归一化为 campus: ${JSON.stringify(campusErrors)}`)
  }

  const invalidWorkTypePayload = plainToInstance(WebhookPayloadDto, {
    items: [{
      externalId: 'cust-job-002',
      title: '运营专员',
      company: '真实客户科技有限公司',
      city: '深圳',
      sourceUrl: 'https://jobs.example.com/cust-job-002',
      workType: 'freelance',
    }],
  })
  const invalidWorkTypeErrors = validateSync(invalidWorkTypePayload, { whitelist: true, forbidNonWhitelisted: true })
  if (invalidWorkTypeErrors.length > 0) pass('Webhook DTO 拒绝未知 workType，避免静默写成全职')
  else fail('Webhook DTO 应拒绝未知 workType')

  const negatedWorkTypePayload = plainToInstance(WebhookPayloadDto, {
    items: [{
      externalId: 'cust-job-002-negated-work-type',
      title: '非全职运营专员',
      company: '真实客户科技有限公司',
      city: '深圳',
      sourceUrl: 'https://jobs.example.com/cust-job-002-negated-work-type',
      workType: '非全职',
    }],
  })
  const negatedWorkTypeErrors = validateSync(negatedWorkTypePayload, { whitelist: true, forbidNonWhitelisted: true })
  if (negatedWorkTypeErrors.length > 0) pass('Webhook DTO 拒绝否定 workType 别名，避免错写 full_time')
  else fail('Webhook DTO 不得把“非全职”归一化为 full_time')

  const ambiguousWorkTypePayload = plainToInstance(WebhookPayloadDto, {
    items: [{
      externalId: 'cust-job-002-ambiguous-work-type',
      title: '全职实习项目',
      company: '真实客户科技有限公司',
      city: '深圳',
      sourceUrl: 'https://jobs.example.com/cust-job-002-ambiguous-work-type',
      workType: '全职实习',
    }],
  })
  const ambiguousWorkTypeErrors = validateSync(ambiguousWorkTypePayload, { whitelist: true, forbidNonWhitelisted: true })
  if (ambiguousWorkTypeErrors.length > 0) pass('Webhook DTO 拒绝复合 workType 别名，避免错写单一 category')
  else fail('Webhook DTO 不得把“全职实习”静默归一化为单一 category')

  const forbiddenPayload = plainToInstance(WebhookPayloadDto, {
    items: [{
      externalId: 'cust-job-003',
      title: '测试工程师',
      company: '真实客户科技有限公司',
      city: '广州',
      sourceUrl: 'https://jobs.example.com/cust-job-003',
      candidateEmail: 'blocked@example.com',
    }],
  })
  const forbiddenErrors = validateSync(forbiddenPayload, { whitelist: true, forbidNonWhitelisted: true })
  if (forbiddenErrors.length > 0) pass('Webhook DTO 拒绝候选人 / 简历等非白名单字段')
  else fail('Webhook DTO 不得接受 candidateEmail 等非白名单字段')
}

function verifyPartnerApiImportValidation(): void {
  const campusPayload = plainToInstance(ImportJobsDto, {
    items: [{
      externalId: 'partner-job-campus',
      title: '校园招聘管培生',
      company: '真实客户科技有限公司',
      city: '上海',
      sourceUrl: 'https://jobs.example.com/partner-job-campus',
      workType: '校园招聘',
    }],
  })
  const campusErrors = validateSync(campusPayload, { whitelist: true, forbidNonWhitelisted: true })
  if (campusErrors.length === 0 && campusPayload.items[0]?.workType === 'campus') {
    pass('Partner API DTO 将校招 / 校园别名归一化为 campus')
  } else {
    fail(`Partner API DTO 应将校招 / 校园别名归一化为 campus: ${JSON.stringify(campusErrors)}`)
  }

  const invalidPayload = plainToInstance(ImportJobsDto, {
    items: [{
      externalId: 'partner-job-invalid-work-type',
      title: '客户运营顾问',
      company: '真实客户科技有限公司',
      city: '深圳',
      sourceUrl: 'https://jobs.example.com/partner-job-invalid-work-type',
      workType: 'freelance',
    }],
  })
  const invalidErrors = validateSync(invalidPayload, { whitelist: true, forbidNonWhitelisted: true })
  if (invalidErrors.length > 0) pass('Partner API DTO 拒绝未知 workType，避免静默写成全职')
  else fail('Partner API DTO 应拒绝未知 workType')

  const negatedPayload = plainToInstance(ImportJobsDto, {
    items: [{
      externalId: 'partner-job-negated-work-type',
      title: '非全职客户运营顾问',
      company: '真实客户科技有限公司',
      city: '深圳',
      sourceUrl: 'https://jobs.example.com/partner-job-negated-work-type',
      workType: '非全职',
    }],
  })
  const negatedErrors = validateSync(negatedPayload, { whitelist: true, forbidNonWhitelisted: true })
  if (negatedErrors.length > 0) pass('Partner API DTO 拒绝否定 workType 别名，避免错写 full_time')
  else fail('Partner API DTO 不得把“非全职”归一化为 full_time')
}

function assertNoOverclaim(source: string, label: string): void {
  const risky = source
    .split('\n')
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => /客户真实岗位样本|岗位信息 AI|Job AI/.test(line))
    .filter(({ line }) => /(生产|商用|试运营|预生产|真机|客户样本)[^。\n]{0,40}(完成|通过|已完成|已通过|可上线|可商用)/.test(line))
    .filter(({ line }) => !/(不代表|不得|不能|未|待|仍需|尚未|PENDING|不等于|不可|不在|准备|准入)/.test(line))
  if (risky.length > 0) {
    fail(`${label} — 存在可能过度宣称的行: ${risky.map((item) => `${item.index}:${item.line.trim()}`).join(' || ')}`)
  } else {
    pass(label)
  }
}

function main(): void {
  console.log('\n=== 客户真实岗位样本导入 readiness 门禁 ===')

  const importDto = readApi('src/jobs/dto/import-jobs.dto.ts')
  const webhookDto = readApi('src/sync/dto/webhook-payload.dto.ts')
  const excelDto = readApi('src/jobs/dto/excel-import.dto.ts')
  const workTypeUtil = readApi('src/jobs/work-type.ts')
  // N1拆分后 Partner写入路径(refreshJobQualitySnapshots/skillsJson等)在jobs-partner.service.ts
  const jobsService = readApi('src/jobs/jobs.service.ts') + '\n' + readApi('src/jobs/jobs-partner.service.ts')
  const jobSyncService = readApi('src/job-sync/job-sync.service.ts')
  const syncService = readApi('src/sync/sync.service.ts')
  const sharedJobTypes = readRepo('packages/shared/src/types/job.ts')
  const partnerTypes = readRepo('apps/partner/src/services/api/types.ts')
  const packageJson = readApi('package.json')
  const ci = readRepo('.github/workflows/ci.yml')
  const readinessDoc = readRepo('docs/acceptance/job-customer-sample-import-readiness.md')
  const realAcceptanceDoc = readRepo('docs/acceptance/job-info-ai-real-acceptance.md')
  const nextTasks = readRepo('docs/progress/next-tasks.md')
  const currentProgress = readRepo('docs/progress/current-progress.md')

  const importFields = extractClassFields(importDto, 'ImportJobItemDto')
  const webhookFields = extractClassFields(webhookDto, 'WebhookJobItemDto')
  const excelFields = new Set<string>(JOB_STANDARD_FIELDS)

  assertFieldCoverage(importFields, readinessFields, 'Partner API 导入 DTO 覆盖客户样本准入字段')
  assertFieldCoverage(webhookFields, readinessFields, 'Webhook DTO 覆盖客户样本准入字段')
  assertFieldCoverage(excelFields, readinessFields, 'Excel 白名单覆盖客户样本准入字段')
  assertNoForbiddenFields(importFields, 'Partner API DTO 不包含招聘闭环 / 候选人字段')
  assertNoForbiddenFields(webhookFields, 'Webhook DTO 不包含招聘闭环 / 候选人字段')

  mustContain(webhookDto, [
    'normalizeWebhookWorkType',
    '@Transform(({ value }) => normalizeWebhookWorkType(value))',
    '@IsIn([...JOB_WORK_TYPE_VALUES])',
    '@IsDateString()',
    '@IsNumber()',
    '@Min(0)',
    'educationRequirement',
    'experienceRequirement',
    'skills',
    'benefits',
    'validThrough',
  ], 'Webhook DTO 校验器对齐 AI-ready 字段和 workType 枚举')

  mustContain(workTypeUtil, [
    'JOB_WORK_TYPE_VALUES',
    "'campus'",
    'WORK_TYPE_ALIAS_GROUPS',
    'normalizeJobWorkType',
    'mapJobWorkTypeToCategory',
    "return 'campus'",
  ], '共享 workType 映射支持 campus 并供多入口复用')

  verifyWebhookValidation()
  verifyPartnerApiImportValidation()

  const missingApiSyncFields = readinessFields.filter((field) => !jobSyncService.includes(field))
  if (missingApiSyncFields.length > 0) {
    fail(`API 拉取映射缺少客户样本字段: ${missingApiSyncFields.join(', ')}`)
  } else {
    pass('API 拉取映射覆盖客户样本准入字段')
  }

  mustContain(jobsService, [
    'importJobs(',
    'importJobsFromWebhook(',
    'confirmExcelImport(',
    'mapWorkTypeToCategory(workType: string | undefined)',
    'mapJobWorkTypeToCategory(workType)',
    'type WorkType      = JobWorkTypeValue',
    "case 'campus':   return 'campus'",
    'normalizeMappedWorkType',
    'workType 必须为',
    'refreshJobQualitySnapshots(touchedJobIds)',
    'educationRequirement',
    'experienceRequirement',
    'skillsJson',
    'benefitsJson',
    'salaryMin',
    'salaryMax',
    'salaryUnit',
    'validThrough',
  ], 'JobsService 三条写入路径落标准化字段并刷新质量快照')
  mustContainAtLeast(
    jobsService,
    'category: mapped.workType ? mapWorkTypeToCategory(mapped.workType) : undefined',
    2,
    'Excel preview/confirm 校验 workType 并持久化到 Job.category,含 campus',
  )

  mustContain(sharedJobTypes, [
    "'contract' | 'campus'",
    "category?: 'fulltime' | 'intern' | 'campus' | 'parttime'",
  ], 'Shared ExternalJobDTO 保留 campus workType / category 契约')

  mustContain(partnerTypes, [
    "'contract' | 'campus'",
  ], 'Partner 类型允许 campus workType，避免校招导入/编辑契约漂移')

  mustContain(jobSyncService, [
    'isSensitiveColumn',
    'matches sensitive pattern',
    'logger.warn',
    'mapJobWorkTypeToCategory',
    'refreshJobQualitySnapshots(touchedJobIds)',
  ], 'API 拉取路径对敏感字段采用跳过 / 告警而非伪称统一拒收')

  mustContain(excelDto, [
    'SENSITIVE_COLUMN_PATTERNS',
    'JOB_STANDARD_FIELDS',
    'JOB_REQUIRED_FIELDS',
    'isSensitiveColumn',
  ], 'Excel 路径保留敏感列拒收和字段白名单')
  if (isSensitiveColumn('候选人邮箱') && isSensitiveColumn('resumeUrl')) {
    pass('Excel 敏感列检测覆盖候选人和简历字段')
  } else {
    fail('Excel 敏感列检测应覆盖候选人和简历字段')
  }

  mustContain(syncService, [
    'source: \'webhook\'',
    'count: result.imported',
    'receivedRequestId',
  ], 'Webhook 审计只记录元数据')
  mustNotContain(syncService, [
    'payload: args.parsed',
    'payload: body',
    'payload: args.rawBody',
    'payload: rawBody',
  ], 'Webhook 审计不持久化原始客户 payload')

  mustContain(readinessDoc, [
    '客户真实岗位样本导入 readiness',
    'Partner API',
    'Excel',
    'Webhook',
    'API 拉取',
    '拒收',
    '跳过 / 告警',
    'headcount',
    '不作为岗位样本准入字段',
    'sourceOrgId',
    'externalId',
    'sourceUrl',
    'educationRequirement',
    'experienceRequirement',
    'skills',
    'benefits',
    'salaryMin',
    'salaryMax',
    'salaryUnit',
    'validThrough',
    'JobDataQualitySnapshot',
    'ExternalJumpLog',
    '不记录投递结果',
    '不得对外宣称',
  ], '客户样本 readiness 文档覆盖字段、路径差异、质量快照和合规边界')

  mustContain(realAcceptanceDoc, [
    'job-customer-sample-import-readiness.md',
    'verify:job-customer-sample-readiness',
  ], '真实验收证据包引用客户样本 readiness 门禁')
  mustContain(nextTasks + currentProgress, [
    'verify:job-customer-sample-readiness',
    '客户真实岗位样本导入 readiness',
  ], '进度入口记录客户样本 readiness 状态')

  mustContain(packageJson, ['"verify:job-customer-sample-readiness"'], 'API package 注册客户样本 readiness 门禁')
  mustContain(ci, ['verify:job-customer-sample-readiness'], 'CI 接入客户样本 readiness 门禁')

  mustNotContain(importDto + webhookDto + excelDto + jobsService + jobSyncService, [
    '一键投递',
    '立即投递',
    '平台投递',
    '候选人筛选',
    '面试邀约',
    'Offer 管理',
    '向企业推荐候选人',
    'applicationStatus',
    'interviewInvite',
    'offerStatus',
    'resumeText',
  ], '客户样本导入 readiness 不引入招聘平台闭环或简历原文字段')
  assertNoOverclaim(readinessDoc + '\n' + realAcceptanceDoc + '\n' + nextTasks + '\n' + currentProgress, '客户样本 readiness 不得过度宣称验收完成')

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项失败 — 客户真实岗位样本导入 readiness 未通过\n`)
    process.exit(1)
  }

  console.log('✅ ALL PASS — 客户真实岗位样本导入 readiness 一致\n')
}

main()
