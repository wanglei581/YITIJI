/** 真实 BOS 连通性验证：put → head → get → delete。 */
import 'dotenv/config'
import assert from 'assert/strict'
import { randomUUID } from 'crypto'
import { BosStorageBackend } from '../src/storage/bos-storage.backend'

async function main(): Promise<void> {
  const accessKeyId = process.env['BAIDU_BOS_ACCESS_KEY_ID']?.trim()
  const secretAccessKey = process.env['BAIDU_BOS_SECRET_ACCESS_KEY']?.trim()
  const bucket = process.env['BAIDU_BOS_BUCKET']?.trim()
  const region = process.env['BAIDU_BOS_REGION']?.trim()
  const endpoint = process.env['BAIDU_BOS_ENDPOINT']?.trim()
  if (!accessKeyId || !secretAccessKey || !bucket || !region || !endpoint) {
    console.log('SKIPPED: 未配置完整 BAIDU_BOS_*，跳过真实 BOS 连通性验证。')
    return
  }

  const backend = new BosStorageBackend({ accessKeyId, secretAccessKey, bucket, region, endpoint })
  const key = `tmp/verify-bos/${randomUUID()}.txt`
  const body = Buffer.from(`verify-bos-${randomUUID()}`)
  let uploaded = false
  try {
    const put = await backend.putObject(key, body, 'text/plain')
    uploaded = true
    assert.equal(put.sizeBytes, body.length)
    const head = await backend.headObject(key)
    assert.equal(head?.sizeBytes, body.length)
    assert.deepEqual(await backend.getObject(key), body)
    console.log(`PASS: 真实 BOS 连通性验证通过（bucket=${bucket}, region=${region}）`)
  } finally {
    if (uploaded) await backend.deleteObject(key)
  }
}

main().catch((error) => {
  console.error(`FAIL: 真实 BOS 连通性验证失败：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
