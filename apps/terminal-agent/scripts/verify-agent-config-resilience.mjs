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
const diagnostics = require(join(agentRoot, 'src/agent/startup-diagnostics.ts'))

const configManagerSource = fs.readFileSync(path.join(agentRoot, 'src/agent/config-manager.ts'), 'utf8')
assert.match(
  configManagerSource,
  /path\.dirname\(filePath\)/,
  'atomic writes must create their temporary file in the primary config directory',
)
assert.match(
  configManagerSource,
  /path\.join\(dir,\s*/,
  'atomic writes must derive their temporary file path from that directory',
)
assert.match(
  configManagerSource,
  /fs\.openSync\(tempPath,\s*['"]wx['"]/,
  'atomic writes must create the temporary file exclusively',
)
assert.match(configManagerSource, /fs\.fsyncSync\(/, 'atomic writes must fsync before replacement')
assert.match(
  configManagerSource,
  /fs\.renameSync\(tempPath,\s*filePath\)/,
  'atomic writes must replace the primary config with rename',
)
assert.match(
  configManagerSource,
  /finally\s*\{[\s\S]*?fs\.rmSync\(tempPath/,
  'atomic writes must remove the temporary file in finally cleanup',
)

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
  diagnostics.writeStartupDiagnostic(diagnosticPath, 'AGENT_CONFIG_INVALID_JSON')
  const diagnostic = diagnostics.readStartupDiagnostic(diagnosticPath)
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
