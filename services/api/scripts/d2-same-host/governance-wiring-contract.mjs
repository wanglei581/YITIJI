import { createHash } from 'node:crypto'

const START = '# D2_GOVERNANCE_INVOKE_START'
const END = '# D2_GOVERNANCE_INVOKE_END'
// Updating either digest requires rerunning every wiring mutation and marker-only Bash harness.
const PREFIX_SHA256 = '02ad18c284207d939643929874ba5e61847097d8f27e4e36981d8b704a95f0dd'
const BLOCK_SHA256 = '5010ecfaeca1eff4e826e64fa630de926b2c207b79492744bc31b4846589ca07'
// This contract rejects concrete source drift; interpreting same-UID adversarial Bash string construction is out of scope.

function reject() {
  throw new Error('D2_PRIME_GOVERNANCE_WIRING_INVALID')
}

function orderedIncludes(source, required) {
  let cursor = -1
  for (const text of required) {
    cursor = source.indexOf(text, cursor + 1)
    if (cursor < 0) reject()
  }
}

export function verifyRunScriptWiring(source) {
  if (typeof source !== 'string') reject()
  const lines = source.split('\n')
  if (lines.filter((line) => line === START).length !== 1 ||
    lines.filter((line) => line === END).length !== 1) reject()
  const start = source.indexOf(START)
  const end = source.indexOf(END, start)
  if (start < 0 || end <= start) reject()
  const prefix = source.slice(0, start)
  if (createHash('sha256').update(prefix, 'utf8').digest('hex') !== PREFIX_SHA256) reject()
  const liveSource = lines.filter((line) => !line.trimStart().startsWith('#')).join('\n')
  const block = source.slice(start, end + END.length)
  if (createHash('sha256').update(block, 'utf8').digest('hex') !== BLOCK_SHA256) reject()
  const liveBlock = block.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')
  orderedIncludes(liveBlock, [
    '[[ -n "${D2_GOVERNANCE_ROOT:-}" && -n "${D2_GOVERNANCE_RESERVATION_ID:-}" ]]',
    'GOVERNANCE_CONTEXT_SENTINEL="D2_GOVERNANCE_CONTEXT_END"',
    'GOVERNANCE_CONTEXT_RAW=""', String.raw`if ! GOVERNANCE_CONTEXT_RAW="$(`,
    '"$NODE_BIN" "$SCRIPT_DIR/governance.mjs" invoke', '--state-root "$D2_GOVERNANCE_ROOT"',
    '--reservation-id "$D2_GOVERNANCE_RESERVATION_ID"', '--context-fd 3',
    '3>&1 >/dev/null', 'GOVERNANCE_STATUS=$?',
    '(( GOVERNANCE_STATUS == 0 )) || exit "$GOVERNANCE_STATUS"',
    'printf \'%s\' "$GOVERNANCE_CONTEXT_SENTINEL"', ')"; then',
    'unset GOVERNANCE_CONTEXT_RAW GOVERNANCE_CONTEXT_SENTINEL', 'exit 2',
    '[[ "$GOVERNANCE_CONTEXT_RAW" == *"$GOVERNANCE_CONTEXT_SENTINEL" ]]',
    'GOVERNANCE_CONTEXT_PAYLOAD="${GOVERNANCE_CONTEXT_RAW%$GOVERNANCE_CONTEXT_SENTINEL}"',
    '[[ "$GOVERNANCE_CONTEXT_PAYLOAD" == *$\'\\n\' ]]',
    'GOVERNANCE_CONTEXT_PAYLOAD="${GOVERNANCE_CONTEXT_PAYLOAD%$\'\\n\'}"',
    '[[ "$GOVERNANCE_CONTEXT_PAYLOAD" == *$\'\\n\'* ]]',
    'EVIDENCE_DIR="${GOVERNANCE_CONTEXT_PAYLOAD%%$\'\\n\'*}"',
    'EVIDENCE_OUT="${GOVERNANCE_CONTEXT_PAYLOAD#*$\'\\n\'}"',
    '[[ -n "$EVIDENCE_DIR" && -n "$EVIDENCE_OUT"', '"$EVIDENCE_OUT" != *$\'\\n\'*',
    'unset GOVERNANCE_CONTEXT_RAW GOVERNANCE_CONTEXT_SENTINEL GOVERNANCE_CONTEXT_PAYLOAD GOVERNANCE_STATUS',
  ])
  const anchors = ['production_variables=(', 'XDG_RUNTIME_DIR=', 'PREFLIGHT_UNIT=', 'NGINX_PORT=']
  const firstSystemd = source.search(/^[ \t]*systemd-run[ \t]/mu)
  const firstSystemdLiteral = source.indexOf('systemd-run')
  const systemdGuard = 'command -v systemd-run >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_APPROVED_PATH_COMMAND"'
  const systemdGuardIndex = source.indexOf(systemdGuard)
  const drillStart = source.indexOf('set +e\nenv -i')
  const drillEnd = source.indexOf('DRILL_STATUS=$?', drillStart)
  const snapshotStart = source.indexOf('INVOCATION_CLONE_ROOT="$(realpath "$ROOT" 2>/dev/null)"', end)
  const identityGuardStart = source.indexOf('assert_invocation_clone_identity() {', snapshotStart)
  const identityGuardEnd = source.indexOf('\n}\n', identityGuardStart)
  const identityCalls = liveSource.match(/^[ \t]*assert_invocation_clone_identity[ \t]*$/gmu) ?? []
  const firstIdentityCall = source.indexOf('\nassert_invocation_clone_identity\n', identityGuardEnd)
  const secondIdentityCall = source.indexOf('\nassert_invocation_clone_identity\n', firstIdentityCall + 1)
  const thirdIdentityCall = source.indexOf('\nassert_invocation_clone_identity\n', secondIdentityCall + 1)
  const userManagerPreflight = source.indexOf('systemctl --user show-environment')
  const keeperStarted = source.lastIndexOf('KEEPER_STARTED=1')
  if (anchors.some((anchor) => source.indexOf(anchor) <= end) || firstSystemd <= end || firstSystemdLiteral <= end ||
    systemdGuardIndex <= end || systemdGuardIndex >= source.indexOf('production_variables=(') ||
    liveSource.split(systemdGuard).length !== 2 || liveSource.split('governance.mjs" invoke').length !== 2 ||
    drillStart < 0 || drillEnd <= drillStart || snapshotStart <= end || identityGuardStart <= snapshotStart ||
    identityGuardEnd <= identityGuardStart || identityCalls.length !== 3 ||
    firstIdentityCall <= identityGuardEnd || firstIdentityCall >= systemdGuardIndex ||
    secondIdentityCall <= firstIdentityCall || secondIdentityCall >= userManagerPreflight ||
    thirdIdentityCall <= keeperStarted || thirdIdentityCall >= drillStart) reject()
  const snapshot = source.slice(snapshotStart, identityGuardStart)
  orderedIncludes(snapshot, [
    'INVOCATION_CLONE_ROOT="$(realpath "$ROOT" 2>/dev/null)"',
    'INVOCATION_GIT_ROOT="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)"',
    'INVOCATION_GIT_ROOT="$(realpath "$INVOCATION_GIT_ROOT" 2>/dev/null)"',
    '[[ "$INVOCATION_CLONE_ROOT" == "$INVOCATION_GIT_ROOT" ]]',
    'INVOCATION_BASELINE_OID="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)"',
    'INVOCATION_TREE_OID="$(git -C "$ROOT" rev-parse \'HEAD^{tree}\' 2>/dev/null)"',
    'INVOCATION_BRANCH="$(git -C "$ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null)"',
    'git -C "$ROOT" diff --quiet --ignore-submodules --',
    'git -C "$ROOT" diff --cached --quiet --ignore-submodules --',
  ])
  const identityGuard = source.slice(identityGuardStart, identityGuardEnd)
  orderedIncludes(identityGuard, [
    'current_root="$(realpath "$ROOT" 2>/dev/null)"',
    'current_git_root="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)"',
    'current_git_root="$(realpath "$current_git_root" 2>/dev/null)"',
    '[[ "$current_root" == "$INVOCATION_CLONE_ROOT" && "$current_git_root" == "$INVOCATION_GIT_ROOT" ]]',
    'current_baseline_oid="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)"',
    '[[ "$current_baseline_oid" == "$INVOCATION_BASELINE_OID" ]]',
    'current_tree_oid="$(git -C "$ROOT" rev-parse \'HEAD^{tree}\' 2>/dev/null)"',
    '[[ "$current_tree_oid" == "$INVOCATION_TREE_OID" ]]',
    'current_branch="$(git -C "$ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null)"',
    '[[ "$current_branch" == "$INVOCATION_BRANCH" ]]',
    'git -C "$ROOT" diff --quiet --ignore-submodules --',
    'git -C "$ROOT" diff --cached --quiet --ignore-submodules --',
  ])
  const drill = source.slice(drillStart, drillEnd)
  const outside = `${source.slice(0, start)}\n${source.slice(end + END.length)}`
  const liveOutside = outside.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')
  if ((liveSource.match(/D2_EVIDENCE_DIR/gu) ?? []).length !== 0 ||
    (liveSource.match(/D2_EVIDENCE_OUT/gu) ?? []).length !== 1 ||
    !drill.includes('D2_EVIDENCE_OUT="$EVIDENCE_OUT"') || /D2_GOVERNANCE_/u.test(drill) ||
    (liveSource.match(/governance\.mjs/gu) ?? []).length !== 1 ||
    (liveSource.match(/\binvoke\b/gu) ?? []).length !== 1 ||
    /D2_(?:TASK_ID|BASELINE_SHA|BRANCH_NAME|CLONE_PATH|ARCHIVE_PATH)/u.test(liveSource) ||
    /invocation-governance\.mjs|--consume/u.test(liveSource) ||
    /D2_GOVERNANCE_(?:ROOT|RESERVATION_ID)/u.test(liveOutside) ||
    /(?:^|\n)[ \t]*(?:export[ \t]+)?[A-Z0-9_]*(?:GOVERNANCE|MODULE|ACTION)[A-Z0-9_]*=/u.test(liveOutside) ||
    (liveSource.match(/D2_WORK_DIR/gu) ?? []).length !== 1 || !liveSource.includes('WORK_DIR="$SCRIPT_DIR/.work"') ||
    !liveSource.includes('[[ -z "${D2_WORK_DIR+x}" ]]')) reject()
  return true
}
