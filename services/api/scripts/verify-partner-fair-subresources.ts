import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Reflector } from '@nestjs/core'
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host'
import { JwtService } from '@nestjs/jwt'
import { AuditService } from '../src/audit/audit.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { FilesService } from '../src/files/files.service'
import { AdminFairsService } from '../src/jobs/admin-fairs.service'
import { FairCompanyZoneService } from '../src/jobs/fair-company-zone.service'
import { FairMaterialPrintBridgeService } from '../src/jobs/fair-material-print-bridge.service'
import { FairMaterialService } from '../src/jobs/fair-material.service'
import { FairVenueGuideService } from '../src/jobs/fair-venue-guide.service'
import { JobsKioskService } from '../src/jobs/jobs-kiosk.service'
import { PartnerFairsController } from '../src/jobs/partner-fairs.controller'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'

const pdf = () => Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1')
const code = (error: unknown) => ((error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.().error?.code)
const status = (error: unknown) => (error as { getStatus?: () => number }).getStatus?.()
const expectCode = (call: () => Promise<unknown>, expected: string, expectedStatus?: number) => assert.rejects(call, (error: unknown) => code(error) === expected && (expectedStatus === undefined || status(error) === expectedStatus))

async function main() {
  assert.ok((process.env.DATABASE_URL ?? '').startsWith('file:'), 'requires isolated SQLite DATABASE_URL=file:')
  process.env.FILE_STORAGE_DRIVER = 'local'
  process.env.FILE_SIGNING_SECRET ??= 'verify-partner-fair-subresources-signing-secret'
  const prisma = new PrismaService(); await prisma.onModuleInit()
  const audit = new AuditService(prisma), storage = new StorageService(), files = new FilesService(prisma, audit, storage)
  const zones = new FairCompanyZoneService(prisma, audit), materials = new FairMaterialService(prisma, audit, storage, new FairMaterialPrintBridgeService(prisma, storage, files)), venue = new FairVenueGuideService(prisma, audit)
  const controller = new PartnerFairsController(prisma, zones, materials, venue), admin = new AdminFairsService(prisma, audit, zones, materials, venue), kiosk = new JobsKioskService(prisma)
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10), ids = { a: `org_pfsa_${suffix}`, b: `org_pfsb_${suffix}`, user: `user_pfsa_${suffix}`, admin: `user_pfsa_admin_${suffix}` }
  let fairA = '', fairB = '', materialId = ''
  try {
    await prisma.organization.createMany({ data: [{ id: ids.a, name: 'Partner A', type: 'gov', contentTrustStatus: 'active' }, { id: ids.b, name: 'Partner B', type: 'gov', contentTrustStatus: 'active' }] })
    await prisma.user.createMany({ data: [{ id: ids.user, username: ids.user, passwordHash: 'x', name: 'A', role: 'partner', orgId: ids.a }, { id: ids.admin, username: ids.admin, passwordHash: 'x', name: 'Admin', role: 'admin' }] })
    const fairs = await Promise.all([ids.a, ids.b].map((sourceOrgId, index) => prisma.jobFair.create({ data: { sourceOrgId, externalId: `PFS-${index}-${suffix}`, sourceName: 'verify', sourceUrl: 'https://example.org', title: `Fair ${index}`, theme: 'general', startAt: new Date(Date.now() + 60_000), endAt: new Date(Date.now() + 120_000), venue: '验证馆', city: '验证市', reviewStatus: 'approved', publishStatus: 'published' } })))
    fairA = fairs[0].id; fairB = fairs[1].id
    const jwt = new JwtService({ secret: process.env.JWT_SECRET ?? 'verify-partner-fair-subresources-jwt-secret' })
    const request: { headers: { authorization: string }; user?: AuthedUser } = { headers: { authorization: `Bearer ${jwt.sign({ sub: ids.user, ver: 0 })}` } }
    const context = new ExecutionContextHost([request], PartnerFairsController, PartnerFairsController.prototype.getZones); context.setType('http')
    const redis = { get: async () => null, del: async () => 0, setJsonIfVersionNotOlder: async () => 'stored' } as unknown as RedisService
    assert.equal(await new JwtAuthGuard(jwt, prisma, redis).canActivate(context), true); assert.equal(new RolesGuard(new Reflector()).canActivate(context), true)
    const user = request.user!
    await expectCode(() => controller.createZone(fairB, { name: 'x' }, user), 'FAIR_NOT_FOUND', 404)
    await expectCode(() => controller.uploadMaterial(fairB, { buffer: pdf(), mimetype: 'application/pdf' } as Express.Multer.File, { name: 'x' }, user), 'FAIR_NOT_FOUND', 404)
    await expectCode(() => controller.saveVenueGuide(fairB, { venueName: 'x', halls: [], facilities: [] }, user), 'FAIR_NOT_FOUND', 404)
    await expectCode(() => controller.getZones(fairA, { ...user, orgId: null }), 'ORG_REQUIRED')
    console.log('PASS cross-org zones/materials/venue writes return 404; missing orgId returns ORG_REQUIRED')
    await controller.createZone(fairA, { name: 'Partner zone' }, user); assert.ok((await kiosk.getFairZones(fairA)).data.some((item) => item.name === 'Partner zone'))
    await controller.saveVenueGuide(fairA, { venueName: '验证馆', halls: [{ hallCode: 'A', hallName: 'A厅', companies: [] }], facilities: [] }, user)
    const uploaded = await controller.uploadMaterial(fairA, { buffer: pdf(), mimetype: 'application/pdf' } as Express.Multer.File, { name: 'Partner material' }, user); materialId = uploaded.id
    assert.equal(uploaded.publishStatus, 'unpublished'); assert.equal((await materials.getPublishedFairMaterials(fairA, 1, 20)).data.length, 0)
    await admin.publishMaterial(fairA, materialId, 'publish', { userId: ids.admin, role: 'admin', orgId: null }); assert.ok((await materials.getPublishedFairMaterials(fairA, 1, 20)).data.some((item) => item.id === materialId))
    const audits = await prisma.auditLog.findMany({ where: { actorId: ids.user } }); for (const action of ['fair.zone.create', 'fair.material.upload', 'fair.venue_guide.save']) assert.ok(audits.some((item) => item.action === action && item.actorRole === 'partner'))
    console.log('PASS public zone visibility; material unpublished then admin-published visibility; partner audit role')
  } finally {
    if (fairA && materialId) await admin.deleteMaterial(fairA, materialId, { userId: ids.admin, role: 'admin', orgId: null }).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [ids.user, ids.admin] } } }).catch(() => undefined)
    await prisma.jobFair.deleteMany({ where: { id: { in: [fairA, fairB].filter(Boolean) } } }).catch(() => undefined)
    await prisma.user.deleteMany({ where: { id: { in: [ids.user, ids.admin] } } }).catch(() => undefined)
    await prisma.organization.deleteMany({ where: { id: { in: [ids.a, ids.b] } } }).catch(() => undefined); await prisma.onModuleDestroy()
  }
}
main().catch((error) => { console.error(error); process.exit(1) })
