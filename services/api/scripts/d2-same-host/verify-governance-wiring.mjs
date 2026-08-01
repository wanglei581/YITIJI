#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { verifyRunScriptWiring } from './governance-contract.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const RUN_PATH = join(SCRIPT_DIR, 'run.sh')
const START = '# D2_GOVERNANCE_INVOKE_START'
const END = '# D2_GOVERNANCE_INVOKE_END'

function markerBlock(source) {
  assert.equal(source.split(START).length, 2)
  assert.equal(source.split(END).length, 2)
  const start = source.indexOf(START)
  const end = source.indexOf(END, start)
  assert.ok(start >= 0 && end > start)
  return source.slice(start, end + END.length)
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function runMarkerHarness(block, fakeNodeBody) {
  const root = mkdtempSync(join(tmpdir(), 'd2-governance-wiring-'))
  try {
    const fakeNode = join(root, 'node')
    const harness = join(root, 'harness.sh')
    const sentinel = join(root, 'sentinel')
    writeFileSync(fakeNode, `#!/usr/bin/env bash\n${fakeNodeBody}\n`, { mode: 0o700 })
    chmodSync(fakeNode, 0o700)
    writeFileSync(harness, `#!/usr/bin/env bash
set -euo pipefail
no_go() { printf 'NO_GO %s\\n' "$1" >&2; exit 2; }
SCRIPT_DIR=${shellQuote(root)}
APPROVED_PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
NODE_BIN=${shellQuote(fakeNode)}
D2_GOVERNANCE_ROOT=/tmp/d2-governance-root
D2_GOVERNANCE_RESERVATION_ID=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
${block}
printf reached > ${shellQuote(sentinel)}
`)
    const result = spawnSync('/bin/bash', [harness], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000,
    })
    return { result, sentinelReached: existsSync(sentinel) }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

let completed = 0
let mutationCount = 0
let harnessCount = 0

test('run.sh has one fail-closed governance invoke before every mutable preflight', () => {
  const source = readFileSync(RUN_PATH, 'utf8')
  verifyRunScriptWiring(source)
  const block = markerBlock(source)
  const commentedDecoy = block.split('\n').map((line) => (
    line === START || line === END ? line : `# ${line}`
  )).join('\n')
  const mutations = [
    source.replace(block, ''),
    source.replace(block, `${block}\n${block}`),
    source.replace(block, '').concat(`\n${block}\n`),
    source.replace(block, commentedDecoy),
    source.replace(START, 'command systemd-run --user true\n' + START),
    source.replace(START, 'env systemd-run --user true\n' + START),
    source.replace(START, '/usr/bin/systemd-run --user true\n' + START),
    source.replace(START, 'SYSTEMD_RUN=/usr/bin/systemd-run\n"$SYSTEMD_RUN" --user true\n' + START),
    source.replace('command -v systemd-run >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_APPROVED_PATH_COMMAND"', ':'),
    source.concat('\n[[ -n "${D2_EVIDENCE_DIR:-}" && -n "${D2_EVIDENCE_OUT:-}" ]]\n'),
    source.replace('--context-fd 3', '--context-fd 1'),
    source.replace('3>&1 >/dev/null', '>/dev/null'),
    source.replace(String.raw`if ! GOVERNANCE_CONTEXT_RAW="$(`, 'if GOVERNANCE_CONTEXT_RAW="$('),
    source.replace('(( GOVERNANCE_STATUS == 0 )) || exit "$GOVERNANCE_STATUS"', ':'),
    source.replace('GOVERNANCE_CONTEXT_SENTINEL="D2_GOVERNANCE_CONTEXT_END"', ':'),
    source.replace('GOVERNANCE_CONTEXT_SENTINEL="D2_GOVERNANCE_CONTEXT_END"', 'GOVERNANCE_CONTEXT_SENTINEL=""'),
    source.replace(
      'printf \'%s\' "$GOVERNANCE_CONTEXT_SENTINEL"',
      'printf \'%s%s\' "$GOVERNANCE_CONTEXT_SENTINEL" "$GOVERNANCE_CONTEXT_SENTINEL"',
    ),
    source.replace(
      'printf \'%s\' "$GOVERNANCE_CONTEXT_SENTINEL"',
      'GOVERNANCE_SENTINEL_COPY="$GOVERNANCE_CONTEXT_SENTINEL"',
    ).replace(
      'GOVERNANCE_CONTEXT_RAW=""',
      'GOVERNANCE_CONTEXT_RAW=""\nprintf \'%s\' "$GOVERNANCE_SENTINEL_COPY"',
    ),
    source.replace(
      'unset GOVERNANCE_CONTEXT_RAW GOVERNANCE_CONTEXT_SENTINEL GOVERNANCE_CONTEXT_PAYLOAD GOVERNANCE_STATUS',
      'unset GOVERNANCE_CONTEXT_SENTINEL GOVERNANCE_CONTEXT_PAYLOAD GOVERNANCE_STATUS',
    ),
    source.replace('"$EVIDENCE_OUT" != *$\'\\n\'*', 'true'),
    source.replace('WORK_DIR="$SCRIPT_DIR/.work"', 'WORK_DIR="${D2_WORK_DIR:-$SCRIPT_DIR/.work}"'),
    source.replace('  D2_EVIDENCE_OUT="$EVIDENCE_OUT" \\\n', '  D2_GOVERNANCE_ROOT="$D2_GOVERNANCE_ROOT" \\\n  D2_EVIDENCE_OUT="$EVIDENCE_OUT" \\\n'),
    source.replace('  D2_EVIDENCE_OUT="$EVIDENCE_OUT" \\\n', '  D2_GOVERNANCE_RESERVATION_ID="$D2_GOVERNANCE_RESERVATION_ID" \\\n  D2_EVIDENCE_OUT="$EVIDENCE_OUT" \\\n'),
    source.concat('\n"$NODE_BIN" "$SCRIPT_DIR/governance.mjs" invoke\n'),
    source.concat('\nGOVERNANCE_MODULE="$SCRIPT_DIR/governance.mjs"\nGOVERNANCE_ACTION=invoke\nenv "$NODE_BIN" "$GOVERNANCE_MODULE" "$GOVERNANCE_ACTION"\n'),
    source.concat('\nMODULE="$SCRIPT_DIR/governance.mjs"\nACTION=invoke\n"$NODE_BIN" "$MODULE" "$ACTION"\n'),
    source.concat('\nenv "$NODE_BIN" "$SCRIPT_DIR/governance.mjs" invoke\n'),
    source.replace('\nassert_invocation_clone_identity\ncommand -v systemd-run', '\ncommand -v systemd-run'),
    source.replace('[[ "$current_tree_oid" == "$INVOCATION_TREE_OID" ]]', ':'),
  ]
  for (const mutation of mutations) {
    assert.notEqual(mutation, source)
    assert.throws(() => verifyRunScriptWiring(mutation))
  }
  mutationCount += mutations.length
  completed += 1
})

test('governance verifiers never import or execute the real drill', () => {
  const verifierNames = readdirSync(SCRIPT_DIR).filter((name) => /^verify-governance.*\.mjs$/u.test(name))
  for (const name of verifierNames) {
    const source = readFileSync(join(SCRIPT_DIR, name), 'utf8')
    assert.doesNotMatch(source, /(?:from\s+['"]\.\/drill\.mjs|import\s*\(\s*['"]\.\/drill\.mjs|spawn(?:Sync)?\([^)]*drill\.mjs)/u, basename(name))
  }
  completed += 1
})

test('marker-only Bash harness fails closed on invoke failure or short context', () => {
  const block = markerBlock(readFileSync(RUN_PATH, 'utf8'))
  const cases = [
    { body: "printf '/tmp/evidence\\n/tmp/evidence/result.json\\n' >&3; exit 7", status: 2, sentinel: false },
    { body: ':', status: 2, sentinel: false },
    { body: "printf '/tmp/evidence\\n' >&3", status: 2, sentinel: false },
    { body: "printf '/tmp/evidence\\n/tmp/evidence/result.json\\n/tmp/extra\\n' >&3", status: 2, sentinel: false },
    { body: "printf '/tmp/evidence\\n/tmp/evidence/result.json\\n\\n' >&3", status: 2, sentinel: false },
    { body: "printf '/tmp/evidence\\n/tmp/evidence/result.json\\n' >&3", status: 0, sentinel: true },
  ]
  for (const fixture of cases) {
    const { result, sentinelReached } = runMarkerHarness(block, fixture.body)
    assert.equal(result.status, fixture.status, result.stderr)
    assert.equal(sentinelReached, fixture.sentinel)
  }
  harnessCount += cases.length
  completed += 1
})

after(() => {
  assert.equal(completed, 3)
  assert.equal(mutationCount, 29)
  assert.equal(harnessCount, 6)
  console.log(`D2_PRIME_GOVERNANCE_WIRING_MUTATIONS=${mutationCount}`)
  console.log(`D2_PRIME_GOVERNANCE_WIRING_HARNESS_CASES=${harnessCount}`)
})
