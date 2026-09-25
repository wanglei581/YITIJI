/**
 * 子进程探针。入口路径不含 scripts/verify-。
 * 由 verify-recruitment-hosting-default-off 拉起，且调用方会删掉托管开关。
 */
import { PrismaService } from '../../src/prisma/prisma.service'
import { AuditService } from '../../src/audit/audit.service'
import { JobsKioskService } from '../../src/jobs/jobs-kiosk.service'
import { JobsAdminService } from '../../src/jobs/jobs-admin.service'
import { isRecruitmentContentHostingEnabled } from '../../src/recruitment-hosting/recruitment-hosting'
import type { AuthedUser } from '../../src/common/decorators/current-user.decorator'

function codeOf(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()
  return response?.error?.code
}

function die(message: string): never {
  console.error(`PROBE_FAIL ${message}`)
  process.exit(1)
}

async function main() {
  if (process.argv.join(' ').includes('scripts/verify-')) die('probe argv still looks like a verify entry')
  if (isRecruitmentContentHostingEnabled()) die('hosting is on without the variable')
  const jobId = process.argv[2]
  if (!jobId) die('missing job id')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  try {
    const kiosk = new JobsKioskService(prisma)
    const page = await kiosk.getPublishedJobs({})
    if (page.data.length !== 0) die(`list length ${page.data.length}`)
    try {
      await kiosk.getPublishedJobById(jobId)
      die('detail did not reject')
    } catch (error) {
      if (codeOf(error) !== 'RECRUITMENT_HOSTING_DISABLED') die(`detail ${codeOf(error) ?? (error as Error).message}`)
    }
    const admin = new JobsAdminService(prisma, new AuditService(prisma))
    const actor: AuthedUser = { userId: 'probe-admin', role: 'admin', orgId: null }
    try {
      await admin.publishJobSource(jobId, 'publish', actor)
      die('write did not reject')
    } catch (error) {
      if (codeOf(error) !== 'RECRUITMENT_HOSTING_DISABLED') die(`write ${codeOf(error) ?? (error as Error).message}`)
    }
    console.log('PROBE_OK')
  } finally {
    await prisma.onModuleDestroy()
  }
}

main().catch((error: unknown) => {
  die((error as Error).message)
})
