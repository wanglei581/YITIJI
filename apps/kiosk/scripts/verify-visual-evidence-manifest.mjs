import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = join(kioskRoot, '..', '..')
const manifestPath = join(kioskRoot, 'tests/visual/fixtures/kiosk-p1-visual-evidence-targets.ts')
const routeManifestPath = join(kioskRoot, 'tests/visual/route-manifest.ts')
const routeSourcePath = join(kioskRoot, 'src/routes/index.tsx')
const runbookPath = join(workspaceRoot, 'docs/acceptance/kiosk-8177-5299-fusion-visual-runbook.md')
const expectedMigrationMatrix = 'docs/design/kiosk-proto-2026-07-migration-matrix.md'
const expectedScreenshotRoot = 'test-results/kiosk-p1-visual-evidence/<sha>/'
const allowedReferenceKinds = new Set([
  'PRIMARY',
  'SUBVIEW_STATE',
  'ROUTE_STATE',
  'REUSE',
  'REDIRECT',
  'NO_INDEPENDENT_PROTOTYPE',
])

let failures = 0

function check(label, run) {
  try {
    run()
    console.log(`PASS ${label}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function loadTypeScriptModule(path) {
  const source = readFileSync(path, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: path,
    reportDiagnostics: true,
  })
  const errors = (transpiled.diagnostics ?? []).filter(({ category }) => category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], `TypeScript diagnostics: ${errors.map(({ messageText }) => ts.flattenDiagnosticMessageText(messageText, '\n')).join('; ')}`)
  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`
  return import(dataUrl)
}

function sorted(values) {
  return [...values].sort()
}

function assertString(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`)
  assert.ok(value.trim().length > 0, `${label} must not be blank`)
}

function declaredRoutePatterns(path) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const patterns = []
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node)
      && ((ts.isIdentifier(node.name) && node.name.text === 'path') || (ts.isStringLiteral(node.name) && node.name.text === 'path'))
      && ts.isStringLiteralLike(node.initializer)
    ) {
      const value = node.initializer.text
      patterns.push(value.startsWith('/') ? value : `/${value}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return patterns
}

function routeStatePattern(value) {
  return value.split('#', 1)[0]
}

function captureMatchesPattern(pattern, captureUrl) {
  const patternSegments = pattern.split('/')
  const captureSegments = new URL(captureUrl, 'https://visual-evidence.invalid').pathname.split('/')
  return patternSegments.length === captureSegments.length
    && patternSegments.every((segment, index) => segment.startsWith(':') || segment === captureSegments[index])
}

let contract = null
let routeManifest = null

check('manifest fixture exists', () => {
  assert.ok(existsSync(manifestPath), 'missing tests/visual/fixtures/kiosk-p1-visual-evidence-targets.ts')
})

if (existsSync(manifestPath)) {
  try {
    contract = await loadTypeScriptModule(manifestPath)
  } catch (error) {
    failures += 1
    console.error(`FAIL manifest fixture loads: ${error instanceof Error ? error.message : String(error)}`)
  }
}

try {
  routeManifest = await loadTypeScriptModule(routeManifestPath)
} catch (error) {
  failures += 1
  console.error(`FAIL frozen route manifest loads: ${error instanceof Error ? error.message : String(error)}`)
}

if (contract && routeManifest) {
  const {
    migrationMatrixPath,
    screenshotRoot,
    visualEvidenceTargets,
    routeEvidenceDispositions,
  } = contract
  const { productionRoutePatterns, compatibilityRedirects } = routeManifest

  check('single migration matrix authority', () => {
    assert.equal(migrationMatrixPath, expectedMigrationMatrix)
    assert.ok(existsSync(join(workspaceRoot, migrationMatrixPath)), `missing ${migrationMatrixPath}`)
  })

  check('ignored screenshot root', () => {
    assert.equal(screenshotRoot, expectedScreenshotRoot)
    assert.ok(screenshotRoot.startsWith('test-results/'), 'screenshots must stay below ignored test-results/')
    assert.ok(screenshotRoot.includes('<sha>/'), 'screenshot output must be commit-scoped')
    const probe = screenshotRoot.replace('<sha>', 'verifier-probe') + 'targets/01/default/prototype.png'
    assert.ok(execFileSync('git', ['check-ignore', probe], { cwd: workspaceRoot, encoding: 'utf8' }).trim(), `${probe} must be gitignored`)
  })

  check('frozen route inventory matches runtime route declarations', () => {
    const declared = declaredRoutePatterns(routeSourcePath)
    assert.equal(declared.length, 87, 'runtime route declaration count')
    assert.equal(new Set(declared).size, 87, 'runtime route declarations must be unique')
    assert.deepEqual(sorted(declared), sorted(productionRoutePatterns))
  })

  check('77 primary targets and 5 Fusion state references', () => {
    assert.ok(Array.isArray(visualEvidenceTargets), 'visualEvidenceTargets must be an array')
    assert.equal(visualEvidenceTargets.length, 82, 'visual target total')
    const primary = visualEvidenceTargets.filter(({ targetGroup }) => targetGroup === 'PRIMARY_TARGET')
    const states = visualEvidenceTargets.filter(({ targetGroup }) => targetGroup === 'FUSION_STATE_REFERENCE')
    assert.equal(primary.length, 77, 'primary visual target count')
    assert.equal(states.length, 5, 'Fusion state reference count')
    assert.deepEqual(sorted(primary.map(({ targetId }) => targetId)), sorted(Array.from({ length: 77 }, (_, index) => String(index + 1).padStart(2, '0'))))
    assert.deepEqual(sorted(states.map(({ targetId }) => targetId)), ['15A', '22B', '32A', '34A', '76A'])
    assert.equal(new Set(visualEvidenceTargets.map(({ targetId }) => targetId)).size, 82, 'target ids must be unique')
  })

  check('target evidence fields are explicit and safe', () => {
    for (const target of visualEvidenceTargets) {
      const label = `target ${target.targetId}`
      assertString(target.prototypePath, `${label}.prototypePath`)
      assert.ok(!target.prototypePath.includes('/sources/'), `${label} must reference a derived/base prototype, not immutable sources`)
      assert.ok(existsSync(join(workspaceRoot, target.prototypePath)), `${label} prototype does not exist: ${target.prototypePath}`)
      assert.ok(allowedReferenceKinds.has(target.referenceKind), `${label} referenceKind ${target.referenceKind}`)
      assert.ok(Array.isArray(target.routeOrState) && target.routeOrState.length > 0, `${label}.routeOrState must be non-empty`)
      assert.ok(Array.isArray(target.captureUrls) && target.captureUrls.length > 0, `${label}.captureUrls must be non-empty`)
      assert.equal(target.routeOrState.length, target.captureUrls.length, `${label} needs one capture URL per route/state landing`)
      target.captureUrls.forEach((captureUrl, index) => {
        assert.match(captureUrl, /^\//, `${label}.captureUrls[${index}] must be root-relative`)
        assert.ok(captureMatchesPattern(routeStatePattern(target.routeOrState[index]), captureUrl), `${label}.captureUrls[${index}] does not match ${target.routeOrState[index]}`)
      })
      assert.deepEqual(Object.keys(target.viewport).sort(), ['height', 'width'], `${label}.viewport shape`)
      assert.ok(Number.isInteger(target.viewport.width) && Number.isInteger(target.viewport.height), `${label}.viewport must use integer pixels`)
      assertString(target.fixture, `${label}.fixture`)
      assert.ok(target.fixture.startsWith('contract-fixture:'), `${label}.fixture must be labeled contract-fixture`)
      assert.doesNotMatch(target.fixture, /真实链路|real[- ]?chain/i, `${label}.fixture must not claim a real chain`)
      for (const field of ['precondition', 'readyMarker', 'claimScope', 'knownLimits']) assertString(target[field], `${label}.${field}`)
      assert.match(target.claimScope, /\bonly\b|仅/i, `${label}.claimScope must remain narrow`)
      assert.match(target.knownLimits, /does not prove|不证明|不代表|不得.*(?:通过|证据)/i, `${label}.knownLimits must reject a real-environment claim`)
      assert.ok(Array.isArray(target.capturePairs), `${label}.capturePairs must be an array`)
      assert.equal(target.capturePairs.length, target.captureUrls.length, `${label} needs one screenshot pair per capture URL`)
      assert.deepEqual(target.capturePairs.map(({ captureUrl }) => captureUrl), target.captureUrls, `${label}.capturePairs URL order`)
      assert.equal(new Set(target.capturePairs.map(({ captureKey }) => captureKey)).size, target.capturePairs.length, `${label}.captureKeys must be unique`)
      for (const pair of target.capturePairs) {
        assert.match(pair.captureKey, /^[a-z0-9-]+$/, `${label}.captureKey`)
        assertString(pair.readyMarker, `${label}.${pair.captureKey}.readyMarker`)
        assert.deepEqual(pair.screenshotPair, {
          prototype: `${screenshotRoot}targets/${target.targetId}/${pair.captureKey}/prototype.png`,
          production: `${screenshotRoot}targets/${target.targetId}/${pair.captureKey}/production.png`,
        }, `${label}.${pair.captureKey}.screenshotPair`)
      }
    }
  })

  check('mobile and kiosk viewports are exact', () => {
    for (const target of visualEvidenceTargets) {
      const expected = ['62', '63'].includes(target.targetId)
        ? { width: 390, height: 844 }
        : { width: 1080, height: 1920 }
      assert.deepEqual(target.viewport, expected, `target ${target.targetId} viewport`)
    }
  })

  check('special target mappings', () => {
    const byId = new Map(visualEvidenceTargets.map((target) => [target.targetId, target]))
    assert.equal(byId.get('73')?.referenceKind, 'SUBVIEW_STATE', '73 must be a page-internal subview')
    assert.deepEqual(byId.get('73')?.routeOrState, ['/assistant#call-state'])
    assert.deepEqual(byId.get('73')?.captureUrls, ['/assistant'])
    assert.equal(byId.get('73')?.prototypePath, 'docs/design/kiosk-proto-2026-07/73-assistant-call.html')
    assert.deepEqual(byId.get('34A')?.routeOrState, ['/scan/start#pre-session', '/scan/settings#session-create-failed'])
    assert.deepEqual(byId.get('34A')?.captureUrls, ['/scan/start', '/scan/settings'])
    assert.deepEqual(byId.get('34A')?.capturePairs.map(({ captureKey }) => captureKey), ['scan-start', 'scan-settings'])
    assert.deepEqual(byId.get('34A')?.capturePairs.map(({ readyMarker }) => readyMarker), [
      '[data-w2-page="scan-start"]:has-text("会话尚未创建")',
      '[data-w2-page="scan-settings"]:has-text("扫描任务未创建")',
    ])
    assert.equal(byId.get('34A')?.referenceKind, 'ROUTE_STATE')
    assert.match(byId.get('34A')?.fixture ?? '', /make no request on scan start/i)
    assert.match(byId.get('34A')?.knownLimits ?? '', /no scanner-status knowledge/i)
  })

  check('87 routes each have exactly one disposition', () => {
    assert.ok(Array.isArray(routeEvidenceDispositions), 'routeEvidenceDispositions must be an array')
    assert.equal(routeEvidenceDispositions.length, 87, 'route disposition count')
    const patterns = routeEvidenceDispositions.map(({ routePattern }) => routePattern)
    assert.equal(new Set(patterns).size, 87, 'route dispositions must be unique')
    assert.deepEqual(sorted(patterns), sorted(productionRoutePatterns), 'route disposition inventory must equal the frozen 87-route manifest')
    for (const disposition of routeEvidenceDispositions) {
      const label = `route ${disposition.routePattern}`
      assert.ok(allowedReferenceKinds.has(disposition.referenceKind), `${label} referenceKind ${disposition.referenceKind}`)
      assert.ok(Array.isArray(disposition.targetIds), `${label}.targetIds must be an array`)
      for (const targetId of disposition.targetIds) {
        assert.ok(visualEvidenceTargets.some((target) => target.targetId === targetId), `${label} references unknown target ${targetId}`)
      }
      for (const field of ['precondition', 'claimScope', 'knownLimits']) assertString(disposition[field], `${label}.${field}`)
      if (disposition.referenceKind !== 'REDIRECT') assert.equal(disposition.redirectTo, null, `${label} must not redirect`)
      if (disposition.captureUrl !== null) {
        assert.match(disposition.captureUrl, /^\//, `${label}.captureUrl must be root-relative`)
        assert.ok(captureMatchesPattern(disposition.routePattern, disposition.captureUrl), `${label}.captureUrl does not match its route pattern`)
      }
      if (!['REDIRECT', 'REUSE', 'NO_INDEPENDENT_PROTOTYPE'].includes(disposition.referenceKind)) {
        assertString(disposition.captureUrl, `${label}.captureUrl`)
        for (const targetId of disposition.targetIds) {
          const target = visualEvidenceTargets.find(({ targetId: candidate }) => candidate === targetId)
          assert.ok(target.routeOrState.some((state) => routeStatePattern(state) === disposition.routePattern), `${label} does not own target ${targetId}`)
          assert.ok(target.captureUrls.includes(disposition.captureUrl), `${label} capture URL is not registered by target ${targetId}`)
        }
      }
    }
  })

  check('five redirects never create visual pairs', () => {
    const expectedRedirects = Object.entries(compatibilityRedirects)
    assert.equal(expectedRedirects.length, 5, 'frozen redirect count')
    const redirects = routeEvidenceDispositions.filter(({ referenceKind }) => referenceKind === 'REDIRECT')
    assert.equal(redirects.length, 5, 'evidence redirect count')
    for (const [source, destination] of expectedRedirects) {
      const disposition = redirects.find(({ routePattern }) => routePattern === source)
      assert.ok(disposition, `missing redirect disposition ${source}`)
      assert.equal(disposition.redirectTo, destination, `${source} redirect target`)
      assert.deepEqual(disposition.targetIds, [], `${source} must not own a target pair`)
      assert.equal(disposition.captureUrl, null, `${source} must not generate a capture URL`)
      for (const field of ['prototypePath', 'screenshotPair', 'fixture', 'readyMarker']) {
        assert.ok(!(field in disposition), `${source} must not define ${field}`)
      }
    }
  })

  check('privacy requests has no fabricated prototype', () => {
    const privacy = routeEvidenceDispositions.find(({ routePattern }) => routePattern === '/me/privacy-requests')
    assert.ok(privacy, 'missing /me/privacy-requests disposition')
    assert.equal(privacy.referenceKind, 'NO_INDEPENDENT_PROTOTYPE')
    assert.deepEqual(privacy.targetIds, [])
    assert.equal(privacy.captureUrl, '/me/privacy-requests')
    for (const field of ['prototypePath', 'screenshotPair', 'fixture', 'readyMarker']) {
      assert.ok(!(field in privacy), `/me/privacy-requests must not define ${field}`)
    }
  })

  check('all targets are reachable through route dispositions', () => {
    const referenced = new Set(routeEvidenceDispositions.flatMap(({ targetIds }) => targetIds))
    const missing = visualEvidenceTargets.map(({ targetId }) => targetId).filter((targetId) => !referenced.has(targetId))
    assert.deepEqual(missing, [])
    const scannerOfflineRoutes = routeEvidenceDispositions
      .filter(({ targetIds }) => targetIds.includes('34A'))
      .map(({ routePattern }) => routePattern)
    assert.deepEqual(sorted(scannerOfflineRoutes), ['/scan/settings', '/scan/start'])
  })
}

check('runbook records the executable evidence boundary', () => {
  const runbook = readFileSync(runbookPath, 'utf8')
  for (const token of [
    '77 个主视觉目标',
    '5 个 Fusion 状态参考',
    '87 条路由',
    '`contract-fixture`',
    '`test-results/kiosk-p1-visual-evidence/<sha>/`',
    '`NO_INDEPENDENT_PROTOTYPE`',
    '`/scan/start#pre-session`',
    '`/scan/settings#session-create-failed`',
  ]) assert.ok(runbook.includes(token), `runbook missing ${token}`)
  assert.ok(runbook.includes('本合同不代表 82 个目标已完成逐屏像素验收'), 'runbook must reject an 82-screen completion claim')
})

if (failures > 0) process.exitCode = 1
else console.log('ALL PASS kiosk P1 visual evidence manifest contract')
