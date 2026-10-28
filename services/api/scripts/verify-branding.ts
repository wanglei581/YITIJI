/**
 * verify:branding —— 贴牌第一步后端（品牌与备案、机构覆盖、Logo、一体机 kiosk-profile）。
 *
 * 覆盖（对应 grok/design-branding-step1.md「验证」一节与 agy 反方采纳项）：
 *   1. 静态契约：shared 与 API 本地副本一致；默认值与现状一致；控制器守卫 / 限流 / 注册；Logo 与待机素材分表。
 *   2. 默认：没配置时和今天一模一样（职易达 / 职 / 现有备案号与查询链接），两个公开接口都是。
 *   3. 平台修改生效、写审计；省略不改、清空回默认；非管理员 403。
 *   4. 校验：品牌名 1–12 字、字标恰好 1 字、控制字符 / 零宽字符拒绝；备案链接只许 https + 官方备案域名（含 beian.mps.gov.cn）。
 *   5. Logo：只收 PNG（按文件头判，不信扩展名与 Content-Type）；WebP / SVG / JPEG / GIF / 动图 / 损坏 /
 *      超 512KB / 超 1024 / 非 1:1 一律拒；落盘的是解压校验后重新编码的文件（只剩 IHDR / PLTE / tRNS / IDAT / IEND）；
 *      公开读取只认 Logo 表。文件内容检查的细节（压缩流、夹带、解压炸弹、扫描行布局）在 verify-brand-logo-image.ts。
 *   6. 机构覆盖只影响该机构的终端；逐项独立回退；终端 → 机构 → 平台。
 *   6b. kiosk-profile 对已验签终端带 licenseState（ok / grace / inactive），只给状态不给到期日等商务细节。
 *   7. 未验签 / 未知终端 / 伪造终端头：只拿平台默认，没有点位、没有机构、没有授权状态；公开响应不含任何非公开字段。
 *   8. Redis 暂不可用时已验签请求回 503（一体机据此保持上次状态），不带验签头的请求不受影响。
 *
 * 数据库：用环境里的 DATABASE_URL（SQLite 或 PostgreSQL 都行），必须是隔离库：
 *   VERIFICATION_DATABASE_TARGET=isolated；平台 brand.* / filing.* 设置在结束时恢复原样。
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:branding
 */
import 'dotenv/config'
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { Module, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { AuditService } from '../src/audit/audit.service'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { ROLES_KEY } from '../src/common/decorators/roles.decorator'
import { resetRedisCooldownForTests } from '../src/common/redis/redis-degradation'
import { RedisService } from '../src/common/redis/redis.service'
import { setLicenseClock } from '../src/licenses/license-clock'
import { resolveTerminalScopedTracker } from '../src/common/throttler/terminal-throttle'
import { BrandLogoService } from '../src/branding/brand-logo.service'
import { BrandingAdminController } from '../src/branding/branding.admin.controller'
import { BrandingPublicController } from '../src/branding/branding.public.controller'
import { BrandingService } from '../src/branding/branding.service'
import * as local from '../src/branding/branding.types'
import { KioskProfileService } from '../src/branding/kiosk-profile.service'
import { UpdateOrgDto } from '../src/orgs/dto/admin-org.dto'
import { AdminOrgsService } from '../src/orgs/admin-orgs.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
import { TERMINAL_TOKEN_VALIDATOR, TerminalSessionService } from '../src/terminals/terminal-session.service'
import * as shared from '../../../packages/shared/src/types/branding'
import { Checker, FakeRedis, installGlobals, makeCaller } from './support/branding-license-support'
import { buildPng, canvasImage, decodeSize, plainRows, pngChunk, pngChunks, pngFromSpec } from './support/png-fixtures'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const API_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(API_ROOT, '../..')
const c = new Checker()

const SETTING_KEYS = Object.values(local.BRAND_SETTING_KEYS)
/** 公开响应里绝不能出现的东西：机构名、机构号、终端号、点位名（验签通过的响应里点位名是预期内容，单独核）。 */
const KIOSK_PROFILE_KEYS = ['brandName', 'brandMark', 'filing', 'licenseState', 'location', 'logoUrl']
const PUBLIC_BRAND_KEYS = ['brandName', 'brandMark', 'logoUrl']

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function interfaceFields(source: string, name: string): string[] {
  const match = source.match(new RegExp(`export interface ${name}(?: extends [A-Za-z]+)? \\{([\\s\\S]*?)\\n\\}`))
  if (!match) return []
  return [...(match[1] ?? '').matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]!).sort()
}

function assertStatic(): void {
  console.log('\n[1] 静态契约')
  // 常量：shared 与 API 本地副本逐项相等
  for (const name of [
    'DEFAULT_BRAND_NAME', 'DEFAULT_BRAND_MARK', 'BRAND_NAME_MAX_LENGTH', 'BRAND_MARK_LENGTH',
    'BRAND_FILING_TEXT_MAX_LENGTH', 'BRAND_FILING_URL_MAX_LENGTH', 'BRAND_FILING_URL_HOSTS',
    'BRAND_LOGO_MIME_TYPES', 'BRAND_LOGO_MAX_BYTES', 'BRAND_LOGO_MAX_PIXELS',
    'BRAND_LOGO_RATIO_MIN', 'BRAND_LOGO_RATIO_MAX', 'DEFAULT_BRANDING_FILING',
  ] as const) {
    c.equal(`shared 与 API 副本一致：${name}`, (local as Record<string, unknown>)[name], (shared as Record<string, unknown>)[name])
  }
  const sharedSource = read(join(REPO_ROOT, 'packages/shared/src/types/branding.ts'))
  const localSource = read(join(API_ROOT, 'src/branding/branding.types.ts'))
  for (const name of ['BrandingFiling', 'PublicBrand', 'PublicKioskProfile', 'AdminBranding', 'UpdateBrandingInput', 'BrandLogoUploadResult', 'OrgBrandOverride']) {
    const a = interfaceFields(sharedSource, name)
    c.check(`shared 与 API 副本字段一致：${name}`, a.length > 0 && JSON.stringify(a) === JSON.stringify(interfaceFields(localSource, name)), `${a} / ${interfaceFields(localSource, name)}`)
  }
  // 默认值 = 现状原值（逐字）
  c.equal('默认品牌名与字标', [local.DEFAULT_BRAND_NAME, local.DEFAULT_BRAND_MARK], ['职易达', '职'])
  c.equal('默认备案号与查询链接与现状逐字一致', local.DEFAULT_BRANDING_FILING, {
    icp: '鲁ICP备2026023517号-2',
    icpUrl: 'https://beian.miit.gov.cn/',
    police: '鲁公网安备37021402007308号',
    policeUrl: 'https://beian.mps.gov.cn/#/query/webSearch?code=37021402007308',
  })
  c.equal('备案查询链接白名单含 beian.mps.gov.cn / beian.miit.gov.cn / www.beian.gov.cn',
    [...local.BRAND_FILING_URL_HOSTS].sort(), ['beian.miit.gov.cn', 'beian.mps.gov.cn', 'www.beian.gov.cn'])
  c.equal('Logo 只收 PNG', [...local.BRAND_LOGO_MIME_TYPES], ['image/png'])
  c.check('PlatformSetting 键沿用设计稿', JSON.stringify(Object.values(local.BRAND_SETTING_KEYS).sort()) ===
    JSON.stringify(['brand.logoAssetId', 'brand.mark', 'brand.name', 'filing.icp', 'filing.icpUrl', 'filing.police', 'filing.policeUrl']))
  // 控制器：守卫、角色、限流、注册
  const adminGuards = (Reflect.getMetadata(GUARDS_METADATA, BrandingAdminController) ?? []) as unknown[]
  c.check('管理员控制器挂 JwtAuthGuard + RolesGuard', adminGuards.includes(JwtAuthGuard) && adminGuards.includes(RolesGuard))
  c.equal('管理员控制器只许 admin 角色', Reflect.getMetadata(ROLES_KEY, BrandingAdminController), ['admin'])
  const publicGuards = (Reflect.getMetadata(GUARDS_METADATA, BrandingPublicController) ?? []) as unknown[]
  c.check('公开控制器不挂登录守卫', !publicGuards.includes(JwtAuthGuard))
  const handler = BrandingPublicController.prototype.kioskProfile as unknown as object
  c.check('kiosk-profile 按台限流 30 次/分钟',
    Reflect.getMetadata('THROTTLER:TTLdefault', handler) === 60_000 &&
    Reflect.getMetadata('THROTTLER:LIMITdefault', handler) === 30 &&
    Reflect.getMetadata('THROTTLER:TRACKERdefault', handler) === resolveTerminalScopedTracker)
  const appModule = read(join(API_ROOT, 'src/app.module.ts'))
  c.check('AppModule 注册 BrandingModule', /import \{ BrandingModule \}/.test(appModule) && /^\s+BrandingModule,$/m.test(appModule))
  // Logo 与待机宣传屏素材分开：品牌模块不碰 AdAsset
  const brandingSources = ['brand-logo.service.ts', 'branding.service.ts', 'kiosk-profile.service.ts', 'branding.public.controller.ts']
    .map((file) => read(join(API_ROOT, 'src/branding', file))).join('\n')
  c.check('品牌模块不读写待机宣传屏素材（不碰 adAsset 表，也不依赖 ContentService）', !/\.adAsset\b|ContentService|content\.service/.test(brandingSources))
  const stored = read(join(API_ROOT, 'src/branding/brand-logo.service.ts'))
  c.check('Logo 清洗后的内容落盘，不是原始上传', stored.includes('inspected.sanitized'))
}

async function main(): Promise<void> {
  assertStatic()
  assertIsolatedVerificationDatabase()
  process.env['ADMIN_IP_ALLOWLIST'] = ''
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8)
  const redis = new FakeRedis()

  @Module({
    imports: [JwtModule.register({ secret: 'branding-verify-secret', signOptions: { expiresIn: '2h' } })],
    controllers: [BrandingPublicController, BrandingAdminController],
    providers: [
      BrandingService, BrandLogoService, KioskProfileService, AuditService, JwtAuthGuard, RolesGuard,
      PrismaService, StorageService, TerminalSessionService,
      { provide: RedisService, useValue: redis },
      { provide: TERMINAL_TOKEN_VALIDATOR, useValue: { async validateTerminalToken() { /* 夹具：不校验终端令牌 */ } } },
    ],
  })
  class FixtureModule {}

  const app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false })
  installGlobals(app)
  await app.listen(0, '127.0.0.1')
  const call = makeCaller(app)
  const prisma = app.get(PrismaService)
  const jwt = app.get(JwtService)
  const sessions = app.get(TerminalSessionService)
  const storage = app.get(StorageService)

  const adminId = `user_br_admin_${suffix}`
  const partnerId = `user_br_partner_${suffix}`
  const orgA = `org_br_a_${suffix}`
  const orgB = `org_br_b_${suffix}`
  const orgC = `org_br_c_${suffix}`
  const termA = `t_br_a_${suffix}`
  const termB = `t_br_b_${suffix}`
  const termC = `t_br_c_${suffix}`
  const termN = `t_br_n_${suffix}`
  const NAME_A = `品牌机构甲${suffix}`
  const LOC_A = `甲区政务大厅一楼${suffix}`
  const LOC_B = `乙区人才市场${suffix}`
  const adminToken = () => jwt.sign({ sub: adminId, ver: 0 })
  const partnerToken = () => jwt.sign({ sub: partnerId, ver: 0 })
  const settingsBefore = await prisma.platformSetting.findMany({ where: { key: { in: SETTING_KEYS } } })
  const createdLogoIds: string[] = []

  try {
    await prisma.platformSetting.deleteMany({ where: { key: { in: SETTING_KEYS } } })
    await prisma.organization.createMany({
      data: [
        { id: orgA, name: NAME_A, type: 'public_employment_service' },
        { id: orgB, name: `品牌机构乙${suffix}`, type: 'public_employment_service' },
        { id: orgC, name: `品牌机构丙${suffix}`, type: 'school_employment_center' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: adminId, username: `br-admin-${suffix}`, passwordHash: 'not-used', name: '品牌管理员', role: 'admin' },
        { id: partnerId, username: `br-partner-${suffix}`, passwordHash: 'not-used', name: '品牌机构账号', role: 'partner', orgId: orgB },
      ],
    })
    const mk = (id: string, orgId: string | null, locationLabel: string | null, displayName: string | null) => ({
      id, terminalCode: `BR-${id.slice(-12)}`, agentToken: `tok-${id}`, deviceFingerprint: `fp-${id}`,
      orgId, locationLabel, displayName, orgBoundAt: orgId ? new Date('2026-10-01T00:00:00Z') : null,
    })
    await prisma.terminal.createMany({
      data: [mk(termA, orgA, LOC_A, '甲区一号机'), mk(termB, orgB, null, LOC_B), mk(termC, orgC, null, null), mk(termN, null, '无机构点位' + suffix, null)],
    })
    const sessionOf = async (terminalId: string): Promise<string> => {
      const ticket = await sessions.createBootTicket(terminalId, 'Bearer fixture')
      return (await sessions.exchangeBootTicket(ticket.bootTicket)).sessionToken
    }
    const profileOf = async (terminalId?: string, token?: string) =>
      call('GET', '/api/v1/public/kiosk-profile', {
        headers: { ...(terminalId ? { 'x-terminal-id': terminalId } : {}), ...(token ? { 'x-terminal-session-token': token } : {}) },
      })
    const upload = async (buffer: Buffer, as = 'logo.png', type = 'image/png', token = adminToken()) => {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(buffer)], { type }), as)
      return call('POST', '/api/v1/admin/branding/logo', { token, form })
    }
    const put = (body: unknown, token = adminToken()) => call('PUT', '/api/v1/admin/branding', { body, token })
    const tokenA = await sessionOf(termA)
    const tokenB = await sessionOf(termB)
    const tokenC = await sessionOf(termC)
    const tokenN = await sessionOf(termN)

    // ── 2. 默认值 ───────────────────────────────────────────────────────────
    console.log('\n[2] 没配置时和今天一模一样')
    const defaultsBrand = await call('GET', '/api/v1/public/brand')
    c.equal('GET /public/brand 默认', defaultsBrand.json.data, { brandName: '职易达', brandMark: '职', logoUrl: null })
    c.check('GET /public/brand 缓存头 public, max-age=60', defaultsBrand.headers.get('cache-control') === 'public, max-age=60')
    const anonymous = await profileOf()
    c.equal('未验签的 kiosk-profile = 平台默认 + 默认备案 + 没有点位 + 没有授权状态', anonymous.json.data, {
      brandName: '职易达', brandMark: '职', logoUrl: null, filing: local.DEFAULT_BRANDING_FILING, location: null, licenseState: null,
    })
    c.check('kiosk-profile 不许被共享缓存', anonymous.headers.get('cache-control') === 'private, no-store')
    const adminDefault = await call('GET', '/api/v1/admin/branding', { token: adminToken() })
    c.check('管理员 GET 读到库存值：全是 null，并带默认值',
      adminDefault.status === 200 && adminDefault.json.data.brandName === null && adminDefault.json.data.filing.icp === null &&
      adminDefault.json.data.defaults.brandName === '职易达' && adminDefault.json.data.defaults.filing.icp === '鲁ICP备2026023517号-2')
    const verifiedDefault = await profileOf(termB, tokenB)
    c.check('机构没覆盖时已验签终端也拿到平台默认品牌，点位取 locationLabel/displayName，授权状态 ok',
      verifiedDefault.json.data.brandName === '职易达' && verifiedDefault.json.data.location === LOC_B && verifiedDefault.json.data.licenseState === 'ok')

    // ── 3. 平台修改生效、审计、清空 ──────────────────────────────────────────
    console.log('\n[3] 平台修改')
    const auditBefore = await prisma.auditLog.count({ where: { action: 'branding.update' } })
    const saved = await put({
      brandName: '  青岛就业通  ', brandMark: '青',
      filing: { icp: ' 鲁ICP备2099000001号-1 ', icpUrl: 'https://beian.miit.gov.cn/', police: '鲁公网安备37000000000001号', policeUrl: 'https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=37000000000001' },
    })
    c.check('管理员保存 → 200 且已去首尾空白', saved.status === 200 && saved.json.data.brandName === '青岛就业通' && saved.json.data.filing.icp === '鲁ICP备2099000001号-1')
    const nowPublic = await call('GET', '/api/v1/public/brand')
    c.check('保存后 /public/brand 立刻是新值（服务端不缓存）', nowPublic.json.data.brandName === '青岛就业通' && nowPublic.json.data.brandMark === '青')
    const nowProfile = await profileOf(termB, tokenB)
    c.check('保存后已验签终端读到新品牌与新备案',
      nowProfile.json.data.brandName === '青岛就业通' && nowProfile.json.data.filing.icp === '鲁ICP备2099000001号-1' &&
      nowProfile.json.data.filing.policeUrl.startsWith('https://www.beian.gov.cn/'))
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'branding.update' }, orderBy: { createdAt: 'desc' } })
    const payload = JSON.parse(audit.payloadJson) as { before: { brandName: string | null }; after: { brandName: string | null } }
    c.check('审计：谁、改前改后', (await prisma.auditLog.count({ where: { action: 'branding.update' } })) === auditBefore + 1 &&
      audit.actorId === adminId && audit.targetId === 'branding' && payload.before.brandName === null && payload.after.brandName === '青岛就业通')
    const partial = await put({ brandMark: '就' })
    c.check('省略的字段保持不变', partial.json.data.brandName === '青岛就业通' && partial.json.data.brandMark === '就')
    const noop = await put({})
    const auditAfterNoop = await prisma.auditLog.count({ where: { action: 'branding.update' } })
    c.check('空请求不写库不写审计', noop.status === 200 && auditAfterNoop === auditBefore + 2)
    const cleared = await put({ brandName: '   ', brandMark: null, filing: { icp: '', icpUrl: null, police: '  ', policeUrl: '' } })
    c.check('空白 / null 一律清除 → 库存值回到 null', cleared.json.data.brandName === null && cleared.json.data.brandMark === null && cleared.json.data.filing.icp === null)
    const afterClear = await profileOf()
    c.equal('清空后公开接口回到默认', afterClear.json.data, {
      brandName: '职易达', brandMark: '职', logoUrl: null, filing: local.DEFAULT_BRANDING_FILING, location: null, licenseState: null,
    })
    c.check('非管理员 PUT → 403', (await put({ brandName: '偷改' }, partnerToken())).status === 403)
    c.check('非管理员 GET → 403', (await call('GET', '/api/v1/admin/branding', { token: partnerToken() })).status === 403)
    c.check('不带令牌 → 401', (await call('PUT', '/api/v1/admin/branding', { body: { brandName: 'x' } })).status === 401)
    c.check('多余字段 → 400', (await put({ brandName: '甲', extra: 1 })).status === 400)

    // ── 4. 校验 ─────────────────────────────────────────────────────────────
    console.log('\n[4] 校验')
    const code = async (body: unknown) => {
      const r = await put(body)
      return `${r.status}:${r.json.error?.code ?? ''}`
    }
    c.equal('品牌名 13 个字 → 400', await code({ brandName: '一二三四五六七八九十一二三' }), '400:BRAND_NAME_INVALID')
    c.equal('品牌名 12 个字 → 通过', (await put({ brandName: '一二三四五六七八九十一二' })).status, 200)
    c.equal('品牌名含零宽字符 → 400', await code({ brandName: '职易\u200B达' }), '400:BRAND_NAME_INVALID')
    c.equal('品牌名含双向控制字符 → 400', await code({ brandName: '职易\u202E达' }), '400:BRAND_NAME_INVALID')
    c.equal('品牌名含换行 → 400', await code({ brandName: '职易\n达' }), '400:BRAND_NAME_INVALID')
    c.equal('字标 2 个字 → 400', await code({ brandMark: '职易' }), '400:BRAND_MARK_INVALID')
    c.equal('字标 1 个字（emoji 算 1 个）→ 通过', (await put({ brandMark: '🚀' })).status, 200)
    c.equal('备案号超 64 字 → 400', await code({ filing: { icp: '号'.repeat(65) } }), '400:BRAND_FILING_INVALID')
    const urlCases: Array<[string, string]> = [
      ['http 不是 https', 'http://beian.miit.gov.cn/'],
      ['主机不在白名单', 'https://evil.example.com/'],
      ['白名单域名做子域前缀', 'https://beian.miit.gov.cn.evil.example.com/'],
      ['账号口令伪装', 'https://beian.miit.gov.cn@evil.example.com/'],
      ['域名对、但带账号口令', 'https://user:pass@beian.miit.gov.cn/'],
      ['带端口', 'https://beian.miit.gov.cn:8443/'],
      ['javascript 协议', 'javascript:alert(1)'],
      ['协议相对', '//beian.miit.gov.cn/'],
      ['内含空白', 'https://beian.miit.gov.cn/ x'],
      ['超长', 'https://beian.miit.gov.cn/' + 'a'.repeat(520)],
      ['不是链接', '备案查询'],
    ]
    for (const [label, url] of urlCases) {
      c.equal(`备案链接被拒：${label}`, await code({ filing: { icpUrl: url } }), '400:BRAND_FILING_URL_INVALID')
      c.equal(`公安备案链接同样被拒：${label}`, await code({ filing: { policeUrl: url } }), '400:BRAND_FILING_URL_INVALID')
    }
    for (const url of ['https://beian.miit.gov.cn/', 'https://www.beian.gov.cn/portal/index', 'https://beian.mps.gov.cn/#/query/webSearch?code=37021402007308']) {
      c.equal(`备案链接放行：${url}`, (await put({ filing: { icpUrl: url } })).status, 200)
    }
    c.equal('Logo 编号不存在 → 400', await code({ brandLogoAssetId: 'f'.repeat(32) }), '400:BRAND_LOGO_NOT_FOUND')
    c.equal('Logo 编号形状不对 → 400', await code({ brandLogoAssetId: '../../etc/passwd' }), '400:BRAND_LOGO_NOT_FOUND')
    await put({ brandName: null, brandMark: null, filing: { icp: null, icpUrl: null, police: null, policeUrl: null } })

    // ── 5. Logo ─────────────────────────────────────────────────────────────
    console.log('\n[5] Logo 上传与读取')
    const adAssetsBefore = await prisma.adAsset.count()
    const realPng = canvasImage(256, 256, 'image/png')
    const okPng = await upload(realPng)
    c.check('合法 PNG → 201 并返回 assetId / logoUrl / 尺寸', okPng.status === 201 && /^[0-9a-f]{32}$/.test(okPng.json.data?.assetId ?? '') &&
      okPng.json.data.logoUrl === `/api/v1/public/brand-logo/${okPng.json.data.assetId}` && okPng.json.data.width === 256 && okPng.json.data.mimeType === 'image/png')
    const pngId = okPng.json.data.assetId as string
    createdLogoIds.push(pngId)
    const served = await call('GET', okPng.json.data.logoUrl)
    c.check('公开读取：200、image/png、nosniff、可缓存、ETag', served.status === 200 && served.headers.get('content-type') === 'image/png' &&
      served.headers.get('x-content-type-options') === 'nosniff' && (served.headers.get('cache-control') ?? '').includes('max-age') && !!served.headers.get('etag'))
    c.check('公开读取的字节能解码为 256×256', (await decodeSize(served.buffer)).width === 256)
    const notModified = await call('GET', okPng.json.data.logoUrl, { headers: { 'if-none-match': served.headers.get('etag') ?? '' } })
    c.check('带 If-None-Match → 304', notModified.status === 304)
    const okPng2 = await upload(canvasImage(300, 300, 'image/png'))
    c.check('第二张合法 PNG（300×300，后面当平台 Logo 用）→ 201', okPng2.status === 201 && okPng2.json.data.width === 300 && okPng2.json.data.mimeType === 'image/png')
    createdLogoIds.push(okPng2.json.data.assetId)
    c.check('Logo 上传不动待机宣传屏素材表', (await prisma.adAsset.count()) === adAssetsBefore)
    c.check('上传写审计 branding.logo_upload', (await prisma.auditLog.count({ where: { action: 'branding.logo_upload', targetId: 'branding' } })) >= 2)

    const rejectCase = async (label: string, buffer: Buffer, expected: string, name = 'logo.png', type = 'image/png') => {
      const r = await upload(buffer, name, type)
      c.equal(`拒绝：${label}`, `${r.status}:${r.json.error?.code ?? ''}`, `400:${expected}`)
    }
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script></svg>')
    await rejectCase('SVG（扩展名与 Content-Type 都冒充 PNG）', svg, 'BRAND_LOGO_FORMAT_UNSUPPORTED')
    await rejectCase('SVG（老实声明 svg）', svg, 'BRAND_LOGO_FORMAT_UNSUPPORTED', 'logo.svg', 'image/svg+xml')
    await rejectCase('JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]), 'BRAND_LOGO_FORMAT_UNSUPPORTED', 'logo.jpg', 'image/jpeg')
    await rejectCase('GIF', Buffer.from('GIF89a\x01\x00\x01\x00'), 'BRAND_LOGO_FORMAT_UNSUPPORTED', 'logo.gif', 'image/gif')
    await rejectCase('文本冒充图片', Buffer.from('not an image at all'), 'BRAND_LOGO_FORMAT_UNSUPPORTED')
    await rejectCase('空文件', Buffer.alloc(0), 'BRAND_LOGO_EMPTY')
    await rejectCase('超过 512KB', Buffer.concat([buildPng(64, 64), Buffer.alloc(513 * 1024)]), 'BRAND_LOGO_TOO_LARGE')
    await rejectCase('宽高超过 1024（1025×1025）', buildPng(1025, 1025), 'BRAND_LOGO_DIMENSIONS_TOO_LARGE')
    await rejectCase('宽高比不是 1:1（200×100）', buildPng(200, 100), 'BRAND_LOGO_NOT_SQUARE')
    await rejectCase('宽高比刚好越界（111×100）', buildPng(111, 100), 'BRAND_LOGO_NOT_SQUARE')
    await rejectCase('宽高比刚好越界（100×112）', buildPng(100, 112), 'BRAND_LOGO_NOT_SQUARE')
    await rejectCase('PNG 损坏（翻转一个字节）', (() => { const b = Buffer.from(buildPng(64, 64)); b[40]! ^= 0xff; return b })(), 'BRAND_LOGO_CORRUPT')
    await rejectCase('PNG 数据区被改一个字节（结构仍合法，只有块校验 CRC 能发现）', (() => { const b = Buffer.from(buildPng(64, 64)); b[45]! ^= 0xff; return b })(), 'BRAND_LOGO_CORRUPT')
    await rejectCase('PNG 被截断', buildPng(64, 64).subarray(0, 60), 'BRAND_LOGO_CORRUPT')
    await rejectCase('PNG 结尾夹带脚本', Buffer.concat([buildPng(64, 64), Buffer.from('<script>alert(1)</script>')]), 'BRAND_LOGO_CORRUPT')
    await rejectCase('动图 APNG', buildPng(64, 64, { afterIhdr: [pngChunk('acTL', Buffer.alloc(8))] }), 'BRAND_LOGO_ANIMATED')
    await rejectCase('WebP（老实声明 webp，不再收）', canvasImage(64, 64, 'image/webp'), 'BRAND_LOGO_FORMAT_UNSUPPORTED', 'logo.webp', 'image/webp')
    await rejectCase('WebP（扩展名与 Content-Type 都冒充 PNG）', canvasImage(64, 64, 'image/webp'), 'BRAND_LOGO_FORMAT_UNSUPPORTED')
    // 块校验是对的，但图本身不对：旧版只验块结构和 CRC 会放行这两种
    await rejectCase('IDAT 里不是压缩流（块校验仍是对的）', pngFromSpec({ width: 64, height: 64, idat: [Buffer.from('this is not a zlib stream')] }), 'BRAND_LOGO_CORRUPT')
    await rejectCase('IDAT 里压缩流结束后夹带脚本（块校验仍是对的）', pngFromSpec({ width: 64, height: 64, idat: [Buffer.concat([deflateSync(plainRows(64, 64, 32)), Buffer.from('<script>alert(1)</script>')])] }), 'BRAND_LOGO_CORRUPT')
    const huge = await upload(Buffer.concat([buildPng(64, 64), Buffer.alloc(1024 * 1024 + 2048)]))
    c.check(`远超上限的文件（>1MB）被挡在读入阶段：HTTP ${huge.status} ${huge.json.error?.code ?? ''}，不落盘不入库`, huge.status >= 400 && huge.status < 500 && (await prisma.brandLogo.count({ where: { createdBy: adminId } })) === createdLogoIds.length, `${huge.status} ${JSON.stringify(huge.json)}`)
    const missing = await call('POST', '/api/v1/admin/branding/logo', { token: adminToken(), form: new FormData() })
    c.equal('缺少 file 字段 → 400 FILE_MISSING', `${missing.status}:${missing.json.error?.code}`, '400:FILE_MISSING')
    c.check('非管理员上传 → 403', (await upload(realPng, 'logo.png', 'image/png', partnerToken())).status === 403)
    for (const [label, buffer] of [['1024×1024 恰好上限', buildPng(1024, 1024)], ['110×100 比例恰好 1.1', buildPng(110, 100)], ['100×110 比例约 0.909', buildPng(100, 110)]] as const) {
      const r = await upload(buffer)
      c.check(`放行：${label}`, r.status === 201, `${r.status} ${r.json.error?.code}`)
      if (r.status === 201) createdLogoIds.push(r.json.data.assetId)
    }
    // 元数据清洗：文字块、EXIF 被剥掉，画面必需块保留，清洗后仍能解码
    const dirty = buildPng(128, 128, { beforeIend: [pngChunk('tEXt', Buffer.from('Comment\0SECRET-GPS-1234')), pngChunk('eXIf', Buffer.from('Exif\0\0SECRET-EXIF')), pngChunk('tIME', Buffer.alloc(7))] })
    const dirtyUp = await upload(dirty)
    c.check('带文字块 / EXIF 的 PNG 可以上传', dirtyUp.status === 201)
    createdLogoIds.push(dirtyUp.json.data.assetId)
    const dirtyRow = await prisma.brandLogo.findUniqueOrThrow({ where: { id: dirtyUp.json.data.assetId } })
    const dirtyStored = await storage.getObject(dirtyRow.storageKey)
    c.check('落盘的是重编码后的：只剩 IHDR / IDAT / IEND（文字块、EXIF、时间块都没了），也不含秘密字符串',
      pngChunks(dirtyStored).map((ch) => ch.type).join() === 'IHDR,IDAT,IEND' && !dirtyStored.includes('SECRET'))
    c.check('公开读取到的字节就是落盘的重编码文件', (await call('GET', `/api/v1/public/brand-logo/${dirtyUp.json.data.assetId}`)).buffer.equals(dirtyStored))
    c.check('清洗后的 PNG 仍能解码为 128×128', (await decodeSize(dirtyStored)).width === 128)
    // 公开读取只认 Logo 表
    const adId = randomUUID().replace(/-/g, '')
    const adKey = `screensaver/materials/${adId}.png`
    // 待机素材是真有文件的：如果公开读取不只认 Logo 表，这里就会读到 200。
    await storage.putObject(adKey, realPng, 'image/png')
    await prisma.adAsset.create({ data: { id: adId, type: 'image', title: `品牌门禁素材${suffix}`, storageKey: adKey, mimeType: 'image/png', sizeBytes: realPng.length, sha256: 'x'.repeat(8) } })
    for (const [label, id] of [['待机宣传屏素材的编号', adId], ['形状合法但不存在', 'a'.repeat(32)], ['大写十六进制', pngId.toUpperCase()], ['路径穿越', '..%2F..%2Fetc%2Fpasswd'], ['太短', 'abc']] as const) {
      c.check(`brand-logo 读不到：${label}`, (await call('GET', `/api/v1/public/brand-logo/${id}`)).status === 404)
    }
    await prisma.adAsset.delete({ where: { id: adId } })
    await storage.deleteObject(adKey)

    // ── 6. 机构覆盖与终端解析 ───────────────────────────────────────────────
    console.log('\n[6] 机构覆盖只影响该机构的终端')
    await put({ brandName: '平台通用名', brandMark: '平', brandLogoAssetId: createdLogoIds[1]!, filing: { icp: '平台备案号', police: '平台公安备案号' } })
    const orgs = new AdminOrgsService(prisma, app.get(AuditService), redis as unknown as RedisService)
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    const patchOrg = async (orgId: string, body: Record<string, unknown>) => {
      const dto = (await pipe.transform(body, { type: 'body', metatype: UpdateOrgDto })) as UpdateOrgDto
      return orgs.updateOrg(orgId, dto, { userId: adminId, role: 'admin', orgId: null })
    }
    const detailA = await patchOrg(orgA, { brandName: '甲机构品牌', brandMark: '甲', brandLogoAssetId: pngId })
    c.check('机构资料接口接受并回显三项，附 Logo 公开地址', detailA.brandName === '甲机构品牌' && detailA.brandMark === '甲' &&
      detailA.brandLogoAssetId === pngId && detailA.brandLogoUrl === `/api/v1/public/brand-logo/${pngId}`)
    const orgAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'org.update', targetId: orgA }, orderBy: { createdAt: 'desc' } })
    c.check('机构品牌修改进审计（changedFields 含三项）', ['brandName', 'brandMark', 'brandLogoAssetId'].every((f) => (JSON.parse(orgAudit.payloadJson) as { changedFields: string[] }).changedFields.includes(f)))
    await patchOrg(orgC, { brandName: '丙机构品牌' })
    const profA = (await profileOf(termA, tokenA)).json.data
    c.check('甲机构终端：机构品牌 + 机构 Logo，点位取 locationLabel', profA.brandName === '甲机构品牌' && profA.brandMark === '甲' &&
      profA.logoUrl === `/api/v1/public/brand-logo/${pngId}` && profA.location === LOC_A)
    const profB = (await profileOf(termB, tokenB)).json.data
    c.check('乙机构（没覆盖）终端：平台品牌 + 平台 Logo，不受甲机构影响', profB.brandName === '平台通用名' && profB.brandMark === '平' &&
      profB.logoUrl === `/api/v1/public/brand-logo/${createdLogoIds[1]}` && profB.location === LOC_B)
    const profC = (await profileOf(termC, tokenC)).json.data
    c.check('丙机构只覆盖了名字：名字用机构的，字标与 Logo 逐项回退到平台', profC.brandName === '丙机构品牌' && profC.brandMark === '平' &&
      profC.logoUrl === `/api/v1/public/brand-logo/${createdLogoIds[1]}` && profC.location === null)
    const profN = (await profileOf(termN, tokenN)).json.data
    c.check('没绑机构的终端：平台品牌，点位取自己的 locationLabel', profN.brandName === '平台通用名' && profN.location === `无机构点位${suffix}`)
    c.check('备案只按平台走，机构覆盖不改备案', [profA, profB, profC, profN].every((p) => p.filing.icp === '平台备案号' && p.filing.police === '平台公安备案号'))
    c.check('/public/brand 不带机构：仍是平台品牌', (await call('GET', '/api/v1/public/brand')).json.data.brandName === '平台通用名')
    for (const [label, body] of [['品牌名 13 字', { brandName: '一二三四五六七八九十一二三' }], ['字标 2 字', { brandMark: '甲乙' }], ['Logo 不存在', { brandLogoAssetId: 'e'.repeat(32) }], ['Logo 编号形状不对', { brandLogoAssetId: 'x' }]] as const) {
      const failed = await patchOrg(orgA, body).then(() => 'ok', (e: { getResponse?: () => { error?: { code?: string } } }) => e.getResponse?.().error?.code ?? 'error')
      c.check(`机构品牌校验：${label}被拒`, failed !== 'ok', String(failed))
    }
    const cleanedA = await patchOrg(orgA, { brandName: '', brandMark: null, brandLogoAssetId: '  ' })
    c.check('机构覆盖清空 → 三项回 null', cleanedA.brandName === null && cleanedA.brandMark === null && cleanedA.brandLogoAssetId === null)
    const profA2 = (await profileOf(termA, tokenA)).json.data
    c.check('清空后甲机构终端回到平台品牌', profA2.brandName === '平台通用名' && profA2.brandMark === '平')
    await patchOrg(orgA, { name: NAME_A + '改' })
    c.check('只改机构名不动品牌覆盖三项（省略 = 不改）', (await profileOf(termA, tokenA)).json.data.brandName === '平台通用名')
    await patchOrg(orgA, { brandName: '甲机构品牌' })
    c.check('机构覆盖回写后再次生效', (await profileOf(termA, tokenA)).json.data.brandName === '甲机构品牌')
    // Logo 引用悬空（编号合法但对象不存在）→ 回退字标，不报错
    await prisma.organization.update({ where: { id: orgA }, data: { brandLogoAssetId: 'c'.repeat(32) } })
    const dangling = (await profileOf(termA, tokenA)).json.data
    c.check('机构 Logo 悬空 → 逐项回退（平台 Logo），不报错', dangling.logoUrl === `/api/v1/public/brand-logo/${createdLogoIds[1]}`)
    await put({ brandLogoAssetId: null })
    c.check('平台 Logo 清除且机构 Logo 悬空 → logoUrl 为 null（前端回退字标）', (await profileOf(termA, tokenA)).json.data.logoUrl === null)

    // ── 6b. 授权状态随时间变化（kiosk-profile 的 licenseState）──────────────
    console.log('\n[6b] kiosk-profile 的授权状态')
    const orgL = `org_br_l_${suffix}`
    const termL = `t_br_l_${suffix}`
    await prisma.organization.create({ data: { id: orgL, name: `品牌授权机构${suffix}`, type: 'public_employment_service', licenseMode: 'required' } })
    await prisma.terminal.create({ data: mk(termL, orgL, `授权点位${suffix}`, null) })
    const T0 = Date.parse('2026-11-01T00:00:00.000Z')
    const DAY = 86_400_000
    await prisma.license.create({ data: {
      orgId: orgL, licenseeName: '品牌门禁被授权企业', creditCode: '91330100799655058B', contractNo: `HT-BR-${suffix}`,
      startsAt: new Date(T0), endsAt: new Date(T0 + 50 * DAY), graceDays: 5, terminalQuota: 2, createdBy: adminId,
    } })
    setLicenseClock(() => new Date(T0 + 40 * DAY))
    const tokenL = await sessionOf(termL)
    const stateAt = async (days: number) => {
      setLicenseClock(() => new Date(T0 + days * DAY))
      return (await profileOf(termL, tokenL)).json.data.licenseState
    }
    c.equal('ok / grace / inactive 随时间变化（到期当刻进宽限，宽限结束当刻锁机）', [await stateAt(40), await stateAt(50), await stateAt(54.9), await stateAt(55)], ['ok', 'grace', 'grace', 'inactive'])
    c.check('锁机时仍给品牌与点位（一体机要用它显示「暂时不能用」）', (await profileOf(termL, tokenL)).json.data.location === `授权点位${suffix}`)
    c.check('profile 里只有状态，没有到期日 / 台数 / 合同等商务细节', !/endsAt|expire|quota|startsAt|contract|credit|licensee/i.test(JSON.stringify((await profileOf(termL, tokenL)).json.data)))
    c.equal('未验签的请求拿不到授权状态', (await profileOf(termL, 'x'.repeat(40))).json.data.licenseState, null)
    setLicenseClock(null)
    await prisma.license.deleteMany({ where: { orgId: orgL } })
    await prisma.terminal.deleteMany({ where: { id: termL } })
    await prisma.organization.deleteMany({ where: { id: orgL } })

    // ── 7. 未验签 / 伪造 / 不泄露 ───────────────────────────────────────────
    console.log('\n[7] 公开接口防枚举、不泄露')
    const forged = await profileOf(termA, 'x'.repeat(43))
    const mismatched = await profileOf(termB, tokenA)
    const unknown = await profileOf('t_unknown_' + suffix, tokenA)
    const tokenOnly = await profileOf(undefined, tokenA)
    const idOnly = await profileOf(termA)
    const hiddenWords = [NAME_A, LOC_A, '甲区一号机', orgA, orgB, orgC, termA, termB, termC, `BR-${termA.slice(-12)}`, '甲机构品牌', '丙机构品牌']
    for (const [label, r] of [['伪造的会话令牌', forged], ['令牌与终端号不匹配', mismatched], ['未知终端', unknown], ['只带令牌', tokenOnly], ['只带终端号', idOnly]] as const) {
      const body = JSON.stringify(r.json.data)
      c.check(`${label}：只拿平台默认，没有点位 / 授权状态，且不含任何机构或终端信息`,
        r.status === 200 && r.json.data.location === null && r.json.data.licenseState === null && r.json.data.brandName === '平台通用名' &&
        hiddenWords.every((word) => !body.includes(word)), body)
    }
    for (const [label, r, keys] of [['kiosk-profile（未验签）', anonymous, KIOSK_PROFILE_KEYS], ['kiosk-profile（已验签）', await profileOf(termA, tokenA), KIOSK_PROFILE_KEYS], ['public/brand', await call('GET', '/api/v1/public/brand'), PUBLIC_BRAND_KEYS]] as const) {
      c.equal(`${label} 字段集合固定`, Object.keys(r.json.data).sort(), [...keys].sort())
    }
    const verifiedBody = JSON.stringify((await profileOf(termA, tokenA)).json.data)
    c.check('已验签响应也不含机构名 / 机构号 / 终端号 / 终端编码', ![NAME_A, orgA, orgB, termA, `BR-${termA.slice(-12)}`].some((word) => verifiedBody.includes(word)), verifiedBody)

    // ── 8. Redis 暂不可用 ──────────────────────────────────────────────────
    console.log('\n[8] Redis 暂不可用')
    redis.down = true
    resetRedisCooldownForTests()
    const outage = await profileOf(termA, tokenA)
    c.equal('已验签请求遇到 Redis 不可用 → 503（一体机据此保持上次状态，不闪回默认）', `${outage.status}:${outage.json.error?.code}`, '503:TERMINAL_SESSION_RETRYABLE')
    const outageAnonymous = await profileOf()
    c.check('不带验签头的请求不依赖 Redis，照常 200', outageAnonymous.status === 200 && outageAnonymous.json.data.brandName === '平台通用名')
    redis.down = false
    resetRedisCooldownForTests()
    c.check('Redis 恢复后已验签请求恢复正常', (await profileOf(termA, tokenA)).status === 200)
  } finally {
    redis.down = false
    resetRedisCooldownForTests()
    await prisma.platformSetting.deleteMany({ where: { key: { in: SETTING_KEYS } } }).catch(() => undefined)
    if (settingsBefore.length > 0) {
      await prisma.platformSetting.createMany({ data: settingsBefore.map(({ key, value, updatedBy }) => ({ key, value, updatedBy })) }).catch(() => undefined)
    }
    for (const id of createdLogoIds) {
      const row = await prisma.brandLogo.findUnique({ where: { id } }).catch(() => null)
      if (row) await storage.deleteObject(row.storageKey).catch(() => undefined)
      await prisma.brandLogo.deleteMany({ where: { id } }).catch(() => undefined)
    }
    await prisma.terminal.deleteMany({ where: { id: { in: [termA, termB, termC, termN] } } }).catch(() => undefined)
    await prisma.user.deleteMany({ where: { id: { in: [adminId, partnerId] } } }).catch(() => undefined)
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB, orgC] } } }).catch(() => undefined)
    await app.close()
  }
  c.finish('verify:branding')
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
