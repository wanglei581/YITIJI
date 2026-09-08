import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const adapterSource = readFileSync(join(kioskRoot, 'src/services/api/aiHttpAdapter.ts'), 'utf8')

function extractMethod(source, name) {
  const start = source.indexOf(`async ${name}(`)
  if (start < 0) throw new Error(`${name} not found`)
  const brace = source.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`${name} is unclosed`)
}

test('exportGeneratedResume POST body includes factsConfirmedAt', async () => {
  const method = extractMethod(adapterSource, 'exportGeneratedResume')
  const wrapped = `
    async function run(post) {
      const adapter = { ${method} }
      const resume = { basic: { name: '青岛求职者' } }
      const taskId = 'task-1'
      const token = 'member-token'
      return adapter.exportGeneratedResume(
        resume,
        taskId,
        token,
        'pdf',
        undefined,
        undefined,
        undefined,
        { factsConfirmedAt: '2026-09-08T00:00:00.000Z' },
      )
    }
  `
  const js = ts.transpileModule(wrapped, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const captured = []
  const post = async (_path, body, _token) => {
    captured.push(body)
    return { fileId: 'file-1' }
  }
  const run = new Function(`${js}; return run;`)()
  await run(post)
  assert.equal(captured.length, 1, 'exportGeneratedResume must POST once')
  assert.equal(
    captured[0].factsConfirmedAt,
    '2026-09-08T00:00:00.000Z',
    'logged-in member export must send factsConfirmedAt or the backend returns 400',
  )
  assert.equal(captured[0].taskId, 'task-1')
  assert.equal(captured[0].format, 'pdf')
})
