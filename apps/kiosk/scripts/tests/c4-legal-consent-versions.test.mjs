// C4 一体机一半（2026-09-29）：正式生产构建取不到已发布协议版本时不回落、如实拦住登录；
// 开发与 E2E 构建保留草拟回落。用 esbuild 按各构建的 import.meta.env 真编译模块，不 mock 判断本身。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(root, 'package.json'))
const { build } = createRequire(require.resolve('vite'))('esbuild')
const DRAFT = 'draft-pending-legal-review'
const COPY = '暂时无法登录：用户协议和隐私政策还没有正式发布。不登录也能打印和扫描。'

async function compile(env) {
  const dir = await mkdtemp(join(tmpdir(), 'c4-legal-'))
  const outfile = join(dir, 'bundle.mjs')
  await build({
    stdin: {
      contents: [
        "export * as versions from './src/services/auth/legalConsentVersions.ts';",
        "export * as copy from './src/pages/auth/accountUserMessage.ts';",
        "export * as gate from './src/pages/auth/loginGateModel.ts';",
        "export * as api from './src/services/auth/memberAuthApi.ts';",
      ].join('\n'),
      resolveDir: root,
    },
    bundle: true, format: 'esm', platform: 'browser', outfile, logLevel: 'silent',
    define: { 'import.meta.env': JSON.stringify({ VITE_API_MODE: 'http', VITE_API_BASE_URL: '/api/v1', ...env }), 'process.env.NODE_ENV': '"production"' },
  })
  const mod = await import(pathToFileURL(outfile).href)
  return { mod, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

// 按文档类型给出响应：'v1.2' = 已发布；null = 200 但没有激活版本；'down' = 取不到。
function stubFetch(plan) {
  globalThis.fetch = async (url) => {
    const kind = String(url).includes('terms_of_service') ? 'terms' : 'privacy'
    const value = plan[kind]
    if (value === 'down') throw new TypeError('network down')
    return { ok: true, json: async () => ({ success: true, data: value === null ? null : { version: value } }) }
  }
}

const FORMAL = [
  ['正式生产构建', { PROD: true, DEV: false }],
  ['正式生产构建（E2E 标志为空白）', { PROD: true, DEV: false, VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN: '  ' }],
]
const FALLBACK = [
  ['开发构建', { PROD: false, DEV: true }],
  ['E2E 构建', { PROD: true, DEV: false, VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN: 'test-only' }],
]

for (const [name, env] of FORMAL) {
  test(`${name}：取不到已发布版本就拦住登录，不回落草拟版本`, async () => {
    const { mod, cleanup } = await compile(env)
    try {
      stubFetch({ terms: null, privacy: 'v1.0' })
      await assert.rejects(mod.versions.fetchLegalConsentVersions(), (error) => {
        assert.equal(error.code, 'LEGAL_DOCS_NOT_PUBLISHED')
        assert.equal(mod.copy.accountErrorMessage(error, '登录验证失败，请稍后重试'), COPY)
        assert.equal(mod.gate.derivePhoneGateState({ sendingCode: false, submitting: false, countdown: 42, notice: null, error: COPY, errorCode: error.code }), 'phone-legal-unpublished')
        return true
      })
      // 网络取不到时如实说「稍后重试」，不冒充「协议未发布」，也不回落。
      stubFetch({ terms: 'down', privacy: 'down' })
      await assert.rejects(mod.versions.fetchLegalConsentVersions(), (error) => error.code === 'NETWORK_ERROR')
      stubFetch({ terms: 'v1.2', privacy: 'v1.0' })
      assert.deepEqual(await mod.versions.fetchLegalConsentVersions(), { termsVersion: 'v1.2', privacyVersion: 'v1.0' })
    } finally {
      await cleanup()
    }
  })
}

for (const [name, env] of FALLBACK) {
  test(`${name}：保留草拟回落，现有测试行为不变`, async () => {
    const { mod, cleanup } = await compile(env)
    try {
      stubFetch({ terms: null, privacy: 'v1.0' })
      assert.deepEqual(await mod.versions.fetchLegalConsentVersions(), { termsVersion: DRAFT, privacyVersion: 'v1.0' })
      stubFetch({ terms: 'down', privacy: 'down' })
      assert.deepEqual(await mod.versions.fetchLegalConsentVersions(), { termsVersion: DRAFT, privacyVersion: DRAFT })
    } finally {
      await cleanup()
    }
  })
}

test('服务端拒绝（LEGAL_DOCS_NOT_PUBLISHED）与一体机自查说同一句话，页面文案不出现工程词', async () => {
  const { mod, cleanup } = await compile({ PROD: false, DEV: true })
  try {
    const serverError = new mod.api.MemberApiError('LEGAL_DOCS_NOT_PUBLISHED', '服务协议暂未正式发布，暂时不能登录，请联系现场工作人员', 403)
    assert.equal(mod.copy.accountErrorMessage(serverError, '登录验证失败，请稍后重试'), COPY)
    assert.equal(mod.api.LEGAL_DOCS_NOT_PUBLISHED_COPY, COPY)
    const gateCopy = mod.gate.LOGIN_GATE_COPY['phone-legal-unpublished']
    const text = `${COPY}${gateCopy.title}${gateCopy.sub}${mod.gate.LOGIN_GATE_PILL['phone-legal-unpublished'].label}`
    assert.doesNotMatch(text, /协议版本|草稿|哨兵|服务端|接口|会话|已登录/)
    assert.match(gateCopy.sub, /不登录也能/)
  } finally {
    await cleanup()
  }
})
