/**
 * 岗位信息 AI 商用闭环 Task 3 静态门禁。
 *
 * 覆盖：
 *   1. JobQualityService 存在且提供必填字段、AI-ready 字段、过期、来源 URL 质量计算。
 *   2. Partner/API/Webhook/Excel 导入后刷新 JobDataQualitySnapshot。
 *   3. 导入 DTO 与 Excel 字段白名单允许客户提供 AI 推荐所需的标准化岗位字段。
 *   4. Kiosk 公开 DTO 对缺失字段诚实显示“来源平台未提供”，不编造薪资或要求。
 *   5. 质量治理代码不引入平台投递、候选人筛选、面试邀约、Offer 等招聘闭环状态。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-data-quality
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JobQualityService, type JobQualityInput } from '../src/job-ai/job-quality.service'
import type { PrismaService } from '../src/prisma/prisma.service'

let failed = 0

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failed += 1
  console.error(`  FAIL ${message}`)
}

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
}

function mustExist(rel: string, label: string): string {
  const abs = join(process.cwd(), rel)
  if (!existsSync(abs)) {
    fail(`${label} — 文件缺失: ${rel}`)
    return ''
  }
  pass(label)
  return readFileSync(abs, 'utf8')
}

function mustContain(source: string, markers: string[], label: string): void {
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length > 0) fail(`${label} — 缺少: ${missing.join(' | ')}`)
  else pass(label)
}

function mustNotContain(source: string, markers: string[], label: string): void {
  const found = markers.filter((marker) => source.includes(marker))
  if (found.length > 0) fail(`${label} — 不应包含: ${found.join(' | ')}`)
  else pass(label)
}

function baseJob(overrides: Partial<JobQualityInput> = {}): JobQualityInput {
  return {
    sourceOrgId: 'org_qa',
    externalId: 'job-001',
    sourceName: '真实客户岗位源',
    sourceUrl: 'https://jobs.example.com/001',
    title: '前端工程师',
    company: '示例科技',
    city: '深圳',
    category: 'fulltime',
    salary: '12000-18000',
    description: '负责真实客户业务系统前端开发，和后端、设计、测试团队协作交付可维护产品。',
    requirements: '熟悉 TypeScript、React、接口联调和基础工程化，有真实项目经验。',
    tagsJson: JSON.stringify(['行业:互联网']),
    educationRequirement: '本科及以上',
    experienceRequirement: '3 年以上',
    skillsJson: JSON.stringify(['TypeScript', 'React']),
    benefitsJson: JSON.stringify(['五险一金']),
    salaryMin: 12000,
    salaryMax: 18000,
    salaryUnit: 'monthly',
    validThrough: new Date('2099-12-31T00:00:00.000Z'),
    syncTime: new Date(),
    ...overrides,
  }
}

function verifyQualityRules(): void {
  const service = new JobQualityService({} as PrismaService)
  const ready = service.evaluateJobQuality(baseJob())
  if (ready.qualityLevel === 'ready' && ready.missingFields.length === 0 && !ready.isStale) {
    pass('质量纯函数:完整真实岗位 → ready')
  } else {
    fail(`质量纯函数:完整真实岗位应为 ready,实际 ${ready.qualityLevel}/${ready.missingFields.join(',')}`)
  }

  const partial = service.evaluateJobQuality(baseJob({ skillsJson: '[]', educationRequirement: null }))
  if (partial.qualityLevel === 'partial' && partial.missingFields.includes('skills') && partial.missingFields.includes('educationRequirement')) {
    pass('质量纯函数:缺 AI-ready 字段 → partial')
  } else {
    fail(`质量纯函数:缺 AI-ready 字段应为 partial,实际 ${partial.qualityLevel}/${partial.missingFields.join(',')}`)
  }

  const insufficient = service.evaluateJobQuality(baseJob({
    sourceUrl: 'ftp://invalid.example.com/job',
    description: null,
    requirements: null,
    syncTime: new Date('2000-01-01T00:00:00.000Z'),
  }))
  if (
    insufficient.qualityLevel === 'insufficient' &&
    insufficient.isStale &&
    insufficient.missingFields.includes('sourceUrlFormat') &&
    insufficient.missingFields.includes('descriptionOrRequirements')
  ) {
    pass('质量纯函数:来源格式错误/缺描述/过期同步 → insufficient')
  } else {
    fail(`质量纯函数:问题岗位应为 insufficient,实际 ${insufficient.qualityLevel}/${insufficient.missingFields.join(',')}`)
  }
}

async function verifyReachabilitySnapshotRules(): Promise<void> {
  const createdRows: Array<{
    jobId: string
    missingFieldsJson: string
    qualityLevel: string
    sourceUrlReachable: boolean | null
    lastError: string | null
  }> = []
  const service = new JobQualityService({
    job: {
      findMany: async () => [
        {
          id: 'job-dead-link',
          ...baseJob(),
        },
      ],
    },
    jobDataQualitySnapshot: {
      createMany: async ({ data }: { data: typeof createdRows }) => {
        createdRows.push(...data)
        return { count: data.length }
      },
    },
  } as unknown as PrismaService)
  service.checkSourceUrlReachable = async () => ({ sourceUrlReachable: false, lastError: 'HTTP_404' })

  await service.refreshJobQualitySnapshots(['job-dead-link'], { checkReachability: true })
  const row = createdRows[0]
  if (
    createdRows.length === 1 &&
    row.qualityLevel === 'insufficient' &&
    row.sourceUrlReachable === false &&
    row.lastError === 'HTTP_404' &&
    row.missingFieldsJson.includes('sourceUrlUnreachable')
  ) {
    pass('质量快照:死链可达性失败 → createMany 写入并降级 insufficient')
  } else {
    fail(`质量快照:死链可达性失败应降级 insufficient,实际 ${JSON.stringify(createdRows)}`)
  }
}

async function main(): Promise<void> {
  console.log('\n=== 岗位数据质量与来源可用性门禁 ===')

  const jobQuality = mustExist('src/job-ai/job-quality.service.ts', 'JobQualityService 已创建')
  const jobsService = read('src/jobs/jobs.service.ts')
  // N1拆分后，质量刷新和字段映射在 jobs-partner.service.ts
  const jobsPartnerService = (() => { try { return read('src/jobs/jobs-partner.service.ts') } catch { return '' } })()
  const jobsModule = read('src/jobs/jobs.module.ts')
  const jobSyncService = read('src/job-sync/job-sync.service.ts')
  const jobSyncModule = read('src/job-sync/job-sync.module.ts')
  const importDto = read('src/jobs/dto/import-jobs.dto.ts')
  const excelDto = read('src/jobs/dto/excel-import.dto.ts')
  const packageJson = read('package.json')
  const ci = read('../../.github/workflows/ci.yml')

  mustContain(
    jobQuality,
    [
      'export class JobQualityService',
      'JOB_QUALITY_REQUIRED_FIELDS',
      'JOB_AI_READY_FIELDS',
      'descriptionOrRequirements',
      'sourceUrlFormat',
      'sourceUrlReachable',
      'sourceUrlUnreachable',
      'isStale',
      'refreshJobQualitySnapshots',
      'getSourceQualitySummary',
      'createMany',
      'JobDataQualitySnapshot',
      'qualityLevel',
      'ready',
      'partial',
      'insufficient',
    ],
    'JobQualityService 覆盖必填字段、AI-ready 字段、过期与来源 URL 质量',
  )

  mustContain(
    jobQuality,
    [
      'title',
      'company',
      'city',
      'sourceName',
      'sourceUrl',
      'externalId',
      'syncTime',
      'salary',
      'category',
      'industry',
      'skills',
      'educationRequirement',
      'experienceRequirement',
      'validThrough',
    ],
    '质量规则覆盖 required 与 AI-ready 字段',
  )

  // N1拆分后读所有 jobs 子服务合并扫描
  const jobsSources = (() => {
    const files = ['src/jobs/jobs.service.ts','src/jobs/jobs-partner.service.ts','src/jobs/jobs-shared.ts','src/jobs/jobs-public.service.ts']
    return files.map(f => { try { return read(f) } catch { return '' } }).join('\n')
  })()
  mustContain(
    jobsSources,
    [
      'private readonly jobQuality: JobQualityService',
      'refreshJobQualitySnapshots',
      '来源平台未提供',
      'skillsJson',
      'benefitsJson',
      'educationRequirement',
      'experienceRequirement',
      'validThrough',
    ],
    'JobsService 接入质量刷新和标准化字段映射',
  )
  mustContain(jobsModule, ['JobQualityService'], 'JobsModule 注册 JobQualityService')

  mustContain(
    jobSyncService,
    [
      'private readonly jobQuality: JobQualityService',
      'refreshJobQualitySnapshots',
      'skillsJson',
      'benefitsJson',
      'educationRequirement',
      'experienceRequirement',
      'validThrough',
    ],
    'JobSyncService API 拉取后刷新质量快照并写入标准化字段',
  )
  mustContain(jobSyncModule, ['JobQualityService'], 'JobSyncModule 注册 JobQualityService')

  mustContain(
    importDto,
    [
      'educationRequirement',
      'experienceRequirement',
      'skills',
      'benefits',
      'salaryMin',
      'salaryMax',
      'salaryUnit',
      'validThrough',
    ],
    'ImportJobsDto 允许客户提供 AI-ready 标准化字段',
  )

  mustContain(
    excelDto,
    [
      "'educationRequirement'",
      "'experienceRequirement'",
      "'skills'",
      "'benefits'",
      "'salaryMin'",
      "'salaryMax'",
      "'salaryUnit'",
      "'validThrough'",
    ],
    'Excel 白名单支持 AI-ready 标准化字段',
  )

  mustContain(packageJson, ['"verify:job-data-quality"'], 'package.json 注册 verify:job-data-quality')
  mustContain(ci, ['verify:job-data-quality'], 'CI 串行 verify 接入岗位数据质量门禁')

  mustNotContain(
    [jobQuality, jobsService, jobSyncService, importDto, excelDto].join('\n'),
    [
      '一键投递',
      '立即投递',
      '平台投递',
      'applyStatus',
      'deliveryStatus',
      'candidateStatus',
      'interviewInvite',
      'offerStatus',
      'resumeText',
      'fullPrompt',
      'completionText',
    ],
    '岗位质量治理不引入招聘闭环或 AI/简历原文持久化字段',
  )

  verifyQualityRules()
  await verifyReachabilitySnapshotRules()

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项失败 — 岗位数据质量与来源可用性门禁未通过\n`)
    process.exit(1)
  }

  console.log('✅ ALL PASS — 岗位数据质量与来源可用性门禁一致\n')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
