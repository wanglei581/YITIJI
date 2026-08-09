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

  } finally {
    if (agencyId) {
      await prisma.offlineJob.deleteMany({ where: { agencyId } })
      await prisma.offlineAgency.deleteMany({ where: { id: agencyId } })
    }
    await prisma.onModuleDestroy()
  }

  console.log('\nAll OfflineAgency P0 service checks passed.\n')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
