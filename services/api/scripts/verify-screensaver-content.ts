/**
 * 待机宣传屏内容 service 级 E2E 验证（P1-B② 守门）。
 *
 * 覆盖（对应验收口径）：
 *   - AdAsset：上传素材（魔数校验 + 落盘读回）、外链素材（白名单 + 私网/非直链拦截）、
 *     启用/禁用、软删（默认列表不含 / includeDeleted 才含）。
 *   - AdPlaylist / AdPlaylistItem：方案创建、整体替换、排序（order）。
 *   - TerminalScreensaverConfig：终端绑定（无方案不允许 enabled、绑定后可启用）。
 *   - ⭐getKioskPlaylist（核心守门）：config 禁用 / playlist 非 active / item 禁用 /
 *     asset 非 active / 软删 / 外链缺 URL / 无可播素材 → 都不进可播列表；
 *     上传素材回签名 URL、外链素材回直链，逐一断言区分。
 *
 * 隔离：临时 SQLite（DATABASE_URL 由 runner/CI 提供，脚本只创建+清理自身夹具，安全）
 *   + 临时 FILE_STORAGE_DIR（local 存储，finally 清理）。不起 HTTP server。
 * 运行：pnpm --filter @ai-job-print/api verify:screensaver-content
 */
import 'dotenv/config'
import { randomBytes } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// 隔离环境——必须在构造 StorageService / 调用签名之前设好。
process.env['FILE_SIGNING_SECRET'] ||= 'verify-screensaver-file-signing-secret-0123456789ab'
process.env['FILE_STORAGE_DRIVER'] = 'local' // 强制 local，绝不触达 COS
process.env['ALLOWED_EXTERNAL_VIDEO_HOSTS'] = 'cdn.example.com' // 强制脚本自控白名单，测试确定性
const STORAGE_DIR = mkdtempSync(join(tmpdir(), 'vsc-storage-'))
process.env['FILE_STORAGE_DIR'] = STORAGE_DIR

import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
import { ContentService } from '../src/content/content.service'
import { verifyAdAssetSignature } from '../src/content/content-signing'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望抛 ${code}，但未抛`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code}，实际: ${c ?? (e as Error).message}`)
  }
}

// 合法 PNG 文件头（validateMedia 只校验魔数，足够通过）。
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)])

async function main() {
  console.log('\n=== 待机宣传屏内容 service 级 E2E 验证（P1-B② 守门）===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  const content = new ContentService(prisma, storage)

  const suffix = randomBytes(6).toString('hex')
  const terminalId = `term_vsc_${suffix}`
  const terminalCode = `VSC-${suffix}`
  const assetIds: string[] = []
  const playlistIds: string[] = []

  async function cleanup() {
    await prisma.terminalScreensaverConfig.deleteMany({ where: { terminalId: { in: [terminalId, terminalCode] } } })
    if (playlistIds.length) {
      await prisma.adPlaylistItem.deleteMany({ where: { playlistId: { in: playlistIds } } })
      await prisma.adPlaylist.deleteMany({ where: { id: { in: playlistIds } } })
    }
    if (assetIds.length) await prisma.adAsset.deleteMany({ where: { id: { in: assetIds } } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
  }

  const track = <T extends { id: string }>(a: T, bucket: string[]): T => { bucket.push(a.id); return a }

  try {
    await cleanup()
    await prisma.terminal.create({ data: { id: terminalId, terminalCode, agentToken: `vsc-${suffix}`, deviceFingerprint: `fp-${suffix}` } })
    pass('终端夹具已创建')

    // ── 1. 上传素材 ───────────────────────────────────────────────────
    const img = track(await content.createAsset({ buffer: PNG, mimeType: 'image/png', title: '宣传图', durationSec: 8, createdBy: 'admin' }), assetIds)
    if (img.status === 'active' && img.source === 'uploaded' && img.type === 'image') pass('1a. 上传素材 → AdAsset(active/uploaded/image)')
    else fail(`1a. 上传异常: ${JSON.stringify(img)}`)
    const readBack = await content.readAssetContent(img.id)
    if (readBack.buffer.length === PNG.length && readBack.mimeType === 'image/png') pass('1b. readAssetContent 读回素材内容（local 存储落盘）')
    else fail(`1b. 读回异常: len=${readBack.buffer.length}`)
    await expectCode(
      () => content.createAsset({ buffer: Buffer.from('not-a-real-image'), mimeType: 'image/png', title: 'x', createdBy: null }),
      'AD_ASSET_CONTENT_MISMATCH',
      '1c. 魔数与声明类型不符 → 拒（AD_ASSET_CONTENT_MISMATCH）',
    )

    // 备用上传素材：禁用 / 软删 / item禁用 各一
    const imgDisabled = track(await content.createAsset({ buffer: PNG, mimeType: 'image/png', title: '将禁用', createdBy: null }), assetIds)
    const imgDeleted = track(await content.createAsset({ buffer: PNG, mimeType: 'image/png', title: '将软删', createdBy: null }), assetIds)
    const imgItemOff = track(await content.createAsset({ buffer: PNG, mimeType: 'image/png', title: 'item禁用', createdBy: null }), assetIds)

    // ── 2. 外链素材 + 白名单 ──────────────────────────────────────────
    const ext = track(await content.createExternalAsset({ url: 'https://cdn.example.com/promo.mp4', title: '外链视频', durationSec: 30, createdBy: 'admin' }), assetIds)
    if (ext.source === 'external_url' && ext.type === 'video') pass('2a. 外链素材（白名单内 https mp4 直链）→ external_url')
    else fail(`2a. 外链异常: ${JSON.stringify(ext)}`)
    await expectCode(() => content.createExternalAsset({ url: 'https://not-allowed.example.org/x.mp4', title: 'x', createdBy: null }), 'EXTERNAL_VIDEO_URL_HOST_NOT_ALLOWED', '2b. 非白名单 host → 拒')
    await expectCode(() => content.createExternalAsset({ url: 'https://192.168.1.10/x.mp4', title: 'x', createdBy: null }), 'EXTERNAL_VIDEO_URL_PRIVATE_HOST', '2c. 私网/内网 host → 拒')
    await expectCode(() => content.createExternalAsset({ url: 'http://cdn.example.com/x.mp4', title: 'x', createdBy: null }), 'EXTERNAL_VIDEO_URL_NOT_HTTPS', '2d. 非 HTTPS → 拒')
    await expectCode(() => content.createExternalAsset({ url: 'https://cdn.example.com/watch?v=abc', title: 'x', createdBy: null }), 'EXTERNAL_VIDEO_URL_NOT_DIRECT', '2e. 非 mp4/webm 直链（网页）→ 拒')
    await expectCode(() => content.readAssetContent(ext.id), 'AD_ASSET_NO_LOCAL_CONTENT', '2f. 外链素材无本地内容 → readAssetContent 404')

    // 脏外链素材（externalUrl 置空）：用于验证 getKioskPlaylist 剔除「外链缺 URL」
    const extDirty = track(await content.createExternalAsset({ url: 'https://cdn.example.com/dirty.mp4', title: '脏外链', createdBy: null }), assetIds)

    // ── 3. 播放方案 + 排序 ────────────────────────────────────────────
    const p1 = await content.createPlaylist({
      name: '方案A', status: 'active', createdBy: 'admin',
      items: [
        { assetId: ext.id, order: 1, enabled: true },
        { assetId: img.id, order: 0, enabled: true },
        { assetId: imgItemOff.id, order: 2, enabled: false }, // item 禁用
        { assetId: imgDisabled.id, order: 3, enabled: true },
        { assetId: imgDeleted.id, order: 4, enabled: true },
      ],
    })
    playlistIds.push(p1.id)
    const p1Order = p1.items.map((it) => it.assetId)
    if (p1Order[0] === img.id && p1Order[1] === ext.id && p1Order[2] === imgItemOff.id) pass('3. 播放方案 items 按 order 升序保序')
    else fail(`3. 排序异常: ${JSON.stringify(p1Order)}`)

    const p2 = await content.createPlaylist({ name: '方案B(脏外链)', status: 'active', createdBy: null, items: [{ assetId: extDirty.id, order: 0, enabled: true }] })
    playlistIds.push(p2.id)

    // ── 4. 启用/禁用 + 软删 + 脏数据制造 ─────────────────────────────
    const upd = await content.updateAsset(imgDisabled.id, { status: 'disabled' })
    if (upd.status === 'disabled') pass('4a. updateAsset → 禁用（status=disabled）')
    else fail(`4a. 禁用异常: ${upd.status}`)
    const del = await content.deleteAsset(imgDeleted.id)
    if (del.status === 'disabled') pass('4b. deleteAsset → 软删（status=disabled，deletedAt 置位）')
    else fail(`4b. 软删异常: ${JSON.stringify(del)}`)
    const listDefault = await content.listAssets()
    const listAll = await content.listAssets({ includeDeleted: true })
    if (!listDefault.some((a) => a.id === imgDeleted.id) && listAll.some((a) => a.id === imgDeleted.id)) pass('4c. 软删素材：默认列表不含、includeDeleted 才含')
    else fail('4c. 软删列表过滤异常')
    // 制造脏外链（externalUrl=null），模拟脏数据
    await prisma.adAsset.update({ where: { id: extDirty.id }, data: { externalUrl: null } })

    // ── 5. 终端绑定 ───────────────────────────────────────────────────
    const cfgNoPlaylist = await content.saveTerminalConfig(terminalId, { enabled: true, idleTimeoutSec: 200, playlistId: null }, 'admin')
    if (cfgNoPlaylist.enabled === false) pass('5a. 无绑定方案时 enabled 强制为 false（不让终端拉空）')
    else fail(`5a. 无方案应 enabled=false，实际 ${cfgNoPlaylist.enabled}`)
    const cfg = await content.saveTerminalConfig(terminalId, { enabled: true, idleTimeoutSec: 200, playlistId: p1.id }, 'admin')
    if (cfg.enabled === true && cfg.playlistId === p1.id && cfg.idleTimeoutSec === 200) pass('5b. 绑定方案 + 启用 → enabled=true，绑定正确')
    else fail(`5b. 绑定异常: ${JSON.stringify(cfg)}`)

    // ── 6. ⭐getKioskPlaylist 可用内容过滤（核心）─────────────────────
    const kp = await content.getKioskPlaylist(terminalId)
    // 只 img(签名URL) + ext(直链) 可播；imgItemOff(item禁用)/imgDisabled(asset禁用)/imgDeleted(软删) 全剔
    if (kp.enabled === true && kp.items.length === 2 && kp.items[0].id === img.id && kp.items[1].id === ext.id) {
      pass('6a. 可播过滤 + 保序：item禁用/asset禁用/软删 均剔除，仅 [img, ext] 保序')
    } else fail(`6a. 可播过滤异常: enabled=${kp.enabled} items=${JSON.stringify(kp.items.map((i) => i.id))}`)
    // 上传素材 → 签名 URL（验签通过）
    const u = new URL(kp.items[0].url, 'http://internal.local')
    const sigOk = /^\/api\/v1\/ad-assets\/.+\/content$/.test(u.pathname) &&
      verifyAdAssetSignature(img.id, u.searchParams.get('expires') ?? '', u.searchParams.get('sig') ?? '')
    if (sigOk) pass('6b. 上传素材 → 签名内容 URL（verifyAdAssetSignature 通过）')
    else fail(`6b. 上传素材签名 URL 异常: ${kp.items[0].url}`)
    // 外链素材 → 直链
    if (kp.items[1].url === 'https://cdn.example.com/promo.mp4') pass('6c. 外链素材 → HTTPS 直链（非签名端点）')
    else fail(`6c. 外链直链异常: ${kp.items[1].url}`)

    // config 禁用 → enabled:false, items:[]
    await content.saveTerminalConfig(terminalId, { enabled: false, idleTimeoutSec: 200, playlistId: p1.id }, 'admin')
    const kpOff = await content.getKioskPlaylist(terminalId)
    if (kpOff.enabled === false && kpOff.items.length === 0) pass('6d. config 禁用 → 不进屏保（enabled:false, items:[]）')
    else fail(`6d. config 禁用异常: ${JSON.stringify(kpOff)}`)

    // playlist 非 active → enabled:false
    await content.saveTerminalConfig(terminalId, { enabled: true, idleTimeoutSec: 200, playlistId: p1.id }, 'admin')
    await content.updatePlaylist(p1.id, { name: '方案A', status: 'disabled', items: [{ assetId: img.id, order: 0, enabled: true }] })
    const kpInactive = await content.getKioskPlaylist(terminalId)
    if (kpInactive.enabled === false) pass('6e. playlist 非 active → enabled:false')
    else fail(`6e. playlist 非 active 异常: ${JSON.stringify(kpInactive)}`)

    // 外链缺 URL + 无可播素材 → enabled:false（绑定只含脏外链的 p2）
    await content.saveTerminalConfig(terminalId, { enabled: true, idleTimeoutSec: 200, playlistId: p2.id }, 'admin')
    const kpDirty = await content.getKioskPlaylist(terminalId)
    if (kpDirty.enabled === false && kpDirty.items.length === 0) pass('6f. 外链缺 URL 被剔 + 无可播素材 → enabled:false（防黑屏）')
    else fail(`6f. 脏外链/无可播异常: ${JSON.stringify(kpDirty)}`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
    rmSync(STORAGE_DIR, { recursive: true, force: true })
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  try { rmSync(STORAGE_DIR, { recursive: true, force: true }) } catch { /* ignore */ }
  process.exit(1)
})
