import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

function shellFunctionSource(source, name) {
  const marker = `\n${name}() {\n`
  const markerStart = source.indexOf(marker)
  assert.ok(markerStart >= 0, `${name} function must exist`)
  const start = markerStart + 1
  const end = source.indexOf('\n}\n', start)
  assert.ok(end > start, `${name} function must have a bounded body`)
  return source.slice(start, end + 2)
}

function productionEnvironmentNames(envExampleSource) {
  const configuredNames = new Set(
    [...envExampleSource.matchAll(/^#?([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]),
  )
  for (const runtimeCredentialName of ['TENCENT_TTS_SECRET_ID', 'TENCENT_TTS_SECRET_KEY']) {
    assert.ok(configuredNames.has(runtimeCredentialName), `.env.example must declare ${runtimeCredentialName}`)
  }
  const dataPlaneNames = new Set([
    'DATABASE_URL',
    'DIRECT_URL',
    'POSTGRES_URL',
    'REDIS_URL',
    'REDIS_HOST',
    'REDIS_PASSWORD',
  ])
  const credentialName = /(?:SECRET|PASSWORD|PRIVATE_KEY|PUBLIC_KEY|APIV3_KEY|MCH_SERIAL_NO|ACCESS_KEY|API_KEY|APP_ID$|APPID$|MCHID$|SIGN_NAME$|TEMPLATE_ID$|CODEPAY_STORE_OUT_ID$)/
  return [...configuredNames].filter((name) => dataPlaneNames.has(name) || credentialName.test(name))
}

function assertProductionEnvironmentContract(runSource, envExampleSource) {
  const productionBlock = runSource.match(/production_variables=\(\n([\s\S]*?)\n\)/)?.[1]
  assert.ok(productionBlock, 'production_variables must be a multiline shell array')
  const productionNames = new Set(productionBlock.split(/\s+/).filter(Boolean))
  for (const name of productionEnvironmentNames(envExampleSource)) {
    assert.ok(productionNames.has(name), `production_variables must include ${name}`)
  }
  for (const legacyName of [
    'OSS_ACCESS_KEY_ID',
    'OSS_ACCESS_KEY_SECRET',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'MINIO_ROOT_USER',
    'MINIO_ROOT_PASSWORD',
    'TENCENTCLOUD_SECRET_ID',
    'TENCENTCLOUD_SECRET_KEY',
  ]) assert.ok(productionNames.has(legacyName), `production_variables must retain ${legacyName}`)

  const environmentGuard = runSource.slice(
    runSource.indexOf('for variable_name in "${production_variables[@]}"'),
    runSource.indexOf('done', runSource.indexOf('for variable_name in "${production_variables[@]}"')) + 4,
  )
  assert.match(environmentGuard, /\[\[ -z "\$\{!variable_name\+x\}" \]\]/)
  assert.doesNotMatch(environmentGuard, /(?:echo|printf|export|printenv|env|set)[^\n]*\$\{!variable_name\}/)
}

function assertForensicRetentionGuards(cleanupSource, message) {
  for (const directory of ['RUN_DIR', 'PM2_CONTROL_ROOT']) {
    const guard = new RegExp(`\\(\\( cleanup_failed != 0 \\)\\) \\|\\| rm -rf -- "\\$${directory}"`, 'g')
    assert.equal((cleanupSource.match(guard) ?? []).length, 1, `${message} (${directory})`)
  }
}

function assertCleanupContract(runSource) {
  const stopHelper = shellFunctionSource(runSource, 'stop_user_unit_and_prove_inactive')
  assert.match(stopHelper, /systemctl --user stop "\$unit_name"/)
  assert.doesNotMatch(stopHelper, /systemctl --user stop "\$unit_name"[^\n]*(?:\|\| return 1|\|\| true)/)
  assert.match(stopHelper, /systemctl --user show "\$unit_name" -p LoadState -p ActiveState/)
  assert.doesNotMatch(stopHelper, /-p LoadState -p ActiveState --value/)
  assert.match(stopHelper, /IFS='=' read -r property_name property_value/)
  assert.match(stopHelper, /LoadState\)[\s\S]*\(\( load_state_seen == 0 \)\) \|\| return 1/)
  assert.match(stopHelper, /ActiveState\)[\s\S]*\(\( active_state_seen == 0 \)\) \|\| return 1/)
  assert.match(stopHelper, /\(\( load_state_seen == 1 && active_state_seen == 1 \)\) \|\| return 1/)
  assert.match(stopHelper, /\[\[ -n "\$load_state" && -n "\$active_state" \]\] \|\| return 1/)
  assert.match(stopHelper, /"\$load_state" == "loaded" \|\| "\$load_state" == "not-found"/)
  assert.match(stopHelper, /\[\[ "\$active_state" == "inactive" \]\]/)
  assert.doesNotMatch(stopHelper, /\|\| true|-z "\$active_state" \|\|/)
  assert.ok(
    (runSource.match(/stop_user_unit_and_prove_inactive "\$(?:PREFLIGHT_UNIT|UNIT_NAME)"/g) ?? []).length >= 2,
    'preflight and final cleanup must share the strict inactive helper',
  )

  const earlyCleanup = shellFunctionSource(runSource, 'early_cleanup')
  assert.equal((earlyCleanup.match(/rm -rf -- "\$(?:RUN_DIR|PM2_CONTROL_ROOT)" \|\| cleanup_failed=1/g) ?? []).length, 2)
  assertForensicRetentionGuards(
    earlyCleanup,
    'early cleanup must retain forensic directories whenever any cleanup step already failed',
  )
  const earlyExitHandler = shellFunctionSource(runSource, 'early_cleanup_on_exit')
  assert.match(earlyExitHandler, /local original_status=\$\?/)
  assert.match(earlyExitHandler, /trap - EXIT/)
  assert.match(earlyExitHandler, /if ! early_cleanup; then[\s\S]*exit 2[\s\S]*fi/)
  assert.match(earlyExitHandler, /exit "\$original_status"/)
  assert.match(runSource, /^trap early_cleanup_on_exit EXIT$/m)

  const cleanup = shellFunctionSource(runSource, 'cleanup')
  assert.match(cleanup, /stop_user_unit_and_prove_inactive "\$UNIT_NAME" \|\| cleanup_failed=1/)
  assert.match(cleanup, /: > "\$STOP_MARKER"\) 2>\/dev\/null \|\| cleanup_failed=1/)
  assert.equal((cleanup.match(/rm -rf -- "\$(?:RUN_DIR|PM2_CONTROL_ROOT)" \|\| cleanup_failed=1/g) ?? []).length, 2)
  assertForensicRetentionGuards(
    cleanup,
    'final cleanup must retain forensic directories whenever any cleanup step already failed',
  )
  assert.doesNotMatch(cleanup, /(?:rm|unlink)[^\n]*EVIDENCE/)

  const exitHandler = shellFunctionSource(runSource, 'cleanup_on_exit')
  assert.match(exitHandler, /local original_status=\$\?/)
  assert.match(exitHandler, /trap - EXIT/)
  assert.match(exitHandler, /if ! cleanup; then[\s\S]*exit 2[\s\S]*fi/)
  assert.match(exitHandler, /exit "\$original_status"/)
  assert.match(runSource, /^trap cleanup_on_exit EXIT$/m)

  const evidenceVerified = runSource.lastIndexOf('"$SCRIPT_DIR/verify-contract.mjs" --evidence "$EVIDENCE_OUT"')
  const finalTrapDisarm = runSource.lastIndexOf('trap - EXIT')
  const finalCleanup = runSource.lastIndexOf('cleanup || no_go "D2_PRIME_CLEANUP_FAILED"')
  const pass = runSource.lastIndexOf("printf 'D2_PRIME_PASS\\nproductionF1=NO-GO\\n'")
  assert.ok(evidenceVerified >= 0 && finalTrapDisarm > evidenceVerified)
  assert.ok(finalCleanup > finalTrapDisarm && pass > finalCleanup)
}

function fixtureScript(runSource, { stopStatus, shows }) {
  const stopHelper = shellFunctionSource(runSource, 'stop_user_unit_and_prove_inactive')
  const fixtures = shows.map(({ load, active, status = 0, shape = 'normal' }) => (
    [load, active, status, shape].join('\t')
  )).join('\n')
  return `set -u
systemctl() {
  if [[ "$1" == "--user" && "$2" == "stop" ]]; then
    return ${stopStatus}
  fi
  if [[ "$1" == "--user" && "$2" == "show" ]]; then
    local fixture_load fixture_active fixture_status fixture_shape
    IFS=$'\\t' read -r fixture_load fixture_active fixture_status fixture_shape <&9 || return 97
    (( fixture_status == 0 )) || return "$fixture_status"
    [[ "$*" == *"-p LoadState -p ActiveState"* ]] || return 96
    case "$fixture_shape" in
      normal) printf 'LoadState=%s\\nActiveState=%s\\n' "$fixture_load" "$fixture_active" ;;
      missing-load) printf 'ActiveState=%s\\n' "$fixture_active" ;;
      duplicate-load) printf 'LoadState=%s\\nLoadState=%s\\nActiveState=%s\\n' "$fixture_load" "$fixture_load" "$fixture_active" ;;
      duplicate-active) printf 'LoadState=%s\\nActiveState=%s\\nActiveState=%s\\n' "$fixture_load" "$fixture_active" "$fixture_active" ;;
      empty-load) printf 'LoadState=\\nActiveState=%s\\n' "$fixture_active" ;;
      empty-active) printf 'LoadState=%s\\nActiveState=\\n' "$fixture_load" ;;
      *) return 95 ;;
    esac
    return 0
  fi
  return 98
}
sleep() { :; }
exec 9<<'D2_CLEANUP_FIXTURES'
${fixtures}
D2_CLEANUP_FIXTURES
${stopHelper}
stop_user_unit_and_prove_inactive 'fixture.service'
`
}

function assertBehavior(runSource, fixture, expectedStatus, label) {
  const result = spawnSync('bash', ['-c', fixtureScript(runSource, fixture)], {
    encoding: 'utf8',
    timeout: 5_000,
  })
  assert.equal(result.signal, null, `${label}: helper must not time out`)
  assert.equal(result.status, expectedStatus, `${label}: ${result.stderr}`)
}

function verifyStrictCleanupBehavior(runSource) {
  const succeeds = [
    ['collected unit after nonzero stop', 1, [
      { load: 'not-found', active: 'inactive' },
      { load: 'not-found', active: 'inactive' },
    ]],
    ['loaded unit after successful stop', 0, [{ load: 'loaded', active: 'inactive' }]],
    ['loaded unit after nonzero stop with proven state', 1, [{ load: 'loaded', active: 'inactive' }]],
    ['unit is collected while polling', 0, [
      { load: 'loaded', active: 'deactivating' },
      { load: 'not-found', active: 'inactive' },
    ]],
  ]
  for (const [label, stopStatus, shows] of succeeds) {
    assertBehavior(runSource, { stopStatus, shows }, 0, label)
  }

  const fails = [
    ['masked inactive unit is not an allowed success tuple', 0, [{ load: 'masked', active: 'inactive' }]],
    ['collected active unit is contradictory', 1, [
      { load: 'not-found', active: 'active' },
      { load: 'not-found', active: 'active' },
    ]],
    ['failed unit remains a cleanup failure', 0, [{ load: 'loaded', active: 'failed' }]],
    ['missing LoadState fails closed', 0, [{ load: 'loaded', active: 'inactive', shape: 'missing-load' }]],
    ['duplicate LoadState fails closed', 0, [{ load: 'loaded', active: 'inactive', shape: 'duplicate-load' }]],
    ['duplicate ActiveState fails closed', 0, [{ load: 'loaded', active: 'inactive', shape: 'duplicate-active' }]],
    ['empty LoadState fails closed', 0, [{ load: '', active: 'inactive', shape: 'empty-load' }]],
    ['empty ActiveState fails closed', 0, [{ load: 'loaded', active: '', shape: 'empty-active' }]],
    ['unknown ActiveState fails closed', 0, [{ load: 'loaded', active: 'maintenance' }]],
    ['show command failure remains fail closed', 0, [{ load: 'loaded', active: 'inactive', status: 1 }]],
  ]
  for (const [label, stopStatus, shows] of fails) {
    assertBehavior(runSource, { stopStatus, shows }, 1, label)
  }
  console.log('  PASS cleanup helper behavior accepts only explicit inactive state tuples')
}

export function verifyCleanupContract() {
  const runSource = readFileSync(join(SCRIPT_DIR, 'run.sh'), 'utf8')
  const envExampleSource = readFileSync(join(SCRIPT_DIR, '../../.env.example'), 'utf8')
  verifyStrictCleanupBehavior(runSource)
  assertProductionEnvironmentContract(runSource, envExampleSource)
  assertCleanupContract(runSource)

  const unsafeMutations = [
    runSource.replace('"$load_state" == "loaded" || "$load_state" == "not-found"', '"$load_state" == "loaded"'),
    runSource.replace('[[ "$active_state" == "inactive" ]]', '[[ -z "$active_state" || "$active_state" == "inactive" ]]'),
    runSource.replace('trap - EXIT\ncleanup || no_go "D2_PRIME_CLEANUP_FAILED"', 'cleanup || no_go "D2_PRIME_CLEANUP_FAILED"'),
    runSource.replace('cleanup || no_go "D2_PRIME_CLEANUP_FAILED"', "printf 'D2_PRIME_PASS\\nproductionF1=NO-GO\\n'"),
    runSource.replace(
      '    (( cleanup_failed != 0 )) || rm -rf -- "$RUN_DIR" || cleanup_failed=1',
      '    rm -rf -- "$RUN_DIR" || cleanup_failed=1',
    ),
    runSource.replace(
      '    (( cleanup_failed != 0 )) || rm -rf -- "$PM2_CONTROL_ROOT" || cleanup_failed=1',
      '    rm -rf -- "$PM2_CONTROL_ROOT" || cleanup_failed=1',
    ),
    runSource.replaceAll(
      '    (( cleanup_failed != 0 )) || rm -rf -- "$PM2_CONTROL_ROOT" || cleanup_failed=1',
      '    (( cleanup_failed != 0 )) || rm -rf -- "$RUN_DIR" || cleanup_failed=1',
    ),
    runSource.replace(
      '\ncleanup() {\n',
      '\ncleanup() {\n  rm -f -- "$EVIDENCE_OUT"\n',
    ),
  ]
  for (const mutation of unsafeMutations) {
    assert.notEqual(mutation, runSource, 'every cleanup mutation must actually alter run.sh')
    assert.throws(() => assertCleanupContract(mutation))
  }

  const requiredName = productionEnvironmentNames(envExampleSource)[0]
  const missingCredential = runSource.replace(new RegExp(`\\b${requiredName}\\b`), '')
  assert.throws(() => assertProductionEnvironmentContract(missingCredential, envExampleSource))
  console.log('  PASS cleanup contract preserves collected-unit and forensic-retention safeguards')
}
