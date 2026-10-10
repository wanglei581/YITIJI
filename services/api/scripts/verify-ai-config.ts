/**
 * AI 大模型配置 service 级验证（P1-B④ 守门）。
 *
 * 覆盖（按验收优先级）：
 *   1. apiKey 加密落盘：更新后配置文件里**不出现明文**，存的是密文。
 *   2. getApiKey 解密往返：服务端取回 === 原明文。
 *   3. getView / getConfig 不回显：无 apiKey/apiKeyEncrypted，仅 apiKeyConfigured 布尔。
 *   4. fail-closed：isReady = enabled && 有 key；禁用或无 key 都 not ready。
 *   5. 清空 key → apiKeyConfigured=false、getApiKey=null、isReady=false。
 *   6. feature 隔离：改一个 feature 不影响另一个。
 *   7. 非法 featureKey → 抛 400 AI_FEATURE_KEY_INVALID（不静默回落）。
 *   8. 重启（new LlmConfigService）后配置 + 解密 apiKey 仍在（文件持久化）。
 *
 * 纯 JSON 文件 + 加密，**无 DB**。临时 FILE_STORAGE_DIR + 测试 SECRET_ENCRYPTION_KEY，finally 清理。
 * 运行：pnpm --filter @ai-job-print/api verify:ai-config
 */
import 'dotenv/config'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { LlmConfigService } from '../src/ai/llm/llm-config.service'
import { assertPublicLlmBaseUrl, isBlockedLlmHost } from '../src/ai/llm/llm-base-url'
import { deepStrictEqual, strictEqual } from 'node:assert'
import { AiConfigController, AiConfigsController } from '../src/ai/llm/ai-config.controller'
import { LlmChatService } from '../src/ai/llm/llm-chat.service'
import type { AuditService } from '../src/audit/audit.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

// 隔离：临时 SECRET_ENCRYPTION_KEY（≥32）+ 临时 FILE_STORAGE_DIR（配置 JSON 写临时目录，不碰真实 data）。
// 清掉可能从 .env 带入的默认 LLM key，保证「初始无 key」状态确定。
process.env['SECRET_ENCRYPTION_KEY'] ||= 'verify-ai-config-secret-encryption-key-0123456789'
const DATA_DIR = mkdtempSync(join(tmpdir(), 'vac-data-'))
process.env['FILE_STORAGE_DIR'] = DATA_DIR
delete process.env['AI_LLM_API_KEY']
delete process.env['TRTC_LLM_API_KEY']

const CONFIG_FILE = join(DATA_DIR, 'ai-model-configs.json')
const SECRET = 'sk-vfy-secret-1234567890abcdef' // 测试明文 apiKey

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); rmSync(DATA_DIR, { recursive: true, force: true }); process.exit(1) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

async function main() {
  console.log('\n=== AI 大模型配置 service 级验证（P1-B④ 守门）===')
  try {
    const svc = new LlmConfigService()

    const v0 = svc.getView('assistant_chat')
    strictEqual(v0.vendor, 'deepseek')
    strictEqual(v0.baseURL, 'https://api.deepseek.com/v1')
    pass('H0 首次启动默认厂商和地址仍为深度求索')
    if (v0.apiKeyConfigured === false) pass('初始无 apiKey：apiKeyConfigured=false')
    else fail(`初始应无 key，实际 configured=${v0.apiKeyConfigured}`)

    // ── 1. apiKey 加密落盘，文件无明文 ──────────────────────────────────
    svc.update({ apiKey: SECRET, enabled: true, vendor: 'deepseek', model: 'deepseek-v4-flash' }, 'assistant_chat')
    const fileText = readFileSync(CONFIG_FILE, 'utf-8')
    if (!fileText.includes(SECRET)) pass('1. apiKey 加密落盘：配置文件不含明文')
    else fail('1. 配置文件出现 apiKey 明文！')
    const enc = (JSON.parse(fileText) as Record<string, { apiKeyEncrypted?: unknown }>)['assistant_chat']?.apiKeyEncrypted
    if (typeof enc === 'string' && enc.length > 0 && enc !== SECRET) pass('1b. 文件存的是密文（apiKeyEncrypted ≠ 明文）')
    else fail(`1b. 文件密文异常：${String(enc).slice(0, 40)}`)

    // ── 2. getApiKey 解密往返 ───────────────────────────────────────────
    if (svc.getApiKey('assistant_chat') === SECRET) pass('2. getApiKey 解密往返回原明文')
    else fail('2. getApiKey 解密未回原值')

    // ── 3. getView / getConfig 不回显 ───────────────────────────────────
    const v = svc.getView('assistant_chat') as Record<string, unknown>
    const cfg = svc.getConfig('assistant_chat') as Record<string, unknown>
    const noLeak =
      v['apiKeyConfigured'] === true &&
      !('apiKey' in v) && !('apiKeyEncrypted' in v) &&
      !('apiKey' in cfg) && !('apiKeyEncrypted' in cfg) &&
      !JSON.stringify(v).includes(SECRET) && !JSON.stringify(cfg).includes(SECRET) &&
      !JSON.stringify(v).includes(String(enc)) && !JSON.stringify(cfg).includes(String(enc))
    if (noLeak) pass('3. getView/getConfig 不回显明文/密文，仅 apiKeyConfigured=true')
    else fail(`3. 配置视图疑似泄漏：view=${JSON.stringify(v)}`)

    // ── 4. fail-closed isReady ──────────────────────────────────────────
    if (svc.isReady('assistant_chat') === true) pass('4a. enabled + key → isReady=true')
    else fail('4a. enabled+key 应 ready')
    svc.update({ enabled: false }, 'assistant_chat')
    if (svc.isReady('assistant_chat') === false) pass('4b. 禁用 → isReady=false（fail-closed）')
    else fail('4b. 禁用应 not ready')
    svc.update({ enabled: true }, 'assistant_chat')

    // ── 5. 清空 key → configured=false + not ready ──────────────────────
    svc.update({ apiKey: '' }, 'assistant_chat')
    if (
      svc.getView('assistant_chat').apiKeyConfigured === false &&
      svc.getApiKey('assistant_chat') === null &&
      svc.isReady('assistant_chat') === false
    ) pass('5. 清空 key → configured=false、getApiKey=null、isReady=false（无 key fail-closed）')
    else fail('5. 清空 key 后状态异常')
    svc.update({ apiKey: SECRET, enabled: true }, 'assistant_chat') // 恢复给后续测试

    // ── 6. feature 隔离 ─────────────────────────────────────────────────
    svc.update({ apiKey: 'sk-other-feature-xyz', model: 'deepseek-other' }, 'resume_diagnosis')
    if (
      svc.getApiKey('assistant_chat') === SECRET &&
      svc.getApiKey('resume_diagnosis') === 'sk-other-feature-xyz' &&
      svc.getView('assistant_chat').model !== svc.getView('resume_diagnosis').model
    ) pass('6. feature 隔离：assistant_chat 与 resume_diagnosis 配置/key 互不影响')
    else fail('6. feature 隔离异常')

    // ── 7. 非法 featureKey → 400 ────────────────────────────────────────
    let threw = false
    try { svc.assertValidFeatureKey('nope_feature') }
    catch (e) { threw = true; if (errCode(e) !== 'AI_FEATURE_KEY_INVALID') fail(`7. 错误码不符：${errCode(e)}`) }
    if (threw) pass('7. 非法 featureKey → 抛 400 AI_FEATURE_KEY_INVALID（不静默回落）')
    else fail('7. 非法 featureKey 未抛错')
    if (svc.assertValidFeatureKey('assistant_chat') === 'assistant_chat') pass('7b. 合法 featureKey 正常返回')
    else fail('7b. 合法 featureKey 异常')

    if (isBlockedLlmHost('127.0.0.1') && isBlockedLlmHost('localhost') && isBlockedLlmHost('169.254.169.254')) {
      pass('7c. 本机/链路本地 host 被识别为禁止')
    } else fail('7c. 内网 host 未拦住')
    if (!isBlockedLlmHost('api.deepseek.com')) pass('7d. 公网 host 放行')
    else fail('7d. 公网 host 被误拦')
    const PROD = { NODE_ENV: 'production' } as const
    const DEV = { NODE_ENV: 'development' } as const
    const rejectCode = (raw: string, env: Record<string, string>): string | undefined => {
      try { assertPublicLlmBaseUrl(raw, env); return undefined } catch (e) { return errCode(e) ?? 'THREW' }
    }
    // 7e：生产环境一律拒绝回环地址（走查放行只限非生产）。
    const loopbackUrls = ['http://127.0.0.1/v1', 'http://127.0.0.1:18080/v1', 'http://localhost:9000', 'http://localhost.', 'http://[::1]:8000']
    const prodLeaks = loopbackUrls.filter((raw) => rejectCode(raw, PROD) !== 'AI_BASE_URL_PRIVATE')
    if (prodLeaks.length === 0) pass('7e. 生产环境 admin baseURL 拒绝回环地址（AI_BASE_URL_PRIVATE）')
    else fail(`7e. 生产环境放行了回环 baseURL: ${prodLeaks.join(', ')}`)
    // 7e2：非生产放行回环地址（与出站白名单同一口径），走查能在后台接本机假大模型。
    const devRejected = loopbackUrls.filter((raw) => rejectCode(raw, DEV) !== undefined)
    if (devRejected.length === 0) pass('7e2. 非生产 admin baseURL 放行回环地址（走查接本机假大模型）')
    else fail(`7e2. 非生产仍拒绝回环 baseURL: ${devRejected.join(', ')}`)
    // 7e3：放行只限回环；内网段、链路本地、0.0.0.0、v4-mapped 回环在非生产也照旧拒绝。
    const stillPrivate = ['http://10.0.0.5', 'http://192.168.1.10', 'http://169.254.169.254', 'http://0.0.0.0:8080', 'http://[fe80::1]', 'http://[fc00::1]', 'http://[::ffff:7f00:1]', 'http://printer.local']
    const devLeaks = stillPrivate.filter((raw) => rejectCode(raw, DEV) !== 'AI_BASE_URL_PRIVATE')
    if (devLeaks.length === 0) pass('7e3. 非生产只放行回环：内网 / 链路本地 / 0.0.0.0 / v4-mapped 仍拒绝')
    else fail(`7e3. 非生产放行了非回环内网地址: ${devLeaks.join(', ')}`)
    try {
      assertPublicLlmBaseUrl('https://api.deepseek.com')
      pass('7f. 公网 https baseURL 放行')
    } catch {
      fail('7f. 公网 https baseURL 被拒绝')
    }

    const blockedHosts = ['[::1]', '[fe80::1]', '[fc00::1]', 'localhost.', '[::ffff:7f00:1]']
    if (blockedHosts.every((h) => isBlockedLlmHost(h))) {
      pass('7g. IPv6 方括号 / localhost. / v4-mapped 字面 host 禁止')
    } else {
      fail(`7g. 未拦住: ${blockedHosts.filter((h) => !isBlockedLlmHost(h)).join(', ')}`)
    }
    const blockedUrls = ['http://[::1]:8000', 'http://[fe80::1]', 'http://[fc00::1]', 'http://localhost.']
    for (const raw of blockedUrls) {
      let blocked = false
      try { assertPublicLlmBaseUrl(raw, PROD) } catch (e) {
        blocked = errCode(e) === 'AI_BASE_URL_PRIVATE'
      }
      if (!blocked) fail(`7h. 应拒绝内网 URL: ${raw}`)
    }
    pass('7h. 生产环境 http://[::1]:8000 / [fe80::1] / [fc00::1] / localhost. 拒绝')
    try {
      assertPublicLlmBaseUrl('http://127.0.0.1.nip.io')
      pass('7i. 127.0.0.1.nip.io 按 DNS 不做（已知边界，字面公网名放行）')
    } catch {
      fail('7i. nip.io 不应在字面检查被拦（已知边界：不做 DNS）')
    }

    // ── 8. 重启（new service）持久化 ────────────────────────────────────
    const svc2 = new LlmConfigService() // 从文件重新加载
    if (
      svc2.getApiKey('assistant_chat') === SECRET &&
      svc2.getView('assistant_chat').enabled === true &&
      svc2.getApiKey('resume_diagnosis') === 'sk-other-feature-xyz'
    ) pass('8. 重启（new LlmConfigService）后配置 + 解密 apiKey 持久仍在')
    else fail('8. 重启后持久化异常')
    await hunyuanChecks(svc)
  } finally {
    rmSync(DATA_DIR, { recursive: true, force: true })
  }

  console.log('\nALL PASS')
}

/** 新厂商、地址换钥和后台「先保存再测试」真实控制器流程，无外部网络。 */
async function hunyuanChecks(svc: LlmConfigService): Promise<void> {
  const envNames = ['AI_ENDPOINT_ALLOWLIST', 'AI_ENDPOINT_ALLOWLIST_EXTRA', 'TRTC_LLM_API_URL', 'AI_LLM_API_KEY', 'TRTC_LLM_API_KEY', 'FILE_STORAGE_DIR']
  const envBefore = Object.fromEntries(envNames.map((name) => [name, process.env[name]]))
  const fetchBefore = globalThis.fetch
  const calls: Array<{ url: string; key: string | null; body: Record<string, unknown> }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), key: new Headers(init?.headers).get('Authorization'), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return new Response(JSON.stringify({ choices: [{ message: { content: '你好，我可以帮你整理材料。' } }] }), { status: 200 })
  }
  const audit = { write: async () => undefined } as unknown as AuditService
  const chat = new LlmChatService(svc)
  const legacy = new AiConfigController(svc, chat, audit)
  const current = new AiConfigsController(svc, chat, audit)
  const user = { userId: 'verify-admin', role: 'admin' } as AuthedUser
  const req = { headers: {}, ip: '127.0.0.1' }
  const rejected = async (action: () => unknown, code: string, label: string) => {
    const before = JSON.stringify(svc.getViews())
    const beforeKey = svc.getApiKey()
    const beforeDisk = readFileSync(CONFIG_FILE, 'utf8')
    const beforeCalls = calls.length
    let error: unknown
    try { await action() } catch (caught) { error = caught }
    strictEqual(errCode(error), code)
    strictEqual((error as { getStatus(): number }).getStatus(), 400)
    if (code === 'AI_CONFIG_API_KEY_REQUIRED') {
      strictEqual(((error as { getResponse(): unknown }).getResponse() as { error: { message: string } }).error.message,
        '模型服务地址换了，请重新填写这一家的 API Key；原来的密钥不会发给新地址')
    }
    strictEqual(JSON.stringify(svc.getViews()), before)
    strictEqual(svc.getApiKey(), beforeKey)
    strictEqual(readFileSync(CONFIG_FILE, 'utf8'), beforeDisk)
    strictEqual(calls.length, beforeCalls)
    pass(label)
  }
  try {
    delete process.env['AI_ENDPOINT_ALLOWLIST']
    delete process.env['AI_ENDPOINT_ALLOWLIST_EXTRA']
    for (const response of [legacy.get(), current.getAll(), current.getOne('assistant_chat')]) {
      strictEqual(response.presets.length, 5)
      const hy = response.presets.find((preset) => preset.vendor === 'hunyuan')!
      deepStrictEqual([hy.baseURL, hy.defaultModel, hy.models, hy.label, hy.docsUrl], ['https://tokenhub.tencentmaas.com/v1', 'hy3', ['hy3'], '腾讯混元（TokenHub）', 'https://cloud.tencent.com/document/product/1823'])
    }
    pass('H1 三个预设读取接口均回五家，混元地址、模型、名称和文档正确')
    await rejected(() => svc.update({ vendor: 'hunyuan' }), 'AI_BASE_URL_NOT_ALLOWED', 'H3 默认不放行混元，白名单先报，内存、密钥、落盘均不变')
    process.env['AI_ENDPOINT_ALLOWLIST_EXTRA'] = 'tokenhub.tencentmaas.com'
    await rejected(() => svc.update({ vendor: 'hunyuan' }), 'AI_CONFIG_API_KEY_REQUIRED', 'H4 放行后切混元不带密钥拒绝，配置原样')
    await rejected(() => svc.update({ baseURL: 'https://tokenhub.tencentmaas.com/v1' }), 'AI_CONFIG_API_KEY_REQUIRED', 'H4b 只改地址不改厂商也须换钥，配置原样')
    await rejected(() => svc.update({ vendor: 'hunyuan' }, 'advisor_work'), 'AI_CONFIG_API_KEY_REQUIRED', 'H5 继承父功能位的子键换厂商不带密钥也拒绝')
    svc.update({ vendor: 'hunyuan', apiKey: 'verify-tencent-key' })
    strictEqual(svc.getApiKey(), 'verify-tencent-key')
    strictEqual(new LlmConfigService().getApiKey(), 'verify-tencent-key')
    pass('H6 带新密钥切换成功，内存及重启后取到新密钥')
    svc.update({ baseURL: 'https://tokenhub.tencentmaas.com/custom/v1', model: 'hy3' })
    strictEqual(svc.getApiKey(), 'verify-tencent-key')
    pass('H7 同主机只改路径或模型，保留密钥')
    svc.update({ vendor: 'deepseek', apiKey: '' })
    strictEqual(svc.getApiKey(), null)
    pass('H8 切厂商显式空串清除成功')
    svc.update({ vendor: 'hunyuan' })
    strictEqual(svc.getApiKey(), null)
    pass('H9 原先没有密钥，切主机允许保存且仍无密钥')

    // 页面两个动作都先 PUT 再 POST；两个 POST 不接收地址或密钥，只读已存配置。
    for (const [name, save, test] of [
      ['旧接口', (patch: Parameters<LlmConfigService['update']>[0]) => legacy.update(patch, user, req), () => legacy.test({})],
      ['功能位接口', (patch: Parameters<LlmConfigService['update']>[0]) => current.updateOne('assistant_chat', patch, user, req), () => current.testOne('assistant_chat')],
    ] as const) {
      svc.update({ vendor: 'deepseek', apiKey: SECRET, enabled: true })
      await rejected(async () => { await save({ vendor: 'hunyuan' }); await test() }, 'AI_CONFIG_API_KEY_REQUIRED', `H10 ${name} 保存并测试：不带密钥换主机，400 且零请求`)
      await save({ vendor: 'hunyuan', apiKey: 'verify-new-test-key' })
      strictEqual((await test()).ok, true)
      strictEqual(calls.at(-1)?.key, 'Bearer verify-new-test-key')
      strictEqual(new URL(calls.at(-1)!.url).hostname, 'tokenhub.tencentmaas.com')
      deepStrictEqual(calls.at(-1)?.body['thinking'], { type: 'disabled' })
      pass(`H11 ${name} 保存并测试：新密钥成功，桩收到新地址、新密钥、关闭思考`)
      await save({ baseURL: 'https://tokenhub.tencentmaas.com/another/v1' })
      strictEqual((await test()).ok, true)
      strictEqual(calls.at(-1)?.key, 'Bearer verify-new-test-key')
      strictEqual(calls.at(-1)?.url, 'https://tokenhub.tencentmaas.com/another/v1/chat/completions')
      pass(`H12 ${name} 保存并测试：同主机只改路径，仍用同一把密钥`)
      await save({ vendor: 'deepseek', apiKey: '' })
      const count = calls.length
      strictEqual((await test()).ok, false)
      strictEqual(calls.length, count)
      strictEqual(svc.getApiKey(), null)
      pass(`H13 ${name} 保存并测试：显式空串清除成功，无密钥不发请求`)
    }
    svc.update({ vendor: 'deepseek', apiKey: SECRET, enabled: true })
    const count = calls.length
    await legacy.test({ baseURL: 'https://tokenhub.tencentmaas.com/v1', apiKey: 'ignored' } as Parameters<AiConfigController['test']>[0])
    // testOne 没有 Body 参数，HTTP 多余字段同样无法进入它的地址或凭证来源。
    await current.testOne('assistant_chat')
    strictEqual(calls.length, count + 2)
    for (const call of calls.slice(count)) {
      strictEqual(new URL(call.url).hostname, 'api.deepseek.com')
      strictEqual(call.key, `Bearer ${SECRET}`)
    }
    pass('H14 两个 POST 只测试已存配置，附加的调用方地址/密钥不影响请求')

    for (const url of [undefined, 'https://api.deepseek.com/v1/x', 'https://tokenhub.tencentmaas.com/v1/x', 'invalid-url']) {
      const dir = mkdtempSync(join(tmpdir(), 'vac-env-'))
      try {
        process.env['FILE_STORAGE_DIR'] = dir
        delete process.env['AI_LLM_API_KEY']
        process.env['TRTC_LLM_API_KEY'] = 'verify-trtc-only-key'
        if (url === undefined) delete process.env['TRTC_LLM_API_URL']
        else process.env['TRTC_LLM_API_URL'] = url
        const envSvc = new LlmConfigService()
        strictEqual(envSvc.getView().vendor, 'deepseek')
        strictEqual(envSvc.getApiKey(), url === undefined || url.includes('api.deepseek.com') ? 'verify-trtc-only-key' : null)
        pass(`H15 fromEnv 数字人地址 ${url ?? '未设'}：仅深度求索可复用密钥`)
        process.env['AI_LLM_API_KEY'] = 'verify-ai-only-key'
        strictEqual(new LlmConfigService().getApiKey(), 'verify-ai-only-key')
        pass(`H16 fromEnv ${url ?? '未设'}：AI_LLM_API_KEY 优先且默认厂商不变`)
      } finally { rmSync(dir, { recursive: true, force: true }) }
    }
  } finally {
    globalThis.fetch = fetchBefore
    for (const name of envNames) {
      if (envBefore[name] === undefined) delete process.env[name]
      else process.env[name] = envBefore[name]
    }
  }
}

void main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)))
