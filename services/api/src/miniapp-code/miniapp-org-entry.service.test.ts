import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import {
  buildOrgEntryPath,
  buildOrgEntryScene,
  isHeartbeatOnline,
  MINIAPP_ORG_HOME_PAGE,
  MiniappOrgEntryService,
  normalizeOrgEntryId,
} from './miniapp-org-entry.service'
import { MiniappOrgEntryController } from './miniapp-org-entry.controller'
import { BrandingService } from '../branding/branding.service'
import { findPartnerWriteExemption } from '../licenses/partner-write-policy'

const NOW = new Date('2026-11-24T12:00:00.000Z').getTime()

function createMockService(overrides: {
  org?: Record<string, unknown> | null
  licenses?: Array<Record<string, unknown>>
  terminals?: Array<Record<string, unknown>>
  totalTerminalCount?: number
  configured?: boolean
  envVersion?: 'release' | 'trial' | 'develop'
  generateImpl?: (page: string, scene: string) => Promise<{ image: Buffer; mimeType: 'image/jpeg' | 'image/png'; envVersion: 'release' | 'trial' | 'develop' }>
} = {}) {
  const org = 'org' in overrides ? overrides.org : {
    id: 'org_qingdao_demo01',
    name: '青岛市就业服务中心',
    type: 'public_employment_service',
    enabled: true,
    archivedAt: null,
    brandName: '青岛就业服务',
    brandMark: '青',
    brandLogoAssetId: 'logo-1',
    licenseMode: 'none',
  }
  const prisma = {
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) => (org && org['id'] === where.id ? org : null),
    },
    license: {
      findMany: async () => overrides.licenses ?? [],
    },
    terminal: {
      count: async () => overrides.totalTerminalCount ?? (overrides.terminals?.length ?? 0),
      findMany: async () => overrides.terminals ?? [],
    },
  }
  const branding = {
    readStored: async () => ({
      brandName: '职易达',
      brandMark: '职',
      logoAssetId: null,
      icp: null,
      icpUrl: null,
      police: null,
      policeUrl: null,
    }),
    toPublicBrand: async (resolved: { brandName: string; brandMark: string; logoCandidates: string[] }) => ({
      brandName: resolved.brandName,
      brandMark: resolved.brandMark,
      logoUrl: resolved.logoCandidates[0] ? `/api/v1/public/brand-logo/${resolved.logoCandidates[0]}` : null,
    }),
    isOrgBrandActive: (orgId: string, now?: Date) =>
      BrandingService.prototype.isOrgBrandActive.call({ prisma }, orgId, now),
  }
  const codes = {
    isConfigured: () => overrides.configured ?? true,
    envVersion: () => overrides.envVersion ?? 'release',
    generate: overrides.generateImpl ?? (async () => ({
      image: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      mimeType: 'image/jpeg' as const,
      envVersion: overrides.envVersion ?? ('release' as const),
    })),
  }
  return new MiniappOrgEntryService(prisma as never, branding as never, codes as never)
}

test('scene 编码与机构编号白名单校验', () => {
  assert.equal(normalizeOrgEntryId(' org_abc-123 '), 'org_abc-123')
  assert.equal(normalizeOrgEntryId(''), null)
  assert.equal(normalizeOrgEntryId('org/bad'), null)
  assert.equal(normalizeOrgEntryId('a'.repeat(31)), null)

  assert.deepEqual(buildOrgEntryScene('org_abc123'), { scene: 'o=org_abc123', valid: true })
  assert.deepEqual(buildOrgEntryScene('a'.repeat(31)), { scene: '', valid: false })
  assert.equal(buildOrgEntryPath('org_abc123'), 'pages/home/home?orgId=org_abc123')
})

test('心跳在线判定：拦截过期、未来时钟偏移及本地任务库异常', () => {
  assert.equal(isHeartbeatOnline(undefined, NOW), false)
  assert.equal(isHeartbeatOnline({ createdAt: new Date(NOW - 60_000), localTaskDatabaseAvailable: true }, NOW), true)
  assert.equal(isHeartbeatOnline({ createdAt: new Date(NOW - 6 * 60_000), localTaskDatabaseAvailable: true }, NOW), false)
  assert.equal(isHeartbeatOnline({ createdAt: new Date(NOW + 10_000), localTaskDatabaseAvailable: true }, NOW), false)
  assert.equal(isHeartbeatOnline({ createdAt: new Date(NOW - 10_000), localTaskDatabaseAvailable: false }, NOW), false)
})

test('getPublicEntry 返回启用机构的联名信息与严格筛选后的在线终端（无敏感或招聘字段）', async () => {
  const svc = createMockService({
    terminals: [
      {
        id: 'term-online',
        terminalCode: 'QD-01',
        displayName: '政务大厅一号机',
        locationLabel: '市南区服务大厅一楼',
        heartbeats: [{ createdAt: new Date(NOW - 30_000), localTaskDatabaseAvailable: true }],
      },
      {
        id: 'term-offline',
        terminalCode: 'QD-02',
        displayName: '离线终端',
        locationLabel: '二楼',
        heartbeats: [{ createdAt: new Date(NOW - 10 * 60_000), localTaskDatabaseAvailable: true }],
      },
      {
        id: 'term-future-skew',
        terminalCode: 'QD-03',
        displayName: '时钟异常机',
        locationLabel: '三楼',
        heartbeats: [{ createdAt: new Date(NOW + 60_000), localTaskDatabaseAvailable: true }],
      },
    ],
  })

  const out = await svc.getPublicEntry('org_qingdao_demo01', NOW)
  assert.equal(out.orgId, 'org_qingdao_demo01')
  assert.equal(out.orgName, '青岛市就业服务中心')
  assert.equal(out.brandName, '青岛就业服务')
  assert.equal(out.brandMark, '青')
  assert.equal(out.brandLogoUrl, '/api/v1/public/brand-logo/logo-1')
  assert.deepEqual(out.terminals, [
    { id: 'term-online', displayName: '政务大厅一号机', locationLabel: '市南区服务大厅一楼', isOnline: true },
  ])
  assert.equal('contactPhone' in out, false)
  assert.equal('officialChannels' in out, false)
})

test('getPublicEntry 对停用、归档、不存在、授权失效机构统一 404 fail-closed', async () => {
  const cases = [
    createMockService({ org: null }),
    createMockService({ org: { id: 'org_qingdao_demo01', name: '停用机构', type: 'campus', enabled: false, archivedAt: null, licenseMode: 'none' } }),
    createMockService({ org: { id: 'org_qingdao_demo01', name: '归档机构', type: 'campus', enabled: true, archivedAt: new Date(), licenseMode: 'none' } }),
    createMockService({
      org: { id: 'org_qingdao_demo01', name: '授权过期机构', type: 'campus', enabled: true, archivedAt: null, licenseMode: 'required' },
      licenses: [{
        id: 'lic-1',
        status: 'active',
        startsAt: new Date('2025-01-01T00:00:00.000Z'),
        endsAt: new Date('2026-01-01T00:00:00.000Z'),
        graceDays: 0,
        terminalQuota: 5,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      }],
    }),
  ]
  for (const svc of cases) {
    await assert.rejects(
      () => svc.getPublicEntry('org_qingdao_demo01', NOW),
      (err: unknown) => err instanceof NotFoundException && (err.getResponse() as { error?: { code?: string } }).error?.code === 'ORG_ENTRY_NOT_FOUND',
    )
  }
})

test('Partner 入口与码生成严格绑定 user.orgId、如实回传 envVersion 且不豁免授权写拦截', async () => {
  let calledPage = ''
  let calledScene = ''
  const svc = createMockService({
    envVersion: 'trial',
    generateImpl: async (page, scene) => {
      calledPage = page
      calledScene = scene
      return { image: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimeType: 'image/png', envVersion: 'trial' }
    },
  })

  const noOrgUser: AuthedUser = { userId: 'u1', role: 'partner', orgId: null }
  await assert.rejects(() => svc.getPartnerEntry(noOrgUser, NOW), ForbiddenException)
  await assert.rejects(() => svc.generatePartnerEntryCode(noOrgUser), ForbiddenException)

  const partner: AuthedUser = { userId: 'u2', role: 'partner', orgId: 'org_qingdao_demo01' }
  const info = await svc.getPartnerEntry(partner, NOW)
  assert.equal(info.miniappPath, 'pages/home/home?orgId=org_qingdao_demo01')
  assert.equal(info.miniappScene, 'o=org_qingdao_demo01')
  assert.equal(info.envVersion, 'trial')
  assert.equal(info.sceneValid, true)

  const code = await svc.generatePartnerEntryCode(partner)
  assert.equal(calledPage, MINIAPP_ORG_HOME_PAGE)
  assert.equal(calledScene, 'o=org_qingdao_demo01')
  assert.equal(code.envVersion, 'trial')
  assert.match(code.dataUri, /^data:image\/png;base64,/)

  // 确认 POST /partner/miniapp-entry-code 不在授权失效豁免表内
  assert.equal(findPartnerWriteExemption('POST', '/partner/miniapp-entry-code', 'MiniappOrgEntryController.generatePartnerEntryCode'), undefined)

  // 超长机构编号拦截
  const badSceneSvc = createMockService({
    org: { id: 'org_' + 'x'.repeat(30), name: '超长机构', type: 'campus', enabled: true, archivedAt: null, licenseMode: 'none' },
  })
  await assert.rejects(
    () => badSceneSvc.generatePartnerEntryCode({ ...partner, orgId: 'org_' + 'x'.repeat(30) }),
    BadRequestException,
  )
})

test('Controller 对成功和 404 错误响应均写入 Cache-Control: private, no-store', async () => {
  const svc = createMockService({ org: null })
  const ctrl = new MiniappOrgEntryController(svc)
  const headers: Record<string, string> = {}
  const fakeRes = { setHeader: (k: string, v: string) => { headers[k] = v } }
  await assert.rejects(() => ctrl.getPublicEntry('org_missing', fakeRes as never), NotFoundException)
  assert.equal(headers['Cache-Control'], 'private, no-store')
})
