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
assert.match(lockfile, /axios@1\.16\.1:[\s\S]*?form-data: 4\.0\.6/, 'axios must dedupe to the patched form-data resolution')

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
