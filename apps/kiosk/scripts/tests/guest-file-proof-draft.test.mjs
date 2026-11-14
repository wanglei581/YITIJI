/**
 * 面试设置草稿会把这份文件的签名地址留下来。
 * 离开设置页再回来，地址还在；清场后草稿连同地址一起被清掉。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const FILE_URL = '/api/v1/files/file-guest-1/content?expires=1893456000000&sig=abc'

function transpile(relativePath) {
  const source = readFileSync(join(root, relativePath), 'utf8')
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: relativePath,
  }).outputText
}

function toDataUrl(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

function installStorage() {
  const store = new Map()
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)) },
      removeItem: (key) => { store.delete(key) },
    },
  }
  return store
}

async function loadSession() {
  const model = toDataUrl(transpile('src/pages/interview/interviewWorkbenchModel.ts'))
  const session = transpile('src/pages/interview/interviewWorkbenchSession.ts')
    .replaceAll("'./interviewWorkbenchModel'", `'${model}'`)
    .replaceAll('"./interviewWorkbenchModel"', `"${model}"`)
  return import(toDataUrl(`${session}\n// ${Date.now()}\n`))
}

const setup = {
  directionSelectionVersion: 1,
  interviewerType: 'hr',
  industry: '软件',
  position: '后端开发',
  experience: 'y1_3',
  difficulty: 'standard',
  duration: 5,
  resumeFile: { fileId: 'file-guest-1', name: 'resume.pdf', fileUrl: FILE_URL },
  pendingSession: null,
  aiOutage: null,
  startFailed: false,
  probed: false,
}

test('离开设置页再回来，草稿里的签名地址还在；清场后连同地址被清掉', async () => {
  const store = installStorage()
  const mod = await loadSession()
  mod.patchInterviewWorkbenchSession({ stage: 'setup', setup })
  const returned = mod.readInterviewWorkbenchSession()
  assert.equal(returned?.setup?.resumeFile?.fileUrl, FILE_URL)
  assert.equal(store.get(mod.INTERVIEW_WORKBENCH_SESSION_KEY).includes(FILE_URL), true)
  mod.clearInterviewWorkbenchSession()
  assert.equal(store.has(mod.INTERVIEW_WORKBENCH_SESSION_KEY), false)
  assert.equal(mod.readInterviewWorkbenchSession(), null)
})
