import 'dotenv/config'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { OfflineAgenciesService } from '../src/offline-agencies/offline-agencies.service'

function fail(message: string): never {
  throw new Error(message)
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

async function main(): Promise<void> {
  console.log('\n=== OfflineAgency P0 service contract ===')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const service = new OfflineAgenciesService(prisma)
  let agencyId: string | null = null
  const extraIds: string[] = []

  try {
    const agency = await service.adminCreate({
      name: `P0 Contract Agency ${Date.now()}`,
      orgType: 'recruitment',
      address: 'P0 Contract Test Address',
      phone: '010-00000000',
    })
    agencyId = agency.id

    const detail = await service.adminFindOne(agency.id)
    if (detail.id !== agency.id) fail('admin detail lookup failed')
    pass('Admin detail lookup returns the created agency')

    await service.adminReview(agency.id, 'approve')
    await service.adminPublish(agency.id, 'published')
    const updated = await service.adminUpdate(agency.id, {
      name: agency.name,
      orgType: 'recruitment',
      address: 'P0 Contract Test Address Updated',
    })
    if (updated.reviewStatus !== 'pending' || updated.publishStatus !== 'draft') {
      fail('agency content edit did not reset review/publish state')
    }
    pass('Agency content edit resets to pending/draft')

    const filtered = await service.adminFindAll({ reviewStatus: 'pending', publishStatus: 'draft' })
    if (!filtered.data.some((item) => item.id === agency.id)) {
      fail('review/publish filters did not return the matching test agency')
    }
    pass('Admin review/publish filters are applied by the service')

    await service.adminReview(agency.id, 'approve')
    await service.adminPublish(agency.id, 'published')
    const job = await service.adminCreateJob(agency.id, {
      title: 'P0 Contract Job',
      jobType: 'fulltime',
      salaryMin: 8000,
      salaryMax: 12000,
      location: 'Test District',
      externalUrl: 'https://example.com/jobs/p0-contract',
    })
    const afterJobCreate = await service.adminFindOne(agency.id)
    if (afterJobCreate.reviewStatus !== 'pending' || afterJobCreate.publishStatus !== 'draft') {
      fail('offline job create bypassed agency review gate')
    }
    pass('Offline job create resets parent agency to pending/draft')

    await service.adminReview(agency.id, 'approve')
    await service.adminPublish(agency.id, 'published')
    const publicJob = await service.findOneJob(job.id)
    if (publicJob.id !== job.id) fail('published offline job was not readable')
    pass('Published agency job is readable')

    await service.adminUpdate(agency.id, { status: 'inactive' })
    try {
      await service.findOneJob(job.id)
      fail('inactive agency leaked through public job deep link')
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error
      pass('Inactive agency blocks public job deep links')
    }

    try {
      await service.adminReview(agency.id, 'reject')
      fail('reject without reason unexpectedly succeeded')
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error
      pass('Reject requires an audit reason')
    }

    const stamp = Date.now()
    const secretEmail = `pii-secret-${stamp}@example.com`
    const fooSvc = `foo-${stamp}`
    const barSvc = `bar-${stamp}`
    const makePublished = async (name: string, services: string[]) => {
      const created = await service.adminCreate({
        name,
        orgType: 'recruitment',
        address: 'P0 Pagination Address',
        phone: '010-11111111',
        contactEmail: secretEmail,
        services: JSON.stringify(services),
      })
      extraIds.push(created.id)
      await service.adminReview(created.id, 'approve')
      await service.adminPublish(created.id, 'published')
      return created
    }
    await makePublished(`P0 Foo Old ${stamp}`, [fooSvc])
    const barAgency = await makePublished(`P0 Bar ${stamp}`, [barSvc])
    await makePublished(`P0 Foo New ${stamp}`, [fooSvc])

    const barPage = await service.findAll({ service: barSvc, page: 1, pageSize: 1 })
    if (barPage.total !== 1) fail(`service=bar total should be 1 after push-down, got ${barPage.total}`)
    if (barPage.data.length !== 1 || barPage.data[0]?.id !== barAgency.id) {
      fail(`page 1 of service=bar should be the bar agency, got ${JSON.stringify(barPage.data)}`)
    }
    const serialized = JSON.stringify(barPage)
    if (serialized.includes(secretEmail) || serialized.includes('contactEmail')) {
      fail('public list leaked contactEmail')
    }
    pass('Public list pushes service filter into query and omits contactEmail')

    const fooPage1 = await service.findAll({ service: fooSvc, page: 1, pageSize: 1 })
    const fooPage2 = await service.findAll({ service: fooSvc, page: 2, pageSize: 1 })
    if (fooPage1.total !== 2 || fooPage2.total !== 2) {
      fail(`service=foo total should be 2, got p1=${fooPage1.total} p2=${fooPage2.total}`)
    }
    if (fooPage1.data.length !== 1 || fooPage2.data.length !== 1) {
      fail('service=foo pagination should return one row per page')
    }
    if (fooPage1.data[0]?.id === fooPage2.data[0]?.id) {
      fail('service=foo page 1 and page 2 returned the same row')
    }
    pass('Public list total is the filtered count and later pages are reachable')

    const adminList = await service.adminFindAll({ keyword: `P0 Bar ${stamp}` })
    const adminRow = adminList.data.find((item) => item.id === barAgency.id) as { contactEmail?: string | null } | undefined
    if (!adminRow || adminRow.contactEmail !== secretEmail) {
      fail('admin list must still return contactEmail for authorized operators')
    }
    pass('Admin list still returns contactEmail under admin auth')

  } finally {
    const cleanupIds = [...extraIds, ...(agencyId ? [agencyId] : [])]
    for (const id of cleanupIds) {
      await prisma.offlineJob.deleteMany({ where: { agencyId: id } })
      await prisma.offlineAgency.deleteMany({ where: { id } })
    }
    await prisma.onModuleDestroy()
  }

  console.log('\nAll OfflineAgency P0 service checks passed.\n')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
