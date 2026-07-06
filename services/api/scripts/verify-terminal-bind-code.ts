/**
 * Static safety verification for the commercial Terminal Agent bind-code flow.
 *
 * It does not connect to a database. It locks the security contract:
 * - schemas expose TerminalBindCode with codeHash only;
 * - admin can create one-time codes, terminal can exchange them without adminSecret;
 * - plaintext bindCode is returned once and not written to audit payload;
 * - creating a new code revokes previous active codes for the same terminal.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(rel: string): string {
  const abs = join(root, rel)
  if (!existsSync(abs)) fail(`missing required file: ${rel}`)
  return readFileSync(abs, 'utf8')
}

function pass(message: string) {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message)
  pass(message)
}

console.log('\n=== terminal bind-code safety verification ===')

const sqliteSchema = read('prisma/schema.prisma')
const pgSchema = read('prisma/postgres/schema.prisma')
const migration = read('prisma/migrations/20260705193000_add_terminal_bind_code/migration.sql')
const adminController = read('src/terminals/admin-terminals.controller.ts')
const terminalController = read('src/terminals/terminals.controller.ts')
const service = read('src/terminals/terminals.service.ts')
const createDto = read('src/terminals/dto/create-terminal-bind-code.dto.ts')
const exchangeDto = read('src/terminals/dto/exchange-terminal-bind-code.dto.ts')
const installer = read('../../apps/terminal-agent/scripts/install-production-agent.ps1')

for (const [name, schema] of [['sqlite', sqliteSchema], ['postgres', pgSchema]] as const) {
  assert(schema.includes('model TerminalBindCode'), `${name} schema defines TerminalBindCode`)
  assert(schema.includes('codeHash     String') && schema.includes('@unique'), `${name} schema stores unique codeHash`)
  assert(!/^\s*bindCode\s+\w+/m.test(schema), `${name} schema does not store plaintext bindCode field`)
  assert(schema.includes('revokedAt') && schema.includes('usedAt') && schema.includes('expiresAt'), `${name} schema tracks revoked/used/expiry`)
}

assert(migration.includes('CREATE TABLE "TerminalBindCode"'), 'SQLite migration creates TerminalBindCode')
assert(migration.includes('"codeHash" TEXT NOT NULL') && migration.includes('TerminalBindCode_codeHash_key'), 'SQLite migration stores unique codeHash')

assert(adminController.includes("@Post(':terminalId/bind-code')"), 'admin controller exposes POST /admin/terminals/:terminalId/bind-code')
assert(adminController.includes("action: 'terminal.bind_code.create'"), 'admin controller writes bind-code create audit action')
assert(adminController.includes('bindCodeReturnedOnce: true'), 'admin audit payload records one-time return marker')
assert(!/payload:\s*{[\s\S]{0,500}bindCode\s*:/m.test(adminController), 'admin audit payload does not write plaintext bindCode')

assert(terminalController.includes("@Post('auth/terminal/exchange-bind-code')"), 'terminal auth controller exposes exchange-bind-code')
const exchangeMethod = terminalController.slice(
  terminalController.indexOf('exchangeBindCode('),
  terminalController.indexOf('// ── 2. Heartbeat'),
)
assert(!exchangeMethod.includes('adminSecret'), 'exchange-bind-code method does not read adminSecret')

assert(createDto.includes('@Min(1)') && createDto.includes('@Max(60)'), 'create DTO clamps TTL to 1-60 minutes')
assert(exchangeDto.includes('bindCode') && exchangeDto.includes('deviceFingerprint'), 'exchange DTO requires bindCode and deviceFingerprint')

assert(service.includes('function hashBindCode') && service.includes("createHash('sha256')"), 'service hashes bindCode with SHA-256')
assert(service.includes("BIND_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'"), 'service uses human-readable bind-code alphabet')
assert(service.includes('for (let i = 0; i < 20; i++)'), 'service generates fixed 20-character bind codes')
assert(service.includes('terminalBindCode.updateMany') && service.includes('revokedAt: now'), 'createBindCode revokes previous active bind codes')
assert(service.includes('codeHash: hashBindCode(bindCode)'), 'service persists bind code hash')
assert(!/terminalBindCode\.create\([\s\S]{0,600}bindCode\s*:/m.test(service), 'service does not persist plaintext bindCode in TerminalBindCode.create')
assert(service.includes('BIND_CODE_REVOKED') && service.includes('BIND_CODE_USED') && service.includes('BIND_CODE_EXPIRED'), 'exchange rejects revoked/used/expired codes')
assert(service.includes('const consumed = await tx.terminalBindCode.updateMany') && service.includes('consumed.count !== 1'), 'exchange consumes bind code with a conditional update for one-time race safety')
assert(service.includes('agentToken') && service.includes('usedAt: now'), 'exchange rotates terminal token and marks code used')
assert(service.includes("action: 'terminal.bind_code.exchange'"), 'exchange writes a terminal bind-code exchange audit action')
assert(!/terminal\.bind_code\.exchange[\s\S]{0,800}bindCode\s*:/m.test(service), 'exchange audit payload does not write plaintext bindCode')

assert(installer.includes('[string]$BindCode') && installer.includes('/auth/terminal/exchange-bind-code'), 'installer supports -BindCode exchange path')
assert(installer.includes('Protect-AgentToken -Token $exchange.terminalToken'), 'installer stores exchanged terminalToken with DPAPI')

console.log('\nALL PASS')
