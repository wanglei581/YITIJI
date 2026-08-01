import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../../..')
const gatePath = resolve(repoRoot, 'docs/compliance/contract-review-release-gate.md')
const source = readFileSync(gatePath, 'utf8')
const frontmatterMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)

assert(frontmatterMatch, 'contract review release gate must include YAML frontmatter')

const frontmatter = frontmatterMatch[1]
const gateFields = [
  'provider_allowlist',
  'algorithm_filing',
  'generative_ai_security_assessment',
  'aigc_visible_label',
  'aigc_metadata_label',
  'legal_gold_set',
] as const

function readField(name: string): string {
  const match = frontmatter.match(new RegExp(`^${name}:[ \\t]*(.*?)[ \\t]*$`, 'm'))
  assert(match, `contract review release gate is missing ${name}`)
  return match[1]
}

function hasApprovedBy(): boolean {
  const lines = frontmatter.split(/\r?\n/)
  const fieldIndex = lines.findIndex((line) => /^approved_by:\s*/.test(line))

  assert(fieldIndex >= 0, 'contract review release gate is missing approved_by')

  const inlineValue = lines[fieldIndex].replace(/^approved_by:\s*/, '').trim()
  if (inlineValue) {
    return !/^(?:null|~|\[\s*\]|["']\s*["'])$/i.test(inlineValue)
  }

  for (const line of lines.slice(fieldIndex + 1)) {
    if (/^[a-z_][a-z0-9_]*:/i.test(line)) {
      return false
    }
    if (/^\s+-\s+\S/.test(line)) {
      return true
    }
  }

  return false
}

const status = readField('status')
assert(
  status === 'blocked' || status === 'approved',
  'contract review release gate status must be blocked or approved',
)
assert.equal(readField('production_default'), 'false', 'contract review production_default must be false')

for (const field of gateFields) {
  readField(field)
}

if (status === 'approved') {
  for (const field of gateFields) {
    assert.equal(readField(field), 'approved', `${field} must be approved before status can be approved`)
  }
  assert(hasApprovedBy(), 'approved_by must be non-empty before status can be approved')
} else {
  readField('approved_by')
}

assert.match(
  source,
  /任何一项未签字 approved[，,]\s*真实合同 AI 调用和生产入口都必须保持关闭/,
  'contract review release gate must state the fail-closed production policy',
)

console.log('Contract review Gate 0 verification passed: record is complete and internally consistent.')
