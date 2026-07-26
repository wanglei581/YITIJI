#!/usr/bin/env node
/**
 * Dependency security gate:
 * - fail closed on audit/network/JSON errors
 * - allow at most one accepted-unreachable high: GHSA-qwww-vcr4-c8h2 (React Router RSC)
 * - allow GHSA-mh99-v99m-4gvg only when every 1.x/2.x finding is locally patched and runtime-tested,
 *   or the installed 5.x version contains the upstream fix (forcing 5.x globally breaks minimatch@3/5)
 * - require SPA architecture guard for the RSC exception
 * - require the pinned pnpm 11 toolchain and workspace-level dependency settings
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const ACCEPTED_UNREACHABLE_HIGH = 'GHSA-qwww-vcr4-c8h2'
const OVERBROAD_BRACE_EXPANSION_HIGH = 'GHSA-mh99-v99m-4gvg'
const FRONTENDS = ['admin', 'kiosk', 'partner']
const REQUIRED_BRACE_PATCHES = {
  'brace-expansion@1.1.16': 'patches/brace-expansion@1.1.16.patch',
  'brace-expansion@2.1.2': 'patches/brace-expansion@2.1.2.patch',
}
const REQUIRED_BRACE_OVERRIDES = {
  'brace-expansion@1.1.14': '1.1.16',
  'brace-expansion@2.1.1': '2.1.2',
  'brace-expansion@5.0.6': '5.0.8',
}
const REQUIRED_PNPM_VERSION = '11.2.2'

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

function runAudit(extraArgs = []) {
  const result = spawnSync('pnpm', ['audit', ...extraArgs, '--audit-level=high', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 40 * 1024 * 1024,
  })
  const stdout = result.stdout || ''
  if (!stdout.trim()) {
    fail(
      `pnpm audit ${extraArgs.join(' ')} produced empty stdout (status=${result.status}): ${result.stderr || ''}`.trim()
    )
  }
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    fail(`pnpm audit ${extraArgs.join(' ')} returned non-JSON: ${error.message}`)
  }
  return parsed
}

function highAdvisories(auditJson) {
  return Object.values(auditJson.advisories || {}).filter(
    (item) => item.severity === 'high' || item.severity === 'critical'
  )
}

function advisoryId(item) {
  return item.github_advisory_id || (String(item.url || '').match(/GHSA-[a-z0-9-]+/i)?.[0] ?? null)
}

function assertPnpmToolchain() {
  const pkg = readJson(path.join(root, 'package.json'))
  const workspace = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')
  assert.equal(
    pkg.packageManager,
    `pnpm@${REQUIRED_PNPM_VERSION}`,
    'packageManager must pin the CI/deployment pnpm version'
  )
  assert.equal(
    pkg.engines?.node,
    '>=22.13 <23',
    'engines.node must match the supported Node 22 LTS line required by pnpm 11.2.2'
  )
  assert.equal(pkg.engines?.pnpm, '>=11.2.2 <12', 'engines.pnpm must reject unsupported pnpm lines')
  assert.equal(
    pkg.pnpm,
    undefined,
    'pnpm 11 project settings must not be duplicated in package.json'
  )
  assert.match(workspace, /^engineStrict:\s*true\s*$/m, 'pnpm-workspace.yaml must enforce engines')

  const versionResult = spawnSync('pnpm', ['--version'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(
    versionResult.status,
    0,
    `unable to execute pnpm --version: ${versionResult.stderr || ''}`
  )
  assert.equal(
    versionResult.stdout.trim(),
    REQUIRED_PNPM_VERSION,
    `dependency security gate requires pnpm ${REQUIRED_PNPM_VERSION}`
  )
}

function assertSecurityOverrides() {
  const workspace = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')
  const workspaceMap = workspaceMapping(workspace, 'overrides')
  assert.equal(
    workspaceMap['brace-expansion'],
    undefined,
    'brace-expansion must not be overridden across incompatible major versions'
  )
  for (const [selector, version] of Object.entries(REQUIRED_BRACE_OVERRIDES)) {
    assert.equal(
      workspaceMap[selector],
      version,
      `missing required brace-expansion override: ${selector} -> ${version}`
    )
  }
}

function workspaceMapping(workspace, blockName) {
  const block = workspace.match(new RegExp(`^${blockName}:\\n((?:[ \\t].*(?:\\n|$))*)`, 'm'))
  assert.ok(block, `pnpm-workspace.yaml must declare ${blockName}`)
  const mapping = {}
  for (const line of block[1].split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = /^\s+('([^']+)'|([^:#]+)):\s*(.+)\s*$/.exec(line)
    if (!match) continue
    const key = match[2] || match[3]
    mapping[key.trim()] = match[4].trim()
  }
  return mapping
}

function assertBracePatchesDeclared() {
  const workspace = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')
  const workspacePatches = workspaceMapping(workspace, 'patchedDependencies')

  for (const [selector, relativePatch] of Object.entries(REQUIRED_BRACE_PATCHES)) {
    assert.equal(
      workspacePatches[selector],
      relativePatch,
      `missing required local patch declaration: ${selector}`
    )
    const patch = fs.readFileSync(path.join(root, relativePatch), 'utf8')
    assert.match(patch, /CVE-2026-14257/, `${relativePatch} must identify the remediated CVE`)
    assert.match(
      patch,
      /EXPANSION_MAX_LENGTH/,
      `${relativePatch} must include the total expansion length guard`
    )
  }
}

function virtualStoreEntries(packagePrefix) {
  const virtualStore = path.join(root, 'node_modules', '.pnpm')
  const matches = fs
    .readdirSync(virtualStore)
    .filter((entry) => entry === packagePrefix || entry.startsWith(`${packagePrefix}_`))
  assert.ok(matches.length > 0, `virtual store package not found: ${packagePrefix}`)
  return matches.map((entry) => path.join(virtualStore, entry, 'node_modules'))
}

function virtualStoreEntriesStartingWith(packagePrefix) {
  const virtualStore = path.join(root, 'node_modules', '.pnpm')
  const matches = fs.readdirSync(virtualStore).filter((entry) => entry.startsWith(packagePrefix))
  assert.ok(matches.length > 0, `virtual store package prefix not found: ${packagePrefix}`)
  return matches.map((entry) => path.join(virtualStore, entry, 'node_modules'))
}

function assertBracePatchRuntime(braceVersion) {
  const packageRoots = virtualStoreEntries(`brace-expansion@${braceVersion}`).filter(
    (packageRoot) => packageRoot.includes('_patch_hash=')
  )
  assert.equal(
    packageRoots.length,
    1,
    `expected exactly one patched virtual-store instance for brace-expansion@${braceVersion}`
  )
  const requireFromPatch = createRequire(
    path.join(packageRoots[0], 'brace-expansion', 'package.json')
  )
  const expand = requireFromPatch('./index.js')
  const installedVersion = requireFromPatch('./package.json').version
  assert.equal(
    installedVersion,
    braceVersion,
    `patched virtual-store instance must be brace-expansion@${braceVersion}`
  )
  assert.equal(
    typeof expand,
    'function',
    `brace-expansion@${braceVersion} must preserve the callable CommonJS API`
  )

  const normal = expand('{a,b}{c,d}')
  assert.deepEqual(
    normal,
    ['ac', 'ad', 'bc', 'bd'],
    `brace-expansion@${braceVersion} normal behavior changed`
  )
  const bounded = expand('{a,b}{c,d}', { maxLength: 3 })
  assert.ok(
    bounded.length < normal.length,
    `brace-expansion@${braceVersion} must enforce maxLength`
  )
  assert.ok(
    bounded.reduce((total, value) => total + value.length, 0) <= 3,
    `brace-expansion@${braceVersion} exceeded maxLength`
  )
  assert.throws(
    () => expand('{a,b}'.repeat(300)),
    RangeError,
    `brace-expansion@${braceVersion} must reject pathological brace-group depth`
  )
}

function assertMinimatchConsumersUsePatchedBraceVersions() {
  const requiredVersions = new Set(
    Object.keys(REQUIRED_BRACE_PATCHES).map((selector) => selector.slice('brace-expansion@'.length))
  )
  const seenVersions = new Set()
  const minimatchRoots = virtualStoreEntriesStartingWith('minimatch@')

  for (const packageRoot of minimatchRoots) {
    const minimatchManifest = path.join(packageRoot, 'minimatch', 'package.json')
    if (!fs.existsSync(minimatchManifest)) continue
    const requireFromMinimatch = createRequire(minimatchManifest)
    let braceVersion
    try {
      braceVersion = requireFromMinimatch('brace-expansion/package.json').version
    } catch {
      continue
    }
    if (!requiredVersions.has(braceVersion)) continue

    const resolvedBrace = requireFromMinimatch.resolve('brace-expansion')
    assert.ok(
      resolvedBrace.includes(`${path.sep}brace-expansion@${braceVersion}_patch_hash=`),
      `minimatch consumer resolved an unpatched brace-expansion@${braceVersion}: ${resolvedBrace}`
    )
    assert.equal(
      typeof requireFromMinimatch('brace-expansion'),
      'function',
      `minimatch consumer must retain callable brace-expansion@${braceVersion}`
    )

    const minimatchModule = requireFromMinimatch('minimatch')
    const minimatch =
      typeof minimatchModule === 'function' ? minimatchModule : minimatchModule.minimatch
    assert.equal(
      typeof minimatch,
      'function',
      `unable to resolve callable minimatch from ${minimatchManifest}`
    )
    assert.equal(
      minimatch('ac', '{a,b}{c,d}'),
      true,
      `minimatch consumer failed a normal brace pattern with brace-expansion@${braceVersion}`
    )
    seenVersions.add(braceVersion)
  }

  assert.deepEqual(
    [...seenVersions].sort(),
    [...requiredVersions].sort(),
    'every locally patched brace-expansion version must be exercised through a real minimatch consumer'
  )
}

function assertBracePatchesEffective() {
  for (const selector of Object.keys(REQUIRED_BRACE_PATCHES)) {
    assertBracePatchRuntime(selector.slice('brace-expansion@'.length))
  }
  assertMinimatchConsumersUsePatchedBraceVersions()
}

function collectSourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage')
      continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(full, out)
      continue
    }
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

function assertSpaArchitectureGuard() {
  const forbiddenImport = /@react-router\/(dev|node|express|serve|cloudflare)/
  const forbiddenApis =
    /\b(hydrateRoot|renderToPipeableStream|renderToReadableStream|StaticRouterProvider|createStaticHandler)\b/
  const forbiddenRouteExport = /\b(clientLoader|clientAction|loader|action|middleware)\s*[:=]/

  for (const app of FRONTENDS) {
    const manifestPath = path.join(root, 'apps', app, 'package.json')
    const manifest = readJson(manifestPath)
    assert.ok(
      manifest.dependencies?.['react-router-dom'] || manifest.devDependencies?.['react-router-dom'],
      `${app} must depend on react-router-dom`
    )
    assert.ok(
      manifest.devDependencies?.vite || manifest.dependencies?.vite,
      `${app} must remain a Vite SPA (vite dependency required)`
    )
    assert.equal(
      manifest.dependencies?.['@react-router/dev'],
      undefined,
      `${app} must not depend on @react-router/dev`
    )
    assert.equal(
      manifest.dependencies?.['@react-router/node'],
      undefined,
      `${app} must not depend on @react-router/node`
    )

    const files = [
      ...collectSourceFiles(path.join(root, 'apps', app, 'src')),
      path.join(root, 'apps', app, 'vite.config.ts'),
      path.join(root, 'apps', app, 'react-router.config.ts'),
    ].filter((file) => fs.existsSync(file))

    let sawCreateBrowserRouter = false
    let sawRouterProvider = false
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8')
      if (forbiddenImport.test(text))
        fail(`${app}: forbidden React Router package import in ${path.relative(root, file)}`)
      if (forbiddenApis.test(text))
        fail(`${app}: forbidden SSR/RSC API in ${path.relative(root, file)}`)
      // Route module exports named loader/action are Framework Mode; SPA route tables use element/Component.
      if (
        file.includes(`${path.sep}routes${path.sep}`) &&
        forbiddenRouteExport.test(text) &&
        !text.includes('createBrowserRouter')
      ) {
        // Allow local helper names only outside route modules; still block Framework-style route exports.
        if (
          /\bexport\s+(async\s+)?function\s+(loader|action|clientLoader|clientAction|middleware)\b/.test(
            text
          ) ||
          /\bexport\s+const\s+(loader|action|clientLoader|clientAction|middleware)\b/.test(text)
        ) {
          fail(`${app}: Framework Mode route export in ${path.relative(root, file)}`)
        }
      }
      if (/\bcreateBrowserRouter\b/.test(text)) sawCreateBrowserRouter = true
      if (/\bRouterProvider\b/.test(text)) sawRouterProvider = true
    }
    assert.ok(sawCreateBrowserRouter, `${app} must use createBrowserRouter`)
    assert.ok(sawRouterProvider, `${app} must use RouterProvider`)
  }
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || ''))
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

function isUpstreamPatchedBraceExpansion(version) {
  const parsed = parseSemver(version)
  if (!parsed) return false
  if (parsed.major === 5) return parsed.minor > 0 || parsed.patch >= 8
  return false
}

function isRemediatedBraceExpansion(item) {
  if (
    advisoryId(item) !== OVERBROAD_BRACE_EXPANSION_HIGH ||
    item.module_name !== 'brace-expansion'
  ) {
    return false
  }
  const versions = (item.findings || []).map((finding) => finding.version).filter(Boolean)
  if (versions.length === 0) return false
  return versions.every(
    (version) =>
      isUpstreamPatchedBraceExpansion(version) ||
      Object.hasOwn(REQUIRED_BRACE_PATCHES, `brace-expansion@${version}`)
  )
}

function assertAuditAcceptable(label, auditJson) {
  const highs = highAdvisories(auditJson)
  const unexpected = []
  let acceptedRsc = 0
  let acceptedBrace = 0
  for (const item of highs) {
    const id = advisoryId(item)
    if (id === ACCEPTED_UNREACHABLE_HIGH && item.module_name === 'react-router') {
      acceptedRsc += 1
      continue
    }
    if (isRemediatedBraceExpansion(item)) {
      acceptedBrace += 1
      continue
    }
    unexpected.push(`${item.severity} ${item.module_name} ${id || item.url || item.title}`)
  }
  if (unexpected.length > 0) {
    fail(`${label}: unaccepted critical/high advisories remain:\n- ${unexpected.join('\n- ')}`)
  }
  if (acceptedRsc > 1) {
    fail(
      `${label}: accepted unreachable high counted ${acceptedRsc} times; expected at most one advisory object`
    )
  }
  console.log(
    `OK: ${label} — unaccepted critical/high = 0; accepted-unreachable RSC (${ACCEPTED_UNREACHABLE_HIGH}) = ${acceptedRsc}; locally-patched brace-expansion (${OVERBROAD_BRACE_EXPANSION_HIGH}) = ${acceptedBrace}`
  )
}

console.log('\n=== verify dependency security ===')
assertPnpmToolchain()
assertSecurityOverrides()
console.log(`OK: pnpm ${REQUIRED_PNPM_VERSION} pinned; workspace security overrides verified`)
assertBracePatchesDeclared()
assertBracePatchesEffective()
console.log('OK: brace-expansion 1.x/2.x local CVE patch declarations and runtime limits verified')
assertSpaArchitectureGuard()
console.log('OK: Admin/Kiosk/Partner remain Vite SPA + createBrowserRouter Data Mode')

const fullAudit = runAudit([])
const prodAudit = runAudit(['--prod'])
assertAuditAcceptable('full tree', fullAudit)
assertAuditAcceptable('--prod', prodAudit)

const fullMeta = fullAudit.metadata?.vulnerabilities || {}
const prodMeta = prodAudit.metadata?.vulnerabilities || {}
console.log(`audit metadata full=${JSON.stringify(fullMeta)} prod=${JSON.stringify(prodMeta)}`)
console.log('ALL PASS: dependency security gate')
