import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import FormData from 'form-data'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const agentRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(agentRoot, '..', '..')
const require = createRequire(import.meta.url)
const { version: installedVersion } = require('form-data/package.json')
const manifest = JSON.parse(fs.readFileSync(path.join(agentRoot, 'package.json'), 'utf8'))
const lockfile = fs.readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8')

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  assert.ok(match, `form-data version must be a stable semver: ${version}`)
  return match.slice(1).map(Number)
}

function isAtLeast(version, minimum) {
  const actualParts = parseVersion(version)
  const minimumParts = parseVersion(minimum)
  return actualParts.some((part, index) => {
    const priorPartsMatch = actualParts.slice(0, index).every((priorPart, priorIndex) => priorPart === minimumParts[priorIndex])
    return priorPartsMatch && part > minimumParts[index]
  }) || actualParts.every((part, index) => part === minimumParts[index])
}

function multipartBodyFor(filename) {
  const form = new FormData()
  form.append('file', Buffer.from('%PDF-1.4 security fixture'), {
    filename,
    contentType: 'application/pdf',
  })
  return form.getBuffer().toString('utf8')
}

console.log('\n=== verify terminal-agent form-data security ===')

assert.match(manifest.dependencies['form-data'], /^\^4\.0\.6(?:$|[\s])/,
  'Terminal Agent must declare form-data with a 4.0.6 security floor')
assert.ok(isAtLeast(installedVersion, '4.0.6'), `installed form-data must be >= 4.0.6, got ${installedVersion}`)
assert.doesNotMatch(lockfile, /form-data@4\.0\.5:/, 'lockfile must not retain the vulnerable form-data@4.0.5 snapshot')
assert.match(lockfile, /form-data@4\.0\.6:/, 'lockfile must resolve the patched form-data@4.0.6 snapshot')
// 不钉 axios 的小版本（钉 1.18 的写法在 2026-10-01 升到 1.20.0 时过期变红）。
// 只看性质：lock 里每个 axios 条目都不低于修掉 7 条高危的 1.20.0，且它自己的依赖块解析到 form-data 4.0.6。
const AXIOS_SECURITY_FLOOR = '1.20.0'
const axiosEntries = [...lockfile.matchAll(/^ {2}axios@(\d+\.\d+\.\d+)[^\n]*:\n((?: {4}.*\n)*)/gm)]
  .map((match) => ({ version: match[1], body: match[2] }))
assert.ok(axiosEntries.length > 0, 'lockfile must contain an axios entry')
for (const entry of axiosEntries) {
  assert.ok(
    isAtLeast(entry.version, AXIOS_SECURITY_FLOOR),
    `lockfile axios must be >= ${AXIOS_SECURITY_FLOOR}, got ${entry.version}`,
  )
}
const axiosFormDataResolutions = axiosEntries
  .flatMap((entry) => [...entry.body.matchAll(/^ {6}form-data: (\S+)$/gm)].map((match) => match[1]))
assert.ok(axiosFormDataResolutions.length > 0, 'axios snapshot must declare its form-data resolution')
assert.deepEqual(
  [...new Set(axiosFormDataResolutions)],
  ['4.0.6'],
  'axios must dedupe to the patched form-data resolution',
)

// Windows filesystems reject CR/LF and double quotes in file names, so this is
// a local dependency-boundary regression rather than a claim of a physical USB
// reproduction. It proves the serializer itself cannot create injected headers.
const hostileFilename = 'resume"\r\nX-Injected: true\r\nshadow=".pdf'
const hostileBody = multipartBodyFor(hostileFilename)
assert.doesNotMatch(hostileBody, /\r\nX-Injected: true\r\n/, 'multipart filename serialization must not emit an injected header')
assert.match(hostileBody, /filename="resume%22%0D%0AX-Injected: true%0D%0Ashadow=%22\.pdf"/, 'multipart filename serialization must percent-escape CR/LF and quotes')

const ordinaryFilename = '张三 简历.pdf'
const ordinaryBody = multipartBodyFor(ordinaryFilename)
assert.match(ordinaryBody, /filename="张三 简历\.pdf"/, 'ordinary Unicode filenames must remain intact')
assert.match(ordinaryBody, /Content-Type: application\/pdf/, 'ordinary upload metadata must remain intact')

console.log(`ALL PASS: form-data ${installedVersion} closes filename header injection and preserves ordinary Unicode filenames`)
