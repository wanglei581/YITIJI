import assert from 'assert/strict'
import { createHash } from 'crypto'
import {
  BosStorageBackend,
  type BosClientLike,
} from '../src/storage/bos-storage.backend'
import { StorageService } from '../src/storage/storage.service'
import { requireBosLiveConfig } from './verify-bos-live'

class FakeBosClient implements BosClientLike {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>()

  async putObject(
    bucket: string,
    key: string,
    body: Buffer,
    options?: Record<string, unknown>,
  ) {
    this.objects.set(`${bucket}/${key}`, {
      body: Buffer.from(body),
      contentType: String(options?.['Content-Type'] ?? 'application/octet-stream'),
    })
    return {}
  }

  async getObject(bucket: string, key: string) {
    const object = this.objects.get(`${bucket}/${key}`)
    if (!object) throw { status_code: 404 }
    return { body: Buffer.from(object.body) }
  }

  async getObjectMetadata(bucket: string, key: string) {
    const object = this.objects.get(`${bucket}/${key}`)
    if (!object) throw { status_code: 404 }
    return {
      http_headers: {
        'content-length': String(object.body.length),
        'content-type': object.contentType,
        etag: 'verify-etag',
      },
    }
  }

  async deleteObject(bucket: string, key: string) {
    this.objects.delete(`${bucket}/${key}`)
    return {}
  }
}

function verifyProviderRouting(): void {
  const envKeys = [
    'FILE_STORAGE_DRIVER',
    'FILE_STORAGE_LEGACY_DRIVER',
    'FILE_STORAGE_SIGN_URL_EXPIRES_SECONDS',
    'TENCENT_COS_SECRET_ID',
    'TENCENT_COS_SECRET_KEY',
    'TENCENT_COS_BUCKET',
    'TENCENT_COS_REGION',
    'BAIDU_BOS_ACCESS_KEY_ID',
    'BAIDU_BOS_SECRET_ACCESS_KEY',
    'BAIDU_BOS_BUCKET',
    'BAIDU_BOS_REGION',
    'BAIDU_BOS_ENDPOINT',
  ] as const
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]))
  Object.assign(process.env, {
    FILE_STORAGE_DRIVER: 'bos',
    FILE_STORAGE_LEGACY_DRIVER: 'cos',
    FILE_STORAGE_SIGN_URL_EXPIRES_SECONDS: '9999',
    TENCENT_COS_SECRET_ID: 'verify-cos-id',
    TENCENT_COS_SECRET_KEY: 'verify-cos-key',
    TENCENT_COS_BUCKET: 'verify-cos-private',
    TENCENT_COS_REGION: 'ap-guangzhou',
    BAIDU_BOS_ACCESS_KEY_ID: 'verify-bos-ak',
    BAIDU_BOS_SECRET_ACCESS_KEY: 'verify-bos-sk',
    BAIDU_BOS_BUCKET: 'verify-bos-private',
    BAIDU_BOS_REGION: 'bj',
    BAIDU_BOS_ENDPOINT: 'https://bj.bcebos.com',
  })

  try {
    const storage = new StorageService()
    assert.equal(storage.driver, 'bos')
    assert.equal(storage.signTtlSeconds, 1800)
    const args = {
      objectKey: 'users/member-a/resumes/file-a.pdf',
      fileId: 'file-a',
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      ttlSeconds: 600,
      disposition: 'attachment' as const,
    }
    const bosUrl = new URL(storage.getDownloadUrl(args, 'verify-bos-private', 'bos').url)
    assert.equal(bosUrl.hostname, 'bj.bcebos.com')
    assert.equal(bosUrl.pathname, `/v1/verify-bos-private/${args.objectKey}`)

    const cosUrl = new URL(storage.getDownloadUrl(args, 'verify-cos-private', 'cos').url)
    assert.equal(cosUrl.hostname, 'verify-cos-private.cos.ap-guangzhou.myqcloud.com')
    const legacyUrl = new URL(storage.getDownloadUrl(args, null, 'legacy').url)
    assert.equal(legacyUrl.hostname, cosUrl.hostname)

    assert.throws(
      () => storage.getDownloadUrl(args, 'wrong-bucket', 'bos'),
      /STORAGE_BUCKET_UNAVAILABLE/,
    )
    assert.throws(
      () => storage.getDownloadUrl(args, null, 'unknown-provider'),
      /STORAGE_PROVIDER_UNSUPPORTED/,
    )
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function verifyLiveGateConfig(): void {
  assert.throws(
    () => requireBosLiveConfig({}),
    /BOS_LIVE_VERIFY_NOT_AUTHORIZED/,
  )
  assert.throws(
    () => requireBosLiveConfig({ BOS_LIVE_VERIFY_ENABLED: 'true' }),
    /BOS_LIVE_VERIFY_TARGET_INVALID/,
  )
  assert.throws(
    () => requireBosLiveConfig({
      BOS_LIVE_VERIFY_ENABLED: 'true',
      BOS_LIVE_VERIFY_TARGET: 'preprod',
    }),
    /BOS_LIVE_CONFIG_MISSING/,
  )
  assert.throws(
    () => requireBosLiveConfig({
      BOS_LIVE_VERIFY_ENABLED: 'true',
      BOS_LIVE_VERIFY_TARGET: 'preprod',
      BAIDU_BOS_ACCESS_KEY_ID: 'verify-ak',
      BAIDU_BOS_SECRET_ACCESS_KEY: 'verify-sk',
      BAIDU_BOS_BUCKET: 'verify-private',
      BAIDU_BOS_REGION: 'bj',
      BAIDU_BOS_ENDPOINT: 'http://bj.bcebos.com',
    }),
    /BOS_LIVE_ENDPOINT_INVALID/,
  )

  assert.deepEqual(
    requireBosLiveConfig({
      BOS_LIVE_VERIFY_ENABLED: 'true',
      BOS_LIVE_VERIFY_TARGET: 'preprod',
      BAIDU_BOS_ACCESS_KEY_ID: 'verify-ak',
      BAIDU_BOS_SECRET_ACCESS_KEY: 'verify-sk',
      BAIDU_BOS_BUCKET: 'verify-private',
      BAIDU_BOS_REGION: 'bj',
      BAIDU_BOS_ENDPOINT: 'https://bj.bcebos.com',
    }),
    {
      target: 'preprod',
      config: {
        accessKeyId: 'verify-ak',
        secretAccessKey: 'verify-sk',
        bucket: 'verify-private',
        region: 'bj',
        endpoint: 'https://bj.bcebos.com',
      },
    },
  )
}

async function main(): Promise<void> {
  const fake = new FakeBosClient()
  const backend = new BosStorageBackend(
    {
      accessKeyId: 'verify-bos-ak',
      secretAccessKey: 'verify-bos-sk',
      bucket: 'verify-private',
      region: 'bj',
      endpoint: 'https://bj.bcebos.com',
    },
    fake,
  )

  const key = 'users/member-a/resumes/file-a.pdf'
  const body = Buffer.from('verify BOS round trip')
  const put = await backend.putObject(key, body, 'application/pdf')
  assert.equal(put.sizeBytes, body.length)
  assert.equal(put.sha256, createHash('sha256').update(body).digest('hex'))
  assert.deepEqual(await backend.getObject(key), body)
  assert.deepEqual(await backend.headObject(key), {
    sizeBytes: body.length,
    contentType: 'application/pdf',
    etag: 'verify-etag',
  })

  const download = backend.getDownloadUrl({
    objectKey: key,
    fileId: 'file-a',
    filename: 'resume.pdf',
    mimeType: 'application/pdf',
    ttlSeconds: 600,
    disposition: 'attachment',
  })
  const downloadUrl = new URL(download.url)
  assert.equal(downloadUrl.origin, 'https://bj.bcebos.com')
  assert.equal(downloadUrl.pathname, `/v1/verify-private/${key}`)
  assert.ok(downloadUrl.searchParams.get('authorization')?.startsWith('bce-auth-v1/verify-bos-ak/'))
  assert.equal(downloadUrl.searchParams.get('responseContentType'), 'application/pdf')
  assert.equal(downloadUrl.searchParams.has('responseContentDisposition'), false)
  assert.ok(!download.url.includes('verify-bos-sk'))

  const upload = backend.getUploadUrl({
    objectKey: key,
    fileId: 'file-a',
    contentType: 'application/pdf',
    ttlSeconds: 600,
  })
  assert.equal(upload.direct, true)
  assert.equal(upload.method, 'PUT')
  assert.equal(upload.headers['Content-Type'], 'application/pdf')
  assert.ok(new URL(upload.url).searchParams.get('authorization')?.startsWith('bce-auth-v1/verify-bos-ak/'))
  assert.ok(!upload.url.includes('verify-bos-sk'))

  await backend.deleteObject(key)
  assert.equal(await backend.headObject(key), null)
  await backend.deleteObject(key)
  verifyProviderRouting()
  verifyLiveGateConfig()

  console.log('PASS: 百度 BOS 后端、live fail-closed 配置与 BOS/COS/legacy 显式路由离线验证通过')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
