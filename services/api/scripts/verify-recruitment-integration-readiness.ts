import 'reflect-metadata'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ForbiddenException } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { ImportFairsDto } from '../src/jobs/dto/import-fairs.dto'
import { ImportJobsDto } from '../src/jobs/dto/import-jobs.dto'
import { RecruitmentIntegrationController } from '../src/jobs/recruitment-integration.controller'
import {
  buildRecruitmentIntegrationContract,
  type PartnerDataSourceCapabilitiesInput,
  summarizeFairPreflight,
  summarizeJobPreflight,
} from '../src/jobs/recruitment-integration.contract'
import type { JobsService } from '../src/jobs/jobs.service'

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function validate<T extends object>(type: new () => T, input: object): T {
  const dto = plainToInstance(type, input)
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })
  expect(errors.length === 0, `fixture validation failed: ${JSON.stringify(errors)}`)
  return dto
}

async function main(): Promise<void> {
  const capabilities: PartnerDataSourceCapabilitiesInput = {
    orgType: 'school_employment_center',
    allowedAccessModes: ['api', 'excel', 'csv', 'json', 'webhook', 'manual'],
    allowedSourceKinds: ['school', 'manual'],
    defaultSourceKind: 'school',
    adminManagedAccessModes: ['api', 'webhook'],
    canImportJobs: true,
    canImportFairs: true,
  }
  const contract = buildRecruitmentIntegrationContract(capabilities)
  expect(contract.contractVersion === '2026-08-10.v1', 'contract version drifted')
  expect(
    contract.schemas
      .find((schema) => schema.dataType === 'job')
      ?.requiredFields.includes('sourceUrl'),
    'job sourceUrl missing'
  )
  expect(
    contract.schemas
      .find((schema) => schema.dataType === 'fair')
      ?.requiredFields.includes('sourceUrl'),
    'fair sourceUrl missing'
  )
  expect(
    contract.webhook?.signatureAlgorithm === 'HMAC-SHA256',
    'webhook signature contract missing'
  )
  expect(
    contract.routes.dataSources === '/api/v1/partner/data-sources',
    'data source registration route missing'
  )
  expect(contract.importTargetState.reviewStatus === 'pending', 'imports must require review')
  expect(contract.importTargetState.publishStatus === 'draft', 'imports must remain draft')
  expect(
    contract.importTargetState.publiclyVisible === false,
    'preflight must not imply public visibility'
  )
  expect(contract.forbiddenFields.includes('resumeUrl'), 'resume field denylist missing')

  const jobDto = validate(ImportJobsDto, {
    items: [
      {
        externalId: 'fixture-job-1',
        title: '测试岗位',
        company: '测试企业',
        city: '上海',
        sourceUrl: 'https://jobs.example.test/fixture-job-1',
        workType: '校园招聘',
        skills: ['沟通'],
      },
    ],
  })
  const jobPreflight = summarizeJobPreflight(jobDto.items)
  expect(jobPreflight.persistence === 'none', 'job preflight must not persist')
  expect(jobPreflight.normalizedDimensions.campus === 1, 'job workType normalization missing')
  expect(
    jobPreflight.optionalFieldsPresent.includes('skills'),
    'job optional field summary missing'
  )

  const fairDto = validate(ImportFairsDto, {
    items: [
      {
        externalId: 'fixture-fair-1',
        title: '测试招聘会',
        startAt: '2026-09-01T01:00:00.000Z',
        endAt: '2026-09-01T05:00:00.000Z',
        venue: '测试场馆',
        city: '上海',
        sourceUrl: 'https://fairs.example.test/fixture-fair-1',
        theme: 'campus',
      },
    ],
  })
  const fairPreflight = summarizeFairPreflight(fairDto.items)
  expect(fairPreflight.persistence === 'none', 'fair preflight must not persist')
  expect(fairPreflight.normalizedDimensions.campus === 1, 'fair theme summary missing')

  const invalid = plainToInstance(ImportJobsDto, {
    items: [
      {
        externalId: 'fixture-invalid',
        title: '非法字段测试',
        company: '测试企业',
        city: '上海',
        sourceUrl: 'https://jobs.example.test/fixture-invalid',
        resumeUrl: 'https://private.example.test/resume.pdf',
      },
    ],
  })
  expect(
    validateSync(invalid, { whitelist: true, forbidNonWhitelisted: true }).length > 0,
    'resumeUrl must be rejected'
  )

  let capabilityReads = 0
  const controller = new RecruitmentIntegrationController({
    getPartnerDataSourceCapabilities: async () => {
      capabilityReads += 1
      return capabilities
    },
  } as unknown as JobsService)
  const user = { userId: 'fixture-partner', role: 'partner', orgId: 'fixture-org' } as const
  expect(
    (await controller.getContract(user)).contractVersion === contract.contractVersion,
    'controller contract route failed'
  )
  expect(
    (await controller.preflightJobs(jobDto, user)).persistence === 'none',
    'controller job preflight failed'
  )
  expect(
    (await controller.preflightFairs(fairDto, user)).persistence === 'none',
    'controller fair preflight failed'
  )
  expect(capabilityReads === 3, 'every route must re-check partner capability')

  const fairOnly = new RecruitmentIntegrationController({
    getPartnerDataSourceCapabilities: async () => ({
      ...capabilities,
      orgType: 'fair_organizer',
      allowedAccessModes: ['api', 'excel', 'csv', 'json', 'manual'],
      allowedSourceKinds: ['fair_organizer', 'manual'],
      defaultSourceKind: 'fair_organizer',
      canImportJobs: false,
    }),
  } as unknown as JobsService)
  let denied = false
  try {
    await fairOnly.preflightJobs(jobDto, user)
  } catch (error) {
    denied = error instanceof ForbiddenException
  }
  expect(denied, 'disallowed data type must fail closed')

  const controllerSource = readFileSync(
    join(__dirname, '../src/jobs/recruitment-integration.controller.ts'),
    'utf8'
  )
  for (const marker of [
    "@Controller('partner/data-sources')",
    '@UseGuards(JwtAuthGuard, RolesGuard)',
    "@Roles('partner')",
    "@Get('integration-contract')",
    "@Post('preflight/jobs')",
    "@Post('preflight/fairs')",
  ])
    expect(controllerSource.includes(marker), `controller guard/route missing: ${marker}`)
  for (const forbidden of ['prisma.', '.create(', '.update(', '.upsert(', '.delete(']) {
    expect(
      !controllerSource.includes(forbidden),
      `preflight controller contains write surface: ${forbidden}`
    )
  }

  console.log('Recruitment integration contract + no-write preflight: PASS')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
