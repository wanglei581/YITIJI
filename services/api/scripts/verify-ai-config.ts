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

function main() {
  console.log('\n=== AI 大模型配置 service 级验证（P1-B④ 守门）===')
  try {
    const svc = new LlmConfigService()

    const v0 = svc.getView('assistant_chat')
    if (v0.apiKeyConfigured === false) pass('初始无 apiKey：apiKeyConfigured=false')
    else fail(`初始应无 key，实际 configured=${v0.apiKeyConfigured}`)

    // ── 1. apiKey 加密落盘，文件无明文 ──────────────────────────────────
    svc.update({ apiKey: SECRET, enabled: true, vendor: 'deepseek', model: 'deepseek-chat' }, 'assistant_chat')
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

    // ── 8. 重启（new service）持久化 ────────────────────────────────────
    const svc2 = new LlmConfigService() // 从文件重新加载
    if (
      svc2.getApiKey('assistant_chat') === SECRET &&
      svc2.getView('assistant_chat').enabled === true &&
      svc2.getApiKey('resume_diagnosis') === 'sk-other-feature-xyz'
    ) pass('8. 重启（new LlmConfigService）后配置 + 解密 apiKey 持久仍在')
    else fail('8. 重启后持久化异常')
  } finally {
    rmSync(DATA_DIR, { recursive: true, force: true })
  }

  console.log('\nALL PASS')
}

main()
