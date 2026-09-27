/**
 * 换引导票即清场 —— 行为测试。
 *
 * 上一位的打印材料键先放进 sessionStorage，再走一次真实的引导票交换。
 * 交换成功：材料键和本机收藏被清掉，新的终端会话令牌在。
 * 交换失败：材料键、收藏和仍在使用的旧令牌都还在。
 *
 * 清场函数用的是 kioskSensitiveSession 那一份，不在测试里另抄键名清单。
 * 只有 node 装不起来的依赖换成替身（import.meta.env、lucide、扫描收尾的网络）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const transpile = (relativePath) => ts.transpileModule(
  readFileSync(join(root, relativePath), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: relativePath },
).outputText

const PRINT_KEY = 'ai-job-print:current-print-material-check'
const TOKEN_KEY = 'terminal_session_token_v1'
const FAVORITE_KEY = 'kiosk:jobFavorites:v1'
const OLD_TOKEN = 'previous-occupant-terminal-session'
const NEW_TOKEN = 'next-occupant-terminal-session'
const PRINT_VALUE = JSON.stringify({ file: { name: '上一位的简历.pdf', pages: 3 }, status: 'done' })
const FAVORITE_VALUE = JSON.stringify(['job-previous'])
const BOOT_TICKET = 'ticket-from-the-watchdog-0123456789abcdef'
const PAGE = `http://127.0.0.1:5173/?boot_ticket=${BOOT_TICKET}`

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(String(key), String(value)) },
    removeItem: (key) => { map.delete(key) },
    clear: () => { map.clear() },
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
}

let seed = 0

async function loadTerminalAuth({ exchangeOk }) {
  seed += 1
  const envName = `__bootClearEnv_${seed}`
  globalThis[envName] = {
    VITE_TERMINAL_AGENT_LOCAL_URL: '',
    VITE_TERMINAL_AGENT_BRIDGE_TOKEN: '',
    VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN: '',
  }
  const calls = []
  const session = memoryStorage()
  const local = memoryStorage()
  const location = new URL(PAGE)
  globalThis.window = {
    sessionStorage: session,
    localStorage: local,
    get location() {
      return {
        href: location.href,
        origin: location.origin,
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      }
    },
    history: {
      state: null,
      replaceState(_state, _title, next) {
        location.href = new URL(String(next), location.origin).href
      },
    },
    setTimeout: (fn, ms) => {
      const id = setTimeout(fn, ms)
      if (typeof id === 'object' && id && typeof id.unref === 'function') id.unref()
      return id
    },
    clearTimeout: (id) => clearTimeout(id),
    addEventListener() {},
    removeEventListener() {},
  }
  globalThis.sessionStorage = session
  globalThis.localStorage = local
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: init?.body })
    if (!exchangeOk) {
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } }),
      }
    }
    return { ok: true, status: 200, json: async () => ({ sessionToken: NEW_TOKEN }) }
  }

  const clientStub = toDataUrl("export const API_BASE_URL = '/api/v1'\nexport const API_MODE = 'http'\n")
  const screensaverStub = toDataUrl("export function getTerminalId() { return 'KSK-001' }\n")
  const httpAdapterStub = toDataUrl(`
export class ApiHttpError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'ApiHttpError'
    this.code = code
    this.status = status
  }
}
`)
  const throwHttpErrorStub = toDataUrl(`
export async function readHttpError(response) {
  const body = await response.json()
  return {
    code: body?.error?.code ?? 'UNKNOWN_ERROR',
    message: body?.error?.message ?? '请求失败',
  }
}
`)
  const questionsStub = toDataUrl('export const SELF_ASSESSMENT_QUESTIONS_V1 = { dimensions: [] }\n')
  const scanTypeStub = toDataUrl(`
export function isScanType(value) {
  return value === 'resume' || value === 'id' || value === 'document'
}
`)
  const cleanupStub = toDataUrl('export function beginScanSessionCleanup() {}\n')
  const interviewModelUrl = toDataUrl(`${transpile('src/pages/interview/interviewWorkbenchModel.ts')}\n// ${seed}\n`)
  const scanModelUrl = toDataUrl(`${transpile('src/pages/scan/scanWorkbenchModel.ts')}\n// ${seed}\n`)
  const leaf = (relativePath) => toDataUrl(`${transpile(relativePath)}\n// ${seed}\n`)
  const selfAssessmentCode = `${transpile('src/pages/resume/selfAssessmentSession.ts')}\n// ${seed}\n`
    .replaceAll("from '@ai-job-print/shared'", `from '${questionsStub}'`)
  const scanSessionCode = `${transpile('src/pages/scan/scanWorkbenchSession.ts')}\n// ${seed}\n`
    .replaceAll("from './scanWorkbench'", `from '${scanTypeStub}'`)
    .replaceAll("from './scanWorkbenchModel'", `from '${scanModelUrl}'`)
  const interviewCode = `${transpile('src/pages/interview/interviewWorkbenchSession.ts')}\n// ${seed}\n`
    .replaceAll("from './interviewWorkbenchModel'", `from '${interviewModelUrl}'`)
  const sensitiveCode = `${transpile('src/auth/kioskSensitiveSession.ts')}\n// ${seed}\n`
    .replaceAll("from '../pages/print/printMaterialSession'", `from '${leaf('src/pages/print/printMaterialSession.ts')}'`)
    .replaceAll("from '../pages/resume/aiResumeSession'", `from '${leaf('src/pages/resume/aiResumeSession.ts')}'`)
    .replaceAll("from '../services/resumeParseIntent'", `from '${leaf('src/services/resumeParseIntent.ts')}'`)
    .replaceAll("from '../pages/resume/jobMaterialDraft'", `from '${leaf('src/pages/resume/jobMaterialDraft.ts')}'`)
    .replaceAll("from '../pages/resume/selfAssessmentSession'", `from '${toDataUrl(selfAssessmentCode)}'`)
    .replaceAll("from '../pages/interview/interviewWorkbenchSession'", `from '${toDataUrl(interviewCode)}'`)
    .replaceAll("from '../pages/scan/scanWorkbenchSession'", `from '${toDataUrl(scanSessionCode)}'`)
    .replaceAll("from '../pages/scan/scanCleanupGate'", `from '${cleanupStub}'`)
    .replaceAll("from '../favorites/localFavorites'", `from '${leaf('src/favorites/localFavorites.ts')}'`)
    .replaceAll("from '../pages/contract-review/contractReviewSession'", `from '${leaf('src/pages/contract-review/contractReviewSession.ts')}'`)
  const authCode = `${transpile('src/services/terminalAuth.ts')}\n// ${seed}\n`
    .replaceAll('import.meta.env', `globalThis[${JSON.stringify(envName)}]`)
    .replaceAll("from './api/client'", `from '${clientStub}'`)
    .replaceAll("from './api/httpAdapter'", `from '${httpAdapterStub}'`)
    .replaceAll("from './api/screensaver'", `from '${screensaverStub}'`)
    .replaceAll("from './api/throwHttpError'", `from '${throwHttpErrorStub}'`)
    .replaceAll("from '../auth/kioskSensitiveSession'", `from '${toDataUrl(sensitiveCode)}'`)

  const mod = await import(toDataUrl(authCode))
  return { mod, session, local, calls, location }
}

function seedPreviousOccupant(session, local) {
  session.setItem(PRINT_KEY, PRINT_VALUE)
  session.setItem(TOKEN_KEY, OLD_TOKEN)
  local.setItem(FAVORITE_KEY, FAVORITE_VALUE)
}

test('successful boot-ticket exchange clears the previous occupant and keeps the new token', async () => {
  const { mod, session, local, calls, location } = await loadTerminalAuth({ exchangeOk: true })
  seedPreviousOccupant(session, local)
  await mod.initializeTerminalSession()
  assert.equal(session.getItem(PRINT_KEY), null)
  assert.equal(local.getItem(FAVORITE_KEY), null)
  assert.equal(session.getItem(TOKEN_KEY), NEW_TOKEN)
  assert.equal(mod.terminalSessionState(), 'ready')
  assert.equal(calls.length, 1)
  assert.match(String(calls[0].body), new RegExp(BOOT_TICKET))
  assert.equal(location.search.includes('boot_ticket'), false)
})

test('failed boot-ticket exchange keeps the session still in use', async () => {
  const { mod, session, local, calls } = await loadTerminalAuth({ exchangeOk: false })
  seedPreviousOccupant(session, local)
  await mod.initializeTerminalSession()
  assert.equal(session.getItem(PRINT_KEY), PRINT_VALUE)
  assert.equal(local.getItem(FAVORITE_KEY), FAVORITE_VALUE)
  assert.equal(session.getItem(TOKEN_KEY), OLD_TOKEN)
  assert.equal(mod.terminalSessionState(), 'failed')
  assert.equal(calls.length, 1)
})
