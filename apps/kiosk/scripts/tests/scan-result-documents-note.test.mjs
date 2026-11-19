/**
 * 面板扫描完成页那句小字：登录且「我的文档」里查到这份 fileId 才说已存。
 * 转译真实源码来跑，不另抄一份句子。
 *
 * CI：`.github/workflows/ci.yml` 作业 `build-and-verify` 的
 * 「Cross-client deterministic static gates」一步直接
 * `node --test apps/kiosk/scripts/tests/scan-result-documents-note.test.mjs`。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

function transpile(absolutePath, replacements = {}) {
  let out = ts.transpileModule(readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
  }).outputText
  for (const [specifier, url] of Object.entries(replacements)) {
    out = out.split(`'${specifier}'`).join(`'${url}'`).split(`"${specifier}"`).join(`"${url}"`)
  }
  const leftover = [...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]).filter((specifier) => !specifier.startsWith('data:'))
  assert.deepEqual(leftover, [], `${absolutePath} 还有没替换的运行时依赖：${leftover.join(', ')}`)
  return toDataUrl(out)
}

const copyUrl = transpile(join(kioskRoot, 'src/copy/unattendedCopy.ts'))
const waysUrl = transpile(join(kioskRoot, 'src/pages/scan/scanGuestWays.ts'), {
  '../../copy/unattendedCopy': copyUrl,
})
const note = await import(transpile(join(kioskRoot, 'src/pages/scan/scanResultDocumentsNote.ts'), {
  './scanGuestWays': waysUrl,
}))

const SAVED = '在「我的文档」查看与管理本次扫描件'
const PRINT_NOW = '当场打印：请在本次操作内完成打印或识别。'
const GUEST = '未登录扫描件不会进入「我的文档」。带走的办法：'

test('句子常量就是屏上那三句', () => {
  assert.equal(note.PANEL_SAVED_IN_DOCUMENTS, SAVED)
  assert.equal(note.scanResultDocumentsNote({ loggedIn: false, check: 'checking' }), GUEST)
  assert.equal(note.scanResultDocumentsNote({ loggedIn: true, check: 'missing' }), PRINT_NOW)
})

test('登录且查到这份 fileId → 已存进我的文档', () => {
  assert.equal(note.scanResultDocumentsNote({ loggedIn: true, check: 'found' }), note.PANEL_SAVED_IN_DOCUMENTS)
  assert.equal(note.scanResultDocumentsNote({ loggedIn: true, check: 'found' }), SAVED)
})

test('登录且没查到、请求失败、还在核对 → 当场打印，不说已存', () => {
  for (const check of ['missing', 'failed', 'checking']) {
    const text = note.scanResultDocumentsNote({ loggedIn: true, check })
    assert.equal(text, PRINT_NOW, check)
    assert.notEqual(text, SAVED, check)
  }
})

test('游客不论核对结果都是游客那句，即使列表里有这份也不说已存', () => {
  for (const check of ['found', 'missing', 'failed', 'checking']) {
    const text = note.scanResultDocumentsNote({ loggedIn: false, check })
    assert.equal(text, GUEST, check)
    assert.notEqual(text, SAVED, check)
  }
})
