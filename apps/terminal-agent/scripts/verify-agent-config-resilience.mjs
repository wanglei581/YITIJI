import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
require('ts-node/register')

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const root = resolve(__dirname, '..')

const {
  AgentStartupError,
  parseConfigText,
  serializePersistedConfig,
  writeValidatedConfigAt,
} = require(join(root, 'src/agent/config-manager.ts'))
const {
  readStartupDiagnostic,
  writeStartupDiagnostic,
} = require(join(root, 'src/agent/startup-diagnostics.ts'))

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
  const diagnosticPath = join(tempDir, 'startup-diagnostic.txt')

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

  const persistedText = serializePersistedConfig({
    ...valid,
    agentToken: 'must-not-persist',
    adminSecret: 'must-not-persist',
  })
  const persistedConfig = JSON.parse(persistedText)
  assert.deepEqual(persistedConfig, valid, 'must serialize only non-sensitive persisted config')
  assert.equal(persistedText.includes('agentToken'), false, 'must not serialize agentToken')
  assert.equal(persistedText.includes('adminSecret'), false, 'must not serialize adminSecret')

  writeFileSync(configPath, serializePersistedConfig(valid), 'utf8')
  writeValidatedConfigAt(configPath, backupPath, { ...valid, terminalCode: 'KSK-002' })

  assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).terminalCode, 'KSK-002')
  assert.equal(JSON.parse(readFileSync(backupPath, 'utf8')).terminalCode, 'KSK-001')

  const primaryBeforeInvalidWrite = readFileSync(configPath, 'utf8')
  assertStartupError(
    () => writeValidatedConfigAt(configPath, backupPath, { ...valid, agentVersion: '' }),
    'AGENT_CONFIG_REQUIRED_FIELD_MISSING',
  )
  assert.equal(readFileSync(configPath, 'utf8'), primaryBeforeInvalidWrite, 'must not alter primary config after validation fails')

  writeStartupDiagnostic(diagnosticPath, 'AGENT_CONFIG_INVALID_JSON')
  assert.equal(readStartupDiagnostic(diagnosticPath), 'AGENT_CONFIG_INVALID_JSON')
  assert.equal(
    readFileSync(diagnosticPath, 'utf8').includes('must-not-persist'),
    false,
    'must not persist sensitive configuration values in startup diagnostics',
  )

  console.log('ALL PASS: agent config resilience')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
