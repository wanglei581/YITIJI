import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../../..')
const gatePath = resolve(repoRoot, 'docs/compliance/contract-review-release-gate.md')
const gateFields = [
  'provider_allowlist',
  'algorithm_filing',
  'generative_ai_security_assessment',
  'aigc_visible_label',
  'aigc_metadata_label',
  'legal_gold_set',
] as const
const allowedKeys = [
  'status',
  'production_default',
  'fail_closed',
  ...gateFields,
  'approved_by',
  'approved_at',
] as const
const allowedKeySet = new Set<string>(allowedKeys)

type FrontmatterValue = string | number | boolean | null | unknown[]
type FrontmatterRecord = Record<string, FrontmatterValue>

function parseQuotedString(value: string, key: string): string {
  if (value.startsWith('"')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      assert.fail(`invalid quoted string for ${key}`)
    }
    assert.equal(typeof parsed, 'string', `${key} must contain a string value`)
    return parsed
  }

  assert(value.endsWith("'"), `invalid quoted string for ${key}`)
  return value.slice(1, -1).replace(/''/g, "'")
}

function parseValue(rawValue: string, key: string): FrontmatterValue {
  assert(rawValue.length > 0, `${key} must not have an empty YAML value`)

  if (rawValue === 'true') return true
  if (rawValue === 'false') return false
  if (rawValue === 'null' || rawValue === '~') return null

  if (rawValue.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawValue)
    } catch {
      assert.fail(`${key} must use a valid JSON-compatible inline YAML array`)
    }
    assert(Array.isArray(parsed), `${key} must be an array`)
    return parsed
  }

  if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
    return parseQuotedString(rawValue, key)
  }

  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rawValue)) {
    return Number(rawValue)
  }

  const hasUnsupportedSyntax = /[{},#&*!|>`]/.test(rawValue) || rawValue.includes('[') || rawValue.includes(']')
  assert(!hasUnsupportedSyntax, `unsupported YAML syntax for ${key}`)
  return rawValue
}

export function parseGateFrontmatter(source: string): FrontmatterRecord {
  const frontmatterMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  assert(frontmatterMatch, 'contract review release gate must include YAML frontmatter')

  const parsed: FrontmatterRecord = Object.create(null) as FrontmatterRecord

  for (const [index, line] of frontmatterMatch[1].split(/\r?\n/).entries()) {
    assert(line.trim().length > 0, `frontmatter line ${index + 1} must not be blank`)
    assert(!/^\s/.test(line), `frontmatter line ${index + 1} must be a top-level field`)

    const pair = line.match(/^([a-z_][a-z0-9_]*):[ \t]*(.*)$/i)
    assert(pair, `invalid frontmatter field on line ${index + 1}`)

    const [, key, rawValue] = pair
    assert(allowedKeySet.has(key), `unknown key: ${key}`)
    assert(!Object.hasOwn(parsed, key), `duplicate key: ${key}`)
    parsed[key] = parseValue(rawValue.trim(), key)
  }

  return parsed
}

function isValidRfc3339(value: string): boolean {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/,
  )
  if (!match) return false

  const [, year, month, day, hour, minute, second, , , offsetHour = '00', offsetMinute = '00'] = match
  const numericYear = Number(year)
  const numericMonth = Number(month)
  const numericDay = Number(day)
  const daysInMonth = new Date(Date.UTC(numericYear, numericMonth, 0)).getUTCDate()

  return (
    numericMonth >= 1 &&
    numericMonth <= 12 &&
    numericDay >= 1 &&
    numericDay <= daysInMonth &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59 &&
    Number(offsetHour) <= 23 &&
    Number(offsetMinute) <= 59 &&
    !Number.isNaN(Date.parse(value))
  )
}

export function verifyGateSource(source: string): void {
  const gate = parseGateFrontmatter(source)

  assert.deepEqual(Object.keys(gate).sort(), [...allowedKeys].sort(), 'frontmatter must contain exactly the gate schema keys')
  assert(
    gate.status === 'blocked' || gate.status === 'approved',
    'contract review release gate status must be blocked or approved',
  )
  assert.strictEqual(gate.production_default, false, 'production_default must be boolean false')
  assert.strictEqual(gate.fail_closed, true, 'fail_closed must be boolean true')

  for (const field of gateFields) {
    assert(
      gate[field] === 'pending' || gate[field] === 'approved',
      `${field} must be pending or approved`,
    )
  }

  assert(Array.isArray(gate.approved_by), 'approved_by must be an array')
  assert(
    gate.approved_by.every((identity) => typeof identity === 'string' && identity.trim().length > 0),
    'approved_by entries must be non-empty identity strings',
  )

  if (gate.status === 'approved') {
    for (const field of gateFields) {
      assert.equal(gate[field], 'approved', `${field} must be approved before status can be approved`)
    }
    assert(gate.approved_by.length > 0, 'approved_by must be non-empty when status is approved')
    assert(
      typeof gate.approved_at === 'string' && isValidRfc3339(gate.approved_at),
      'approved_at must be a valid RFC3339 timestamp when status is approved',
    )
  } else {
    assert.equal(gate.approved_by.length, 0, 'approved_by must be empty when status is blocked')
    assert.strictEqual(gate.approved_at, null, 'approved_at must be null when status is blocked')
  }
}

function makeApproved(source: string): string {
  return source
    .replace('status: blocked', 'status: approved')
    .replace(/: pending/g, ': approved')
    .replace('approved_by: []', 'approved_by: ["legal@example.com", "security@example.com"]')
    .replace('approved_at: null', 'approved_at: 2026-08-01T12:00:00+08:00')
}

function runRegressionFixtures(validSource: string): void {
  const duplicateStatus = validSource.replace('status: blocked', 'status: blocked\nstatus: approved')
  assert.throws(() => verifyGateSource(duplicateStatus), /duplicate key: status/)

  const duplicateProductionDefault = validSource.replace(
    'production_default: false',
    'production_default: false\nproduction_default: true',
  )
  assert.throws(() => verifyGateSource(duplicateProductionDefault), /duplicate key: production_default/)

  const unknownKey = validSource.replace('status: blocked', 'status: blocked\nunreviewed_escape_hatch: true')
  assert.throws(() => verifyGateSource(unknownKey), /unknown key: unreviewed_escape_hatch/)

  for (const invalidState of ['banana', '', 'null', 'unknown']) {
    const invalidGateState = validSource.replace(
      'provider_allowlist: pending',
      `provider_allowlist: ${invalidState}`,
    )
    assert.throws(() => verifyGateSource(invalidGateState), /provider_allowlist/)
  }

  const blockedWithApprover = validSource.replace('approved_by: []', 'approved_by: ["legal@example.com"]')
  assert.throws(() => verifyGateSource(blockedWithApprover), /approved_by must be empty when status is blocked/)

  const blockedWithTimestamp = validSource.replace('approved_at: null', 'approved_at: 2026-08-01T12:00:00Z')
  assert.throws(() => verifyGateSource(blockedWithTimestamp), /approved_at must be null when status is blocked/)

  const approvedWithoutTimestamp = makeApproved(validSource).replace(
    'approved_at: 2026-08-01T12:00:00+08:00',
    'approved_at: null',
  )
  assert.throws(() => verifyGateSource(approvedWithoutTimestamp), /approved_at must be a valid RFC3339 timestamp/)

  const approvedWithEmptyApprovers = makeApproved(validSource).replace(
    'approved_by: ["legal@example.com", "security@example.com"]',
    'approved_by: []',
  )
  assert.throws(() => verifyGateSource(approvedWithEmptyApprovers), /approved_by must be non-empty/)

  const approvedWithScalarApprover = makeApproved(validSource).replace(
    'approved_by: ["legal@example.com", "security@example.com"]',
    'approved_by: legal@example.com',
  )
  assert.throws(() => verifyGateSource(approvedWithScalarApprover), /approved_by must be an array/)

  const approvedWithInvalidTimestamp = makeApproved(validSource).replace(
    'approved_at: 2026-08-01T12:00:00+08:00',
    'approved_at: 2026-02-30T12:00:00Z',
  )
  assert.throws(() => verifyGateSource(approvedWithInvalidTimestamp), /approved_at must be a valid RFC3339 timestamp/)

  const approvedWithBlankApprover = makeApproved(validSource).replace(
    'approved_by: ["legal@example.com", "security@example.com"]',
    'approved_by: [""]',
  )
  assert.throws(() => verifyGateSource(approvedWithBlankApprover), /approved_by entries/)

  const approvedWithNonStringApprover = makeApproved(validSource).replace(
    'approved_by: ["legal@example.com", "security@example.com"]',
    'approved_by: [123]',
  )
  assert.throws(() => verifyGateSource(approvedWithNonStringApprover), /approved_by entries/)

  const quotedProductionDefault = validSource.replace('production_default: false', 'production_default: "false"')
  assert.throws(() => verifyGateSource(quotedProductionDefault), /production_default must be boolean false/)

  const quotedFailClosed = validSource.replace('fail_closed: true', 'fail_closed: "true"')
  assert.throws(() => verifyGateSource(quotedFailClosed), /fail_closed must be boolean true/)

  assert.doesNotThrow(() => verifyGateSource(makeApproved(validSource)))
}

const source = readFileSync(gatePath, 'utf8')
runRegressionFixtures(source)
verifyGateSource(source)

console.log('Contract review Gate 0 verification passed: schema, regression fixtures, and record are valid.')
