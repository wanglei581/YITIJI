import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
require('ts-node/register')

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const agentRoot = resolve(__dirname, '..')

const {
  AgentStartupError,
  parseConfigText,
  serializePersistedConfig,
  writeValidatedConfigAt,
} = require(join(agentRoot, 'src/agent/config-manager.ts'))
const {
  readStartupDiagnostic,
  writeStartupDiagnostic,
  writeStartupDiagnosticSafely,
} = require(join(agentRoot, 'src/agent/startup-diagnostics.ts'))
const indexSource = fs.readFileSync(path.join(agentRoot, 'src/index.ts'), 'utf8')

const configManagerSource = fs.readFileSync(path.join(agentRoot, 'src/agent/config-manager.ts'), 'utf8')
const atomicWriterMatch = configManagerSource.match(/function writeTextAtomically\([\s\S]*?\n}\n/s)
assert.ok(atomicWriterMatch, 'config manager must define writeTextAtomically')
const atomicWriter = atomicWriterMatch[0]
assert.match(
  atomicWriter,
  /path\.dirname\(filePath\)/,
  'atomic writes must create their temporary file in the primary config directory',
)
assert.match(
  atomicWriter,
  /path\.join\(dir,\s*/,
  'atomic writes must derive their temporary file path from that directory',
)

const atomicWriteSteps = [
  ['open', "fs.openSync(tempPath, 'wx'"],
  ['write', 'fs.writeFileSync'],
  ['fsync', 'fs.fsyncSync'],
  ['close', 'fs.closeSync'],
  ['rename', 'fs.renameSync(tempPath, filePath)'],
]
let previousStepIndex = -1
for (const [step, source] of atomicWriteSteps) {
  const stepIndex = atomicWriter.indexOf(source)
  assert.notEqual(stepIndex, -1, `atomic writer must ${step}`)
  assert.ok(stepIndex > previousStepIndex, `atomic writer must ${step} after the preceding step`)
  previousStepIndex = stepIndex
}

const cleanupIndex = atomicWriter.indexOf('fs.rmSync(tempPath')
assert.ok(cleanupIndex > previousStepIndex, 'atomic writer must clean up its temp file after rename')
assert.match(
  atomicWriter,
  /finally\s*\{[\s\S]*?fs\.rmSync\(tempPath/,
  'atomic writes must remove the temporary file in finally cleanup',
)

const writeValidatedMatch = configManagerSource.match(/function writeValidatedConfigAt\([\s\S]*?\n}\n/s)
assert.ok(writeValidatedMatch, 'config manager must define writeValidatedConfigAt')
const writeValidatedConfig = writeValidatedMatch[0]
const primaryParseIndex = writeValidatedConfig.indexOf('parseConfigText(fs.readFileSync(configPath')
const backupWriteIndex = writeValidatedConfig.indexOf('writeTextAtomically(lastKnownGoodPath')
const primaryWriteIndex = writeValidatedConfig.indexOf('writeTextAtomically(configPath')
assert.notEqual(primaryParseIndex, -1, 'must parse the existing primary config before any write')
assert.notEqual(backupWriteIndex, -1, 'must write the last-known-good backup through the atomic writer')
assert.notEqual(primaryWriteIndex, -1, 'must write the primary config through the atomic writer')
assert.ok(primaryParseIndex < backupWriteIndex, 'must parse primary config before writing its backup')
assert.ok(backupWriteIndex < primaryWriteIndex, 'must write the backup before replacing the primary config')

const failStartupMatch = indexSource.match(/function failStartup\([\s\S]*?\n}\n/s)
assert.ok(failStartupMatch, 'agent entrypoint must define failStartup')
const failStartupSource = failStartupMatch[0]
const safeDiagnosticIndex = failStartupSource.indexOf('writeStartupDiagnosticSafely')
const failureLogIndex = failStartupSource.indexOf('err(`${code}: Agent did not start.')
const exitIndex = failStartupSource.indexOf('process.exit(1)')
assert.notEqual(safeDiagnosticIndex, -1, 'failStartup must use the non-blocking diagnostic writer')
assert.notEqual(failureLogIndex, -1, 'failStartup must retain its closed-code log')
assert.notEqual(exitIndex, -1, 'failStartup must exit after reporting the closed code')
assert.ok(safeDiagnosticIndex < failureLogIndex, 'failStartup must attempt diagnostics before logging the closed code')
assert.ok(failureLogIndex < exitIndex, 'failStartup must log the closed code before exiting')
const readyDiagnosticIndex = indexSource.indexOf("writeStartupDiagnosticSafely('AGENT_READY'")
const heartbeatIndex = indexSource.indexOf('const heartbeatTimer = startHeartbeat')
assert.notEqual(readyDiagnosticIndex, -1, 'registration success must use the non-blocking ready diagnostic')
assert.notEqual(heartbeatIndex, -1, 'agent entrypoint must start the heartbeat loop')
assert.ok(readyDiagnosticIndex < heartbeatIndex, 'ready diagnostic must be attempted before heartbeat startup')

const valid = {
  apiBaseUrl: 'https://api.example.test/api/v1',
  terminalCode: 'KSK-001',
  printerName: 'Test Printer',
  agentVersion: '0.3.0',
  terminalId: 'terminal-test',
}

function assertStartupError(action, code) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof AgentStartupError, 'must throw AgentStartupError')
    assert.equal(error.code, code)
    return true
  })
}

const tempDir = mkdtempSync(join(tmpdir(), 'agent-config-resilience-'))

try {
  const configPath = join(tempDir, 'agent-config.json')
  const backupPath = join(tempDir, 'agent-config.backup.json')
  const diagnosticPath = join(tempDir, 'last-startup-diagnostic.json')

  assert.equal(
    parseConfigText(`\uFEFF${JSON.stringify(valid)}`).terminalCode,
    'KSK-001',
    'must parse valid JSON that starts with a UTF-8 BOM',
  )

  assertStartupError(() => parseConfigText('{'), 'AGENT_CONFIG_INVALID_JSON')
  assertStartupError(
    () => parseConfigText(JSON.stringify({ ...valid, printerName: '   ' })),
    'AGENT_CONFIG_REQUIRED_FIELD_MISSING',
  )
  assertStartupError(
    () => parseConfigText(JSON.stringify({ ...valid, agentToken: 1 })),
    'AGENT_CONFIG_INVALID_FIELD',
  )
  assertStartupError(
    () => parseConfigText(JSON.stringify({ ...valid, adminSecret: '' })),
    'AGENT_CONFIG_INVALID_FIELD',
  )
  assertStartupError(
    () => parseConfigText(JSON.stringify({ ...valid, apiBaseUrl: 1 })),
    'AGENT_CONFIG_INVALID_FIELD',
  )
  assertStartupError(
    () => parseConfigText(JSON.stringify({ ...valid, apiBaseUrl: '   ' })),
    'AGENT_CONFIG_REQUIRED_FIELD_MISSING',
  )
  const optionalFallbackConfig = parseConfigText(JSON.stringify({
    ...valid,
    localApiPort: 0,
    scanWatchFolder: '',
    localApiBridgeToken: '',
    localApiAllowedOrigins: [],
  }))
  assert.equal(optionalFallbackConfig.localApiPort, 0, 'localApiPort=0 must preserve automatic port selection')
  assert.equal(optionalFallbackConfig.scanWatchFolder, '', 'empty scan folder must preserve feature disablement')
  assert.equal(optionalFallbackConfig.localApiBridgeToken, '', 'empty bridge token must preserve bridge disablement')
  assert.deepEqual(optionalFallbackConfig.localApiAllowedOrigins, [], 'empty origins must preserve local API fallback')

  const sensitiveConfig = {
    agentToken: 'agent-token-must-not-persist',
    adminSecret: 'admin-secret-must-not-persist',
    bindCode: 'bind-code-must-not-persist',
    _comment: 'comment-must-not-persist',
  }
  const persistedText = serializePersistedConfig({
    ...valid,
    ...sensitiveConfig,
  })
  const persistedConfig = JSON.parse(persistedText)
  assert.deepEqual(persistedConfig, valid, 'must serialize only non-sensitive persisted config')
  for (const [key, value] of Object.entries(sensitiveConfig)) {
    assert.equal(key in persistedConfig, false, `must not persist ${key}`)
    assert.equal(persistedText.includes(value), false, `must not serialize ${key}'s value`)
  }

  writeFileSync(configPath, serializePersistedConfig(valid), 'utf8')
  writeValidatedConfigAt(configPath, backupPath, { ...valid, terminalCode: 'KSK-002' })

  assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).terminalCode, 'KSK-002')
  assert.equal(JSON.parse(readFileSync(backupPath, 'utf8')).terminalCode, 'KSK-001')

  const primaryAfterValidWrite = readFileSync(configPath, 'utf8')
  const backupAfterValidWrite = readFileSync(backupPath, 'utf8')
  writeFileSync(configPath, '{', 'utf8')
  const corruptedPrimaryBeforeWrite = readFileSync(configPath, 'utf8')
  assertStartupError(
    () => writeValidatedConfigAt(configPath, backupPath, valid),
    'AGENT_CONFIG_INVALID_JSON',
  )
  assert.equal(
    readFileSync(configPath, 'utf8'),
    corruptedPrimaryBeforeWrite,
    'must not overwrite a corrupted primary config',
  )
  assert.equal(
    readFileSync(backupPath, 'utf8'),
    backupAfterValidWrite,
    'must not overwrite the backup when the primary config is corrupted',
  )

  writeFileSync(configPath, primaryAfterValidWrite, 'utf8')
  const primaryBeforeInvalidWrite = readFileSync(configPath, 'utf8')
  assertStartupError(
    () => writeValidatedConfigAt(configPath, backupPath, { ...valid, agentVersion: '' }),
    'AGENT_CONFIG_REQUIRED_FIELD_MISSING',
  )
  assert.equal(readFileSync(configPath, 'utf8'), primaryBeforeInvalidWrite, 'must not alter primary config after validation fails')

  assert.equal(basename(diagnosticPath), 'last-startup-diagnostic.json')
  let diagnosticFailureObserved = false
  assert.equal(
    writeStartupDiagnosticSafely('AGENT_READY', {
      writer: () => {
        throw new Error('diagnostic test failure')
      },
      onFailure: () => {
        diagnosticFailureObserved = true
      },
    }),
    false,
    'safe diagnostic writer must absorb writer failures',
  )
  assert.equal(diagnosticFailureObserved, true, 'safe diagnostic writer must invoke the failure callback')
  assert.equal(
    writeStartupDiagnosticSafely('AGENT_READY', { filePath: diagnosticPath, writer: writeStartupDiagnostic }),
    true,
    'safe diagnostic writer must report successful writes',
  )
  const readyDiagnostic = readStartupDiagnostic(diagnosticPath)
  assert.equal(readyDiagnostic.code, 'AGENT_READY')
  assert.equal(readyDiagnostic.state, 'ready')

  writeStartupDiagnostic(diagnosticPath, 'AGENT_CONFIG_INVALID_JSON')
  const diagnostic = readStartupDiagnostic(diagnosticPath)
  assert.equal(diagnostic.code, 'AGENT_CONFIG_INVALID_JSON')
  assert.equal(diagnostic.schemaVersion, 1)
  assert.equal(diagnostic.state, 'failed')
  assert.equal(Number.isNaN(Date.parse(diagnostic.recordedAt)), false, 'recordedAt must be parseable')
  const diagnosticText = readFileSync(diagnosticPath, 'utf8')
  assert.deepEqual(
    Object.keys(JSON.parse(diagnosticText)).sort(),
    ['code', 'recordedAt', 'schemaVersion', 'state'],
    'startup diagnostic must persist only its public schema fields',
  )

  console.log('ALL PASS: agent config resilience')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
