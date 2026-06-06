import assert from 'node:assert/strict'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
import { ContentService } from '../src/content/content.service'

/**
 * 外部视频直链 service 层集成验证(打 dev.db,自清理)。
 *
 * 证明:
 *   1. createExternalAsset 落库 source='external_url' + externalUrl
 *   2. 非法 URL → 抛 BadRequest(HTTP 400)
 *   3. getKioskPlaylist 对外链素材直接返回 externalUrl 作为 url(不签名)
 *   4. deleteAsset 对外链素材软删且不触碰物理存储(不调用 StorageService)
 *
 * 运行前确保 DATABASE_URL 指向 dev.db、FILE_SIGNING_SECRET 已设(≥32 字符)。
 * StorageService 默认 driver=local,外链路径不会触达它(create/delete 均跳过)。
 */

process.env['DATABASE_URL'] ??= 'file:./prisma/dev.db'
process.env['FILE_SIGNING_SECRET'] ??= 'verify-external-video-signing-secret-min-32-chars'

const TERMINAL_ID = 'VERIFY-EXT-VIDEO-TERMINAL'
const EXT_URL = 'https://cdn.example.com/verify/promo.mp4'

async function main(): Promise<void> {
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const content = new ContentService(prisma, new StorageService())

  let assetId: string | null = null
  let playlistId: string | null = null

  try {
    // 1. 创建外链素材(durationSec=600 > 上传视频默认 120s 上限,证明外链放宽到 1800s)
    const asset = await content.createExternalAsset({
      url: EXT_URL,
      title: '验证用外链视频',
      durationSec: 600,
      createdBy: null,
    })
    assetId = asset.id
    assert.equal(asset.source, 'external_url', 'source should be external_url')
    assert.equal(asset.type, 'video', 'type should be video')
    assert.equal(asset.externalUrl, EXT_URL, 'externalUrl should round-trip')
    assert.equal(asset.mimeType, 'video/mp4')
    assert.equal(asset.durationSec, 600, 'external durationSec should allow >120s (up to 1800)')
    assert.equal(asset.previewUrl, EXT_URL, 'preview of external asset should be its externalUrl')

    // 1b. 超过 1800s 上限 → 400
    await assert.rejects(
      () => content.createExternalAsset({ url: EXT_URL, title: 'too long', durationSec: 1801, createdBy: null }),
      (err: unknown) => {
        const status = (err as { getStatus?: () => number }).getStatus?.()
        assert.equal(status, 400, 'durationSec > 1800 should yield HTTP 400')
        return true
      },
    )

    // 2. 非法 URL → 400
    await assert.rejects(
      () => content.createExternalAsset({ url: 'https://192.168.1.5/a.mp4', title: 'x', createdBy: null }),
      (err: unknown) => {
        const status = (err as { getStatus?: () => number }).getStatus?.()
        assert.equal(status, 400, 'private host should yield HTTP 400')
        return true
      },
    )

    // 3. 加入播放方案 + 绑定终端 + 拉取 Kiosk 列表
    const playlist = await content.createPlaylist({
      name: '验证外链方案',
      items: [{ assetId: asset.id, order: 0, enabled: true }],
      createdBy: null,
    })
    playlistId = playlist.id

    await content.saveTerminalConfig(
      TERMINAL_ID,
      { enabled: true, idleTimeoutSec: 60, playlistId: playlist.id },
      null,
    )

    const kiosk = await content.getKioskPlaylist(TERMINAL_ID)
    assert.equal(kiosk.enabled, true, 'kiosk playlist should be enabled with one external item')
    assert.equal(kiosk.items.length, 1)
    const [item] = kiosk.items
    assert.ok(item)
    assert.equal(item.type, 'video')
    assert.equal(item.url, EXT_URL, 'kiosk should serve the raw externalUrl, not a signed path')
    assert.ok(!item.url.includes('/ad-assets/'), 'external url must not be signed content path')

    // 4. 删除外链素材(软删,不触物理存储)
    const deleted = await content.deleteAsset(asset.id)
    assert.equal(deleted.status, 'disabled')

    console.log('verify:external-video:e2e passed')
  } finally {
    // 自清理:硬删测试行,保持 dev.db 干净
    await prisma.terminalScreensaverConfig.deleteMany({ where: { terminalId: TERMINAL_ID } }).catch(() => {})
    if (playlistId) await prisma.adPlaylist.delete({ where: { id: playlistId } }).catch(() => {})
    if (assetId) await prisma.adAsset.delete({ where: { id: assetId } }).catch(() => {})
    await prisma.onModuleDestroy()
  }
}

main().catch((err) => {
  console.error('verify:external-video:e2e FAILED')
  console.error(err)
  process.exit(1)
})
