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
const approverRoles = ['legal', 'compliance', 'security'] as const
const stableApproverIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/
const placeholderMarkerPattern = /(?:^|[._-])(?:test|demo|example|placeholder|sample|todo|tbd|fake|dummy)(?:$|[._-])/i
const automationMarkerPattern =
  /(?:^|[._-])(?:bot|automation|automated|ci|runner|workflow|actions|github[._-]?actions)(?:$|[._-])/i
const compactAutomationTerms = ['bot', 'automation', 'automated', 'runner', 'workflow', 'actions', 'githubactions'] as const
const ciAutomationTerms = ['agent', 'bot', 'runner', 'workflow', 'actions', 'automation', 'automated'] as const

type GateField = (typeof gateFields)[number]
type GateState = 'pending' | 'approved'
type FrontmatterValue = string | number | boolean | null | unknown[]
type FrontmatterRecord = Record<string, FrontmatterValue>
type GateFixture = Readonly<
  Record<GateField, GateState> & {
    status: 'blocked' | 'approved'
    production_default: false
    fail_closed: true
    approved_by: readonly string[]
    approved_at: string | null
  }
>

function parseQuotedString(value: string, key: string): string {
  if (value.startsWith('"')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      assert.fail(`invalid quoted string for ${key}`)
    }
    assert(typeof parsed === 'string', `${key} must contain a string value`)
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
    assert(!Object.prototype.hasOwnProperty.call(parsed, key), `duplicate key: ${key}`)
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

function hasAutomationMarker(stableId: string): boolean {
  if (automationMarkerPattern.test(stableId)) return true

  const compact = stableId.toLowerCase().replace(/[._-]/g, '')
  if (compactAutomationTerms.some((term) => compact.startsWith(term) || compact.endsWith(term))) {
    return true
  }

  return ciAutomationTerms.some(
    (term) => compact.startsWith(`ci${term}`) || compact.endsWith(`${term}ci`),
  )
}

function validateApproverIdentities(approvedBy: unknown[]): Set<string> {
  const seenIdentities = new Set<string>()
  const seenRoles = new Set<string>()
  const seenStableIds = new Set<string>()

  for (const identity of approvedBy) {
    assert(typeof identity === 'string' && identity.length > 0, 'approved_by entries must be non-empty strings')
    assert.equal(identity, identity.trim(), 'approved_by identities must not contain surrounding whitespace')

    const match = identity.match(/^(legal|compliance|security):(.+)$/)
    assert(match, 'approved_by identities must use <role>:<stable-id>')

    const [, role, stableId] = match
    assert(!hasAutomationMarker(stableId), `approved_by stable-id contains an automation marker for role ${role}`)
    assert(stableApproverIdPattern.test(stableId), `approved_by stable-id is invalid for role ${role}`)
    assert(!placeholderMarkerPattern.test(stableId), `approved_by stable-id contains a placeholder marker for role ${role}`)
    assert(!seenIdentities.has(identity), `approved_by contains duplicate identity: ${identity}`)
    assert(!seenRoles.has(role), `approved_by contains duplicate role: ${role}`)
    assert(!seenStableIds.has(stableId), `approved_by contains duplicate stable-id: ${stableId}`)
    seenIdentities.add(identity)
    seenRoles.add(role)
    seenStableIds.add(stableId)
  }

  return seenRoles
}

export function verifyGateSource(source: string): void {
  const gate = parseGateFrontmatter(source)
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')

  assert.deepEqual(Object.keys(gate).sort(), [...allowedKeys].sort(), 'frontmatter must contain exactly the gate schema keys')
  assert.doesNotMatch(
    body,
    /当前(?:状态|阶段|结论)?[^\r\n]{0,80}\bblocked\b/i,
    'document body must not hardcode the current gate status as blocked',
  )
  assert.doesNotMatch(body, /\|\s*当前状态\s*\|/, 'document body must not include a current-status table column')
  for (const field of gateFields) {
    assert.doesNotMatch(
      body,
      new RegExp(`\\|\\s*\`?${field}\`?\\s*\\|\\s*\`?(?:pending|approved)\`?\\s*\\|`, 'i'),
      `document body must not mirror the current ${field} state`,
    )
  }
  assert(
    gate.status === 'blocked' || gate.status === 'approved',
    'contract review release gate status must be blocked or approved',
  )
  assert.strictEqual(gate.production_default, false, 'production_default must be boolean false')
  assert.strictEqual(gate.fail_closed, true, 'fail_closed must be boolean true')

  for (const field of gateFields) {
    assert(gate[field] === 'pending' || gate[field] === 'approved', `${field} must be pending or approved`)
  }

  assert(Array.isArray(gate.approved_by), 'approved_by must be an array')
  const approvedRoles = validateApproverIdentities(gate.approved_by)

  if (gate.status === 'approved') {
    for (const field of gateFields) {
      assert.equal(gate[field], 'approved', `${field} must be approved before status can be approved`)
    }
    for (const role of approverRoles) {
      assert(approvedRoles.has(role), `approved_by must include exactly one ${role} approver`)
    }
    assert.equal(approvedRoles.size, approverRoles.length, 'approved_by must contain exactly the required roles')
    assert(
      typeof gate.approved_at === 'string' && isValidRfc3339(gate.approved_at),
      'approved_at must be a valid RFC3339 timestamp when status is approved',
    )
  } else {
    assert.equal(gate.approved_by.length, 0, 'approved_by must be empty when status is blocked')
    assert.strictEqual(gate.approved_at, null, 'approved_at must be null when status is blocked')
  }
}

function renderFixture(gate: GateFixture): string {
  return [
    '---',
    `status: ${gate.status}`,
    `production_default: ${gate.production_default}`,
    `fail_closed: ${gate.fail_closed}`,
    ...gateFields.map((field) => `${field}: ${gate[field]}`),
    `approved_by: ${JSON.stringify(gate.approved_by)}`,
    `approved_at: ${gate.approved_at ?? 'null'}`,
    '---',
    'Canonical verifier fixture.',
  ].join('\n')
}

const canonicalBlockedGate = Object.freeze({
  status: 'blocked',
  production_default: false,
  fail_closed: true,
  provider_allowlist: 'pending',
  algorithm_filing: 'pending',
  generative_ai_security_assessment: 'pending',
  aigc_visible_label: 'pending',
  aigc_metadata_label: 'pending',
  legal_gold_set: 'pending',
  approved_by: Object.freeze([] as string[]),
  approved_at: null,
} as const satisfies GateFixture)
const canonicalApprovedGate = Object.freeze({
  ...canonicalBlockedGate,
  status: 'approved',
  provider_allowlist: 'approved',
  algorithm_filing: 'approved',
  generative_ai_security_assessment: 'approved',
  aigc_visible_label: 'approved',
  aigc_metadata_label: 'approved',
  legal_gold_set: 'approved',
  approved_by: Object.freeze([
    'legal:contract-governance-counsel',
    'compliance:ai-compliance-office',
    'security:ai-security-office',
  ]),
  approved_at: '2026-08-01T12:00:00+08:00',
} as const satisfies GateFixture)
const canonicalBlockedFixture = renderFixture(canonicalBlockedGate)
const canonicalPartialApprovedFixtures = Object.freeze(
  gateFields.map((field) =>
    renderFixture(
      Object.freeze({
        ...canonicalBlockedGate,
        [field]: 'approved',
      }) as GateFixture,
    ),
  ),
)
const canonicalApprovedFixture = renderFixture(canonicalApprovedGate)

function runRegressionFixtures(): void {
  assert.doesNotThrow(() => verifyGateSource(canonicalBlockedFixture))
  for (const partialApprovedFixture of canonicalPartialApprovedFixtures) {
    assert.doesNotThrow(() => verifyGateSource(partialApprovedFixture))
  }
  assert.doesNotThrow(() => verifyGateSource(canonicalApprovedFixture))
  assert.doesNotThrow(() =>
    verifyGateSource(
      canonicalApprovedFixture.replace(
        /approved_by: .+/,
        'approved_by: ["legal:l", "compliance:co", "security:sec"]',
      ),
    ),
  )
  assert.doesNotThrow(() =>
    verifyGateSource(
      canonicalApprovedFixture.replace('legal:contract-governance-counsel', 'legal:civic-counsel'),
    ),
  )

  assert.throws(
    () => verifyGateSource(canonicalBlockedFixture.replace('status: blocked', 'status: blocked\nstatus: approved')),
    /duplicate key: status/,
  )
  assert.throws(
    () =>
      verifyGateSource(
        canonicalBlockedFixture.replace(
          'production_default: false',
          'production_default: false\nproduction_default: true',
        ),
      ),
    /duplicate key: production_default/,
  )
  assert.throws(
    () => verifyGateSource(canonicalBlockedFixture.replace('status: blocked', 'status: blocked\nescape_hatch: true')),
    /unknown key: escape_hatch/,
  )

  for (const invalidState of ['banana', '', 'null', 'unknown']) {
    assert.throws(
      () =>
        verifyGateSource(
          canonicalBlockedFixture.replace('provider_allowlist: pending', `provider_allowlist: ${invalidState}`),
        ),
      /provider_allowlist/,
    )
  }

  assert.throws(
    () => verifyGateSource(canonicalBlockedFixture.replace('production_default: false', 'production_default: "false"')),
    /production_default must be boolean false/,
  )
  assert.throws(
    () => verifyGateSource(canonicalBlockedFixture.replace('fail_closed: true', 'fail_closed: "true"')),
    /fail_closed must be boolean true/,
  )
  assert.throws(
    () =>
      verifyGateSource(
        canonicalBlockedFixture.replace('approved_by: []', 'approved_by: ["legal:contract-governance-counsel"]'),
      ),
    /approved_by must be empty when status is blocked/,
  )
  assert.throws(
    () => verifyGateSource(canonicalBlockedFixture.replace('approved_at: null', 'approved_at: 2026-08-01T12:00:00Z')),
    /approved_at must be null when status is blocked/,
  )
  assert.throws(
    () => verifyGateSource(canonicalApprovedFixture.replace(/approved_at: .+/, 'approved_at: null')),
    /approved_at must be a valid RFC3339 timestamp/,
  )
  assert.throws(
    () => verifyGateSource(canonicalApprovedFixture.replace(/approved_at: .+/, 'approved_at: 2026-02-30T12:00:00Z')),
    /approved_at must be a valid RFC3339 timestamp/,
  )
  assert.throws(
    () => verifyGateSource(canonicalApprovedFixture.replace(/approved_by: .+/, 'approved_by: []')),
    /must include exactly one legal approver/,
  )
  assert.throws(
    () => verifyGateSource(canonicalApprovedFixture.replace(/approved_by: .+/, 'approved_by: legal:governance-counsel')),
    /approved_by must be an array/,
  )
  assert.throws(
    () => verifyGateSource(canonicalApprovedFixture.replace(/approved_by: .+/, 'approved_by: [""]')),
    /approved_by entries must be non-empty/,
  )
  assert.throws(
    () => verifyGateSource(canonicalApprovedFixture.replace(/approved_by: .+/, 'approved_by: [123]')),
    /approved_by entries must be non-empty/,
  )
  assert.throws(
    () =>
      verifyGateSource(
        canonicalApprovedFixture.replace(
          /approved_by: .+/,
          'approved_by: ["legal:contract-governance-counsel", "legal:legal-review-counsel", "security:ai-security-office"]',
        ),
      ),
    /duplicate role: legal/,
  )
  assert.throws(
    () =>
      verifyGateSource(
        canonicalApprovedFixture.replace(
          /approved_by: .+/,
          'approved_by: ["legal:contract-governance-counsel", "legal:contract-governance-counsel", "security:ai-security-office"]',
        ),
      ),
    /duplicate identity: legal:contract-governance-counsel/,
  )
  assert.throws(
    () =>
      verifyGateSource(
        canonicalApprovedFixture.replace(
          /approved_by: .+/,
          'approved_by: ["legal:contract-governance-counsel", "compliance:demo-account", "security:ai-security-office"]',
        ),
      ),
    /placeholder marker for role compliance/,
  )
  assert.throws(
    () =>
      verifyGateSource(
        canonicalApprovedFixture.replace(
          /approved_by: .+/,
          'approved_by: ["legal:contract-governance-counsel", "security:ai-security-office"]',
        ),
      ),
    /must include exactly one compliance approver/,
  )
  assert.throws(
    () =>
      verifyGateSource(
        canonicalApprovedFixture.replace(
          /approved_by: .+/,
          'approved_by: ["legal:shared-review-office", "compliance:shared-review-office", "security:shared-review-office"]',
        ),
      ),
    /duplicate stable-id: shared-review-office/,
  )
  assert.throws(
    () =>
      verifyGateSource(
        canonicalApprovedFixture.replace(
          /approved_by: .+/,
          `approved_by: ["legal:contract-governance-counsel", "compliance:${'a'.repeat(65)}", "security:ai-security-office"]`,
        ),
      ),
    /stable-id is invalid for role compliance/,
  )
  for (const automatedStableId of [
    'bot-approver',
    'automation-agent',
    'Automated.Reviewer',
    'ci-runner',
    'release_runner',
    'workflow-owner',
    'actions-approver',
    'github-actions',
    'GitHub_Actions',
    'GitHubActions',
    'approvalbot',
    'botapprover',
    'automationrunner',
    'automatedreviewer',
    'ciagent',
    'workflowowner',
    'actionsapprover',
  ]) {
    assert.throws(
      () =>
        verifyGateSource(
          canonicalApprovedFixture.replace(
            /approved_by: .+/,
            `approved_by: ["legal:contract-governance-counsel", "compliance:${automatedStableId}", "security:ai-security-office"]`,
          ),
        ),
      /automation marker for role compliance/,
    )
  }
  assert.throws(
    () =>
      verifyGateSource(
        canonicalBlockedFixture.replace('Canonical verifier fixture.', '当前状态为 blocked。'),
      ),
    /must not hardcode the current gate status as blocked/,
  )
  assert.throws(
    () =>
      verifyGateSource(
        canonicalBlockedFixture.replace(
          'Canonical verifier fixture.',
          '| `provider_allowlist` | `pending` | mirrored state |',
        ),
      ),
    /must not mirror the current provider_allowlist state/,
  )
}

const source = readFileSync(gatePath, 'utf8')
verifyGateSource(source)
runRegressionFixtures()

console.log(
  'Contract review Gate 0 verification passed: lifecycle fixtures accepted; duplicate stable IDs, automation identities, and other negative fixtures rejected.',
)
