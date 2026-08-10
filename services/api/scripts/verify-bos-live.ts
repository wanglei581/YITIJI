/** 真实 BOS 连通性验证：put → head → get → delete。 */
import 'dotenv/config'
import assert from 'assert/strict'
import { randomUUID } from 'crypto'
import {
  BosStorageBackend,
  type BosBackendConfig,
} from '../src/storage/bos-storage.backend'

const REQUIRED_BOS_KEYS = [
  'BAIDU_BOS_ACCESS_KEY_ID',
  'BAIDU_BOS_SECRET_ACCESS_KEY',
  'BAIDU_BOS_BUCKET',
  'BAIDU_BOS_REGION',
  'BAIDU_BOS_ENDPOINT',
] as const

type BosLiveVerifyTarget = 'preprod' | 'production'

export function requireBosLiveConfig(env: NodeJS.ProcessEnv = process.env): {
  config: BosBackendConfig
  target: BosLiveVerifyTarget
} {
  if (env['BOS_LIVE_VERIFY_ENABLED'] !== 'true') {
    throw new Error('BOS_LIVE_VERIFY_NOT_AUTHORIZED: 必须显式设置 BOS_LIVE_VERIFY_ENABLED=true')
  }

  const target = env['BOS_LIVE_VERIFY_TARGET']?.trim()
  if (target !== 'preprod' && target !== 'production') {
    throw new Error('BOS_LIVE_VERIFY_TARGET_INVALID: 必须显式设置 preprod 或 production')
  }

  const missing = REQUIRED_BOS_KEYS.filter((key) => !env[key]?.trim())
  if (missing.length > 0) {
    throw new Error(`BOS_LIVE_CONFIG_MISSING: ${missing.join(', ')}`)
  }

  const endpoint = env['BAIDU_BOS_ENDPOINT']!.trim()
  let parsedEndpoint: URL
  try {
    parsedEndpoint = new URL(endpoint)
  } catch {
    throw new Error('BOS_LIVE_ENDPOINT_INVALID: 必须使用官方 HTTPS regional endpoint')
  }
  if (
    parsedEndpoint.protocol !== 'https:' ||
    parsedEndpoint.username ||
    parsedEndpoint.password ||
    !/(^|\.)bcebos\.com$/i.test(parsedEndpoint.hostname) ||
    parsedEndpoint.port ||
    (parsedEndpoint.pathname !== '/' && parsedEndpoint.pathname !== '') ||
    parsedEndpoint.search ||
    parsedEndpoint.hash
  ) {
    throw new Error('BOS_LIVE_ENDPOINT_INVALID: 必须使用官方 HTTPS regional endpoint')
  }

  return {
    target,
    config: {
      accessKeyId: env['BAIDU_BOS_ACCESS_KEY_ID']!.trim(),
      secretAccessKey: env['BAIDU_BOS_SECRET_ACCESS_KEY']!.trim(),
      bucket: env['BAIDU_BOS_BUCKET']!.trim(),
      region: env['BAIDU_BOS_REGION']!.trim(),
      endpoint,
    },
  }
}

async function main(): Promise<void> {
  const { config, target } = requireBosLiveConfig()
  const backend = new BosStorageBackend(config)
  const key = `tmp/verify-bos/${randomUUID()}.txt`
  const body = Buffer.from(`verify-bos-${randomUUID()}`)
  let operationError: unknown
  try {
    const put = await backend.putObject(key, body, 'text/plain')
    assert.equal(put.sizeBytes, body.length)
    const head = await backend.headObject(key)
    assert.equal(head?.sizeBytes, body.length)
    assert.deepEqual(await backend.getObject(key), body)
  } catch (error) {
    operationError = error
  }

  let cleanupError: unknown
  try {
    await backend.deleteObject(key)
    assert.equal(await backend.headObject(key), null, 'BOS live verifier 临时对象删除后仍存在')
  } catch (error) {
    cleanupError = error
  }

  if (operationError && cleanupError) {
    throw new AggregateError(
      [operationError, cleanupError],
      'BOS_LIVE_OPERATION_AND_CLEANUP_FAILED',
    )
  }
  if (cleanupError) throw cleanupError
  if (operationError) throw operationError

  console.log(
    `PASS: 真实 BOS 连通性与临时对象清理验证通过（target=${target}, bucket=${config.bucket}, region=${config.region}）`,
  )
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`FAIL: 真实 BOS 连通性验证失败：${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
