/**
 * 真实 COS 连通性验证(put → head → get → delete)。
 *
 * 仅当配置了 TENCENT_COS_SECRET_ID / SECRET_KEY / BUCKET / REGION 时运行;
 * 否则打印 SKIPPED 并以 0 退出(CI / 无凭证环境不阻塞)。
 *
 * 用一个一次性 tmp/ objectKey 实测 COS 预签名 URL 的 PUT/HEAD/GET/DELETE,
 * 跑完删除,不残留。绝不打印 SecretId / SecretKey。
 *
 * Run: pnpm --filter @ai-job-print/api verify:cos:live
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { CosStorageBackend } from '../src/storage/cos-storage.backend'

async function main() {
  const secretId = process.env['TENCENT_COS_SECRET_ID']?.trim()
  const secretKey = process.env['TENCENT_COS_SECRET_KEY']?.trim()
  const bucket = process.env['TENCENT_COS_BUCKET']?.trim()
  const region = process.env['TENCENT_COS_REGION']?.trim()

  if (!secretId || !secretKey || !bucket || !region) {
    console.log('SKIPPED: 未配置 TENCENT_COS_* 凭证,跳过真实 COS 连通性验证。')
    console.log('  要跑此项:在 services/api/.env 填 TENCENT_COS_SECRET_ID/SECRET_KEY/BUCKET/REGION 后重试。')
    process.exit(0)
  }

  console.log(`\n=== 真实 COS 连通性验证 (bucket=${bucket} region=${region}) ===`)
  const cos = new CosStorageBackend({ secretId, secretKey, bucket, region })
  const objectKey = `tmp/uploads/cos-live-verify/${randomUUID().replace(/-/g, '')}.txt`
  const payload = Buffer.from(`cos-live-verify ${new Date().toISOString()}`)

  try {
    await cos.putObject(objectKey, payload, 'text/plain')
    console.log(`  PASS putObject → ${objectKey}`)

    const head = await cos.headObject(objectKey)
    if (head && head.sizeBytes === payload.length) console.log(`  PASS headObject size=${head.sizeBytes}`)
    else throw new Error(`headObject 不匹配: ${JSON.stringify(head)}`)

    const got = await cos.getObject(objectKey)
    if (got.equals(payload)) console.log('  PASS getObject 字节一致')
    else throw new Error('getObject 字节不一致')

    const dl = cos.getDownloadUrl({ objectKey, fileId: 'live', filename: 'live.txt', mimeType: 'text/plain', ttlSeconds: 300, disposition: 'attachment' })
    const res = await fetch(dl.url)
    if (res.ok && (await res.text()) === payload.toString()) console.log('  PASS 预签名下载 URL 可直连')
    else throw new Error(`预签名下载失败: ${res.status}`)

    await cos.deleteObject(objectKey)
    const headAfter = await cos.headObject(objectKey)
    if (headAfter === null) console.log('  PASS deleteObject 后对象已不存在')
    else throw new Error('删除后对象仍存在')

    console.log('\nALL PASS (真实 COS)')
  } catch (err) {
    // 失败时尽力清理
    await cos.deleteObject(objectKey).catch(() => undefined)
    throw err
  }
}

main().catch((error: unknown) => {
  console.error('\nFAIL:', (error as Error).message)
  process.exit(1)
})
